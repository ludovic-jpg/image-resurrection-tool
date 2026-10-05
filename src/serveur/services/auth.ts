/**
 * Authentification : e-mail + mot de passe, sessions par jeton opaque, invitations à usage unique.
 *
 * ÉCART ASSUMÉ par rapport au cadrage, qui annonçait la bibliothèque better-auth : le besoin réel est
 * réduit (pas d'OAuth, pas de 2FA) et les flux propres au métier (invitation de l'apprenant, candidature
 * du formateur, dissociation RGPD) auraient de toute façon dû être écrits à la main. Primitives standard :
 *  - mots de passe : scrypt (node:crypto), sel aléatoire par utilisateur, comparaison à temps constant ;
 *  - sessions : jeton aléatoire de 256 bits ; seule son empreinte SHA-256 est stockée ;
 *  - anti-force brute : 5 échecs par adresse sur 15 minutes.
 * À faire relire par un tiers avant toute mise en production (voir docs/HYPOTHESES.md).
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { formateur, invitation, organismeFormation, sessionUtilisateur, stagiaire, utilisateur } from "../bd/schema";
import { jetonAleatoire, nouvelId, sha256 } from "../ports/divers";
import { ErreurMetier, invalide, journaliser, type Acteur, type Services } from "./socle";

const scrypt = promisify(scryptCb) as (mdp: string, sel: Buffer, longueur: number) => Promise<Buffer>;

export const DUREE_SESSION_MS = 12 * 60 * 60 * 1000;
export const DUREE_INVITATION_MS = 14 * 24 * 60 * 60 * 1000;
const LONGUEUR_MIN_MDP = 10;
const MAX_ECHECS = 5;
const FENETRE_ECHECS_MS = 15 * 60 * 1000;

export async function hacherMotDePasse(mdp: string): Promise<string> {
  const sel = randomBytes(16);
  const cle = await scrypt(mdp, sel, 64);
  return `scrypt$${sel.toString("base64")}$${cle.toString("base64")}`;
}

export async function verifierMotDePasse(mdp: string, stocke: string): Promise<boolean> {
  const [algo, sel, cle] = stocke.split("$");
  if (algo !== "scrypt" || !sel || !cle) return false;
  const attendu = Buffer.from(cle, "base64");
  const calcule = await scrypt(mdp, Buffer.from(sel, "base64"), attendu.length);
  return timingSafeEqual(attendu, calcule);
}

export function validerMotDePasse(mdp: string): void {
  if (mdp.length < LONGUEUR_MIN_MDP) throw invalide(`Le mot de passe doit compter au moins ${LONGUEUR_MIN_MDP} caractères.`);
  if (mdp.length > 200) throw invalide("Le mot de passe est trop long.");
}

export const normaliserEmail = (email: string): string => email.trim().toLowerCase();

function validerEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw invalide("Adresse e-mail invalide.");
}

/** Compteur d'échecs en mémoire. Suffisant pour une instance ; à déporter si l'application est répliquée. */
const echecs = new Map<string, number[]>();

export function reinitialiserAntiForceBrute(): void {
  echecs.clear();
}

export async function organismeParDefaut(s: Services): Promise<string> {
  const [of] = await s.bd.select({ id: organismeFormation.id }).from(organismeFormation).orderBy(organismeFormation.cree_le).limit(1);
  if (!of) throw new ErreurMetier("introuvable", "Aucun organisme de formation n'est configuré.");
  return of.id;
}

