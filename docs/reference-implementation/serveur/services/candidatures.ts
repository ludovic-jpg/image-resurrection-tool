/** Module 1 — Postulation et validation du compte Formateur (F-ONB-01 à F-ONB-03). */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { formateur, organismeFormation, pieceFormateur, utilisateur } from "../bd/schema";
import { cheminCandidature } from "../ports/archive";
import { nouvelId } from "../ports/divers";
import { courriels } from "./courriels";
import { validerFichier, type FichierDepose } from "./fichiers";
import { ErreurMetier, exigerRole, interdit, introuvable, invalide, journaliser, type Acteur, type Services } from "./socle";

/**
 * Pièces justificatives de la candidature. Point ouvert n° 6 du cahier des charges : liste par défaut,
 * reprise de la base A et complétée du K-bis ; `obligatoire` est le seul réglage à ajuster.
 */
export const TYPES_PIECE_FORMATEUR = [
  { type: "cv", libelle: "Curriculum vitæ", obligatoire: true },
  { type: "identite", libelle: "Pièce d'identité", obligatoire: true },
  { type: "diplome", libelle: "Diplômes et titres", obligatoire: true },
  { type: "kbis", libelle: "Extrait K-bis ou avis de situation SIRENE", obligatoire: false },
  { type: "attestation", libelle: "Attestations (URSSAF, assurance RC Pro…)", obligatoire: false },
  { type: "casier", libelle: "Extrait de casier judiciaire (bulletin n° 3)", obligatoire: false },
  { type: "autre", libelle: "Autre document", obligatoire: false },
] as const;

export const SchemaProfilFormateur = z
  .object({
    formateur_prenom: z.string().trim().min(1).max(100),
    formateur_nom: z.string().trim().min(1).max(100),
    formateur_telephone: z.string().trim().max(30),
    formateur_entreprise_nom: z.string().trim().max(200),
    formateur_entreprise_adresse: z.string().trim().max(400),
    formateur_entreprise_siret: z.string().trim().max(20),
    formateur_nda_numero: z.string().trim().max(30),
    formateur_dreets_region: z.string().trim().max(100),
    formateur_iban: z.string().trim().max(50),
    formateur_bic: z.string().trim().max(20),
    parcours: z.string().trim().max(8000),
    // Profil étendu (« Modification 1 », 23/09/2026)
    formateur_statut_juridique: z.string().trim().max(100),
    formateur_domaines: z.array(z.string().trim().min(1).max(100)).max(20),
    formateur_zones: z.string().trim().max(500),
    formateur_langues: z.string().trim().max(200),
    formateur_tarif_journalier: z.number().int().min(0).max(10_000_000).nullable(),
    formateur_bio: z.string().trim().max(1500),
    formateur_linkedin: z.union([z.literal(""), z.string().trim().url("Adresse de profil invalide.").max(300)]),
    formateur_disponibilites: z.string().trim().max(1000),
    formateur_assurance_rc: z.string().trim().max(300),
  })
  .partial();

/** Après validation, l'identité ne se modifie plus que par l'organisme (elle figure sur les contrats signés). */
const CHAMPS_FIGES_APRES_VALIDATION = ["formateur_prenom", "formateur_nom"] as const;

function monFormateurId(acteur: Acteur): string {
  if (acteur.role !== "formateur" || !acteur.formateur_id) throw interdit();
  return acteur.formateur_id;
}

export async function lireMaCandidature(s: Services, acteur: Acteur) {
  const id = monFormateurId(acteur);
  const [f] = await s.bd.select().from(formateur).where(eq(formateur.id, id));
  if (!f) throw introuvable("Candidature");
  const pieces = await s.bd.select().from(pieceFormateur).where(eq(pieceFormateur.formateur_id, id)).orderBy(pieceFormateur.cree_le);
  const aujourdhui = s.horloge.maintenant().toISOString().slice(0, 10);
  const echeances = pieces.filter((p) => p.expire_le).map((p) => ({ id: p.id, nom_fichier: p.nom_fichier, expire_le: p.expire_le, expiree: p.expire_le < aujourdhui }));
  return { formateur: f, pieces, types: TYPES_PIECE_FORMATEUR, manques: manquesCandidature(f, pieces), echeances };
}

