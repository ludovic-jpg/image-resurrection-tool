/**
 * Confirmation de la suppression d'un compte (F-RGPD-01) — règle PURE.
 *
 * La phrase est exacte : même casse, mêmes mots, mêmes accents ; seuls les espaces autour sont tolérés (comme l'ancien
 * service). « supprimer mon compte », « SUPPRIMER  MON COMPTE » ou « SUPPRIMER MON COMPTE. » sont refusées.
 */
import { PHRASE_DE_CONFIRMATION } from "./apercu";

export const MESSAGE_PHRASE_INCORRECTE = `Pour confirmer, saisissez exactement : ${PHRASE_DE_CONFIRMATION}`;
export const MESSAGE_MOT_DE_PASSE_INCORRECT = "Mot de passe incorrect.";

export function phraseDeConfirmationValide(phrase: unknown): boolean {
  return typeof phrase === "string" && phrase.trim() === PHRASE_DE_CONFIRMATION;
}
