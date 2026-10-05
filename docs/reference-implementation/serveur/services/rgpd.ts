/**
 * Module 9 — Gestion de compte et RGPD (F-ONB-04, F-RGPD-01 à 03, RG-01).
 *
 * Hypothèse retenue (point ouvert n° 10) : DISSOCIATION + EFFACEMENT. Le compte est supprimé, les champs
 * identifiants du formateur sont effacés, mais sa ligne « formateur » subsiste, anonyme, pour que les dossiers
 * qu'il a instruits restent rattachés à quelque chose. Les pièces déjà émises et archivées ne sont pas
 * réécrites : ce sont des documents contractuels soumis à conservation légale.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { coffreFichier, dossierFormation, entrepriseCliente, formateur, formation, modeleOutil, pieceFormateur, positionnement, sessionUtilisateur, stagiaire, stagiaireDossier, utilisateur } from "../bd/schema";
import { verifierMotDePasse } from "./auth";
import { ErreurMetier, interdit, invalide, journaliser, type Acteur, type Services } from "./socle";

export const PHRASE_DE_CONFIRMATION = "SUPPRIMER MON COMPTE";

/** Ce qui sera supprimé et ce qui sera conservé — affiché AVANT la confirmation (F-RGPD-01). */
export async function apercuSuppression(s: Services, acteur: Acteur) {
  if (acteur.role !== "formateur" || !acteur.formateur_id) throw interdit("La suppression de compte en libre-service concerne les formateurs.");
  const dossiers = await s.bd.select({ id: dossierFormation.id, statut: dossierFormation.sous_statut }).from(dossierFormation).where(eq(dossierFormation.formateur_id, acteur.formateur_id));
  const brouillons = dossiers.filter((d) => d.statut === "brouillon").length;
  const enCours = dossiers.filter((d) => !["brouillon", "archive", "refus_financement"].includes(d.statut)).length;
  return {
    phrase: PHRASE_DE_CONFIRMATION,
    supprime: ["Votre compte et votre mot de passe", "Vos coordonnées et les informations de votre entreprise", "Votre parcours et vos pièces justificatives", `Vos ${brouillons} dossier(s) en brouillon`, "Les formations, outils et coffres-forts qui ne servent à aucun dossier conservé"],
    conserve: [`${dossiers.length - brouillons} dossier(s) de formation instruits, avec leurs pièces archivées (obligations légales et Qualiopi)`, "Le journal d'historique de ces dossiers"],
    dossiers_en_cours: enCours,
    avertissement: enCours > 0 ? `${enCours} dossier(s) sont encore en cours d'instruction : ils resteront suivis par l'organisme, mais vous n'y aurez plus accès.` : "",
  };
}

