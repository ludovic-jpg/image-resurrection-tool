/**
 * Les cinq questionnaires en ligne (recueil des besoins, positionnement, acquis, satisfaction à chaud et à froid) :
 * pièce portée, libellé, moment d'ouverture, état d'un formulaire envoyé. Repris de `CONFIG_EVALUATIONS`, `MOMENTS`,
 * `questionnaireOuvert` et `etatFormulaires` de l'ancien serveur (`evaluations.ts`, `formulaires-apprenant.ts`).
 */
import { aAtteint, estTerminal, type SousStatut } from "../pipeline/statuts";
import { FORMULAIRES } from "../formulaires/definitions";
import type { CodePiece } from "../referentiel/pieces";

export type TypeEvaluation =
  "recueil" | "positionnement" | "acquis" | "satisfaction_chaud" | "satisfaction_froid";

export const CONFIG_EVALUATIONS: Record<
  TypeEvaluation,
  { code: CodePiece; libelle: string; ouvertDes: SousStatut; valideLaPiece: boolean }
> = {
  recueil: {
    code: "00-AVT",
    libelle: "Recueil des besoins",
    ouvertDes: "brouillon",
    valideLaPiece: true,
  },
  positionnement: {
    code: "01-AVT",
    libelle: "Test de positionnement",
    ouvertDes: "brouillon",
    valideLaPiece: true,
  },
  // L'évaluation des acquis se signe ensuite : la saisie des réponses seule ne suffit pas à valider la pièce.
  acquis: {
    code: "07-FIN",
    libelle: "Évaluation des acquis",
    ouvertDes: "formation_debutee",
    valideLaPiece: false,
  },
  satisfaction_chaud: {
    code: "08-FIN",
    libelle: "Satisfaction à chaud",
    ouvertDes: "fin_dossier_incomplet",
    valideLaPiece: true,
  },
  satisfaction_froid: {
    code: "12-APR",
    libelle: "Satisfaction à froid",
    ouvertDes: "fin_dossier_complet",
    valideLaPiece: true,
  },
};

export const TYPES_EVALUATION = Object.keys(CONFIG_EVALUATIONS) as TypeEvaluation[];

export const MOMENTS: Record<TypeEvaluation, string> = {
  recueil: "à la création du dossier",
  positionnement: "à la création du dossier",
  acquis: "quand la formation est déclarée terminée",
  satisfaction_chaud: "quand la formation est déclarée terminée",
  satisfaction_froid: "90 jours après la fin de la formation",
};

export function questionnaireOuvert(statut: SousStatut, type: TypeEvaluation): boolean {
  return aAtteint(statut, CONFIG_EVALUATIONS[type].ouvertDes) && !estTerminal(statut);
}

export type StatutFormulaire = "valide" | "en_cours" | "expire" | "envoye" | "non_envoye";

/** État affiché d'un formulaire : la pièce validée prime, puis l'état de la ligne d'envoi. */
export function statutFormulaire(a: {
  pieceValidee: boolean;
  formulaire: { statut: string; expire_le: string } | null;
  maintenant: string;
}): StatutFormulaire {
  if (a.pieceValidee) return "valide";
  const f = a.formulaire;
  if (!f) return "non_envoye";
  if (f.statut === "complet") return "valide";
  if (f.statut === "en_cours") return "en_cours";
  // Les horodatages de la base n'ont pas tous le même format textuel : on compare des instants, pas des chaînes.
  return Date.parse(f.expire_le) <= Date.parse(a.maintenant) ? "expire" : "envoye";
}

/** Formulaire fixe d'un type (recueil, satisfactions) ; `null` pour les QCM, rattachés au dossier. */
export function formulaireDe(type: TypeEvaluation) {
  return type === "recueil"
    ? FORMULAIRES["00-AVT"]
    : type === "satisfaction_chaud"
      ? FORMULAIRES["08-FIN"]
      : type === "satisfaction_froid"
        ? FORMULAIRES["12-APR"]
        : null;
}
