/**
 * Pièces justificatives de la candidature d'un formateur (F-ONB-01) — règles PURES.
 *
 * Reprise de `candidatures.ts` de l'ancien serveur : liste des types de pièce, calcul des « manques » (ce qui
 * empêche de soumettre) et des échéances, contrôle d'un fichier déposé. Point ouvert n° 6 du cahier des charges :
 * `obligatoire` est le seul réglage à ajuster dans la liste.
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

export const TAILLE_MAX_PIECE = 15 * 1024 * 1024;
/** Extensions acceptées pour une pièce (liste blanche de l'ancien serveur, `fichiers.ts`). */
export const EXTENSIONS_PIECE = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "doc",
  "docx",
  "odt",
  "xls",
  "xlsx",
  "ods",
  "csv",
  "txt",
] as const;

export function extensionDe(nom: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(nom);
  return m ? m[1]!.toLowerCase() : "";
}

/** Ce qu'il manque pour pouvoir soumettre : téléphone, parcours, pièces obligatoires. Libellés lisibles. */
export function manquesCandidature(
  formateur: { formateur_telephone: string; parcours: string },
  pieces: ReadonlyArray<{ type: string }>,
): string[] {
  const manques: string[] = [];
  if (!formateur.formateur_telephone) manques.push("Téléphone");
  if (!formateur.parcours) manques.push("Parcours professionnel");
  for (const t of TYPES_PIECE_FORMATEUR)
    if (t.obligatoire && !pieces.some((p) => p.type === t.type)) manques.push(t.libelle);
  return manques;
}

/** Pièces dotées d'une date de fin de validité, avec indicateur « expirée » (dates ISO AAAA-MM-JJ comparables). */
export function echeancesPieces(
  pieces: ReadonlyArray<{ id: string; nom_fichier: string; expire_le: string }>,
  aujourdhui: string,
) {
  return pieces
    .filter((p) => p.expire_le)
    .map((p) => ({
      id: p.id,
      nom_fichier: p.nom_fichier,
      expire_le: p.expire_le,
      expiree: p.expire_le < aujourdhui,
    }));
}

/**
 * Contrôle d'un dépôt AVANT l'envoi : type connu, date de fin de validité bien formée, fichier non vide, borné,
 * d'une extension admise. Renvoie le message d'erreur (en français) ou `null`.
 */
export function erreurDepotPiece(d: {
  type: string;
  nom: string;
  taille: number;
  expire_le: string;
}): string | null {
  if (!TYPES_PIECE_FORMATEUR.some((t) => t.type === d.type)) return "Type de pièce inconnu.";
  if (d.expire_le && !/^\d{4}-\d{2}-\d{2}$/.test(d.expire_le))
    return "Date de fin de validité attendue au format AAAA-MM-JJ.";
  if (d.taille === 0) return "Le fichier est vide.";
  if (d.taille > TAILLE_MAX_PIECE)
    return `Le fichier dépasse la taille maximale de ${Math.round(TAILLE_MAX_PIECE / 1024 / 1024)} Mo.`;
  if (!(EXTENSIONS_PIECE as readonly string[]).includes(extensionDe(d.nom)))
    return `Type de fichier non accepté. Formats admis : ${EXTENSIONS_PIECE.join(", ")}.`;
  return null;
}
