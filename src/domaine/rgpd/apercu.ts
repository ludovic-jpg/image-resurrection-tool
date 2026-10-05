/** Aperçu de la suppression d'un compte formateur, affiché AVANT la confirmation (F-RGPD-01). Pur. */
export const PHRASE_DE_CONFIRMATION = "SUPPRIMER MON COMPTE";

const STATUTS_NON_EN_COURS = ["brouillon", "archive", "refus_financement"];

export function construireApercuSuppression(statutsDesDossiers: readonly string[]) {
  const brouillons = statutsDesDossiers.filter((s) => s === "brouillon").length;
  const enCours = statutsDesDossiers.filter((s) => !STATUTS_NON_EN_COURS.includes(s)).length;
  return {
    phrase: PHRASE_DE_CONFIRMATION,
    supprime: [
      "Votre compte et votre mot de passe",
      "Vos coordonnées et les informations de votre entreprise",
      "Votre parcours et vos pièces justificatives",
      `Vos ${brouillons} dossier(s) en brouillon`,
      "Les formations, outils et coffres-forts qui ne servent à aucun dossier conservé",
    ],
    conserve: [
      `${statutsDesDossiers.length - brouillons} dossier(s) de formation instruits, avec leurs pièces archivées (obligations légales et Qualiopi)`,
      "Le journal d'historique de ces dossiers",
    ],
    dossiers_en_cours: enCours,
    avertissement:
      enCours > 0
        ? `${enCours} dossier(s) sont encore en cours d'instruction : ils resteront suivis par l'organisme, mais vous n'y aurez plus accès.`
        : "",
  };
}
