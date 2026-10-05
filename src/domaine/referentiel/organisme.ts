/**
 * Champs de l'organisme sans lesquels une pièce contractuelle n'est pas émissible.
 *
 * Version PURE de `CHAMPS_OF_OBLIGATOIRES` et `champsOfManquants` de `src/serveur/services/organisme.ts` : mêmes
 * champs, mêmes libellés, même ordre. Tant qu'ils sont vides, la validation d'un dossier est refusée : mieux vaut un
 * refus clair qu'une convention sans SIRET.
 */
export const CHAMPS_OF_OBLIGATOIRES = [
  "of_nom",
  "of_adresse",
  "of_siret",
  "of_nda_numero",
  "of_dreets_region",
  "of_representant_prenom",
  "of_representant_nom",
  "of_email_pedagogie",
  "of_tribunal_competent",
] as const;

const LIBELLES: Record<(typeof CHAMPS_OF_OBLIGATOIRES)[number], string> = {
  of_nom: "Raison sociale",
  of_adresse: "Adresse",
  of_siret: "SIRET",
  of_nda_numero: "Numéro de déclaration d'activité",
  of_dreets_region: "Région de la DREETS",
  of_representant_prenom: "Prénom du représentant légal",
  of_representant_nom: "Nom du représentant légal",
  of_email_pedagogie: "E-mail pédagogie",
  of_tribunal_competent: "Tribunal compétent",
};

/** Libellés des champs obligatoires restés vides, dans l'ordre de `CHAMPS_OF_OBLIGATOIRES`. */
export function champsOfManquants(of: Partial<Record<string, unknown>>): string[] {
  return CHAMPS_OF_OBLIGATOIRES.filter((c) => !String(of[c] ?? "").trim()).map((c) => LIBELLES[c]);
}
