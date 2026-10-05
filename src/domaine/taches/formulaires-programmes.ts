/**
 * Tâche quotidienne — quels formulaires apprenant partent d'eux-mêmes ? Règle PURE.
 *
 * Reprise de `envoyerFormulairesProgrammes` (`src/serveur/services/formulaires-apprenant.ts`, exposée par `taches.ts`) :
 *  - satisfaction « à froid » (pièce 12-APR, indicateur Qualiopi n° 30) 90 jours après la fin de la formation ;
 *  - UNE relance, 7 jours après l'envoi, des formulaires restés sans réponse.
 * Idempotente : une ligne par formulaire, compteur d'envois.
 */
import { aAtteint, estTerminal, type SousStatut } from "../pipeline/statuts";
import type { CodePiece } from "../referentiel/pieces";

export const DELAI_FROID_JOURS = 90;
export const DELAI_RELANCE_JOURS = 7;
/** Validité d'un lien de formulaire (le lien de relance repart pour 45 jours). */
export const DUREE_LIEN_FORMULAIRE_MS = 45 * 24 * 3600 * 1000;

export type TypeFormulaire =
  "recueil" | "positionnement" | "acquis" | "satisfaction_chaud" | "satisfaction_froid";

/** Même table que `CONFIG_EVALUATIONS` de l'ancien service d'évaluations. */
export const CONFIG_FORMULAIRES: Record<
  TypeFormulaire,
  { code: CodePiece; libelle: string; ouvertDes: SousStatut }
> = {
  recueil: { code: "00-AVT", libelle: "Recueil des besoins", ouvertDes: "brouillon" },
  positionnement: { code: "01-AVT", libelle: "Test de positionnement", ouvertDes: "brouillon" },
  acquis: { code: "07-FIN", libelle: "Évaluation des acquis", ouvertDes: "formation_debutee" },
  satisfaction_chaud: {
    code: "08-FIN",
    libelle: "Satisfaction à chaud",
    ouvertDes: "fin_dossier_incomplet",
  },
  satisfaction_froid: {
    code: "12-APR",
    libelle: "Satisfaction à froid",
    ouvertDes: "fin_dossier_complet",
  },
};

export const estTypeFormulaire = (t: string): t is TypeFormulaire => t in CONFIG_FORMULAIRES;

/** Le formulaire est-il ouvert à cette étape du dossier ? (`questionnaireOuvert` de l'ancien service) */
export function formulaireOuvert(sousStatut: string, type: TypeFormulaire): boolean {
  const statut = sousStatut as SousStatut;
  return aAtteint(statut, CONFIG_FORMULAIRES[type].ouvertDes) && !estTerminal(statut);
}

/** Sous-statuts des dossiers dont la formation est terminée et qui ne sont pas archivés. */
export const STATUTS_FORMATION_TERMINEE = [
  "fin_dossier_complet",
  "demande_paiement",
  "paiement_receptionne",
] as const;

const JOUR_MS = 24 * 3600 * 1000;

/** Date ISO (AAAA-MM-JJ) avant laquelle (incluse) une formation terminée appelle la satisfaction à froid. */
export const seuilFroid = (maintenant: Date): string =>
  new Date(maintenant.getTime() - DELAI_FROID_JOURS * JOUR_MS).toISOString().slice(0, 10);

/** Instant avant lequel (inclus) un formulaire resté sans réponse mérite sa relance. */
export const seuilRelance = (maintenant: Date): Date =>
  new Date(maintenant.getTime() - DELAI_RELANCE_JOURS * JOUR_MS);

export function aSatisfactionFroidDue(
  d: { sous_statut: string; formation_date_fin: string },
  maintenant: Date,
): boolean {
  return (
    (STATUTS_FORMATION_TERMINEE as readonly string[]).includes(d.sous_statut) &&
    d.formation_date_fin !== "" &&
    d.formation_date_fin <= seuilFroid(maintenant)
  );
}

export function estARelancer(
  f: { statut: string; envois: number; envoye_le: string | null; expire_le: string },
  maintenant: Date,
): boolean {
  return (
    (f.statut === "envoye" || f.statut === "en_cours") &&
    f.envois === 1 &&
    f.envoye_le !== null &&
    new Date(f.envoye_le).getTime() <= seuilRelance(maintenant).getTime() &&
    new Date(f.expire_le).getTime() > maintenant.getTime()
  );
}
