/**
 * Espace pédagogique — propositions de contenu par l'assistant IA (cahier des charges oral du 23/09/2026, puis
 * « Modification 1 » et version 7). Port de `src/serveur/services/pedagogie-ia.ts`, mêmes règles, mêmes réponses.
 *
 * Toute production suit le même chemin :
 *  1. DOSSIER D'ENJEUX — l'IA mène une recherche web sur le sujet réel de la formation ; il est enregistré sur la
 *     formation SEULEMENT quand le formateur le demande (route 61, bouton « Analyser les enjeux ») ;
 *  2. PARCOURS, QCM, programme, plan de support — rédigés à partir de ce dossier.
 *
 * RÈGLE : ce service ne fait que PROPOSER. Aucune de ces fonctions n'écrit dans la formation, les questionnaires ou le
 * coffre-fort ; la seule trace est le journal d'audit (usage, coût). Le formateur relit, aménage, puis enregistre par
 * les chemins habituels (fiche formation, outils), qui appliquent leurs propres contrôles. Les deux exceptions, voulues
 * et demandées par un geste explicite du formateur : l'analyse des enjeux (route 61) et la production d'un PPTX
 * (`supports.functions.ts`).
 *
 * C'est le SEUL module qui appelle l'assistant (`./ia.server`) — test de garde `ia-perimetre.test.ts`. Il ne traite
 * ni conventions, ni pièces, ni pipeline, ni montants.
 */
import { z } from "zod";
import {
  BORNES_QCM,
  CONSIGNE_SYSTEME,
  consigneDiapos,
  consigneEnjeux,
  consigneParcours,
  consigneProgramme,
  consigneQcm,
  extraireJson,
  validerPropositionDiapos,
  validerPropositionEnjeux,
  validerPropositionParcours,
  validerPropositionProgramme,
  validerPropositionQcm,
  type DossierEnjeux,
} from "@/domaine/pedagogie/propositions";
import {
  programmeDepuisModules,
  repartirHeures,
  type ModuleParcours,
} from "@/domaine/pedagogie/parcours";
import type { Acteur, ActeurFormateurValide } from "./acteur.server";
import type { BdService } from "./bd.server";
import { ErreurMetier, introuvable, invalide, leverSiErreurBd } from "./erreurs.server";
import {
  assistantPourOrganisme,
  type AssistantPedagogique,
  type OptionsRedaction,
} from "./ia.server";
import { journaliser } from "./journal.server";
import {
  lireCorps,
  lireFormation as lireFormationDe,
  modulesDe,
  type FormationIa,
} from "./pedagogie-commun.server";

export interface ContexteIa {
  acteur: ActeurFormateurValide;
  /** Client « service » : réglages (clé), lecture, journal. */
  bd: BdService;
  /** Client portant le jeton du formateur (RLS) : seule l'analyse des enjeux écrit avec lui. */
  bdUtilisateur?: BdService;
  /** Pour les tests : simule le réseau. Par défaut le `fetch` global. */
  appel?: typeof fetch;
}

/** Formation du formateur du contexte (cloisonnée) — voir `pedagogie-commun.server.ts`. */
const lireFormation = (ctx: ContexteIa, id: string) => lireFormationDe(ctx.bd, ctx.acteur, id);

type SourceIa = Array<{ titre: string; url: string }>;

/** Message d'invitation à réessayer / à configurer ; identique à l'ancien serveur (409). */
async function assistant(ctx: ContexteIa): Promise<AssistantPedagogique> {
  return assistantPourOrganisme(ctx.bd, ctx.acteur.of_id, ctx.appel);
}

// ——— État de l'assistant (route 57) ———

export async function etatIa(
  bd: BdService,
  acteur: Acteur,
  appel?: typeof fetch,
): Promise<{ disponible: boolean; description: string }> {
  // Comme l'ancien serveur : seul un formateur voit l'assistant ; les autres reçoivent « indisponible » (pas d'erreur).
  if (acteur.role !== "formateur") return { disponible: false, description: "" };
  const ia = await assistantPourOrganisme(bd, acteur.of_id, appel);
  return { disponible: ia.disponible, description: ia.disponible ? ia.description : "" };
}

// ——— Appel de l'IA : journal, deux tentatives, validation stricte ———

