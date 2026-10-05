/**
 * Règles PURES des formulaires renseignés en ligne par l'apprenant : recueil des besoins (00-AVT), test de
 * positionnement (01-AVT), évaluation des acquis (07-FIN), satisfaction à chaud (08-FIN) et à froid (12-APR).
 *
 * Version pure de ce qui vivait dans `src/serveur/services/evaluations.ts` (`CONFIG_EVALUATIONS`,
 * `questionnaireOuvert`, `controlerReponses`…) et de `MOMENTS` de `formulaires-apprenant.ts` — la carte des routes
 * (§ route 100) demande de les déplacer dans le noyau. Aucun accès base ni réseau ici.
 */
import type { SousStatut } from "../pipeline/statuts";
import { aAtteint, estTerminal } from "../pipeline/statuts";
import type { CodePiece } from "../referentiel/pieces";
import { FORMULAIRES, validerReponses, type Reponses } from "./definitions";
import { corriger, type Questionnaire } from "./qcm";

export type TypeEvaluation =
  "recueil" | "positionnement" | "acquis" | "satisfaction_chaud" | "satisfaction_froid";

export type TypeFormulaire = TypeEvaluation;

export const TYPES_EVALUATION: readonly TypeEvaluation[] = [
  "recueil",
  "positionnement",
  "acquis",
  "satisfaction_chaud",
  "satisfaction_froid",
];

export const estTypeEvaluation = (t: string): t is TypeEvaluation =>
  (TYPES_EVALUATION as readonly string[]).includes(t);

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

/** Quand chaque formulaire part automatiquement (affiché au formateur pour qu'il sache ce qui se passe). */
export const MOMENTS: Record<TypeEvaluation, string> = {
  recueil: "à la création du dossier",
  positionnement: "à la création du dossier",
  acquis: "quand la formation est déclarée terminée",
  satisfaction_chaud: "quand la formation est déclarée terminée",
  satisfaction_froid: "90 jours après la fin de la formation",
};

/** Durée de validité d'un lien personnel de formulaire. */
export const DUREE_LIEN_FORMULAIRE_MS = 45 * 24 * 3600 * 1000;
export const DELAI_RELANCE_JOURS = 7;
export const DELAI_FROID_JOURS = 90;

/** Le questionnaire est-il ouvert à ce sous-statut ? (étape atteinte et dossier non terminal) */
export function questionnaireOuvert(sousStatut: SousStatut, type: TypeEvaluation): boolean {
  return aAtteint(sousStatut, CONFIG_EVALUATIONS[type].ouvertDes) && !estTerminal(sousStatut);
}

/** Définition à questions fixes (recueil, satisfactions) ; `null` pour les QCM (positionnement, acquis). */
export function formulaireDe(type: TypeEvaluation) {
  return type === "recueil"
    ? FORMULAIRES["00-AVT"]
    : type === "satisfaction_chaud"
      ? FORMULAIRES["08-FIN"]
      : type === "satisfaction_froid"
        ? FORMULAIRES["12-APR"]
        : null;
}

/** Questionnaire (QCM) rattaché au dossier pour ce type, ou `null`. */
export function questionnaireDe(
  d: { questionnaire_positionnement?: unknown; questionnaire_acquis?: unknown },
  type: TypeEvaluation,
): Questionnaire | null {
  if (type === "positionnement") return (d.questionnaire_positionnement as Questionnaire) ?? null;
  if (type === "acquis") return (d.questionnaire_acquis as Questionnaire) ?? null;
  return null;
}

export type ControleReponses =
  | { ok: true; reponses: Reponses | Array<number | null>; score: number | null }
  | {
      ok: false;
      code: "invalide" | "conflit";
      message: string;
      erreurs: Record<string, string>;
    };

/**
 * Contrôle les réponses d'un questionnaire (forme, complétude) sans rien écrire. Retourne les réponses normalisées
 * et le score (QCM), ou l'erreur métier lisible.
 */
export function controlerReponses(
  d: { questionnaire_positionnement?: unknown; questionnaire_acquis?: unknown },
  type: TypeEvaluation,
  brut: unknown,
): ControleReponses {
  const q = questionnaireDe(d, type);
  if (type === "positionnement" || type === "acquis") {
    if (!q)
      return {
        ok: false,
        code: "conflit",
        message: "Aucun questionnaire n'est rattaché à ce dossier pour cette évaluation.",
        erreurs: {},
      };
    if (!Array.isArray(brut) || brut.length !== q.questions.length)
      return {
        ok: false,
        code: "invalide",
        message: "Une réponse est attendue pour chaque question.",
        erreurs: {},
      };
    const reponses = brut.map((r, i) =>
      Number.isInteger(r) &&
      (r as number) >= 0 &&
      (r as number) < q.questions[i]!.propositions.length
        ? (r as number)
        : null,
    );
    if (reponses.some((r) => r === null))
      return {
        ok: false,
        code: "invalide",
        message: "Toutes les questions doivent recevoir une réponse.",
        erreurs: {},
      };
    return { ok: true, reponses, score: corriger(q, reponses).score };
  }
  const def = formulaireDe(type)!;
  if (typeof brut !== "object" || brut === null || Array.isArray(brut))
    return { ok: false, code: "invalide", message: "Réponses illisibles.", erreurs: {} };
  const reponses = Object.fromEntries(
    Object.entries(brut as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]),
  );
  const erreurs = validerReponses(def, reponses);
  if (Object.keys(erreurs).length > 0)
    return {
      ok: false,
      code: "invalide",
      message: "Certaines réponses sont manquantes ou invalides.",
      erreurs,
    };
  return { ok: true, reponses, score: null };
}

/** Ce que l'apprenant voit du suivi d'un formulaire dans l'état d'un dossier. */
export type StatutSuiviFormulaire = "valide" | "en_cours" | "expire" | "envoye" | "non_envoye";

/** Statut affiché au formateur : la pièce validée prime, puis la ligne du formulaire. */
export function statutSuiviFormulaire(
  ligne: { statut: string; expire_le: string } | null | undefined,
  pieceValidee: boolean,
  maintenant: Date,
): StatutSuiviFormulaire {
  if (pieceValidee) return "valide";
  if (!ligne) return "non_envoye";
  if (ligne.statut === "complet") return "valide";
  if (ligne.statut === "en_cours") return "en_cours";
  return new Date(ligne.expire_le).getTime() <= maintenant.getTime() ? "expire" : "envoye";
}

/** Statut du formulaire tel que la page publique le présente (« complet », « en_cours », « envoye »). */
export function statutPagePublique(
  ligne: { statut: string },
  pieceValidee: boolean,
): "complet" | "en_cours" | "envoye" {
  if (ligne.statut === "complet" || pieceValidee) return "complet";
  return ligne.statut === "en_cours" ? "en_cours" : "envoye";
}
