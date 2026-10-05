/**
 * Questionnaires à choix multiples : test de positionnement (01-AVT) et évaluation des acquis (07-FIN).
 * Le formateur en crée des modèles dans « Mes outils pédagogiques » (F-OUT-02, F-OUT-03).
 */

export interface Question {
  enonce: string;
  propositions: string[];
  /** Index (base 0) de la bonne réponse dans `propositions`. */
  bonne_reponse: number;
}

export interface Questionnaire {
  titre: string;
  questions: Question[];
}

export function validerQuestionnaire(q: Questionnaire): string[] {
  const erreurs: string[] = [];
  if (q.titre.trim() === "") erreurs.push("Le questionnaire doit avoir un titre.");
  if (q.questions.length === 0) erreurs.push("Le questionnaire doit comporter au moins une question.");
  q.questions.forEach((question, i) => {
    const n = i + 1;
    if (question.enonce.trim() === "") erreurs.push(`Question ${n} : énoncé vide.`);
    const propositions = question.propositions.map((p) => p.trim());
    if (propositions.length < 2) erreurs.push(`Question ${n} : deux propositions au minimum.`);
    if (propositions.some((p) => p === "")) erreurs.push(`Question ${n} : proposition vide.`);
    if (new Set(propositions).size !== propositions.length) erreurs.push(`Question ${n} : propositions en double.`);
    if (!Number.isInteger(question.bonne_reponse) || question.bonne_reponse < 0 || question.bonne_reponse >= propositions.length) {
      erreurs.push(`Question ${n} : la bonne réponse ne désigne aucune proposition.`);
    }
  });
  return erreurs;
}

export interface Correction {
  bonnes: number;
  total: number;
  /** Score sur 100, arrondi à l'entier. */
  score: number;
  detail: boolean[];
}

/** Corrige une copie. Une question sans réponse (`null`) compte comme fausse. */
export function corriger(q: Questionnaire, reponses: ReadonlyArray<number | null>): Correction {
  const detail = q.questions.map((question, i) => reponses[i] === question.bonne_reponse);
  const bonnes = detail.filter(Boolean).length;
  const total = q.questions.length;
  return { bonnes, total, score: total === 0 ? 0 : Math.round((bonnes / total) * 100), detail };
}

/** Le questionnaire tel que l'apprenant doit le voir : SANS les bonnes réponses. */
export function sansCorrige(q: Questionnaire): { titre: string; questions: Array<Omit<Question, "bonne_reponse">> } {
  return { titre: q.titre, questions: q.questions.map(({ enonce, propositions }) => ({ enonce, propositions })) };
}