/** F-ONB-01 : création du compte d'un candidat formateur. Sa candidature démarre en brouillon. */
export async function inscrireFormateur(
  s: Services,
  donnees: { email: string; mot_de_passe: string; prenom: string; nom: string; of_id?: string },
): Promise<{ utilisateur_id: string; formateur_id: string }> {
  const email = normaliserEmail(donnees.email);
  validerEmail(email);
  validerMotDePasse(donnees.mot_de_passe);
  if (!donnees.prenom.trim() || !donnees.nom.trim()) throw invalide("Le prénom et le nom sont obligatoires.");
  const of_id = donnees.of_id ?? (await organismeParDefaut(s));

  const [existant] = await s.bd.select({ id: utilisateur.id }).from(utilisateur).where(sql`lower(${utilisateur.email}) = ${email}`);
  if (existant) throw new ErreurMetier("conflit", "Un compte existe déjà avec cette adresse e-mail.");

  const utilisateur_id = nouvelId();
  const formateur_id = nouvelId();
  await s.bd.transaction(async (tx) => {
    await tx.insert(utilisateur).values({
      id: utilisateur_id,
      of_id,
      email,
      mot_de_passe_hash: await hacherMotDePasse(donnees.mot_de_passe),
      role: "formateur",
      prenom: donnees.prenom.trim(),
      nom: donnees.nom.trim(),
    });
    await tx.insert(formateur).values({
      id: formateur_id,
      of_id,
      utilisateur_id,
      formateur_prenom: donnees.prenom.trim(),
      formateur_nom: donnees.nom.trim(),
      formateur_email: email,
    });
  });
  await journaliser(s, { of_id, acteur: { utilisateur_id, role: "formateur" }, type: "compte_cree", libelle: "Compte formateur créé" });
  return { utilisateur_id, formateur_id };
}

export async function connecter(s: Services, emailBrut: string, mdp: string): Promise<{ jeton: string; expire_le: Date }> {
  const email = normaliserEmail(emailBrut);
  const maintenant = s.horloge.maintenant().getTime();
  const recents = (echecs.get(email) ?? []).filter((t) => maintenant - t < FENETRE_ECHECS_MS);
  if (recents.length >= MAX_ECHECS) throw new ErreurMetier("interdit", "Trop de tentatives. Réessayez dans quelques minutes.");

  const [u] = await s.bd.select().from(utilisateur).where(sql`lower(${utilisateur.email}) = ${email}`);
  // Même message et même coût de calcul que l'adresse existe ou non : on ne révèle pas les comptes.
  const ok = u?.actif && !u.supprime_le && u.mot_de_passe_hash ? await verifierMotDePasse(mdp, u.mot_de_passe_hash) : (await hacherMotDePasse(mdp), false);
  if (!u || !ok) {
    echecs.set(email, [...recents, maintenant]);
    throw new ErreurMetier("non_authentifie", "Adresse e-mail ou mot de passe incorrect.");
  }
  echecs.delete(email);
  return ouvrirSession(s, u.id);
}

async function ouvrirSession(s: Services, utilisateur_id: string): Promise<{ jeton: string; expire_le: Date }> {
  const jeton = jetonAleatoire();
  const expire_le = new Date(s.horloge.maintenant().getTime() + DUREE_SESSION_MS);
  await s.bd.insert(sessionUtilisateur).values({ jeton_hash: sha256(jeton), utilisateur_id, expire_le, cree_le: s.horloge.maintenant() });
  return { jeton, expire_le };
}

export async function deconnecter(s: Services, jeton: string): Promise<void> {
  await s.bd.delete(sessionUtilisateur).where(eq(sessionUtilisateur.jeton_hash, sha256(jeton)));
}

/** Reconstruit l'acteur à partir du jeton de session. `null` si la session est absente ou expirée. */
export async function acteurDepuisJeton(s: Services, jeton: string | undefined | null): Promise<Acteur | null> {
  if (!jeton) return null;
  const [ligne] = await s.bd
    .select({ u: utilisateur })
    .from(sessionUtilisateur)
    .innerJoin(utilisateur, eq(utilisateur.id, sessionUtilisateur.utilisateur_id))
    .where(and(eq(sessionUtilisateur.jeton_hash, sha256(jeton)), gt(sessionUtilisateur.expire_le, s.horloge.maintenant()), isNull(utilisateur.supprime_le)));
  if (!ligne || !ligne.u.actif) return null;
  return construireActeur(s, ligne.u);
}