export async function supprimerMonCompte(s: Services, acteur: Acteur, confirmation: { phrase: string; mot_de_passe: string }): Promise<void> {
  if (acteur.role !== "formateur" || !acteur.formateur_id) throw interdit("La suppression de compte en libre-service concerne les formateurs.");
  if (confirmation.phrase.trim() !== PHRASE_DE_CONFIRMATION) throw invalide(`Pour confirmer, saisissez exactement : ${PHRASE_DE_CONFIRMATION}`);
  const [u] = await s.bd.select().from(utilisateur).where(eq(utilisateur.id, acteur.utilisateur_id));
  if (!u || !(await verifierMotDePasse(confirmation.mot_de_passe, u.mot_de_passe_hash))) throw new ErreurMetier("invalide", "Mot de passe incorrect.");

  const formateur_id = acteur.formateur_id;
  const pieces = await s.bd.select().from(pieceFormateur).where(eq(pieceFormateur.formateur_id, formateur_id));
  for (const p of pieces) await s.archive.supprimer(p.chemin);

  await s.bd.transaction(async (tx) => {
    // 1. Les brouillons n'engagent personne : ils partent avec le compte.
    await tx.delete(dossierFormation).where(and(eq(dossierFormation.formateur_id, formateur_id), eq(dossierFormation.sous_statut, "brouillon")));
    const conserves = await tx.select({ formation_id: dossierFormation.formation_id, entreprise_id: dossierFormation.entreprise_id }).from(dossierFormation).where(eq(dossierFormation.formateur_id, formateur_id));
    const formationsGardees = conserves.map((c) => c.formation_id).filter((x): x is string => x !== null);

    // 2. Catalogue, outils et coffres qui ne servent à aucun dossier conservé.
    await tx.delete(modeleOutil).where(eq(modeleOutil.formateur_id, formateur_id));
    const aSupprimer = await tx
      .select({ id: formation.id })
      .from(formation)
      .where(formationsGardees.length ? and(eq(formation.formateur_id, formateur_id), notInArray(formation.id, formationsGardees)) : eq(formation.formateur_id, formateur_id));
    if (aSupprimer.length) {
      await tx.delete(coffreFichier).where(inArray(coffreFichier.formation_id, aSupprimer.map((f) => f.id)));
      await tx.delete(formation).where(inArray(formation.id, aSupprimer.map((f) => f.id)));
    }
    // 2 bis. Positionnements hors dossier (« Modification 1 ») : pré-contractuels, ils partent avec le compte ;
    // ceux qui ont servi à un dossier conservé y ont été recopiés (pièces 00-AVT et 01-AVT).
    await tx.delete(positionnement).where(eq(positionnement.formateur_id, formateur_id));
    // 3. Fiches du répertoire qui ne figurent dans aucun dossier conservé (apprenants et entreprises).
    const inscrits = await tx
      .select({ id: stagiaireDossier.stagiaire_id })
      .from(stagiaireDossier)
      .innerJoin(dossierFormation, eq(dossierFormation.id, stagiaireDossier.dossier_id))
      .where(eq(dossierFormation.formateur_id, formateur_id));
    const gardes = inscrits.map((i) => i.id);
    const orphelins = await tx
      .select({ id: stagiaire.id, utilisateur_id: stagiaire.utilisateur_id })
      .from(stagiaire)
      .where(gardes.length ? and(eq(stagiaire.formateur_id, formateur_id), notInArray(stagiaire.id, gardes)) : eq(stagiaire.formateur_id, formateur_id));
    if (orphelins.length) {
      await tx.delete(stagiaire).where(inArray(stagiaire.id, orphelins.map((o) => o.id)));
      const comptes = orphelins.map((o) => o.utilisateur_id).filter((x): x is string => x !== null);
      if (comptes.length) await tx.delete(utilisateur).where(and(inArray(utilisateur.id, comptes), eq(utilisateur.role, "apprenant")));
    }
    const entreprisesGardees = conserves.map((c) => c.entreprise_id);
    await tx.update(stagiaire).set({ entreprise_id: null }).where(entreprisesGardees.length ? and(eq(stagiaire.formateur_id, formateur_id), notInArray(stagiaire.entreprise_id, entreprisesGardees)) : eq(stagiaire.formateur_id, formateur_id));
    await tx.delete(entrepriseCliente).where(entreprisesGardees.length ? and(eq(entrepriseCliente.formateur_id, formateur_id), notInArray(entrepriseCliente.id, entreprisesGardees)) : eq(entrepriseCliente.formateur_id, formateur_id));

    // 4. Effacement des données identifiantes du formateur et de son entreprise (F-RGPD-02).
    await tx.delete(pieceFormateur).where(eq(pieceFormateur.formateur_id, formateur_id));
    await tx
      .update(formateur)
      .set({
        utilisateur_id: null,
        formateur_prenom: "Formateur",
        formateur_nom: "(compte supprimé)",
        formateur_email: "",
        formateur_telephone: "",
        formateur_entreprise_nom: "",
        formateur_entreprise_adresse: "",
        formateur_entreprise_siret: "",
        formateur_nda_numero: "",
        formateur_dreets_region: "",
        formateur_iban: "",
        formateur_bic: "",
        parcours: "",
        formateur_statut_juridique: "",
        formateur_domaines: [],
        formateur_zones: "",
        formateur_langues: "",
        formateur_tarif_journalier: null,
        formateur_bio: "",
        formateur_linkedin: "",
        formateur_disponibilites: "",
        formateur_assurance_rc: "",
        motif_decision: "",
        anonymise_le: s.horloge.maintenant(),
      })
      .where(eq(formateur.id, formateur_id));

    // 5. Le compte lui-même.
    await tx.delete(sessionUtilisateur).where(eq(sessionUtilisateur.utilisateur_id, acteur.utilisateur_id));
    await tx.delete(utilisateur).where(eq(utilisateur.id, acteur.utilisateur_id));
  });

  await journaliser(s, { of_id: acteur.of_id, acteur: "systeme", type: "compte_supprime", libelle: "Compte formateur supprimé à la demande de son titulaire ; dossiers instruits conservés", detail: { formateur_id } });
}