function manquesCandidature(f: typeof formateur.$inferSelect, pieces: Array<{ type: string }>): string[] {
  const manques: string[] = [];
  if (!f.formateur_telephone) manques.push("Téléphone");
  if (!f.parcours) manques.push("Parcours professionnel");
  for (const t of TYPES_PIECE_FORMATEUR) if (t.obligatoire && !pieces.some((p) => p.type === t.type)) manques.push(t.libelle);
  return manques;
}

export async function mettreAJourMonProfil(s: Services, acteur: Acteur, donnees: unknown) {
  const id = monFormateurId(acteur);
  const valeurs = SchemaProfilFormateur.parse(donnees);
  const [actuel] = await s.bd.select().from(formateur).where(eq(formateur.id, id));
  if (actuel?.statut_candidature === "soumise") throw new ErreurMetier("conflit", "Votre candidature est en cours d'étude : attendez la décision pour modifier votre profil.");
  if (actuel?.statut_candidature === "validee") {
    for (const cle of CHAMPS_FIGES_APRES_VALIDATION) {
      if (cle in valeurs && valeurs[cle] !== actuel[cle]) throw invalide("Après validation, votre nom et votre prénom ne se modifient que par l'organisme de formation.");
      delete valeurs[cle];
    }
  }
  if (Object.keys(valeurs).length > 0) {
    await s.bd.update(formateur).set(valeurs).where(eq(formateur.id, id));
    if (actuel?.statut_candidature === "validee") await journaliser(s, { of_id: acteur.of_id, acteur, type: "profil_modifie", libelle: `Profil formateur mis à jour (${Object.keys(valeurs).join(", ")})` });
  }
  if (valeurs.formateur_prenom || valeurs.formateur_nom) {
    await s.bd
      .update(utilisateur)
      .set({ ...(valeurs.formateur_prenom ? { prenom: valeurs.formateur_prenom } : {}), ...(valeurs.formateur_nom ? { nom: valeurs.formateur_nom } : {}) })
      .where(eq(utilisateur.id, acteur.utilisateur_id));
  }
  return lireMaCandidature(s, acteur);
}

export async function deposerPieceFormateur(s: Services, acteur: Acteur, type: string, fichier: FichierDepose, expire_le = "") {
  const id = monFormateurId(acteur);
  if (!TYPES_PIECE_FORMATEUR.some((t) => t.type === type)) throw invalide("Type de pièce inconnu.");
  if (expire_le && !/^\d{4}-\d{2}-\d{2}$/.test(expire_le)) throw invalide("Date de fin de validité attendue au format AAAA-MM-JJ.");
  const [f] = await s.bd.select({ statut: formateur.statut_candidature }).from(formateur).where(eq(formateur.id, id));
  if (f?.statut === "soumise") throw new ErreurMetier("conflit", "Votre candidature est en cours d'étude : attendez la décision pour ajouter des pièces.");
  validerFichier(fichier, "piece");
  const pieceId = nouvelId();
  const chemin = await s.archive.ecrire(cheminCandidature(acteur.of_id, id, `${type}_${pieceId.slice(0, 8)}_${fichier.nom}`), fichier.contenu);
  await s.bd.insert(pieceFormateur).values({ id: pieceId, formateur_id: id, type, nom_fichier: fichier.nom, chemin, taille: fichier.contenu.length, expire_le, cree_le: s.horloge.maintenant() });
  return lireMaCandidature(s, acteur);
}

export async function supprimerPieceFormateur(s: Services, acteur: Acteur, pieceId: string) {
  const id = monFormateurId(acteur);
  const [p] = await s.bd.select().from(pieceFormateur).where(and(eq(pieceFormateur.id, pieceId), eq(pieceFormateur.formateur_id, id)));
  if (!p) throw introuvable("Pièce");
  await s.archive.supprimer(p.chemin);
  await s.bd.delete(pieceFormateur).where(eq(pieceFormateur.id, pieceId));
  return lireMaCandidature(s, acteur);
}

