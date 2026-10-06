/**
 * Rejoue la migration Supabase sur un vrai PostgreSQL (PGlite, en mémoire) et vérifie le cloisonnement RLS.
 *
 * Usage :  node supabase/tests/rls_test.mjs
 * Prérequis : @electric-sql/pglite résolvable (il est dans les dépendances du dépôt : `npm ci`),
 * ou définir PGLITE_PATH vers un autre répertoire node_modules.
 *
 * Le stub reproduit le strict minimum de Supabase : schémas auth / storage / extensions, auth.users, auth.identities,
 * auth.uid(), les rôles anon / authenticated / service_role, storage.buckets / storage.objects, storage.foldername()
 * et pgcrypto (fourni par PGlite : crypt / gen_salt réels). La section 10 rejoue seed_demo.sql deux fois, la 11 teste
 * les RPC / triggers / vues de la migration 2, la 12 rejoue admin_production.sql (placeholders substitués).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const ici = dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  process.env.PGLITE_PATH ? join(resolve(process.env.PGLITE_PATH), "x.js") : import.meta.url,
);
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");

const MIGRATION = join(ici, "..", "migrations", "20261005000000_s4m_initial.sql");
const MIGRATION2 = join(ici, "..", "migrations", "20261005000100_s4m_rpc.sql");
const SEED = join(ici, "..", "seed_demo.sql");
const ADMIN_PROD = join(ici, "..", "admin_production.sql");

const STUB = `
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz
);
create table auth.identities (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  provider_id text,
  provider text,
  identity_data jsonb,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  unique (provider_id, provider)
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (
  id uuid default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end $$;
grant usage on schema auth, storage to anon, authenticated, service_role;
grant select on storage.objects, storage.buckets to anon, authenticated, service_role;
grant insert, update, delete on storage.objects to authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
let echecs = 0;
let ok = 0;
function verifier(libelle, condition) {
  if (condition) {
    ok++;
    console.log(`  ✓ ${libelle}`);
  } else {
    echecs++;
    console.log(`  ✗ ${libelle}`);
  }
}

const db = new PGlite({ extensions: { pgcrypto } });

// ── 1. Stub puis migration ──────────────────────────────────────────────────────────────────────
console.log("1. Stub Supabase");
await db.exec(STUB);
console.log("2. Migrations");
await db.exec(readFileSync(MIGRATION, "utf8"));
await db.exec(readFileSync(MIGRATION2, "utf8"));
console.log("   migrations 1 et 2 appliquées sans erreur");

// ── 2. Jeu de données (en tant que postgres = service) ──────────────────────────────────────────
console.log("3. Jeu de données");
const OF1 = "of-1";
const OF2 = "of-2";
await db.exec(`
  insert into public.organisme_formation (id, of_nom) values ('${OF1}', 'OF Un'), ('${OF2}', 'OF Deux');
`);

/** Simule une inscription Supabase Auth : insert dans auth.users → trigger → profil. */
async function inscrire(email, userMeta = {}, appMeta = {}) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3, $4)`,
    [id, email, JSON.stringify(userMeta), JSON.stringify(appMeta)],
  );
  return id;
}

// Admin de l'OF1 et de l'OF2 : via app_metadata (service).
const admin1 = await inscrire(
  "admin1@of1.fr",
  { prenom: "Alice", nom: "Admin" },
  { s4m_role: "admin", of_id: OF1 },
);
const admin2 = await inscrire("admin2@of2.fr", {}, { s4m_role: "admin", of_id: OF2 });

// Tentative d'auto-attribution admin via user_metadata : doit être refusée.
let refuse = false;
try {
  await inscrire("pirate@of1.fr", { role: "admin", of_id: OF1 });
} catch (e) {
  refuse = /invitation/i.test(e.message);
}
verifier("auto-attribution du rôle admin via user_metadata refusée", refuse);

// Formateurs A et B de l'OF1 (inscription spontanée), C de l'OF2.
const fA = await inscrire("a@of1.fr", { of_id: OF1, prenom: "Anna", nom: "A" });
const fB = await inscrire("b@of1.fr", { of_id: OF1, prenom: "Bob", nom: "B" });
const fC = await inscrire("c@of2.fr", { of_id: OF2, prenom: "Carl", nom: "C" });
const idFormateur = async (uid) =>
  (await db.query(`select id from public.formateur where utilisateur_id = $1`, [uid])).rows[0].id;
const formA = await idFormateur(fA);
const formB = await idFormateur(fB);
const formC = await idFormateur(fC);
// Les candidatures sont validées par le service.
await db.exec(
  `update public.formateur set statut_candidature = 'validee', decidee_le = now(), formateur_iban = 'FR76XXXX', formateur_tarif_journalier = 80000`,
);

// Entreprise, stagiaires, formation et dossier pour A ; idem B ; idem C (OF2).
async function monterDossier(of, form, suffixe) {
  const ent = `ent-${suffixe}`;
  const st = `st-${suffixe}`;
  const fo = `fo-${suffixe}`;
  const d = `d-${suffixe}`;
  await db.exec(`
    insert into public.entreprise_cliente (id, of_id, formateur_id, entreprise_nom) values ('${ent}', '${of}', '${form}', 'Client ${suffixe}');
    insert into public.stagiaire (id, of_id, formateur_id, entreprise_id, stagiaire_prenom, stagiaire_nom, stagiaire_email)
      values ('${st}', '${of}', '${form}', '${ent}', 'Stag', '${suffixe}', 'stag-${suffixe}@client.fr');
    insert into public.formation (id, of_id, formateur_id, formation_titre) values ('${fo}', '${of}', '${form}', 'Formation ${suffixe}');
    insert into public.dossier_formation (id, of_id, dossier_reference, formateur_id, entreprise_id, formation_id, formation_titre, sous_statut)
      values ('${d}', '${of}', 'ADF-2026-${suffixe}', '${form}', '${ent}', '${fo}', 'Formation ${suffixe}', 'accord_financement');
    insert into public.stagiaire_dossier (dossier_id, stagiaire_id) values ('${d}', '${st}');
    insert into public.piece_dossier (dossier_id, code, stagiaire_id) values
      ('${d}', '02-AVT', null), ('${d}', '04-AVT', null), ('${d}', '10-FIN', null), ('${d}', '05-AVT', '${st}');
    insert into public.facture_of (dossier_id, facture_of_numero, facture_of_date) values ('${d}', 'FA-2026-${suffixe}', '2026-10-05');
    insert into public.evenement (of_id, dossier_id, acteur_role, type, libelle) values ('${of}', '${d}', 'systeme', 'test', 'Journal ${suffixe}');
    insert into public.coffre_fichier (of_id, formateur_id, formation_id, nom_fichier, chemin, taille, partageable)
      values ('${of}', '${form}', '${fo}', 'support.pdf', '${of}/coffres/${fo}/support.pdf', 10, true),
             ('${of}', '${form}', '${fo}', 'prive.pdf', '${of}/coffres/${fo}/prive.pdf', 10, false);
    insert into storage.objects (bucket_id, name) values ('coffre', '${of}/coffres/${fo}/support.pdf'), ('coffre', '${of}/coffres/${fo}/prive.pdf'),
      ('archive', '${of}/dossiers/ADF-2026-${suffixe}/Retour/piece.pdf');
  `);
  return { ent, st, fo, d };
}
const A = await monterDossier(OF1, formA, "A");
const B = await monterDossier(OF1, formB, "B");
const C = await monterDossier(OF2, formC, "C");

// Second stagiaire sur le dossier A (pour vérifier que l'apprenant ne voit pas les pièces d'un autre).
await db.exec(`
  insert into public.stagiaire (id, of_id, formateur_id, entreprise_id, stagiaire_prenom, stagiaire_nom) values ('st-A2', '${OF1}', '${formA}', '${A.ent}', 'Autre', 'A2');
  insert into public.stagiaire_dossier (dossier_id, stagiaire_id, rang) values ('${A.d}', 'st-A2', 2);
  insert into public.piece_dossier (dossier_id, code, stagiaire_id) values ('${A.d}', '05-AVT', 'st-A2');
