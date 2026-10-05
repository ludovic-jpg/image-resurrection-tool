/**
 * Ce que l'exécution d'une transition écrit sur le dossier, et quelles pièces chaque effet concerne — parties pures
 * de `executerAction` / `executerEffet` de l'ancien `src/serveur/services/pipeline.ts`. La DÉCISION (rôle, étape,
 * garde, motif) reste au noyau (`transiter`) ; ceci ne décide rien, il décrit l'écriture une fois la décision prise.
 */
import type { CodePiece } from "../referentiel/pieces";
import type { Action } from "./transitions";

/** Pièces générées à la validation du dossier (F-ARCH-01/03), dans « Pièces de départ ». */
export const PIECES_DE_DEPART: readonly CodePiece[] = [
  "00-AVT",
  "01-AVT",
  "PRE",
  "02-AVT",
  "03-AVT",
  "PRG",
];
/** Planning et programme sont transmis en annexe de la convention, sans statut (F-COM-03bis). */
export const PIECES_TRANSMISES_EN_ANNEXE: readonly CodePiece[] = ["03-AVT", "PRG"];
/** Pièces jointes à l'e-mail automatique à l'entreprise (F-DOS-06 / RG-04). */
export const PIECES_ENVOYEES_A_L_ENTREPRISE: readonly CodePiece[] = [
  "PRE",
  "02-AVT",
  "03-AVT",
  "PRG",
];
export const PIECES_DE_REALISATION: readonly CodePiece[] = ["06-PDT", "07-FIN"];
export const PIECES_DE_FIN: readonly CodePiece[] = ["08-FIN", "09-FIN"];

/** Colonnes de `dossier_formation` écrites avec le nouveau sous-statut, selon l'action. */
export function colonnesDeTransition(
  action: Action,
  vers: string,
  maintenant: string,
  motif?: string,
): Record<string, string> {
  return {
    sous_statut: vers,
    maj_le: maintenant,
    ...(action === "valider_dossier" ? { valide_le: maintenant, motif_renvoi: "" } : {}),
    ...(action === "renvoyer_en_brouillon" ? { motif_renvoi: (motif ?? "").trim() } : {}),
    ...(action === "enregistrer_refus" ? { motif_refus: motif?.trim() ?? "" } : {}),
    ...(action === "terminer_formation" ? { termine_le: maintenant } : {}),
  };
}