async function demander(
  ctx: ContexteIa,
  quoi: string,
  demande: string,
  options: OptionsRedaction = {},
): Promise<{ json: unknown; sources: SourceIa }> {
  const ia = await assistant(ctx);
  const { acteur, bd } = ctx;
  try {
    // Sans clé : `rediger` lève le message français (« non configuré », « désactivé », « clé illisible »).
    const r = await ia.rediger(CONSIGNE_SYSTEME, demande, options);
    await journaliser(bd, {
      of_id: acteur.of_id,
      acteur,
      type: "ia_appel",
      libelle: `IA — ${quoi}`,
      detail: { ...r.usage, sources: r.sources.length },
    });
    return { json: extraireJson(r.texte), sources: r.sources };
  } catch (e) {
    if (e instanceof ErreurMetier) throw e;
    const message = e instanceof Error ? e.message : "L'assistant IA est indisponible.";
    if (ia.disponible)
      await journaliser(bd, {
        of_id: acteur.of_id,
        acteur,
        type: "ia_echec",
        libelle: `IA — ${quoi} : échec`,
        detail: { message },
      });
    throw new ErreurMetier("conflit", message);
  }
}

/**
 * Deux tentatives sur une réponse mal formée : la seconde rappelle strictement le schéma. Jamais de « réparation »
 * silencieuse : si la seconde réponse est encore invalide, l'erreur est renvoyée avec ses motifs.
 */
async function demanderValide<T>(
  ctx: ContexteIa,
  quoi: string,
  demande: string,
  valider: (
    json: unknown,
    sources: SourceIa,
  ) => { ok: true; valeur: T } | { ok: false; erreurs: string[] },
  options: OptionsRedaction = {},
): Promise<T> {
  const premiere = await demander(ctx, quoi, demande, options);
  const r1 = valider(premiere.json, premiere.sources);
  if (r1.ok) return r1.valeur;
  const rappel = `${demande}\n\nATTENTION : ta réponse précédente a été rejetée (${r1.erreurs.slice(0, 3).join(" ; ")}). Respecte exactement le schéma JSON et les nombres demandés.`;
  const seconde = await demander(ctx, `${quoi} (2e tentative)`, rappel, options);
  const r2 = valider(seconde.json, seconde.sources);
  if (r2.ok) return r2.valeur;
  throw invalide("La proposition de l'IA n'est pas exploitable. Relancez la génération.", {
    erreurs: r2.erreurs,
  });
}

const contexte = (f: FormationIa) => ({
  formation_titre: f.formation_titre,
  formation_objectifs: f.formation_objectifs,
  formation_niveau: f.formation_niveau,
  formation_prerequis: f.formation_prerequis,
  public_vise: f.public_vise,
  programme: f.programme,
  formation_duree_heures_total: f.formation_duree_heures_total,
  modules: (f.formation_modules ?? []) as ModuleParcours[],
  enjeux: (f.dossier_enjeux ?? null) as DossierEnjeux | null,
});

// ——— 1. Dossier d'enjeux (recherche web) — route 61 ———

/** Ce que l'IA reçoit pour constituer le dossier d'enjeux : la description de la FORMATION, rien d'autre. */
interface EntreeEnjeux {
  titre: string;
  niveau: string;
  public_vise: string;
  modalite: string;
  heures: number | null;
}

function rechercherEnjeux(ctx: ContexteIa, e: EntreeEnjeux): Promise<DossierEnjeux> {
  return demanderValide(
    ctx,
    `dossier d'enjeux « ${e.titre} »`,
    consigneEnjeux(e),
    (json, sources) => validerPropositionEnjeux(json, sources),
    { recherche: true, maxRecherches: 8, maxTokens: 6000 },
  );
}

const SchemaEnjeux = z.object({ formation_id: z.string().min(1, "Formation manquante.") });

/**
 * Constitue (ou reconstitue) le dossier d'enjeux d'une formation existante et l'enregistre sur la formation, à la
 * demande du formateur. L'état précédent reste dans l'historique des versions (déclencheur `s4m_version`). Public visé
 * et prérequis vides sont complétés depuis le dossier. L'écriture passe par le client du formateur : la RLS la
 * cloisonne (formation du formateur validé), et l'historique garde son nom.
 */