`);

// Apprenant du dossier A : invité par A, puis inscrit avec le jeton.
const jeton = "jeton-apprenant-A";
await db.query(
  `insert into public.invitation (jeton_hash, of_id, email, role, prenom, nom, stagiaire_id, expire_le)
   values ($1, $2, $3, 'apprenant', 'Stag', 'A', $4, now() + interval '14 days')`,
  [sha256(jeton), OF1, "stag-A@client.fr", A.st],
);
const app = await inscrire("stag-A@client.fr", { invitation: jeton });
const lie = (await db.query(`select utilisateur_id from public.stagiaire where id = $1`, [A.st]))
  .rows[0].utilisateur_id;
verifier("le trigger relie le compte apprenant à sa fiche stagiaire", lie === app);
const inv = (
  await db.query(`select utilisee_le from public.invitation where jeton_hash = $1`, [sha256(jeton)])
).rows[0];
verifier("l'invitation est consommée", inv.utilisee_le !== null);

// Rejouer le même jeton doit échouer.
let rejeu = false;
try {
  await inscrire("stag-A@client.fr", { invitation: jeton });
} catch (e) {
  rejeu = true;
}
verifier("un jeton d'invitation déjà utilisé est refusé", rejeu);

// ── 3. Tests RLS en tant qu'utilisateur authentifié ─────────────────────────────────────────────
/** Exécute `fn` dans une transaction avec `set role authenticated` et le claim sub de l'utilisateur. */
async function enTantQue(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(
      `set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`,
    );
    try {
      return await fn(tx);
    } finally {
      await tx.exec(`reset role;`);
    }
  });
}
const compter = async (tx, sql, params = []) =>
  Number((await tx.query(`select count(*)::int as n from (${sql}) q`, params)).rows[0].n);

console.log("4. Formateur A");
await enTantQue(fA, async (tx) => {
  verifier(
    "A voit son dossier",
    (await compter(tx, `select 1 from public.dossier_formation where id = '${A.d}'`)) === 1,
  );
  verifier(
    "A ne voit PAS le dossier de B (même OF)",
    (await compter(tx, `select 1 from public.dossier_formation where id = '${B.d}'`)) === 0,
  );
  verifier(
    "A ne voit PAS le dossier de C (OF2)",
    (await compter(tx, `select 1 from public.dossier_formation where id = '${C.d}'`)) === 0,
  );
  verifier(
    "A ne liste que ses formations",
    (await compter(tx, `select 1 from public.formation`)) === 1,
  );
  verifier(
    "A ne liste que ses stagiaires",
    (await compter(tx, `select 1 from public.stagiaire`)) === 2,
  );
  verifier(
    "A ne liste que ses entreprises",
    (await compter(tx, `select 1 from public.entreprise_cliente`)) === 1,
  );
  verifier(
    "A voit son coffre complet (2 fichiers)",
    (await compter(tx, `select 1 from public.coffre_fichier`)) === 2,
  );
  verifier(
    "A voit toutes les pièces de son dossier (ODM et facture comprises)",
    (await compter(tx, `select 1 from public.piece_dossier`)) === 5,
  );
  verifier("A voit sa facture OF", (await compter(tx, `select 1 from public.facture_of`)) === 1);
  verifier(
    "A voit le journal de son dossier seulement",
    (await compter(tx, `select 1 from public.evenement where dossier_id is not null`)) === 1,
  );
  verifier(
    "A ne lit pas les compteurs",
    (await compter(tx, `select 1 from public.compteur`)) === 0,
  );
  verifier("A ne lit pas les réglages", (await compter(tx, `select 1 from public.reglage`)) === 0);
  verifier(
    "A (formateur) ne lit pas la table organisme_formation (IBAN, commission)",
    (await compter(tx, `select 1 from public.organisme_formation`)) === 0,
  );
  verifier(
    "A lit son organisme via organisme_public",
    (await compter(tx, `select 1 from public.organisme_public`)) === 1,
  );
  verifier(
    "A voit son profil et celui de son apprenant, pas ceux de B/admin",
    (await compter(tx, `select 1 from public.utilisateur`)) === 2,
  );
  verifier(
    "storage : A lit son coffre, pas celui de B",
    (await compter(tx, `select 1 from storage.objects where bucket_id = 'coffre'`)) === 2,
  );
  verifier(
    "storage : A lit l'archive de son dossier seulement",
    (await compter(tx, `select 1 from storage.objects where bucket_id = 'archive'`)) === 1,
  );

  // Écriture : A ne peut pas modifier le dossier de B, ni le sien hors brouillon.
  const maj = await tx.query(
    `update public.dossier_formation set formation_titre = 'X' where id = '${B.d}' returning id`,
  );
  verifier("A ne peut pas modifier le dossier de B (0 ligne)", maj.rows.length === 0);
  const majA = await tx.query(
    `update public.dossier_formation set formation_titre = 'X' where id = '${A.d}' returning id`,
  );
  verifier("A ne peut pas modifier son dossier hors brouillon (0 ligne)", majA.rows.length === 0);
  let evenement = false;
  try {
    await tx.query(`savepoint s2`);
    await tx.query(
      `insert into public.evenement (of_id, acteur_role, type, libelle) values ('${OF1}', 'formateur', 'x', 'x')`,
    );
  } catch (e) {
    evenement = /row-level security/i.test(e.message);
    await tx.query(`rollback to savepoint s2`);
  }
  verifier("A ne peut pas écrire dans le journal", evenement);
  let facture = false;
  try {
    await tx.query(`savepoint s3`);
    await tx.query(
      `insert into public.facture_of (dossier_id, facture_of_numero, facture_of_date) values ('${B.d}', 'X', '2026-01-01')`,
    );
  } catch (e) {
    facture = /row-level security/i.test(e.message);
    await tx.query(`rollback to savepoint s3`);
  }
  verifier("A ne peut pas créer de facture", facture);
  let piece = false;
  try {
    await tx.query(`savepoint s4`);
    await tx.query(
      `update public.piece_dossier set empreinte_retour = 'faux' where dossier_id = '${A.d}'`,
    );
    const r = await tx.query(
      `select count(*)::int as n from public.piece_dossier where empreinte_retour = 'faux'`,
    );
    piece = r.rows[0].n === 0;
  } catch (e) {
    piece = /row-level security|permission/i.test(e.message);
    await tx.query(`rollback to savepoint s4`);
  }
  verifier("A ne peut pas sceller / modifier une pièce", piece);
  // Un formateur ne valide pas sa propre candidature.
  let candid = false;
  try {
    await tx.query(`savepoint s5`);
    await tx.query(
      `update public.formateur set statut_candidature = 'refusee' where id = '${formA}'`,
    );
  } catch (e) {
    candid = /candidat/i.test(e.message);
    await tx.query(`rollback to savepoint s5`);
  }
  verifier("A ne décide pas de sa propre candidature", candid);
  // Insertion légitime : A crée un dossier brouillon.
  const cree = await tx.query(
    `insert into public.dossier_formation (of_id, dossier_reference, formateur_id, entreprise_id, formation_titre) values ('${OF1}', 'ADF-2026-A2', '${formA}', '${A.ent}', 'Nouveau') returning id`,
  );
  verifier("A crée un dossier brouillon", cree.rows.length === 1);
  const majBrouillon = await tx.query(
    `update public.dossier_formation set formation_titre = 'Nouveau 2' where id = '${cree.rows[0].id}' returning id`,
  );
  verifier("A modifie son dossier brouillon", majBrouillon.rows.length === 1);
  let bloque = false;
  try {
    await tx.query(`savepoint s1`);
    await tx.query(
      `update public.dossier_formation set sous_statut = 'dossier_valide' where id = '${cree.rows[0].id}'`,
    );
  } catch (e) {
    bloque = /Edge Function/.test(e.message);
    await tx.query(`rollback to savepoint s1`);
  }
  verifier("A ne peut pas changer le sous-statut de son brouillon (trigger garde-fou)", bloque);
  let usurpation = false;
  try {
    await tx.query(`savepoint s6`);
    await tx.query(
      `insert into public.dossier_formation (of_id, dossier_reference, formateur_id, entreprise_id) values ('${OF1}', 'ADF-2026-X', '${formB}', '${B.ent}')`,
    );
  } catch (e) {
    usurpation = /row-level security/i.test(e.message);
    await tx.query(`rollback to savepoint s6`);
  }
  verifier("A ne crée pas de dossier au nom de B", usurpation);
});

console.log("5. Formateur B");
await enTantQue(fB, async (tx) => {
  verifier(
    "B ne voit PAS le dossier de A",
    (await compter(tx, `select 1 from public.dossier_formation where id = '${A.d}'`)) === 0,
  );
  verifier(
    "B ne voit aucune pièce du dossier de A",
    (await compter(tx, `select 1 from public.piece_dossier where dossier_id = '${A.d}'`)) === 0,
  );
  verifier(
    "B ne voit pas le stagiaire de A",
    (await compter(tx, `select 1 from public.stagiaire where id = '${A.st}'`)) === 0,
  );
  verifier(
    "B ne voit pas le coffre de A",
    (await compter(tx, `select 1 from public.coffre_fichier where formation_id = '${A.fo}'`)) === 0,
  );
  verifier(
    "B ne voit pas les séances/journal de A",
    (await compter(tx, `select 1 from public.evenement where dossier_id = '${A.d}'`)) === 0,
  );
  verifier(
    "formateur_public : B ne voit que lui-même",
    (await compter(tx, `select 1 from public.formateur_public where id = '${formB}'`)) === 1 &&
      (await compter(tx, `select 1 from public.formateur_public`)) === 1,
  );
});

console.log("6. Admin OF1 et admin OF2");
await enTantQue(admin1, async (tx) => {
  verifier(
    "admin1 voit les 3 dossiers de l'OF1 (A, A2, B)",
    (await compter(tx, `select 1 from public.dossier_formation`)) === 3,
  );
  verifier(
    "admin1 ne voit rien de l'OF2",
    (await compter(tx, `select 1 from public.dossier_formation where of_id = '${OF2}'`)) === 0,
  );
  verifier(
    "admin1 voit les formateurs de l'OF1 seulement",
    (await compter(tx, `select 1 from public.formateur`)) === 2,
  );
  verifier(
    "admin1 voit le journal de l'OF1",
    (await compter(tx, `select 1 from public.evenement`)) >= 2,
  );
  verifier(
    "admin1 voit toutes les factures de l'OF1",
    (await compter(tx, `select 1 from public.facture_of`)) === 2,
  );
  const dec = await tx.query(
    `update public.formateur set statut_candidature = 'refusee', decidee_le = now() where id = '${formB}' returning id`,
  );
  verifier("admin1 décide d'une candidature", dec.rows.length === 1);
  await tx.query(
    `update public.formateur set statut_candidature = 'validee' where id = '${formB}'`,
  );
});
await enTantQue(admin2, async (tx) => {
  verifier(
    "admin2 (OF2) ne voit rien de l'OF1 : dossiers",
    (await compter(tx, `select 1 from public.dossier_formation where of_id = '${OF1}'`)) === 0,
  );
  verifier(
    "admin2 (OF2) ne voit rien de l'OF1 : stagiaires",
    (await compter(tx, `select 1 from public.stagiaire where of_id = '${OF1}'`)) === 0,
  );
  verifier(
    "admin2 (OF2) ne voit rien de l'OF1 : utilisateurs",
    (await compter(tx, `select 1 from public.utilisateur where of_id = '${OF1}'`)) === 0,
  );
  verifier(
    "admin2 (OF2) ne voit rien de l'OF1 : journal",
    (await compter(tx, `select 1 from public.evenement where of_id = '${OF1}'`)) === 0,
  );
  verifier(
    "admin2 (OF2) voit son propre dossier",
    (await compter(tx, `select 1 from public.dossier_formation`)) === 1,
  );
  verifier(
    "storage : admin2 ne voit aucun objet de l'OF1",
    (await compter(tx, `select 1 from storage.objects where name like '${OF1}/%'`)) === 0,
  );
  verifier(
    "formateur_public : admin2 ne voit que les formateurs de l'OF2",
    (await compter(tx, `select 1 from public.formateur_public`)) === 1,
  );
});

console.log("7. Apprenant du dossier A");
await enTantQue(app, async (tx) => {
  verifier(
    "l'apprenant ne lit plus la table dossier_formation (prix, corrigés)",
    (await compter(tx, `select 1 from public.dossier_formation`)) === 0,
  );
  verifier(
    "l'apprenant voit son dossier via dossier_formation_apprenant",
    (await compter(tx, `select 1 from public.dossier_formation_apprenant where id = '${A.d}'`)) ===
      1,
  );
  verifier(
    "l'apprenant ne voit que son dossier (vue)",
    (await compter(tx, `select 1 from public.dossier_formation_apprenant`)) === 1,
  );
  const codes = (
    await tx.query(`select code, stagiaire_id from public.piece_dossier order by code`)
  ).rows;
  verifier("l'apprenant ne voit PAS l'ODM (04-AVT)", !codes.some((p) => p.code === "04-AVT"));
  verifier("l'apprenant ne voit PAS la facture (10-FIN)", !codes.some((p) => p.code === "10-FIN"));
  verifier(
    "l'apprenant voit la convention (02-AVT, collective)",
    codes.some((p) => p.code === "02-AVT"),
  );
  verifier(
    "l'apprenant voit SA convocation (05-AVT) et pas celle de l'autre stagiaire",
    codes.filter((p) => p.code === "05-AVT").length === 1 &&
      codes.find((p) => p.code === "05-AVT").stagiaire_id === A.st,
  );
  verifier(
    "l'apprenant ne voit aucune facture",
    (await compter(tx, `select 1 from public.facture_of`)) === 0 &&
      (await compter(tx, `select 1 from public.facture_formateur`)) === 0,
  );
  verifier(
    "l'apprenant ne voit pas le journal",
    (await compter(tx, `select 1 from public.evenement`)) === 0,
  );
  verifier(
    "l'apprenant ne voit pas les courriers",
    (await compter(tx, `select 1 from public.courrier`)) === 0,
  );
  verifier(
    "l'apprenant ne voit que sa ligne d'inscription",
    (await compter(tx, `select 1 from public.stagiaire_dossier`)) === 1,
  );
  verifier(
    "l'apprenant ne voit que sa fiche stagiaire",
    (await compter(tx, `select 1 from public.stagiaire`)) === 1,
  );
  verifier(
    "l'apprenant voit le coffre partageable (RG-08) mais pas le fichier privé",
    (await compter(tx, `select 1 from public.coffre_fichier`)) === 1,
  );
  verifier(
    "storage : l'apprenant lit le fichier partageable du coffre seulement",
    (await compter(tx, `select 1 from storage.objects where bucket_id = 'coffre'`)) === 1,
  );
  verifier(
    "storage : l'apprenant ne lit pas l'archive",
    (await compter(tx, `select 1 from storage.objects where bucket_id = 'archive'`)) === 0,
  );
  verifier(
    "l'apprenant ne voit pas les positionnements",
    (await compter(tx, `select 1 from public.positionnement`)) === 0,
  );
  verifier(
    "l'apprenant ne lit AUCUNE ligne de formateur (ni IBAN, ni SIRET, ni tarifs)",
    (await compter(tx, `select 1 from public.formateur`)) === 0,
  );
  verifier(
    "l'apprenant ne lit pas l'IBAN même par colonne ciblée",
    (await compter(
      tx,
      `select formateur_iban from public.formateur where formateur_iban is not null`,
    )) === 0,
  );
  const pub = (await tx.query(`select * from public.formateur_public`)).rows;
  verifier(
    "formateur_public : l'apprenant voit le nom de SON formateur seulement",
    pub.length === 1 && pub[0].id === formA && pub[0].formateur_nom === "A",
  );
  verifier(
    "formateur_public : aucune colonne sensible exposée",
    ![
      "formateur_iban",
      "formateur_bic",
      "formateur_entreprise_siret",
      "formateur_entreprise_adresse",
      "formateur_telephone",
      "formateur_tarif_journalier",
    ].some((c) => c in pub[0]),
  );
  let ecrit = false;
  try {
    await tx.query(`savepoint a1`);
    await tx.query(
      `insert into public.emargement (seance_id, stagiaire_id, signataire, trace_png) values ('x', '${A.st}', 'stagiaire', 'png')`,
    );
  } catch (e) {
    ecrit = /row-level security/i.test(e.message);
    await tx.query(`rollback to savepoint a1`);
  }
  verifier("l'apprenant ne peut pas émarger directement (Edge Function)", ecrit);
  const maj = await tx.query(
    `update public.dossier_formation set formation_titre = 'pirate' where id = '${A.d}' returning id`,
  );
  verifier("l'apprenant ne modifie pas le dossier", maj.rows.length === 0);
  const role = await tx.query(
    `select public.s4m_role() as r, public.s4m_of_id() as o, public.s4m_formateur_id() as f, public.s4m_est_admin() as a`,
  );
  verifier(
    "fonctions d'aide : rôle apprenant, OF1, pas de formateur, pas admin",
    role.rows[0].r === "apprenant" &&
      role.rows[0].o === OF1 &&
      role.rows[0].f === null &&
      role.rows[0].a === false,
  );
  // Mise à jour de son profil : prénom OK, rôle refusé.
  const prof = await tx.query(
    `update public.utilisateur set prenom = 'Moi' where id = '${app}' returning id`,
  );
  verifier("l'apprenant modifie son prénom", prof.rows.length === 1);
  let escalade = false;
  try {
    await tx.query(`savepoint a2`);
    await tx.query(`update public.utilisateur set role = 'admin' where id = '${app}'`);
  } catch (e) {
    escalade = /interdite/i.test(e.message);
    await tx.query(`rollback to savepoint a2`);
  }
  verifier("l'apprenant ne s'auto-promeut pas admin", escalade);
});

// Coffre fermé tant que le dossier n'a pas atteint l'accord de financement.
await db.exec(
  `update public.dossier_formation set sous_statut = 'dossier_depose' where id = '${A.d}'`,
);
await enTantQue(app, async (tx) => {
  verifier(
    "coffre fermé avant l'accord de financement",
    (await compter(tx, `select 1 from public.coffre_fichier`)) === 0,
  );
});

console.log("8. Anonyme");
await db.transaction(async (tx) => {
  await tx.exec(`set local role anon;`);
  let bloque = false;
  try {
    await tx.query(`savepoint n1`);
    await tx.query(`select * from public.dossier_formation`);
  } catch (e) {
    bloque = /permission denied/i.test(e.message);
    await tx.query(`rollback to savepoint n1`);
  }
  verifier("anon n'a aucun accès aux tables", bloque);
  await tx.exec(`reset role;`);
});

console.log("9. Formateur non validé");
const fD = await inscrire("d@of1.fr", { of_id: OF1, prenom: "Dan", nom: "D" });
await enTantQue(fD, async (tx) => {
  verifier(
    "un candidat non validé voit sa fiche formateur",
    (await compter(tx, `select 1 from public.formateur`)) === 1,
  );
  let bloque = false;
  try {
    await tx.query(`savepoint d1`);
    await tx.query(
      `insert into public.formation (of_id, formateur_id, formation_titre) values ('${OF1}', (select id from public.formateur where utilisateur_id = '${fD}'), 'X')`,
    );
  } catch (e) {
    bloque = /row-level security/i.test(e.message);
    await tx.query(`rollback to savepoint d1`);
  }
  verifier("un candidat non validé ne crée pas de formation", bloque);
  const soumis = await tx.query(
    `update public.formateur set statut_candidature = 'soumise', soumise_le = now() where utilisateur_id = '${fD}' returning id`,
  );
  verifier("un candidat soumet sa candidature", soumis.rows.length === 1);
});

await db.close();

// ── 4. Jeu de démonstration (seed_demo.sql) sur une base neuve ──────────────────────────────────
console.log("10. seed_demo.sql");
const db2 = new PGlite({ extensions: { pgcrypto } });
await db2.exec(STUB);
await db2.exec(readFileSync(MIGRATION, "utf8"));
await db2.exec(readFileSync(MIGRATION2, "utf8"));
const seed = readFileSync(SEED, "utf8");
await db2.exec(seed);
await db2.exec(seed); // idempotence
console.log("   seed appliqué deux fois sans erreur");
const uid = async (email) =>
  (await db2.query(`select id from auth.users where email = $1`, [email])).rows[0]?.id;
const sAdmin = await uid("admin@demo.example");
const sSophie = await uid("formatrice@demo.example");
const sMarc = await uid("formateur2@demo.example");
const sAnne = await uid("apprenante@demo.example");
const sPaul = await uid("candidat@demo.example");
verifier(
  "seed : 5 comptes auth, 5 identités",
  (await db2.query(`select count(*)::int as n from auth.users`)).rows[0].n === 5 &&
    (await db2.query(`select count(*)::int as n from auth.identities`)).rows[0].n === 5,
);
verifier(
  "seed : mot de passe vérifiable par crypt()",
  (
    await db2.query(
      `select encrypted_password = extensions.crypt('demonstration-s4m', encrypted_password) as ok from auth.users where id = $1`,
      [sAdmin],
    )
  ).rows[0].ok === true,
);
const roles = Object.fromEntries(
  (await db2.query(`select email, role from public.utilisateur`)).rows.map((r) => [
    r.email,
    r.role,
  ]),
);
verifier(
  "seed : rôles des profils (trigger)",
  roles["admin@demo.example"] === "admin" &&
    roles["formatrice@demo.example"] === "formateur" &&
    roles["formateur2@demo.example"] === "formateur" &&
    roles["apprenante@demo.example"] === "apprenant" &&
    roles["candidat@demo.example"] === "formateur",
);
verifier(
  "seed : un seul profil par compte (idempotence)",
  (await db2.query(`select count(*)::int as n from public.utilisateur`)).rows[0].n === 5,
);
const stat = Object.fromEntries(
  (
    await db2.query(
      `select u.email, f.statut_candidature from public.formateur f join public.utilisateur u on u.id = f.utilisateur_id`,
    )
  ).rows.map((r) => [r.email, r.statut_candidature]),
);
verifier(
  "seed : candidatures validées / brouillon (Paul)",
  stat["formatrice@demo.example"] === "validee" &&
    stat["formateur2@demo.example"] === "validee" &&
    stat["candidat@demo.example"] === "brouillon",
);
verifier(
  "seed : 3 fiches formateur, pas de doublon",
  (await db2.query(`select count(*)::int as n from public.formateur`)).rows[0].n === 3,
);
verifier(
  "seed : l'apprenante est reliée à sa fiche stagiaire",
  (await db2.query(`select utilisateur_id from public.stagiaire where id = 'st-demo-anne'`)).rows[0]
    .utilisateur_id === sAnne,
);

async function enTantQue2(u, fn) {
  return db2.transaction(async (tx) => {
    await tx.exec(
      `set local role authenticated; select set_config('request.jwt.claim.sub', '${u}', true);`,
    );
    try {
      return await fn(tx);
    } finally {
      await tx.exec(`reset role;`);
    }
  });
}
await enTantQue2(sAdmin, async (tx) => {
  verifier(
    "démo admin : voit les 2 dossiers, 3 formateurs, 3 formations",
    (await compter(tx, `select 1 from public.dossier_formation`)) === 2 &&
      (await compter(tx, `select 1 from public.formateur`)) === 3 &&
      (await compter(tx, `select 1 from public.formation`)) === 3,
  );
  verifier(
    "démo admin : voit la candidature en brouillon de Paul et ses 3 pièces",
    (await compter(tx, `select 1 from public.formateur where statut_candidature = 'brouillon'`)) ===
      1 && (await compter(tx, `select 1 from public.piece_formateur`)) === 3,
  );
  verifier(
    "démo admin : voit le journal",
    (await compter(tx, `select 1 from public.evenement`)) >= 3,
  );
});
await enTantQue2(sSophie, async (tx) => {
  verifier(
    "démo Sophie : ses 2 dossiers, ses 2 formations, 2 stagiaires, 1 entreprise",
    (await compter(tx, `select 1 from public.dossier_formation`)) === 2 &&
      (await compter(tx, `select 1 from public.formation`)) === 2 &&
      (await compter(tx, `select 1 from public.stagiaire`)) === 2 &&
      (await compter(tx, `select 1 from public.entreprise_cliente`)) === 1,
  );
  verifier(
    "démo Sophie : ne voit pas la formation de Marc",
    (await compter(tx, `select 1 from public.formation where id = 'fo-demo-prospection'`)) === 0,
  );
  verifier(
    "démo Sophie : voit les 10 pièces et le coffre complet",
    (await compter(tx, `select 1 from public.piece_dossier`)) === 10 &&
      (await compter(tx, `select 1 from public.coffre_fichier`)) === 2,
  );
  const maj = await tx.query(
    `update public.dossier_formation set formation_lieu_nom = 'Salle 2' where id = 'd-demo-2' returning id`,
  );
  verifier("démo Sophie : modifie son dossier brouillon", maj.rows.length === 1);
  const majC = await tx.query(
    `update public.dossier_formation set formation_lieu_nom = 'Salle 2' where id = 'd-demo-1' returning id`,
  );
  verifier("démo Sophie : ne modifie pas le dossier en cours", majC.rows.length === 0);
});
await enTantQue2(sMarc, async (tx) => {
  verifier(
    "démo Marc : aucun dossier, aucune pièce, aucun stagiaire de Sophie",
    (await compter(tx, `select 1 from public.dossier_formation`)) === 0 &&
      (await compter(tx, `select 1 from public.piece_dossier`)) === 0 &&
      (await compter(tx, `select 1 from public.stagiaire`)) === 0,
  );
  verifier(
    "démo Marc : sa seule formation",
    (await compter(tx, `select 1 from public.formation`)) === 1,
  );
});
await enTantQue2(sAnne, async (tx) => {
  verifier(
    "démo Anne : voit le dossier Excel seulement (vue apprenant)",
    (await compter(tx, `select 1 from public.dossier_formation_apprenant`)) === 1 &&
      (await compter(
        tx,
        `select 1 from public.dossier_formation_apprenant where id = 'd-demo-1'`,
      )) === 1,
  );
  const codes = (
    await tx.query(`select code, stagiaire_id from public.piece_dossier order by code`)
  ).rows;
  verifier(
    "démo Anne : ni ODM ni facture, sa convocation / son émargement seulement",
    !codes.some((p) => p.code === "04-AVT" || p.code === "10-FIN") &&
      codes.filter((p) => p.stagiaire_id === "st-demo-luc").length === 0 &&
      codes.filter((p) => p.code === "05-AVT").length === 1 &&
      codes.length === 6,
  );
  verifier(
    "démo Anne : coffre ouvert (formation en cours) — support partageable seulement",
    (await compter(tx, `select 1 from public.coffre_fichier`)) === 1,
  );
  verifier(
    "démo Anne : 0 ligne formateur, nom via formateur_public",
    (await compter(tx, `select 1 from public.formateur`)) === 0 &&
      (await tx.query(`select formateur_nom from public.formateur_public`)).rows[0]
        ?.formateur_nom === "Lambert",
  );
  verifier(
    "démo Anne : pas de journal",
    (await compter(tx, `select 1 from public.evenement`)) === 0,
  );
});
await enTantQue2(sPaul, async (tx) => {
  verifier(
    "démo Paul (candidat) : sa fiche seulement, rien d'autre",
    (await compter(tx, `select 1 from public.formateur`)) === 1 &&
      (await compter(tx, `select 1 from public.dossier_formation`)) === 0 &&
      (await compter(tx, `select 1 from public.formation`)) === 0,
  );
});

console.log("11. RPC, triggers et vues (migration 2) sur le jeu de démonstration");
const rpc = async (tx, sql) => (await tx.query(`select ${sql} as r`)).rows[0].r;
await enTantQue2(sAdmin, async (tx) => {
  const moi = await rpc(tx, "public.s4m_moi()");
  verifier(
    "s4m_moi admin : rôle, OF, organisme {nom, couleur}, pas de formateur_id",
    moi.acteur.role === "admin" &&
      moi.acteur.of_id === "of-demo" &&
      moi.acteur.formateur_id === null &&
      moi.acteur.formateur_valide === false &&
      moi.organisme.nom === "ORGANISME DÉMO FORMATION" &&
      typeof moi.organisme.couleur === "string",
  );
  const liste = await rpc(tx, "public.s4m_lister_dossiers()");
  verifier(
    "s4m_lister_dossiers admin : 2 dossiers + etapes/sous_statuts",
    liste.dossiers.length === 2 && liste.etapes.length === 7 && liste.sous_statuts.length === 13,
  );
  const d1 = liste.dossiers.find((d) => d.id === "d-demo-1");
  verifier(
    "s4m_lister_dossiers : forme de carte (libellé, étape, apprenants, formateur, compteur de pièces)",
    d1.libelle_statut === "Formation en cours" &&
      d1.etape === "C" &&
      d1.archive === false &&
      d1.apprenants.join("|") === "Anne Martin|Luc Petit" &&
      d1.formateur === "Sophie Lambert" &&
      d1.pieces_total === 8 &&
      d1.pieces_validees === 4,
  );
  const coffres = await rpc(tx, "public.s4m_coffres_parcours()");
  verifier(
    "s4m_coffres_parcours admin : 3 parcours, agrégats Excel",
    coffres.length === 3 &&
      coffres.find((c) => c.id === "fo-demo-excel").pedagogique === 3 &&
      coffres.find((c) => c.id === "fo-demo-excel").dossiers === 1 &&
      coffres.find((c) => c.id === "fo-demo-excel").formateur === "Sophie Lambert",
  );
  const regl = (await tx.query(`select * from public.reglage_vue`)).rows;
  verifier(
    "reglage_vue admin : une ligne, booléens pour les secrets, aucune colonne ia_cle / smtp_mot_de_passe",
    regl.length === 1 &&
      regl[0].ia_cle_definie === false &&
      !("ia_cle" in regl[0]) &&
      !("smtp_mot_de_passe" in regl[0]),
  );
  const q = await rpc(tx, "public.s4m_questionnaire('d-demo-1', 'acquis', 'st-demo-anne')");
  verifier(
    "s4m_questionnaire admin : ouvert (formation en cours), type acquis",
    q.type === "acquis" && q.ouvert === true && q.reponses === null,
  );
});
// Secret chiffré inséré par le service : jamais en clair dans la vue.
await db2.exec(
  `insert into public.reglage (of_id, cle, valeur, secret) values ('of-demo', 'ia_cle', 'CHIFFRE:abc', true), ('of-demo', 'ia_modele', 'claude-sonnet-5', false) on conflict (of_id, cle) do nothing`,
);
await db2.exec(
  `update public.dossier_formation set questionnaire_acquis = '{"titre":"QCM","questions":[{"enonce":"Q1","propositions":["a","b"],"bonne_reponse":1}]}'::jsonb where id = 'd-demo-1'`,
);
await enTantQue2(sAdmin, async (tx) => {
  const regl = (await tx.query(`select * from public.reglage_vue`)).rows[0];
  verifier(
    "reglage_vue : secret défini → true, valeur jamais exposée, clé non secrète en clair",
    regl.ia_cle_definie === true &&
      regl.ia_modele === "claude-sonnet-5" &&
      !JSON.stringify(regl).includes("CHIFFRE"),
  );
  verifier(
    "reglage (table) : la ligne secrète reste invisible à l'admin",
    (await compter(tx, `select 1 from public.reglage where secret`)) === 0,
  );
});
await enTantQue2(sSophie, async (tx) => {
  const moi = await rpc(tx, "public.s4m_moi()");
  verifier(
    "s4m_moi formatrice : formateur_id + formateur_valide, nom « Sophie Lambert »",
    moi.acteur.role === "formateur" &&
      moi.acteur.formateur_id !== null &&
      moi.acteur.formateur_valide === true &&
      moi.acteur.stagiaire_id === null &&
      moi.acteur.nom === "Sophie Lambert",
  );
  const liste = await rpc(tx, "public.s4m_lister_dossiers()");
  verifier("s4m_lister_dossiers formatrice : ses 2 dossiers", liste.dossiers.length === 2);
  // Duplication de SA formation.
  const copie = await rpc(tx, "public.s4m_dupliquer_formation('fo-demo-excel')");
  verifier(
    "s4m_dupliquer_formation : copie avec « (copie) », même formateur, non archivée",
    copie.formation_titre.endsWith("(copie)") &&
      copie.formateur_id === moi.acteur.formateur_id &&
      copie.archivee === false &&
      copie.id !== "fo-demo-excel",
  );
  // Duplication de la formation d'un AUTRE formateur : interdite (introuvable).
  let interdit = false;
  try {
    await tx.query(`savepoint r1`);
    await rpc(tx, "public.s4m_dupliquer_formation('fo-demo-prospection')");
  } catch (e) {
    interdit = /introuvable/i.test(e.message);
    await tx.query(`rollback to savepoint r1`);
  }
  verifier("s4m_dupliquer_formation interdit sur la formation d'un autre", interdit);
  // Versions : la modification crée une version, la restauration la rejoue.
  await tx.query(
    `update public.formation set formation_titre = 'Excel v2' where id = 'fo-demo-excel'`,
  );
  const versions = (
    await tx.query(
      `select id, libelle, snapshot ->> 'formation_titre' as titre from public.version_objet where objet_id = 'fo-demo-excel' order by cree_le desc`,
    )
  ).rows;
  verifier(
    "trigger version_objet : une version mémorisée avec l'ancien titre",
    versions.length === 1 &&
      versions[0].titre.startsWith("Excel —") &&
      versions[0].libelle.startsWith("Avant la modification"),
  );
  const rest = await rpc(tx, `public.s4m_restaurer_version('${versions[0].id}')`);
  const titre = (
    await tx.query(`select formation_titre from public.formation where id = 'fo-demo-excel'`)
  ).rows[0].formation_titre;
  verifier(
    "s4m_restaurer_version : { type, id } et titre restauré, état courant mémorisé avant",
    rest.type === "formation" &&
      rest.id === "fo-demo-excel" &&
      titre.startsWith("Excel —") &&
      (await compter(
        tx,
        `select 1 from public.version_objet where objet_id = 'fo-demo-excel' and libelle = 'Avant restauration d''une version antérieure'`,
      )) === 1,
  );
  // Journal par trigger : création / archivage de formation.
  await tx.query(
    `update public.formation set archivee = true, archivee_le = now() where id = '${copie.id}'`,
  );
  // Le journal hors dossier n'est lisible que par l'admin (RLS) : vérifié plus bas en service.
  verifier(
    "trigger journal : invisible à la formatrice hors dossier (RLS)",
    (await compter(tx, `select 1 from public.evenement where type = 'formation_archivee'`)) === 0,
  );
  // Séances atomiques.
  const seances = await rpc(
    tx,
    `public.s4m_definir_seances('d-demo-2', '[{"date":"2026-11-02","heure_debut":"09:00","heure_fin":"12:30"},{"date":"2026-11-03","heure_debut":"14:00","heure_fin":"17:00"}]'::jsonb)`,
  );
  verifier(
    "s4m_definir_seances : 2 séances posées sur le brouillon",
    seances.length === 2 && seances[0].date === "2026-11-02",
  );
  let bloque = false;
  try {
    await tx.query(`savepoint r2`);
    await rpc(tx, `public.s4m_definir_seances('d-demo-1', '[]'::jsonb)`);
  } catch (e) {
    bloque = /modifiable/i.test(e.message);
    await tx.query(`rollback to savepoint r2`);
  }
  verifier("s4m_definir_seances refusé sur un dossier non modifiable", bloque);
  const q = await rpc(tx, "public.s4m_questionnaire('d-demo-1', 'acquis', 'st-demo-anne')");
  verifier(
    "s4m_questionnaire formatrice : corrigé présent",
    q.questionnaire.questions[0].bonne_reponse === 1,
  );
  verifier(
    "s4m_piece_visible / s4m_coffre_accessible formatrice",
    (await rpc(tx, "public.s4m_piece_visible('pd-demo-04')")) === true &&
      (await rpc(tx, "public.s4m_coffre_accessible('cf-demo-2')")) === true,
  );
  // Profil : prénom/nom figés après validation ; autre champ journalisé.
  let fige = false;
  try {
    await tx.query(`savepoint r3`);
    await tx.query(
      `update public.formateur set formateur_nom = 'X' where id = '${moi.acteur.formateur_id}'`,
    );
  } catch (e) {
    fige = /validation/i.test(e.message);
    await tx.query(`rollback to savepoint r3`);
  }
  verifier("trigger profil : nom figé après validation", fige);
  await tx.query(
    `update public.formateur set formateur_bio = 'Nouvelle bio' where id = '${moi.acteur.formateur_id}'`,
  );
  verifier(
    "trigger profil : bio modifiée (champ libre)",
    (
      await tx.query(
        `select formateur_bio from public.formateur where id = '${moi.acteur.formateur_id}'`,
      )
    ).rows[0].formateur_bio === "Nouvelle bio",
  );
  const pv = (await tx.query(`select * from public.positionnement_vue`)).rows;
  verifier(
    "positionnement_vue : lisible, sans jeton_hash / brouillon / questionnaire",
    Array.isArray(pv) &&
      !["jeton_hash", "brouillon", "questionnaire", "reponses"].some((c) =>
        (pv[0] ?? {}).hasOwnProperty(c),
      ),
  );
  const fv = (await tx.query(`select * from public.formulaire_apprenant_vue`)).rows;
  verifier(
    "formulaire_apprenant_vue : lisible, sans jeton_hash / brouillon",
    Array.isArray(fv) && !["jeton_hash", "brouillon"].some((c) => (fv[0] ?? {}).hasOwnProperty(c)),
  );
});
verifier(
  "trigger profil (service) : journal profil_modifie avec le champ",
  (
    await db2.query(
      `select count(*)::int as n from public.evenement where type = 'profil_modifie' and libelle like '%formateur_bio%' and acteur_role = 'formateur'`,
    )
  ).rows[0].n === 1,
);
verifier(
  "trigger journal (service) : formation_creee (copie) + formation_archivee, acteur formateur",
  (
    await db2.query(
      `select count(*)::int as n from public.evenement where type = 'formation_creee' and libelle like '%(copie)%' and acteur_role = 'formateur'`,
    )
  ).rows[0].n === 1 &&
    (
      await db2.query(
        `select count(*)::int as n from public.evenement where type = 'formation_archivee'`,
      )
    ).rows[0].n === 1,
);
await enTantQue2(sMarc, async (tx) => {
  verifier(
    "s4m_lister_dossiers Marc : 0 dossier (cloisonnement)",
    (await rpc(tx, "public.s4m_lister_dossiers()")).dossiers.length === 0,
  );
  verifier(
    "s4m_coffres_parcours Marc : son seul parcours",
    (await rpc(tx, "public.s4m_coffres_parcours()")).length === 1,
  );
  verifier(
    "s4m_piece_visible Marc : pièce de Sophie invisible",
    (await rpc(tx, "public.s4m_piece_visible('pd-demo-02')")) === false,
  );
});
await enTantQue2(sAnne, async (tx) => {
  const moi = await rpc(tx, "public.s4m_moi()");
  verifier(
    "s4m_moi apprenante : stagiaire_id, pas de formateur_id",
    moi.acteur.role === "apprenant" &&
      moi.acteur.stagiaire_id === "st-demo-anne" &&
      moi.acteur.formateur_id === null,
  );
  const liste = await rpc(tx, "public.s4m_lister_dossiers()");
  verifier(
    "s4m_lister_dossiers apprenante : 1 dossier, formateur nommé via formateur_public, pièces visibles seulement",
    liste.dossiers.length === 1 &&
      liste.dossiers[0].formateur === "Sophie Lambert" &&
      liste.dossiers[0].pieces_total === 4,
  );
  const coffres = await rpc(tx, "public.s4m_coffres_apprenant()");
  verifier(
    "s4m_coffres_apprenant : dossier Excel, fichier partageable seul",
    coffres.length === 1 &&
      coffres[0].dossier_id === "d-demo-1" &&
      coffres[0].fichiers.length === 1 &&
      coffres[0].fichiers[0].id === "cf-demo-1",
  );
  verifier(
    "s4m_coffres_parcours apprenante : vide",
    (await rpc(tx, "public.s4m_coffres_parcours()")).length === 0,
  );
  const q = await rpc(tx, "public.s4m_questionnaire('d-demo-1', 'acquis', 'st-demo-luc')");
  verifier(
    "s4m_questionnaire apprenante : corrigé retiré, stagiaire forcé au sien",
    q.questionnaire.questions[0].bonne_reponse === undefined &&
      q.questionnaire.questions[0].enonce === "Q1",
  );
  verifier(
    "s4m_piece_visible apprenante : ODM invisible, convention visible",
    (await rpc(tx, "public.s4m_piece_visible('pd-demo-04')")) === false &&
      (await rpc(tx, "public.s4m_piece_visible('pd-demo-02')")) === true,
  );
  verifier(
    "s4m_coffre_accessible apprenante : partageable oui, privé non",
    (await rpc(tx, "public.s4m_coffre_accessible('cf-demo-1')")) === true &&
      (await rpc(tx, "public.s4m_coffre_accessible('cf-demo-2')")) === false,
  );
  verifier(
    "reglage_vue apprenante : vide",
    (await compter(tx, `select 1 from public.reglage_vue`)) === 0,
  );
  let dup = false;
  try {
    await tx.query(`savepoint r4`);
    await rpc(tx, "public.s4m_dupliquer_formation('fo-demo-excel')");
  } catch (e) {
    dup = /introuvable/i.test(e.message);
    await tx.query(`rollback to savepoint r4`);
  }
  verifier("s4m_dupliquer_formation interdit à l'apprenante", dup);
});
await enTantQue2(sPaul, async (tx) => {
  const moi = await rpc(tx, "public.s4m_moi()");
  verifier(
    "s4m_moi candidat : formateur_id présent, formateur_valide false",
    moi.acteur.formateur_id !== null && moi.acteur.formateur_valide === false,
  );
  verifier(
    "s4m_lister_dossiers candidat : vide",
    (await rpc(tx, "public.s4m_lister_dossiers()")).dossiers.length === 0,
  );
  const soumet = await tx.query(
    `update public.formateur set statut_candidature = 'soumise', soumise_le = now() where utilisateur_id = '${sPaul}' and statut_candidature = 'brouillon' returning id`,
  );
  verifier(
    "recette seed : Paul (brouillon complet) soumet sa candidature",
    soumet.rows.length === 1,
  );
  let bloque = false;
  try {
    await tx.query(`savepoint r5`);
    await tx.query(
      `update public.formateur set formateur_bio = 'x' where utilisateur_id = '${sPaul}'`,
    );
  } catch (e) {
    bloque = /en cours d/i.test(e.message);
    await tx.query(`rollback to savepoint r5`);
  }
  verifier("trigger profil : candidature soumise → profil verrouillé", bloque);
});
console.log("13. Relecture indépendante : un test par point de sécurité");
// Sondes rejouées sur la base de démo. Chaque test ÉCHOUAIT sur la version précédente.
const forge = async (u, sql) =>
  enTantQue2(u, async (tx) => {
    try {
      await tx.query(`savepoint f`);
      await tx.query(sql);
      await tx.query(`release savepoint f`);
      return "passe";
    } catch (e) {
      await tx.query(`rollback to savepoint f`);
      return e.message;
    }
  });
const nbEv = async () =>
  (await db2.query(`select count(*)::int as n from public.evenement`)).rows[0].n;
const nbVer = async () =>
  (await db2.query(`select count(*)::int as n from public.version_objet`)).rows[0].n;
await db2.exec(
  `insert into public.organisme_formation (id, of_nom) values ('of-2', 'Autre OF') on conflict do nothing`,
);
{
  const ev0 = await nbEv(),
    v0 = await nbVer();
  const r1 = await forge(
    sMarc,
    `select public.s4m_journal('of-demo', 'd-demo-1', 'faux', 'Événement forgé sur le dossier de Sophie')`,
  );
  const r2 = await forge(
    sMarc,
    `select public.s4m_journal('of-2', null, 'faux', 'Événement forgé dans un autre OF')`,
  );
  const r3 = await forge(
    sMarc,
    `select public.s4m_memoriser_version('of-demo', 'formation', 'fo-demo-excel', '{"formation_titre":"forgé"}'::jsonb, 'forgée')`,
  );
  const r4 = await forge(
    sAnne,
    `select public.s4m_journal('of-demo', 'd-demo-1', 'faux', 'forgé par l''apprenante')`,
  );
  const r5 = await forge(
    sAnne,
    `select public.s4m_memoriser_version('of-demo', 'formation', 'fo-demo-excel', '{}'::jsonb, 'forgée')`,
  );
  verifier(
    "1. formateur2 ne peut pas forger un evenement sur le dossier de Sophie",
    r1 !== "passe",
  );
  verifier("1. formateur2 ne peut pas forger un evenement dans un autre OF", r2 !== "passe");
  verifier(
    "1. formateur2 ne peut pas forger une version_objet sur la formation de Sophie",
    r3 !== "passe",
  );
  verifier(
    "1. l'apprenante ne peut forger ni evenement ni version_objet",
    r4 !== "passe" && r5 !== "passe",
  );
  verifier(
    "1. aucune ligne forgée n'a été écrite",
    (await nbEv()) === ev0 && (await nbVer()) === v0,
  );
  // La garde s4m_est_service() dans un SECURITY DEFINER : vue d'un client, elle doit répondre false.
  await db2.exec(
    `create or replace function public.t_service_definer() returns boolean language sql security definer as $$ select public.s4m_est_service() $$; grant execute on function public.t_service_definer() to authenticated;`,
  );
  const vu = await enTantQue2(
    sMarc,
    async (tx) => (await tx.query(`select public.t_service_definer() as r`)).rows[0].r,
  );
  verifier(
    "1. s4m_est_service() = false pour un client, même appelée depuis un SECURITY DEFINER",
    vu === false,
  );
  const vuJwt = await db2.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`);
    return (await tx.query(`select public.t_service_definer() as r`)).rows[0].r;
  });
  verifier(
    "1. s4m_est_service() = false si le JWT porte role=authenticated (format request.jwt.claims)",
    vuJwt === false,
  );
  verifier(
    "1. s4m_est_service() = true pour le service (postgres sans JWT client)",
    (await db2.query(`select public.s4m_est_service() as r`)).rows[0].r === true,
  );
  await db2.exec(`drop function public.t_service_definer()`);
  // Les garde-fous restent contournés par le service (Edge Function) et non par un client.
  const garde = await forge(
    sSophie,
    `update public.dossier_formation set sous_statut = 'dossier_valide' where id = 'd-demo-2'`,
  );
  verifier(
    "1. le pipeline reste verrouillé pour le client (garde via s4m_est_service)",
    /Edge Function/.test(garde),
  );
}
await enTantQue2(sAnne, async (tx) => {
  verifier(
    "2. l'apprenante ne lit aucune ligne de dossier_formation",
    (await compter(tx, `select 1 from public.dossier_formation`)) === 0,
  );
  const v = (await tx.query(`select * from public.dossier_formation_apprenant`)).rows;
  verifier(
    "2. dossier_formation_apprenant : 1 ligne, sans prix / coût / questionnaires / motifs",
    v.length === 1 &&
      ![
        "formation_prix_unitaire_ht",
        "formation_prix_presentiel_ht",
        "formateur_cout_horaire",
        "questionnaire_positionnement",
        "questionnaire_acquis",
        "motif_renvoi",
        "motif_refus",
      ].some((c) => c in v[0]),
  );
  verifier(
    "2. aucune trace du corrigé dans ce que l'apprenante peut lire",
    !JSON.stringify(v).includes("bonne_reponse"),
  );
  const liste = (await tx.query(`select public.s4m_lister_dossiers() as r`)).rows[0].r;
  verifier(
    "2. s4m_lister_dossiers marche toujours pour l'apprenante",
    liste.dossiers.length === 1 &&
      liste.dossiers[0].id === "d-demo-1" &&
      liste.dossiers[0].formateur === "Sophie Lambert",
  );
  const q = (await tx.query(`select public.s4m_questionnaire('d-demo-1', 'acquis') as r`)).rows[0]
    .r;
  verifier(
    "2. s4m_questionnaire marche toujours pour l'apprenante, sans corrigé",
    q.questionnaire.questions.length === 1 && !JSON.stringify(q).includes("bonne_reponse"),
  );
  verifier(
    "2. s4m_coffres_apprenant marche toujours",
    (await tx.query(`select public.s4m_coffres_apprenant() as r`)).rows[0].r.length === 1,
  );
  verifier(
    "2. coffre_fichier (RLS) ouvert à l'apprenante sans lire dossier_formation",
    (await compter(tx, `select 1 from public.coffre_fichier`)) === 1,
  );
});
await enTantQue2(sMarc, async (tx) => {
  let refuse = false;
  try {
    await tx.query(`savepoint q`);
    await tx.query(`select public.s4m_questionnaire('d-demo-1', 'acquis', 'st-demo-anne')`);
  } catch (e) {
    refuse = /introuvable/i.test(e.message);
    await tx.query(`rollback to savepoint q`);
  }
  verifier("2. s4m_questionnaire (definer) refuse un formateur étranger au dossier", refuse);
  verifier(
    "2. dossier_formation_apprenant vide pour un formateur",
    (await compter(tx, `select 1 from public.dossier_formation_apprenant`)) === 0,
  );
});
for (const [nom, u] of [
  ["apprenante", sAnne],
  ["formatrice", sSophie],
]) {
  await enTantQue2(u, async (tx) => {
    verifier(
      `3. ${nom} : 0 ligne dans organisme_formation (IBAN, BIC, commission, signature)`,
      (await compter(tx, `select 1 from public.organisme_formation`)) === 0,
    );
    const o = (await tx.query(`select * from public.organisme_public`)).rows;
    verifier(
      `3. ${nom} : organisme_public = 1 ligne sans of_iban / of_bic / portage / signature`,
      o.length === 1 &&
        o[0].of_nom === "ORGANISME DÉMO FORMATION" &&
        ![
          "of_iban",
          "of_bic",
          "of_banque_nom",
          "portage_commission_pourcentage",
          "signature_representant_png",
          "tva_pourcentage",
        ].some((c) => c in o[0]) &&
        !JSON.stringify(o).includes("FR00 0000"),
    );
    const moi = (await tx.query(`select public.s4m_moi() as r`)).rows[0].r;
    verifier(
      `3. ${nom} : s4m_moi renvoie toujours organisme { nom, couleur }`,
      moi.organisme.nom === "ORGANISME DÉMO FORMATION" && moi.organisme.couleur === "#1d6a45",
    );
  });
}
await enTantQue2(sAdmin, async (tx) => {
  verifier(
    "3. admin : table organisme_formation complète (IBAN lisible)",
    (await tx.query(`select of_iban from public.organisme_formation`)).rows[0]?.of_iban ===
      "FR00 0000 0000 0000 0000 0000 000",
  );
});
{
  const e1 = await forge(
    sAnne,
    `update public.utilisateur set email = 'autre@pirate.example' where id = '${sAnne}'`,
  );
  const e2 = await forge(
    sAdmin,
    `update public.utilisateur set email = 'autre@pirate.example' where id = '${sSophie}'`,
  );
  const e3 = await forge(
    sSophie,
    `update public.utilisateur set of_id = 'of-2' where id = '${sSophie}'`,
  );
  const e4 = await forge(
    sAdmin,
    `update public.utilisateur set role = 'admin' where id = '${sMarc}'`,
  );
  verifier(
    "4. un utilisateur ne change pas son e-mail (désynchronisation auth.users)",
    /interdite/i.test(e1),
  );
  verifier(
    "4. même un admin ne change pas l'e-mail d'un compte côté client",
    /interdite/i.test(e2),
  );
  verifier(
    "4. of_id et rôle non modifiables côté client (y compris admin)",
    /interdite/i.test(e3) && /interdite/i.test(e4),
  );
  verifier(
    "4. prénom / nom restent modifiables par l'intéressé",
    (await forge(
      sAnne,
      `update public.utilisateur set nom = 'Martin-Weiss' where id = '${sAnne}'`,
    )) === "passe",
  );
  verifier(
    "4. le service peut synchroniser l'e-mail",
    (
      await db2.query(
        `update public.utilisateur set email = email where id = '${sAnne}' returning id`,
      )
    ).rows.length === 1,
  );
}
await enTantQue2(sSophie, async (tx) => {
  const direct = await tx.query(
    `update public.dossier_formation set formation_objectifs_atteints = 'x' where id = 'd-demo-1' returning id`,
  );
  verifier(
    "5. (rappel) la politique UPDATE bloque la saisie directe hors brouillon",
    direct.rows.length === 0,
  );
  const r = (
    await tx.query(
      `select public.s4m_objectifs_atteints('d-demo-1', '  Objectifs atteints : TCD maîtrisés.  ') as r`,
    )
  ).rows[0].r;
  const val = (
    await tx.query(
      `select formation_objectifs_atteints as v from public.dossier_formation where id = 'd-demo-1'`,
    )
  ).rows[0].v;
  verifier(
    "5. s4m_objectifs_atteints : { ok: true }, texte rogné, formation en cours",
    r.ok === true && val === "Objectifs atteints : TCD maîtrisés.",
  );
});
{
  const m = await forge(sMarc, `select public.s4m_objectifs_atteints('d-demo-1', 'pirate')`);
  const a = await forge(sAnne, `select public.s4m_objectifs_atteints('d-demo-1', 'pirate')`);
  verifier(
    "5. s4m_objectifs_atteints refusé à un autre formateur et à l'apprenante",
    /introuvable/i.test(m) && /interdit/i.test(a),
  );
  await db2.exec(
    `update public.dossier_formation set sous_statut = 'archive' where id = 'd-demo-2'`,
  );
  const t = await forge(sAdmin, `select public.s4m_objectifs_atteints('d-demo-2', 'x')`);
  verifier(
    "5. s4m_objectifs_atteints refusé sur un dossier terminal (admin compris)",
    /archiv/i.test(t),
  );
  verifier(
    "5. aucun objectif écrit par les tentatives refusées",
    (
      await db2.query(
        `select formation_objectifs_atteints as v from public.dossier_formation where id = 'd-demo-1'`,
      )
    ).rows[0].v === "Objectifs atteints : TCD maîtrisés.",
  );
}
{
  const avant = (
    await db2.query(
      `select count(*)::int as n from public.version_objet where objet_id = 'fo-demo-manager'`,
    )
  ).rows[0].n;
  await enTantQue2(sSophie, async (tx) => {
    await tx.query(`select set_config('s4m.sans_version', 'on', true)`);
    await tx.query(
      `update public.formation set formation_titre = 'sans trace' where id = 'fo-demo-manager'`,
    );
  });
  const apres = (
    await db2.query(
      `select count(*)::int as n from public.version_objet where objet_id = 'fo-demo-manager'`,
    )
  ).rows[0].n;
  verifier(
    "1 bis. un client ne peut pas désactiver la photographie de version (ancien garde s4m.sans_version)",
    apres === avant + 1,
  );
}

