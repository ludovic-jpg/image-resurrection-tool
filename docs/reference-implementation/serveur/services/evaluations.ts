/**
 * Questionnaires renseignés en ligne : recueil des besoins (00-AVT), test de positionnement (01-AVT),
 * évaluation des acquis (07-FIN), satisfaction à chaud (08-FIN) et à froid (12-APR).
 *
 * Qui renseigne quoi (version 7, 23/09/2026) : l'APPRENANT, et lui seul — depuis son espace personnel, ou depuis la
 * page interactive de son formulaire (lien personnel, voir `formulaires-apprenant.ts`), où il répond ET signe.
 * Le formateur ne saisit plus de réponses à la place d'un apprenant (décision du 23/09/2026) ; un positionnement
 * signé avant le dossier est repris automatiquement (voir `positionnements.ts`).
 *  - recueil et positionnement joignent ces deux pièces au dossier et ouvrent la demande de validation (RG-02) ;
 *  - acquis : la pièce 07-FIN se signe (page interactive, ou espace personnel) ;
 *  - satisfaction : l'apprenant seulement — un formateur ne note pas sa propre formation.
 */
import { and, eq } from "drizzle-orm";
import { FORMULAIRES, validerReponses, type Reponses } from "@/domaine/formulaires/definitions";
import { corriger, sansCorrige, type Questionnaire } from "@/domaine/formulaires/qcm";
import { aAtteint, estTerminal, type SousStatut } from "@/domaine/pipeline/statuts";
import type { CodePiece } from "@/domaine/referentiel/pieces";
import { evaluation } from "../bd/schema";
import { dateIso, nouvelId } from "../ports/divers";
import { accederAuDossier, stagiairesDuDossier, type LigneDossier } from "./agregat";
import { archiverRendu, nomFichierPiece, rendrePiece, synchroniserPieces, trouverPiece } from "./generation";
import { marquerValidee } from "./retours";
import { ErreurMetier, interdit, invalide, type Acteur, type Services } from "./socle";

export type TypeEvaluation = "recueil" | "positionnement" | "acquis" | "satisfaction_chaud" | "satisfaction_froid";

export const CONFIG_EVALUATIONS: Record<TypeEvaluation, { code: CodePiece; libelle: string; ouvertDes: SousStatut; valideLaPiece: boolean }> = {
  recueil: { code: "00-AVT", libelle: "Recueil des besoins", ouvertDes: "brouillon", valideLaPiece: true },
  positionnement: { code: "01-AVT", libelle: "Test de positionnement", ouvertDes: "brouillon", valideLaPiece: true },
  // L'évaluation des acquis se signe ensuite : la saisie des réponses seule ne suffit pas à valider la pièce.
  acquis: { code: "07-FIN", libelle: "Évaluation des acquis", ouvertDes: "formation_debutee", valideLaPiece: false },
  satisfaction_chaud: { code: "08-FIN", libelle: "Satisfaction à chaud", ouvertDes: "fin_dossier_incomplet", valideLaPiece: true },
  satisfaction_froid: { code: "12-APR", libelle: "Satisfaction à froid", ouvertDes: "fin_dossier_complet", valideLaPiece: true },
};
const CONFIG = CONFIG_EVALUATIONS;

export const TYPES_EVALUATION = Object.keys(CONFIG_EVALUATIONS) as TypeEvaluation[];

export function questionnaireOuvert(d: LigneDossier, type: TypeEvaluation): boolean {
  const statut = d.sous_statut as SousStatut;
  return aAtteint(statut, CONFIG[type].ouvertDes) && !estTerminal(statut);
}

export function formulaireDe(type: TypeEvaluation) {
  return type === "recueil" ? FORMULAIRES["00-AVT"] : type === "satisfaction_chaud" ? FORMULAIRES["08-FIN"] : type === "satisfaction_froid" ? FORMULAIRES["12-APR"] : null;
}

export function questionnaireDe(d: LigneDossier, type: TypeEvaluation): Questionnaire | null {
  if (type === "positionnement") return d.questionnaire_positionnement as Questionnaire | null;
  if (type === "acquis") return d.questionnaire_acquis as Questionnaire | null;
  return null;
}

function cibleStagiaire(acteur: Acteur, stagiaireId: string | undefined): string {
  if (acteur.role === "apprenant") {
    if (!acteur.stagiaire_id) throw interdit();
    return acteur.stagiaire_id;
  }
  if (!stagiaireId) throw invalide("Le stagiaire concerné doit être précisé.");
  return stagiaireId;
}

/** Ce que l'apprenant (ou le formateur) doit voir pour renseigner un questionnaire — sans le corrigé. */
export async function lireQuestionnaire(s: Services, acteur: Acteur, dossierId: string, type: TypeEvaluation, stagiaireId?: string) {
  const d = await accederAuDossier(s, acteur, dossierId);
  const stagiaire_id = cibleStagiaire(acteur, stagiaireId);
  const [existante] = await s.bd.select().from(evaluation).where(and(eq(evaluation.dossier_id, d.id), eq(evaluation.stagiaire_id, stagiaire_id), eq(evaluation.type, type)));
  const q = questionnaireDe(d, type);
  const config = CONFIG[type];
  return {
    type,
    ouvert: aAtteint(d.sous_statut as SousStatut, config.ouvertDes) && !estTerminal(d.sous_statut as SousStatut),
    formulaire: formulaireDe(type),
    // Le corrigé ne quitte jamais le serveur à destination d'un apprenant.
    questionnaire: q ? (acteur.role === "apprenant" ? sansCorrige(q) : q) : null,
    reponses: existante?.reponses ?? null,
    score: existante?.score ?? null,
    date: existante?.date ?? null,
  };
}

