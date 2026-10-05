/**
 * Qui peut modifier quoi sur un dossier, selon son sous-statut — règles de `exigerModifiable`, `definirStagiaires`,
 * `supprimerBrouillon` et `renseignerObjectifsAtteints` de l'ancien `src/serveur/services/dossiers.ts`.
 *
 * La base les rejoue par politiques RLS (`s4m_dossier_modifiable`, politique DELETE) : ce sont des filets. Ces
 * fonctions donnent le refus LISIBLE (409 « conflit ») au lieu d'un 0 ligne muet.
 */
import { estTerminal, type SousStatut } from "../pipeline/statuts";
import type { Role } from "../referentiel/pieces";

export const MESSAGE_DOSSIER_FIGE =
  "Ce dossier n'est plus modifiable à cette étape : les pièces émises font foi.";
export const MESSAGE_STAGIAIRES_FIGES = "Les apprenants ne se modifient qu'en brouillon.";
export const MESSAGE_SUPPRESSION_REFUSEE =
  "Seul un dossier en brouillon peut être supprimé, par son formateur.";
export const MESSAGE_DOSSIER_ARCHIVE = "Ce dossier est archivé.";

/** Le formateur modifie en brouillon ; l'administrateur en brouillon et jusqu'à sa validation. Jamais l'apprenant. */
export function dossierModifiable(role: Role, statut: SousStatut): boolean {
  if (role === "formateur") return statut === "brouillon";
  if (role === "admin") return statut === "brouillon" || statut === "en_cours_validation";
  return false;
}

/** Les apprenants du dossier ne se modifient qu'en brouillon, et seul le formateur le fait. */
export function stagiairesModifiables(role: Role, statut: SousStatut): boolean {
  return role === "formateur" && statut === "brouillon";
}

export function brouillonSupprimable(role: Role, statut: SousStatut): boolean {
  return role === "formateur" && statut === "brouillon";
}

/** Les objectifs atteints se renseignent tant que le dossier n'est pas terminal. */
export function objectifsRenseignables(statut: SousStatut): boolean {
  return !estTerminal(statut);
}
