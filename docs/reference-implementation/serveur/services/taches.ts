/**
 * Tâches de fond, lancées au démarrage puis chaque jour :
 *  - satisfaction « à froid » 90 jours après la fin de la formation (pièce 12-APR, indicateur Qualiopi n° 30) ;
 *  - une relance à J+7 des formulaires apprenant restés sans réponse.
 * Tout est porté par `formulaires-apprenant.ts` (version 7) ; ce module ne fait que l'exposer.
 */
export { DELAI_FROID_JOURS, envoyerFormulairesProgrammes, envoyerSatisfactionsAFroid } from "./formulaires-apprenant";