export async function analyserEnjeux(ctx: ContexteIa, donnees: unknown) {
  const v = lireCorps(SchemaEnjeux, donnees);
  const f = await lireFormation(ctx, v.formation_id);
  const enjeux = await rechercherEnjeux(ctx, {
    titre: f.formation_titre,
    niveau: f.formation_niveau,
    public_vise: f.public_vise,
    modalite: f.formation_modalite,
    heures: f.formation_duree_heures_total,
  });
  const maintenant = new Date().toISOString();
  const ecriture = ctx.bdUtilisateur ?? ctx.bd;
  const { data, error } = await ecriture
    .from("formation")
    .update({
      dossier_enjeux: enjeux,
      enjeux_le: maintenant,
      public_vise: f.public_vise || enjeux.public_vise,
      formation_prerequis: f.formation_prerequis || enjeux.prerequis,
      maj_le: maintenant,
    })
    .eq("id", f.id)
    .select("id");
  leverSiErreurBd(error, "enregistrement du dossier d'enjeux");
  if (!data?.length) throw introuvable("Formation");
  await journaliser(ctx.bd, {
    of_id: ctx.acteur.of_id,
    acteur: ctx.acteur,
    type: "enjeux_analyses",
    libelle: `Dossier d'enjeux constitué pour « ${f.formation_titre} » (${enjeux.sources.length} source(s))`,
  });
  return { enjeux, enjeux_le: maintenant };
}

/**
 * Le dossier d'enjeux d'une formation. S'il manque, il est constitué POUR CET APPEL SEULEMENT et n'est pas enregistré :
 * l'enregistrer relève de la route 61 (le gestionnaire du lot l'appelle d'abord, sur le geste du formateur).
 */
async function enjeuxDe(ctx: ContexteIa, f: FormationIa): Promise<DossierEnjeux> {
  if (f.dossier_enjeux) return f.dossier_enjeux as DossierEnjeux;
  return rechercherEnjeux(ctx, {
    titre: f.formation_titre,
    niveau: f.formation_niveau,
    public_vise: f.public_vise,
    modalite: f.formation_modalite,
    heures: f.formation_duree_heures_total,
  });
}

// ——— 2. Tests : questions de connaissances — routes 58 et 62 ———

const SchemaQcm = z.object({
  formation_id: z.string().min(1, "Formation manquante."),
  type: z.enum(["positionnement", "acquis"], { error: "Type de test inconnu." }),
  nombre: z
    .number()
    .int()
    .min(BORNES_QCM.min, `Entre ${BORNES_QCM.min} et ${BORNES_QCM.max} questions.`)
    .max(BORNES_QCM.max, `Entre ${BORNES_QCM.min} et ${BORNES_QCM.max} questions.`)
    .default(10),
});

/** Brouillon de QCM (positionnement ou acquis) rédigé par l'IA, fondé sur la formation et son dossier d'enjeux. */
export async function proposerQcm(ctx: ContexteIa, donnees: unknown) {
  const v = lireCorps(SchemaQcm, donnees);
  const f = await lireFormation(ctx, v.formation_id); // vérifie que la formation est bien la sienne
  const nbModules = Array.isArray(f.formation_modules) ? f.formation_modules.length : 0;
  if (!(f.formation_objectifs ?? "").trim() && !(f.programme ?? "").trim() && nbModules === 0) {
    throw invalide(
      "Renseignez d'abord les objectifs, le programme ou le parcours de la formation : l'IA s'appuie dessus.",
    );
  }
  const enjeux = await enjeuxDe(ctx, f);
  const questionnaire = await demanderValide(
    ctx,
    `${v.type === "positionnement" ? "test de positionnement" : "évaluation des acquis"} « ${f.formation_titre} »`,
    consigneQcm({ ...contexte(f), enjeux }, v.type, v.nombre),
    (json) => validerPropositionQcm(json, v.nombre),
    { recherche: true, maxRecherches: 3, maxTokens: 6000 },
  );
  return { brouillon: true as const, source: "ia" as const, questionnaire };
}

// ——— Objectifs et programme — route 59 ———

const SchemaProgramme = z.object({
  formation_titre: z
    .string()
    .trim()
    .min(3, "Indiquez d'abord l'intitulé de la formation.")
    .max(200),
  formation_niveau: z.string().trim().max(100).default(""),
  public_vise: z.string().trim().max(2000).default(""),
  formation_prerequis: z.string().trim().max(2000).default(""),
  formation_duree_heures_total: z.number().positive().max(2000).nullable().default(null),
});

