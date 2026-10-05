/**
 * Propositions pédagogiques rédigées par l'IA — cahier des charges oral du 23/09/2026, puis version 7 :
 * « l'usage de l'IA est important sur la partie support pédagogique ; sur le reste, elle ne semble pas
 * nécessaire, car tout doit être produit de manière très exacte ».
 *
 * Version 7 (23/09/2026) : plus aucune trame générique. Pour chaque formation, l'IA constitue d'abord un
 * DOSSIER D'ENJEUX par recherche web (enjeux, cadre réglementaire, notions clés, erreurs fréquentes, pratiques à
 * jour, sources) ; ce dossier est enregistré sur la formation et injecté dans toutes les consignes suivantes :
 * parcours, tests de connaissances, supports de cours. Résultat : du contenu propre au sujet réel, pas un gabarit.
 *
 * Trois règles, vérifiées par les tests :
 *  1. L'IA ne fait que PROPOSER un brouillon. Rien n'est enregistré sans relecture et enregistrement
 *     par le formateur (l'humain reste l'auteur, et c'est lui qui engage l'organisme).
 *  2. Toute réponse de l'IA est validée ici, strictement, avant d'être montrée : une réponse mal formée
 *     est rejetée, jamais « réparée » en silence.
 *  3. L'IA ne touche ni aux pièces contractuelles (convention, planning, factures…), ni au pipeline,
 *     ni aux montants : seul le service `pedagogie-ia` l'appelle (test de garde dans `ia-perimetre.test.ts`).
 *
 * Module pur : il construit les consignes et valide les réponses, sans appel réseau.
 */
import { validerQuestionnaire, type Questionnaire } from "../formulaires/qcm";
import { decrireEnjeux, validerEnjeux, type DossierEnjeux } from "./enjeux";
import {
  DIAPOS_PAR_MODULE,
  heuresTexte,
  validerDiapos,
  validerModules,
  type Diapo,
  type EntreeParcours,
  type ModuleParcours,
} from "./parcours";

export interface ContexteFormation {
  formation_titre: string;
  formation_objectifs: string;
  formation_niveau: string;
  formation_prerequis: string;
  public_vise: string;
  programme: string;
  formation_duree_heures_total: number | null;
  /** Modules du parcours, s'ils existent : ils rendent les questions plus précises. */
  modules?: ModuleParcours[];
  /** Dossier d'enjeux issu de la recherche web (version 7). */
  enjeux?: DossierEnjeux | null;
}

export type TypeQcm = "positionnement" | "acquis";

export const BORNES_QCM = { min: 3, max: 20 } as const;

/** Rôle et garde-fous communs à toutes les demandes. */
export const CONSIGNE_SYSTEME = [
  "Tu es un ingénieur pédagogique senior francophone, doublé d'un expert du domaine enseigné, spécialiste de la formation professionnelle continue en France et du référentiel national qualité (Qualiopi).",
  "Tu conçois pour des adultes en activité : contenu concret, ancré dans leur métier, à jour (réglementation, outils et pratiques en vigueur en France), jamais générique.",
  "Principes que tu appliques systématiquement : alignement pédagogique (objectif → activité → évaluation), objectifs formulés avec des verbes d'action observables (taxonomie de Bloom), charge cognitive maîtrisée (une idée à la fois, du simple au complexe), alternance apports / pratique, récupération en mémoire, transfert au poste de travail.",
  "Tu rédiges des BROUILLONS que le formateur relira et corrigera avant tout usage.",
  "N'invente aucune donnée administrative, financière ou logistique : ni date, ni prix, ni lieu, ni nom de personne ou d'entreprise, ni numéro.",
  "Quand un outil de recherche web t'est fourni, utilise-le AVANT de rédiger, pour vérifier les faits et t'appuyer sur des sources récentes et fiables (textes officiels, organismes de référence, publications spécialisées).",
  "Réponds uniquement par un objet JSON valide, conforme au schéma demandé, sans texte avant ni après, sans bloc de code.",
].join("\n");