export async function soumettreCandidature(s: Services, acteur: Acteur) {
  const { formateur: f, manques } = await lireMaCandidature(s, acteur);
  if (f.statut_candidature === "validee") throw new ErreurMetier("conflit", "Votre candidature est déjà validée.");
  if (f.statut_candidature === "soumise") throw new ErreurMetier("conflit", "Votre candidature est déjà en cours d'étude.");
  if (manques.length > 0) throw invalide("Votre candidature est incomplète.", { manques });
  await s.bd.update(formateur).set({ statut_candidature: "soumise", soumise_le: s.horloge.maintenant(), motif_decision: "" }).where(eq(formateur.id, f.id));
  await journaliser(s, { of_id: acteur.of_id, acteur, type: "candidature_soumise", libelle: `Candidature soumise par ${acteur.nom}` });

  const [of] = await s.bd.select().from(organismeFormation).where(eq(organismeFormation.id, acteur.of_id));
  const admins = await s.bd.select().from(utilisateur).where(and(eq(utilisateur.of_id, acteur.of_id), eq(utilisateur.role, "admin"), eq(utilisateur.actif, true)));
  for (const admin of admins) {
    const c = courriels.candidatureSoumise({ of_nom: of!.of_nom, candidat: acteur.nom, lien: `${s.appUrl}/admin/candidatures` });
    await s.courrier.envoyer({ of_id: acteur.of_id, type: "candidature_soumise", destinataire: admin.email, ...c });
  }
  return lireMaCandidature(s, acteur);
}

// ——— Côté Admin S4M ———

export async function listerCandidatures(s: Services, acteur: Acteur) {
  exigerRole(acteur, "admin");
  return s.bd.select().from(formateur).where(eq(formateur.of_id, acteur.of_id)).orderBy(desc(formateur.soumise_le), desc(formateur.cree_le));
}

export async function lireCandidature(s: Services, acteur: Acteur, formateurId: string) {
  exigerRole(acteur, "admin");
  const [f] = await s.bd.select().from(formateur).where(and(eq(formateur.id, formateurId), eq(formateur.of_id, acteur.of_id)));
  if (!f) throw introuvable("Candidature");
  const pieces = await s.bd.select().from(pieceFormateur).where(eq(pieceFormateur.formateur_id, formateurId)).orderBy(pieceFormateur.cree_le);
  return { formateur: f, pieces, types: TYPES_PIECE_FORMATEUR };
}

/** F-ONB-02 / F-ONB-03 : l'admin approuve ou rejette ; le candidat est informé par e-mail. */
export async function deciderCandidature(s: Services, acteur: Acteur, formateurId: string, decision: { validee: boolean; motif?: string }) {
  const { formateur: f } = await lireCandidature(s, acteur, formateurId);
  if (f.statut_candidature !== "soumise") throw new ErreurMetier("conflit", "Seule une candidature soumise peut recevoir une décision.");
  const motif = decision.motif?.trim() ?? "";
  if (!decision.validee && !motif) throw invalide("Un motif est obligatoire pour rejeter une candidature.");

  await s.bd
    .update(formateur)
    .set({ statut_candidature: decision.validee ? "validee" : "refusee", motif_decision: motif, decidee_le: s.horloge.maintenant() })
    .where(eq(formateur.id, f.id));
  await journaliser(s, {
    of_id: acteur.of_id,
    acteur,
    type: decision.validee ? "candidature_validee" : "candidature_refusee",
    libelle: `Candidature de ${f.formateur_prenom} ${f.formateur_nom} ${decision.validee ? "validée" : "rejetée"}`,
    detail: { formateur_id: f.id, motif },
  });

  const [of] = await s.bd.select().from(organismeFormation).where(eq(organismeFormation.id, acteur.of_id));
  const c = courriels.decisionCandidature({ of_nom: of!.of_nom, prenom: f.formateur_prenom, validee: decision.validee, motif, lien: `${s.appUrl}/` });
  await s.courrier.envoyer({ of_id: acteur.of_id, type: "candidature_decision", destinataire: f.formateur_email, ...c });
  return lireCandidature(s, acteur, formateurId);
}

export async function telechargerPieceFormateur(s: Services, acteur: Acteur, pieceId: string) {
  const [ligne] = await s.bd
    .select({ p: pieceFormateur, f: formateur })
    .from(pieceFormateur)
    .innerJoin(formateur, eq(formateur.id, pieceFormateur.formateur_id))
    .where(eq(pieceFormateur.id, pieceId));
  if (!ligne || ligne.f.of_id !== acteur.of_id) throw introuvable("Pièce");
  if (acteur.role !== "admin" && ligne.f.id !== acteur.formateur_id) throw interdit();
  return { nom: ligne.p.nom_fichier, contenu: await s.archive.lire(ligne.p.chemin) };
}