/** Brouillon d'objectifs pédagogiques et de programme détaillé, à partir de l'intitulé et du public. */
export async function proposerProgramme(ctx: ContexteIa, donnees: unknown) {
  const v = lireCorps(SchemaProgramme, donnees);
  const valeur = await demanderValide(
    ctx,
    `objectifs et programme « ${v.formation_titre} »`,
    consigneProgramme(v),
    (json) => validerPropositionProgramme(json),
    { recherche: true, maxRecherches: 3 },
  );
  return { brouillon: true as const, ...valeur };
}

// ——— 3. Le parcours complet en un clic — route 60 ———

const SchemaParcours = z.object({
  titre: z.string().trim().min(3, "Indiquez l'intitulé de la formation.").max(200),
  heures: z
    .number({ error: "Indiquez la durée en heures." })
    .positive("La durée doit être positive.")
    .max(2000),
  jours: z.number().positive().max(400).nullable().default(null),
  nb_modules: z.number().int().min(1).max(12),
  niveau: z.string().trim().max(100).default(""),
  public_vise: z.string().trim().max(2000).default(""),
  modalite: z.enum(["presentiel", "distanciel", "mixte"]).default("presentiel"),
  /** Formation existante : son dossier d'enjeux est réutilisé s'il existe. */
  formation_id: z.string().default(""),
});

/**
 * Avec seulement l'intitulé, la durée (heures, jours), le nombre de modules, propose le parcours complet : dossier
 * d'enjeux (recherche web), modules, objectifs, contenus, méthodes, mise en pratique, évaluations, programme rédigé,
 * public visé et prérequis. RIEN n'est enregistré : le dossier d'enjeux d'une nouvelle formation est renvoyé avec la
 * proposition et ne sera enregistré qu'avec le prochain « Enregistrer » du formateur.
 */
export async function proposerParcours(ctx: ContexteIa, donnees: unknown) {
  const v = lireCorps(SchemaParcours, donnees);
  if (v.heures / v.nb_modules < 0.5)
    throw invalide(
      "Chaque module doit durer au moins une demi-heure : réduisez le nombre de modules.",
    );
  let enjeux: DossierEnjeux | null = null;
  if (v.formation_id) {
    const f = await lireFormation(ctx, v.formation_id);
    if (f.dossier_enjeux && f.formation_titre.trim().toLowerCase() === v.titre.toLowerCase())
      enjeux = f.dossier_enjeux as DossierEnjeux;
  }
  enjeux ??= await rechercherEnjeux(ctx, {
    titre: v.titre,
    niveau: v.niveau,
    public_vise: v.public_vise,
    modalite: v.modalite,
    heures: v.heures,
  });
  const durees = repartirHeures(v.heures, v.nb_modules);
  const r = await demanderValide(
    ctx,
    `parcours « ${v.titre} »`,
    consigneParcours(v, durees, enjeux),
    (json) => validerPropositionParcours(json, durees),
    { recherche: true, maxRecherches: 3, maxTokens: 10_000 },
  );
  return {
    brouillon: true as const,
    source: "ia" as const,
    modules: r.modules,
    formation_objectifs: r.objectifs.join("\n"),
    programme: programmeDepuisModules(r.modules),
    public_vise: r.public_vise || enjeux.public_vise,
    formation_prerequis: r.prerequis || enjeux.prerequis,
    dossier_enjeux: enjeux,
  };
}

// ——— 4. Plan d'un support de cours : 20 diapositives par module — route 63 ———

const SchemaPlan = z.object({
  formation_id: z.string().min(1, "Formation manquante."),
  module_index: z.number().int().min(0).max(11),
});

/** Plan de 20 diapositives d'un module, rédigé par l'IA, à relire et aménager avant de produire le PPTX. */
export async function proposerPlanSupport(ctx: ContexteIa, donnees: unknown) {
  const v = lireCorps(SchemaPlan, donnees);
  const f = await lireFormation(ctx, v.formation_id);
  const m = modulesDe(f)[v.module_index];
  if (!m) throw invalide("Ce module n'existe pas dans le parcours.");
  const enjeux = await enjeuxDe(ctx, f);
  const diapos = await demanderValide(
    ctx,
    `support du module ${v.module_index + 1} « ${f.formation_titre} »`,
    consigneDiapos({ ...contexte(f), enjeux }, m, v.module_index + 1),
    (json) => validerPropositionDiapos(json),
    { recherche: true, maxRecherches: 4, maxTokens: 14_000 },
  );
  return { source: "ia" as const, diapos };
}