// ——— Dossier d'enjeux (recherche web) ———

export type { DossierEnjeux } from "./enjeux";
export { decrireEnjeux } from "./enjeux";

export function consigneEnjeux(e: {
  titre: string;
  niveau?: string;
  public_vise?: string;
  modalite?: string;
  heures?: number | null;
}): string {
  return [
    `Constitue le dossier d'enjeux de l'action de formation « ${e.titre} », destiné à en concevoir le parcours, les évaluations et les supports.`,
    "Mène d'abord une recherche web ciblée (4 à 6 requêtes) : cadre réglementaire et normatif applicable en France, notions et méthodes de référence, pratiques et outils actuels, erreurs fréquentes, chiffres ou faits marquants récents.",
    "Sois précis et concret : cite les textes, normes, organismes, outils et méthodes par leur nom. Chaque élément de liste tient en une phrase informative (pas de généralités du type « il est important de… »).",
    "Formule « public_vise » et « prerequis » comme sur une convention de formation (une à deux phrases chacun).",
    "Sources : 4 à 10 références réellement consultées, avec leur titre et leur adresse exacte.",
    'Schéma : {"resume": string, "enjeux": string[], "cadre": string[], "notions_cles": string[], "erreurs_frequentes": string[], "pratiques_actuelles": string[], "public_vise": string, "prerequis": string, "glossaire": [{"terme": string, "definition": string}], "sources": [{"titre": string, "url": string}]}',
    "",
    `Intitulé : ${e.titre}`,
    e.niveau ? `Niveau : ${e.niveau}` : "",
    e.public_vise ? `Public visé pressenti : ${e.public_vise}` : "",
    e.heures ? `Durée : ${heuresTexte(e.heures)}` : "",
    e.modalite ? `Modalité : ${e.modalite}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

const texte = (x: unknown): x is string => typeof x === "string";

/** Valide le dossier d'enjeux proposé par l'IA, en y ajoutant les sources relevées par la recherche web. */
export function validerPropositionEnjeux(
  brut: unknown,
  sourcesConnues: Array<{ titre: string; url: string }> = [],
): Resultat<DossierEnjeux> {
  return validerEnjeux(brut, sourcesConnues);
}

function decrire(f: ContexteFormation): string {
  return [
    `Intitulé : ${f.formation_titre}`,
    f.formation_niveau && `Niveau : ${f.formation_niveau}`,
    f.public_vise && `Public visé : ${f.public_vise}`,
    f.formation_prerequis && `Prérequis : ${f.formation_prerequis}`,
    f.formation_duree_heures_total && `Durée : ${f.formation_duree_heures_total} heures`,
    f.formation_objectifs && `Objectifs :\n${f.formation_objectifs}`,
    f.modules?.length
      ? `Modules :\n${f.modules.map((m, i) => `${i + 1}. ${m.titre} (${heuresTexte(m.duree_heures)}) — objectifs : ${m.objectifs.join(" ; ")} — contenus : ${m.contenus.join(" ; ")}`).join("\n")}`
      : "",
    f.programme && !f.modules?.length && `Programme :\n${f.programme}`,
    decrireEnjeux(f.enjeux),
  ]
    .filter(Boolean)
    .join("\n");
}

// ——— Tests : questions de CONNAISSANCES sur le sujet réel ———

export function consigneQcm(f: ContexteFormation, type: TypeQcm, nombre: number): string {
  const nature =
    type === "positionnement"
      ? "un TEST DE POSITIONNEMENT, passé AVANT la formation, qui mesure le niveau de départ sur les notions du parcours pour ajuster le programme (indicateur Qualiopi n° 8) : questions graduées, des fondamentaux (un tiers) aux notions avancées (un tiers), en passant par l'application (un tiers)"
      : "une ÉVALUATION DES ACQUIS, passée EN FIN de formation, qui mesure l'atteinte de CHAQUE objectif pédagogique (indicateur Qualiopi n° 11) : répartis les questions entre les objectifs et les modules, avec une majorité de questions d'application ou d'analyse (mise en situation courte, cas concret) plutôt que de simple restitution";
  return [
    `Rédige ${nature}.`,
    `Exactement ${nombre} questions à choix multiples, chacune avec 4 propositions distinctes, plausibles et de longueur comparable, et UNE seule bonne réponse ; varie la position de la bonne réponse.`,
    "Règles : questions de connaissances et de compétences sur le SUJET RÉEL de la formation (jamais sur l'organisation de la formation, jamais d'auto-évaluation du type « je sais faire ») ; énoncés autonomes et sans ambiguïté ; pas de « toutes les réponses » ni « aucune » ; pas de négation piégeuse ; vocabulaire du métier ; les distracteurs reprennent les erreurs fréquentes du dossier d'enjeux.",
    'Schéma : {"titre": string, "questions": [{"enonce": string, "propositions": [string, string, string, string], "bonne_reponse": 0 | 1 | 2 | 3}]}',
    "",
    decrire(f),
  ].join("\n");
}

export function consigneProgramme(
  f: Pick<
    ContexteFormation,
    | "formation_titre"
    | "formation_niveau"
    | "public_vise"
    | "formation_prerequis"
    | "formation_duree_heures_total"
    | "enjeux"
  >,
): string {
  return [
    "Propose les objectifs pédagogiques et le programme détaillé de cette action de formation.",
    "Objectifs : 3 à 8, opérationnels et évaluables, chacun commençant par un verbe d'action à l'infinitif, un par ligne, sans numérotation.",
    "Programme : découpé en séquences (par demi-journée ou par journée selon la durée), chacune avec un titre court suivi de ses points de contenu, propres au sujet.",
    'Schéma : {"objectifs": string[], "programme": string}',
    "",
    decrire({ ...f, formation_objectifs: "", programme: "" }),
  ].join("\n");
}

export type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreurs: string[] };

/** Valide un QCM proposé par l'IA : forme, nombre exact de questions, règles du QCM de la plateforme. */
export function validerPropositionQcm(
  brut: unknown,
  nombreAttendu: number,
): Resultat<Questionnaire> {
  if (typeof brut !== "object" || brut === null)
    return { ok: false, erreurs: ["La réponse de l'IA n'est pas un objet."] };
  const o = brut as Record<string, unknown>;
  if (!texte(o.titre) || !Array.isArray(o.questions))
    return {
      ok: false,
      erreurs: ["La réponse de l'IA ne suit pas le schéma attendu (titre, questions)."],
    };
  const questions = o.questions.map((q) => {
    const x = (q ?? {}) as Record<string, unknown>;
    return {
      enonce: texte(x.enonce) ? x.enonce.trim() : "",
      propositions: Array.isArray(x.propositions)
        ? x.propositions.map((p) => (texte(p) ? p.trim() : ""))
        : [],
      bonne_reponse: typeof x.bonne_reponse === "number" ? x.bonne_reponse : -1,
    };
  });
  const qcm: Questionnaire = { titre: o.titre.trim(), questions };
  const erreurs = validerQuestionnaire(qcm);
  if (questions.length !== nombreAttendu)
    erreurs.unshift(`L'IA a proposé ${questions.length} questions au lieu de ${nombreAttendu}.`);
  return erreurs.length > 0 ? { ok: false, erreurs } : { ok: true, valeur: qcm };
}

export interface PropositionProgramme {
  formation_objectifs: string;
  programme: string;
}

/** Valide une proposition d'objectifs et de programme ; les objectifs sont rendus « un par ligne ». */
export function validerPropositionProgramme(brut: unknown): Resultat<PropositionProgramme> {
  if (typeof brut !== "object" || brut === null)
    return { ok: false, erreurs: ["La réponse de l'IA n'est pas un objet."] };
  const o = brut as Record<string, unknown>;
  const objectifs = Array.isArray(o.objectifs)
    ? o.objectifs
        .filter(texte)
        .map((x) => x.trim().replace(/^[-•\d.)\s]+/, ""))
        .filter(Boolean)
    : [];
  const programme = texte(o.programme) ? o.programme.trim() : "";
  const erreurs: string[] = [];
  if (objectifs.length < 3 || objectifs.length > 8)
    erreurs.push(`L'IA a proposé ${objectifs.length} objectifs ; il en faut de 3 à 8.`);
  if (programme.length < 20) erreurs.push("Le programme proposé est vide ou trop court.");
  if (programme.length > 20_000) erreurs.push("Le programme proposé est trop long.");
  return erreurs.length > 0
    ? { ok: false, erreurs }
    : { ok: true, valeur: { formation_objectifs: objectifs.join("\n"), programme } };
}

