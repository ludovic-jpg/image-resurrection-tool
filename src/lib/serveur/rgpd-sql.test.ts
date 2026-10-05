// @vitest-environment node
/**
 * La fonction SQL d'effacement RGPD (migration 20261006000800) exécutée sur un vrai Postgres (PGlite) chargé avec les
 * deux migrations d'origine : on vérifie que RIEN de personnel ne subsiste (balayage de toutes les tables), que les
 * dossiers instruits restent, et que seul le serveur (service) peut l'appeler.
 * Limite : PGlite n'est pas Supabase (pas de GoTrue ni de Storage réels : un prélude minimal les imite).
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = (nom: string) => readFileSync(`supabase/migrations/${nom}.sql`, "utf8");
const U_FORM = "00000000-0000-4000-8000-000000000001";
const U_ADMIN = "00000000-0000-4000-8000-000000000002";
const U_ORPH = "00000000-0000-4000-8000-000000000003"; // apprenant sans dossier conservé
const U_GARDE = "00000000-0000-4000-8000-000000000004"; // apprenant d'un dossier conservé
const U_AUTRE_FORM = "00000000-0000-4000-8000-000000000005";

let db: PGlite;

async function semer() {
  // Réplica : les déclencheurs (création de profil à l'inscription, journal) ne rejouent pas pendant le semis.
  await db.exec(`
    set session_replication_role = replica;
    insert into auth.users(id, email) values
      ('${U_FORM}','sophie.lambert@example.fr'), ('${U_ADMIN}','admin@of.fr'), ('${U_ORPH}','orphelin.dupond@example.fr'),
      ('${U_GARDE}','garde.martin@example.fr'), ('${U_AUTRE_FORM}','autre@example.fr');
    insert into organisme_formation(id, of_nom) values ('of1','OF Test');
    insert into utilisateur(id, of_id, email, role, prenom, nom) values
      ('${U_FORM}','of1','sophie.lambert@example.fr','formateur','Sophie','Lambert'),
      ('${U_ADMIN}','of1','admin@of.fr','admin','Alice','Admin'),
      ('${U_ORPH}','of1','orphelin.dupond@example.fr','apprenant','Olivier','Dupond'),
      ('${U_GARDE}','of1','garde.martin@example.fr','apprenant','Gaelle','Martin'),
      ('${U_AUTRE_FORM}','of1','autre@example.fr','formateur','Autre','Formateur');
    insert into formateur(id, of_id, utilisateur_id, formateur_prenom, formateur_nom, formateur_email, formateur_telephone,
        formateur_iban, formateur_entreprise_siret, parcours, formateur_bio) values
      ('f1','of1','${U_FORM}','Sophie','Lambert','sophie.lambert@example.fr','0611223344','FR7612345678901234567890123',
       '12345678900011','Dix ans de VBA chez Zorglub','Bio de Sophie'),
      ('f2','of1','${U_AUTRE_FORM}','Autre','Formateur','autre@example.fr','0600000000','','','','');
    insert into entreprise_cliente(id, of_id, formateur_id, entreprise_nom) values
      ('e-garde','of1','f1','Entreprise Gardée SARL'), ('e-orph','of1','f1','Entreprise Orpheline SAS'),
      ('e-autre','of1','f2','Entreprise Autre');
    insert into stagiaire(id, of_id, formateur_id, entreprise_id, utilisateur_id, stagiaire_prenom, stagiaire_nom, stagiaire_email) values
      ('s-garde','of1','f1','e-garde','${U_GARDE}','Gaelle','Martin','garde.martin@example.fr'),
      ('s-orph','of1','f1','e-orph','${U_ORPH}','Olivier','Dupond','orphelin.dupond@example.fr'),
      ('s-autre','of1','f2','e-autre',null,'Zoe','Autre','zoe@example.fr');
    insert into formation(id, of_id, formateur_id, formation_titre) values
      ('fo-garde','of1','f1','Excel gardé'), ('fo-libre','of1','f1','Formation Libre Secrète'), ('fo-autre','of1','f2','Autre');
    insert into coffre_fichier(id, of_id, formateur_id, formation_id, nom_fichier, chemin, taille) values
      ('c-libre','of1','f1','fo-libre','secret-sophie.pdf','of1/coffres/fo-libre/secret-sophie.pdf',10),
      ('c-garde','of1','f1','fo-garde','support.pdf','of1/coffres/fo-garde/support.pdf',10),
      ('c-autre','of1','f2','fo-autre','autre.pdf','of1/coffres/fo-autre/autre.pdf',10);
    insert into modele_outil(id, of_id, formateur_id, type, titre, contenu) values
      ('o1','of1','f1','positionnement','QCM de Sophie','{}'), ('o-autre','of1','f2','positionnement','QCM autre','{}');
    insert into dossier_formation(id, of_id, dossier_reference, formateur_id, entreprise_id, formation_id, sous_statut, formation_titre) values
      ('d-garde','of1','ADF-2026-0001','f1','e-garde','fo-garde','paiement_receptionne','Excel gardé'),
      ('d-brouillon','of1','ADF-2026-0002','f1','e-orph','fo-libre','brouillon','Brouillon de Sophie'),
      ('d-autre','of1','ADF-2026-0003','f2','e-autre','fo-autre','dossier_valide','Autre');
    insert into stagiaire_dossier(id, dossier_id, stagiaire_id) values
      ('sd1','d-garde','s-garde'), ('sd2','d-brouillon','s-orph'), ('sd3','d-autre','s-autre');
    insert into piece_formateur(id, formateur_id, type, nom_fichier, chemin, taille) values
      ('pf1','f1','kbis','kbis-sophie.pdf','of1/candidatures/f1/kbis-sophie.pdf',10);
    insert into invitation(jeton_hash, of_id, email, role, formateur_id, expire_le) values
      ('h1','of1','sophie.lambert@example.fr','formateur','f1', now() + interval '1 day'),
      ('h2','of1','orphelin.dupond@example.fr','apprenant', null, now() + interval '1 day'),
      ('h3','of1','zoe@example.fr','apprenant', null, now() + interval '1 day');
    insert into courrier(id, of_id, dossier_id, type, destinataire, sujet, corps_html, formateur_id) values
      ('m1','of1',null,'invitation','sophie.lambert@example.fr','Bienvenue Sophie','<p>Sophie</p>','f1'),
      ('m2','of1',null,'relance','orphelin.dupond@example.fr','Relance Olivier','<p>Olivier</p>','f1'),
      ('m3','of1','d-garde','facture','compta@entreprise.fr','Facture','<p>x</p>','f1'),
      ('m4','of1',null,'invitation','zoe@example.fr','Bienvenue Zoé','<p>Zoé</p>','f2');
    insert into version_objet(id, of_id, type, objet_id, snapshot, auteur_id) values
      ('v1','of1','formation','fo-libre','{"titre":"Formation Libre Secrète"}','${U_FORM}'),
      ('v2','of1','formation','fo-garde','{}','${U_FORM}'),
      ('v3','of1','outil','o1','{"titre":"QCM de Sophie"}','${U_FORM}');
    insert into evenement(id, of_id, dossier_id, acteur_id, acteur_role, type, libelle, detail) values
      ('ev1','of1','d-garde','${U_FORM}','formateur','dossier_cree','Dossier créé',null),
      ('ev2','of1',null,'${U_FORM}','formateur','connexion','Connexion de Sophie Lambert',null),
      ('ev3','of1',null,'${U_ADMIN}','admin','formateur_valide','Formateur validé','{"formateur_id":"f1"}'),
      ('ev4','of1',null,'${U_ADMIN}','admin','organisme_modifie','Organisme modifié',null);
    set session_replication_role = origin;
  `);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.role() returns text language sql as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
    create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
    alter table storage.objects enable row level security;
    create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n, '/') $$;
    create schema extensions;
  `);
  for (const f of [
    "20261005000000_s4m_initial",
    "20261005000100_s4m_rpc",
    "20261006000800_lot8_rgpd",
  ])
    await db.exec(migration(f));
  await semer();
}, 120_000);
afterAll(async () => db.close());

const effacer = () =>
  db.query<{ r: Record<string, unknown> }>(
    `select public.s4m_effacer_donnees_formateur('f1', '${U_FORM}') as r`,
  );
const compter = async (sql: string) =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0]!.n);
const ids = async (table: string) =>
  (await db.query<{ id: string }>(`select id from ${table} order by id`)).rows.map((r) => r.id);

describe("s4m_effacer_donnees_formateur", () => {
  it("refuse un client (rôle authenticated) : rien n'est effacé", async () => {
    await db.exec("set role authenticated");
    await expect(effacer()).rejects.toThrow();
    await db.exec("reset role");
    expect(await compter("formateur where id = 'f1' and anonymise_le is null")).toBe(1);
  });

  it("refuse un autre couple formateur / compte (acteur ne vient pas du corps) et un compte inexistant", async () => {
    await expect(
      db.query(`select public.s4m_effacer_donnees_formateur('f1', '${U_AUTRE_FORM}')`),
    ).rejects.toThrow(/introuvable/i);
    await expect(
      db.query(`select public.s4m_effacer_donnees_formateur('inconnu', '${U_FORM}')`),
    ).rejects.toThrow(/introuvable/i);
    expect(await compter("formateur where id = 'f1' and anonymise_le is null")).toBe(1);
  });

  it("efface et renvoie les fichiers et comptes à supprimer côté Storage / Auth", async () => {
    const { rows } = await effacer();
    const r = rows[0]!.r as {
      of_id: string;
      archive: string[];
      coffre: string[];
      comptes_apprenants: string[];
    };
    expect(r.of_id).toBe("of1");
    expect(r.archive).toEqual(["of1/candidatures/f1/kbis-sophie.pdf"]);
    expect(r.coffre).toEqual(["of1/coffres/fo-libre/secret-sophie.pdf"]);
    expect(r.comptes_apprenants).toEqual([U_ORPH]);
  });

  it("aucune donnée personnelle conservée : balayage de toutes les tables", async () => {
    const interdits = [
      "Sophie",
      "Lambert",
      "sophie.lambert",
      "0611223344",
      "FR7612345678901234567890123",
      "12345678900011",
      "Zorglub",
      "Bio de Sophie",
      "Olivier",
      "Dupond",
      "orphelin.dupond",
      "Libre Secrète",
      "secret-sophie",
      "kbis-sophie",
      "QCM de Sophie",
      "Entreprise Orpheline",
      "Brouillon de Sophie",
    ];
    const tables = (
      await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema in ('public','auth') and table_type = 'BASE TABLE'`,
      )
    ).rows.map((r) => r.table_name);
    const trouves: string[] = [];
    for (const t of tables) {
      const schema = t === "users" ? "auth" : "public";
      const { rows } = await db.query<{ ligne: string }>(
        `select to_jsonb(x)::text as ligne from ${schema}.${t} x`,
      );
      for (const { ligne } of rows)
        for (const mot of interdits) if (ligne.includes(mot)) trouves.push(`${t}: ${mot}`);
    }
    // Le compte Auth du formateur (auth.users) est supprimé côté serveur par le client service, pas par la fonction.
    expect(trouves.filter((x) => !x.startsWith("users:"))).toEqual([]);
  });

  it("le profil et les données du formateur disparaissent, la ligne formateur reste anonyme", async () => {
    expect(await compter(`utilisateur where id = '${U_FORM}'`)).toBe(0);
    const f = (await db.query<Record<string, unknown>>("select * from formateur where id = 'f1'"))
      .rows[0]!;
    expect(f).toMatchObject({
      utilisateur_id: null,
      formateur_prenom: "Formateur",
      formateur_nom: "(compte supprimé)",
      formateur_email: "",
      formateur_telephone: "",
      formateur_iban: "",
      formateur_entreprise_siret: "",
      parcours: "",
      formateur_bio: "",
    });
    expect(f["anonymise_le"]).not.toBeNull();
  });

  it("supprime brouillons, formations libres, coffres, outils, fiches et entreprises orphelins, pièces, invitations, courriers", async () => {
    expect(await ids("dossier_formation")).toEqual(["d-autre", "d-garde"]);
    expect(await ids("formation")).toEqual(["fo-autre", "fo-garde"]);
    expect(await ids("coffre_fichier")).toEqual(["c-autre", "c-garde"]);
    expect(await ids("modele_outil")).toEqual(["o-autre"]);
    expect(await ids("stagiaire")).toEqual(["s-autre", "s-garde"]);
    expect(await ids("entreprise_cliente")).toEqual(["e-autre", "e-garde"]);
    expect(await ids("piece_formateur")).toEqual([]);
    expect(
      (
        await db.query<{ jeton_hash: string }>("select jeton_hash from invitation order by 1")
      ).rows.map((r) => r.jeton_hash),
    ).toEqual(["h3"]);
    expect(await ids("courrier")).toEqual(["m3", "m4"]); // m3 : courrier d'un dossier conservé
    expect(await ids("version_objet")).toEqual(["v2"]);
    expect(await compter(`utilisateur where id = '${U_ORPH}'`)).toBe(0);
  });

  it("conserve le dossier instruit, son apprenant et son compte, et les données des autres formateurs", async () => {
    expect(
      await compter(`utilisateur where id in ('${U_GARDE}', '${U_ADMIN}', '${U_AUTRE_FORM}')`),
    ).toBe(3);
    expect(await compter("stagiaire_dossier where dossier_id = 'd-garde'")).toBe(1);
    expect(await compter("formateur where id = 'f2' and anonymise_le is null")).toBe(1);
  });

  it("journal : trace hors dossier du formateur effacée, auteur coupé, évènement de suppression ajouté", async () => {
    const evts = (
      await db.query<{ id: string; type: string; acteur_id: string | null }>(
        "select id, type, acteur_id from evenement order by id",
      )
    ).rows;
    expect(evts.find((e) => e.id === "ev1")).toMatchObject({ acteur_id: null }); // dossier conservé
    expect(evts.find((e) => e.id === "ev2")).toBeUndefined(); // connexion hors dossier
    expect(evts.find((e) => e.id === "ev3")).toBeUndefined(); // détail au nom du formateur
    expect(evts.find((e) => e.id === "ev4")).toBeDefined(); // action de l'admin, non liée
    expect(evts.filter((e) => e.type === "compte_supprime")).toHaveLength(1);
    expect(evts.some((e) => e.acteur_id === U_FORM)).toBe(false);
    expect(await compter(`evenement where type = 'coffre_purge'`)).toBe(0);
  });

  it("n'est pas rejouable : le compte est déjà anonymisé", async () => {
    await expect(effacer()).rejects.toThrow(/introuvable/i);
  });
});