await db2.transaction(async (tx) => {
  await tx.exec(`set local role anon;`);
  let bloque = false;
  try {
    await tx.query(`savepoint n2`);
    await tx.query(`select public.s4m_moi()`);
  } catch (e) {
    bloque = true;
    await tx.query(`rollback to savepoint n2`);
  }
  verifier("anon : s4m_moi() refusé (pas de grant)", bloque);
  await tx.exec(`reset role;`);
});
await db2.close();

// ── 5. Gabarit de production (placeholders substitués) sur une base neuve ────────────────────────
console.log("12. admin_production.sql");
const db3 = new PGlite({ extensions: { pgcrypto } });
await db3.exec(STUB);
await db3.exec(readFileSync(MIGRATION, "utf8"));
await db3.exec(readFileSync(MIGRATION2, "utf8"));
const brut = readFileSync(ADMIN_PROD, "utf8");
let refusePlaceholders = false;
try {
  await db3.exec(brut);
} catch (e) {
  refusePlaceholders = /placeholders/i.test(e.message);
}
verifier("admin_production : refuse de tourner avec les placeholders", refusePlaceholders);
const rempli = brut
  .replaceAll("<OF_ID>", "of-prod")
  .replaceAll("<OF_NOM>", "MON ORGANISME SA")
  .replaceAll("<EMAIL>", "Direction@Exemple.fr")
  .replaceAll("<MOT_DE_PASSE>", "mot-de-passe-solide")
  .replaceAll("<PRENOM>", "Jeanne")
  .replaceAll("<NOM>", "Dupuis");