/**
 * Extrait l'objet JSON d'une réponse textuelle (l'IA entoure parfois sa réponse d'un bloc ```json, ou d'une phrase).
 * Retourne `null` si aucun JSON valide n'est trouvé : on refuse plutôt que de deviner.
 */
export function extraireJson(reponse: string): unknown {
  const bloc = /```(?:json)?\s*([\s\S]*?)```/.exec(reponse)?.[1] ?? reponse;
  const debut = bloc.indexOf("{");
  const fin = bloc.lastIndexOf("}");
  if (debut < 0 || fin <= debut) return null;
  const candidat = bloc.slice(debut, fin + 1);
  try {
    return JSON.parse(candidat) as unknown;
  } catch {
    // Dernière chance : virgule finale avant « } » ou « ] » (erreur fréquente), sans autre « réparation ».
    try {
      return JSON.parse(candidat.replace(/,\s*([}\]])/g, "$1")) as unknown;
    } catch {
      return null;
    }
  }
}

// ——— Parcours complet et supports de cours ———

/** Parcours complet : l'IA rédige le contenu des modules ; leurs durées sont imposées par la plateforme. */
export function consigneParcours(
  e: EntreeParcours,
  durees: number[],
  enjeux?: DossierEnjeux | null,
): string {
  return [
    `Conçois le parcours de l'action de formation « ${e.titre} », découpé en exactement ${durees.length} module(s), à partir du dossier d'enjeux ci-dessous.`,
    `Durées imposées (ne pas les modifier) : ${durees.map((d, i) => `module ${i + 1} = ${heuresTexte(d)}`).join(", ")}.`,
    "Progression : du cadre et des fondamentaux vers l'application en situation, puis la consolidation et le transfert au poste de travail ; chaque module a un fil conducteur propre au sujet (pas de titres passe-partout du type « Enjeux et vocabulaire »).",
    "Pour chaque module : un titre court et explicite ; 2 à 4 objectifs opérationnels et évaluables, chacun commençant par un verbe d'action à l'infinitif ; 3 à 6 points de contenu précis (notions, méthodes, outils, textes nommés) ; les méthodes pédagogiques adaptées à la modalité ; une activité de mise en pratique concrète, décrite (situation, consigne, livrable, durée) ; la modalité d'évaluation du module.",
    "Objectifs de la formation : 3 à 8, verbes d'action, un par élément — ils figureront sur la convention.",
    "Public visé et prérequis : une à deux phrases chacun, formulés pour la convention de formation.",
    'Schéma : {"objectifs": string[], "public_vise": string, "prerequis": string, "modules": [{"titre": string, "objectifs": string[], "contenus": string[], "methodes": string, "mise_en_pratique": string, "evaluation": string}]}',
    "",
    `Intitulé : ${e.titre}`,
    e.niveau ? `Niveau : ${e.niveau}` : "",
    e.public_vise ? `Public visé pressenti : ${e.public_vise}` : "",
    `Durée : ${heuresTexte(e.heures)}${e.jours ? ` sur ${e.jours} jour(s)` : ""}`,
    e.modalite ? `Modalité : ${e.modalite}` : "",
    decrireEnjeux(enjeux),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function validerPropositionParcours(
  brut: unknown,
  durees: number[],
): Resultat<{
  objectifs: string[];
  modules: ModuleParcours[];
  public_vise: string;
  prerequis: string;
}> {
  if (typeof brut !== "object" || brut === null)
    return { ok: false, erreurs: ["La réponse de l'IA n'est pas un objet."] };
  const o = brut as Record<string, unknown>;
  const modules = validerModules(o.modules, { nombre: durees.length, durees });
  const objectifs = Array.isArray(o.objectifs)
    ? o.objectifs
        .filter(texte)
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  const erreurs = modules.ok ? [] : [...modules.erreurs];
  if (objectifs.length < 3 || objectifs.length > 8)
    erreurs.push(`L'IA a proposé ${objectifs.length} objectifs ; il en faut de 3 à 8.`);
  if (erreurs.length > 0 || !modules.ok) return { ok: false, erreurs };
  return {
    ok: true,
    valeur: {
      objectifs,
      modules: modules.valeur,
      public_vise: texte(o.public_vise) ? o.public_vise.trim().slice(0, 2000) : "",
      prerequis: texte(o.prerequis) ? o.prerequis.trim().slice(0, 2000) : "",
    },
  };
}

/** Plan de 20 diapositives pour UN module : recherche, présentation cognitive, mise en page, mise en pratique. */
export function consigneDiapos(
  formation: ContexteFormation,
  m: ModuleParcours,
  rang: number,
): string {
  return [
    `Conçois le support de cours (diaporama) du module ${rang} « ${m.titre} » de la formation « ${formation.formation_titre} » : exactement ${DIAPOS_PAR_MODULE} diapositives, au contenu RÉDIGÉ (faits, définitions, chiffres, exemples réels du domaine), prêt à projeter.`,
    "Utilise la recherche web pour vérifier les faits, textes et chiffres cités, et pour trouver un exemple réel récent.",
    "Règles de présentation : une idée par diapositive ; 3 à 5 points de 12 mots au plus, informatifs (pas de « définition », « exemple » sans contenu) ; un visuel décrit précisément par diapositive (schéma à réaliser, pictogramme, photo) — double codage texte + image ;",
    "un point d'étape de récupération en mémoire toutes les 4 à 5 diapositives, avec ses questions ; au moins 3 diapositives de mise en pratique (consigne détaillée, critères de réussite, débriefing) ; une synthèse et un quiz final de 5 questions avec leurs réponses dans les notes.",
    "Notes du formateur : déroulé minuté, questions à poser, réponses attendues, pièges à anticiper.",
    "Types admis : titre, objectifs, sommaire, amorce, notion, schema, exemple, point_etape, pratique, debriefing, vigilance, synthese, quiz.",
    'Schéma : {"diapos": [{"type": string, "titre": string, "points": string[], "visuel": string, "notes": string}]}',
    "",
    `Durée du module : ${heuresTexte(m.duree_heures)}`,
    `Objectifs du module : ${m.objectifs.join(" ; ")}`,
    `Contenus : ${m.contenus.join(" ; ")}`,
    m.mise_en_pratique ? `Mise en pratique prévue : ${m.mise_en_pratique}` : "",
    formation.public_vise ? `Public visé : ${formation.public_vise}` : "",
    formation.formation_niveau ? `Niveau : ${formation.formation_niveau}` : "",
    decrireEnjeux(formation.enjeux),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function validerPropositionDiapos(brut: unknown): Resultat<Diapo[]> {
  if (typeof brut !== "object" || brut === null)
    return { ok: false, erreurs: ["La réponse de l'IA n'est pas un objet."] };
  return validerDiapos((brut as Record<string, unknown>).diapos);
}