/**
 * Contrôle les réponses d'un questionnaire (forme, complétude, corrigé) sans rien écrire.
 * Retourne les réponses normalisées et le score (QCM), ou lève une erreur métier lisible.
 */
export function controlerReponses(d: LigneDossier, type: TypeEvaluation, brut: unknown): { reponses: Reponses | Array<number | null>; score: number | null; erreurs: Record<string, string> } {
  const q = questionnaireDe(d, type);
  if (type === "positionnement" || type === "acquis") {
    if (!q) throw new ErreurMetier("conflit", "Aucun questionnaire n'est rattaché à ce dossier pour cette évaluation.");
    if (!Array.isArray(brut) || brut.length !== q.questions.length) throw invalide("Une réponse est attendue pour chaque question.");
    const reponses = brut.map((r, i) => (Number.isInteger(r) && (r as number) >= 0 && (r as number) < q.questions[i]!.propositions.length ? (r as number) : null));
    if (reponses.some((r) => r === null)) throw invalide("Toutes les questions doivent recevoir une réponse.");
    return { reponses, score: corriger(q, reponses).score, erreurs: {} };
  }
  const def = formulaireDe(type)!;
  if (typeof brut !== "object" || brut === null || Array.isArray(brut)) throw invalide("Réponses illisibles.");
  const reponses = Object.fromEntries(Object.entries(brut as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]));
  const erreurs = validerReponses(def, reponses);
  if (Object.keys(erreurs).length > 0) throw invalide("Certaines réponses sont manquantes ou invalides.", { erreurs });
  return { reponses, score: null, erreurs };
}

/**
 * Cœur de l'enregistrement, sans contrôle de rôle : utilisé par l'apprenant connecté, par la page interactive du
 * formulaire (lien personnel) et par la reprise d'un positionnement signé. Valide la pièce si `validerPiece`.
 */
export async function enregistrerReponses(
  s: Services,
  d: LigneDossier,
  stagiaire_id: string,
  type: TypeEvaluation,
  donnees: { reponses: unknown; ajustement?: string },
  par: { utilisateur_id: string | null; acteur: Acteur | "systeme"; validerPiece: boolean },
): Promise<{ score: number | null; piece: Awaited<ReturnType<typeof trouverPiece>> }> {
  const config = CONFIG[type];
  const statut = d.sous_statut as SousStatut;
  if (estTerminal(statut)) throw new ErreurMetier("conflit", "Ce dossier est archivé : il n'est plus modifiable.");
  if (!aAtteint(statut, config.ouvertDes)) throw new ErreurMetier("conflit", "Ce questionnaire n'est pas encore ouvert à cette étape du dossier.");
  if (!(await stagiairesDuDossier(s, d.id)).some((l) => l.st.id === stagiaire_id)) throw invalide("Ce stagiaire n'est pas inscrit à ce dossier.");
  const { reponses, score } = controlerReponses(d, type, donnees.reponses);

  await synchroniserPieces(s, d);
  const piece = await trouverPiece(s, d.id, config.code, stagiaire_id);
  // Une pièce déjà validée fait foi : on ne réécrit pas les réponses qui la fondent.
  if (piece?.statut === "valide") throw new ErreurMetier("conflit", "Ce questionnaire est déjà validé : il ne peut plus être modifié.");

  const valeurs = { date: dateIso(s.horloge.maintenant()), reponses, score, ajustement: donnees.ajustement?.trim() ?? "", saisie_par: par.utilisateur_id };
  await s.bd
    .insert(evaluation)
    .values({ id: nouvelId(), dossier_id: d.id, stagiaire_id, type, ...valeurs, cree_le: s.horloge.maintenant() })
    .onConflictDoUpdate({ target: [evaluation.dossier_id, evaluation.stagiaire_id, evaluation.type], set: valeurs });

  if (piece && par.validerPiece && par.acteur !== "systeme") {
    const { html } = await rendrePiece(s, d, piece);
    const st = (await stagiairesDuDossier(s, d.id)).find((l) => l.st.id === stagiaire_id)!.st;
    const { chemin } = await archiverRendu(s, d, "Retour", `${nomFichierPiece(config.code, `${st.stagiaire_prenom} ${st.stagiaire_nom}`)}_renseigne`, html);
    await marquerValidee(s, d, piece, par.acteur, { chemin, nom_fichier: chemin.split("/").pop()!, mode: "formulaire" });
  }
  return { score, piece };
}

/** Enregistrement par un utilisateur connecté : l'apprenant, pour lui-même. */
export async function enregistrerEvaluation(
  s: Services,
  acteur: Acteur,
  dossierId: string,
  type: TypeEvaluation,
  donnees: { reponses: unknown; stagiaire_id?: string; ajustement?: string },
) {
  const d = await accederAuDossier(s, acteur, dossierId);
  if (acteur.role === "admin") throw interdit("Les questionnaires sont renseignés par l'apprenant lui-même.");
  if (acteur.role === "formateur") throw interdit("Ce questionnaire est renseigné par l'apprenant lui-même : envoyez-lui son formulaire (bouton « Envoyer »).");
  const stagiaire_id = cibleStagiaire(acteur, donnees.stagiaire_id);
  const { score } = await enregistrerReponses(s, d, stagiaire_id, type, donnees, { utilisateur_id: acteur.utilisateur_id, acteur, validerPiece: CONFIG[type].valideLaPiece });
  return { score };
}