await db3.exec(rempli);
await db3.exec(rempli); // idempotence
const prodAdmin = (
  await db3.query(`select u.id, u.role, u.of_id, u.email, u.prenom from public.utilisateur u`)
).rows;
verifier(
  "admin_production : un seul profil, admin de of-prod, e-mail en minuscules",
  prodAdmin.length === 1 &&
    prodAdmin[0].role === "admin" &&
    prodAdmin[0].of_id === "of-prod" &&
    prodAdmin[0].email === "direction@exemple.fr" &&
    prodAdmin[0].prenom === "Jeanne",
);
verifier(
  "admin_production : compte auth + identité, mot de passe vérifiable",
  (await db3.query(`select count(*)::int as n from auth.identities`)).rows[0].n === 1 &&
    (
      await db3.query(
        `select encrypted_password = extensions.crypt('mot-de-passe-solide', encrypted_password) as ok from auth.users`,
      )
    ).rows[0].ok === true,
);
await db3.transaction(async (tx) => {
  await tx.exec(
    `set local role authenticated; select set_config('request.jwt.claim.sub', '${prodAdmin[0].id}', true);`,
  );
  const moi = (await tx.query(`select public.s4m_moi() as r`)).rows[0].r;
  verifier(
    "admin_production : s4m_moi() → admin de MON ORGANISME SA",
    moi.acteur.role === "admin" && moi.organisme.nom === "MON ORGANISME SA",
  );
  await tx.exec(`reset role;`);
});
await db3.close();
console.log(`\n${ok} vérifications réussies, ${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