export async function construireActeur(s: Services, u: typeof utilisateur.$inferSelect): Promise<Acteur> {
  let formateur_id: string | null = null;
  let formateur_valide = false;
  let stagiaire_id: string | null = null;
  if (u.role === "formateur") {
    const [f] = await s.bd.select({ id: formateur.id, statut: formateur.statut_candidature }).from(formateur).where(eq(formateur.utilisateur_id, u.id));
    formateur_id = f?.id ?? null;
    formateur_valide = f?.statut === "validee";
  } else if (u.role === "apprenant") {
    const [st] = await s.bd.select({ id: stagiaire.id }).from(stagiaire).where(eq(stagiaire.utilisateur_id, u.id));
    stagiaire_id = st?.id ?? null;
  }
  return { utilisateur_id: u.id, of_id: u.of_id, role: u.role, formateur_id, formateur_valide, stagiaire_id, nom: `${u.prenom} ${u.nom}`.trim(), email: u.email };
}

/** Crée une invitation à usage unique et retourne le lien à placer dans l'e-mail. */
export async function creerInvitation(s: Services, utilisateur_id: string): Promise<string> {
  const jeton = jetonAleatoire();
  await s.bd.insert(invitation).values({
    jeton_hash: sha256(jeton),
    utilisateur_id,
    expire_le: new Date(s.horloge.maintenant().getTime() + DUREE_INVITATION_MS),
    cree_le: s.horloge.maintenant(),
  });
  return `${s.appUrl}/invitation/${jeton}`;
}

export async function lireInvitation(s: Services, jeton: string): Promise<{ email: string; prenom: string; nom: string }> {
  const [ligne] = await s.bd
    .select({ i: invitation, u: utilisateur })
    .from(invitation)
    .innerJoin(utilisateur, eq(utilisateur.id, invitation.utilisateur_id))
    .where(eq(invitation.jeton_hash, sha256(jeton)));
  if (!ligne || ligne.i.utilisee_le || ligne.i.expire_le <= s.horloge.maintenant() || ligne.u.supprime_le) {
    throw new ErreurMetier("introuvable", "Ce lien d'invitation n'est plus valable. Demandez-en un nouveau à votre formateur.");
  }
  return { email: ligne.u.email, prenom: ligne.u.prenom, nom: ligne.u.nom };
}

/** L'invité choisit son mot de passe ; l'invitation est consommée et une session s'ouvre. */
export async function accepterInvitation(s: Services, jeton: string, mdp: string): Promise<{ jeton: string; expire_le: Date }> {
  await lireInvitation(s, jeton);
  validerMotDePasse(mdp);
  const [inv] = await s.bd.select().from(invitation).where(eq(invitation.jeton_hash, sha256(jeton)));
  await s.bd.transaction(async (tx) => {
    await tx.update(utilisateur).set({ mot_de_passe_hash: await hacherMotDePasse(mdp), actif: true }).where(eq(utilisateur.id, inv!.utilisateur_id));
    await tx.update(invitation).set({ utilisee_le: s.horloge.maintenant() }).where(eq(invitation.jeton_hash, sha256(jeton)));
  });
  return ouvrirSession(s, inv!.utilisateur_id);
}

export async function changerMotDePasse(s: Services, acteur: Acteur, ancien: string, nouveau: string): Promise<void> {
  const [u] = await s.bd.select().from(utilisateur).where(eq(utilisateur.id, acteur.utilisateur_id));
  if (!u || !(await verifierMotDePasse(ancien, u.mot_de_passe_hash))) throw invalide("Le mot de passe actuel est incorrect.");
  validerMotDePasse(nouveau);
  await s.bd.update(utilisateur).set({ mot_de_passe_hash: await hacherMotDePasse(nouveau) }).where(eq(utilisateur.id, u.id));
  // Toutes les autres sessions tombent : un mot de passe changé invalide les accès ouverts.
  await s.bd.delete(sessionUtilisateur).where(eq(sessionUtilisateur.utilisateur_id, u.id));
}
