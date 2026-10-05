/**
 * Espace pédagogique — propositions de contenu par l'assistant IA (cahier des charges oral du 23/09/2026, puis
 * « Modification 1 » et version 7).
 *
 * Version 7 : plus aucune « trame » générique. Toute production suit le même chemin :
 *  1. DOSSIER D'ENJEUX — l'IA mène une recherche web sur le sujet réel de la formation (enjeux, cadre réglementaire,
 *     notions clés, erreurs fréquentes, pratiques actuelles, sources) ; il est enregistré sur la formation ;
 *  2. PARCOURS, TESTS de connaissances, SUPPORTS de cours — rédigés à partir de ce dossier.
 * Le service ne fait que PROPOSER : le formateur relit, aménage, puis enregistre par les chemins habituels
 * (`modifierFormation`, `enregistrerOutil`), qui appliquent leurs propres contrôles. Seule exception : la production
 * d'un support PPTX, qui ÉCRIT dans le coffre-fort un document que le formateur a validé (ou demandé).
 *
 * La configuration de l'IA vient des réglages de l'organisme (Organisme → Assistant IA), à défaut du `.env` du serveur.
 * Chaque appel est journalisé avec son usage (tokens, recherches, durée) : le coût reste visible.
 * C'est le SEUL service qui a le droit d'appeler le port IA (test de garde `ia-perimetre.test.ts`).
 */
import { and, eq, isNull } from "drizzle-orm";
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
  validerDiapos,
  type Diapo,
  type ModuleParcours,
} from "@/domaine/pedagogie/parcours";
import { coffreFichier, formation as tableFormation } from "../bd/schema";
import {
  creerAssistant,
  iaIndisponible,
  type AssistantPedagogique,
  type OptionsRedaction,
} from "../ports/ia";
import { ecrireDansCoffre, lireFormation, memoriserVersion } from "./formations";
import { lireOrganisme } from "./organisme";
import { configIa } from "./reglages";
import { nomSupport, rendrePptx } from "./supports";
import {
  ErreurMetier,
  exigerFormateurValide,
  invalide,
  journaliser,
  type Acteur,
  type Services,
} from "./socle";

// ——— Configuration : réglages de l'organisme, puis `.env` ———

const cache = new Map<string, { signature: string; assistant: AssistantPedagogique }>();

/** L'assistant à utiliser pour cet organisme : réglages enregistrés dans l'application, sinon celui du serveur. */
async function assistant(s: Services, of_id: string): Promise<AssistantPedagogique> {
  const c = await configIa(s, of_id);
  if (c === null) return s.ia ?? iaIndisponible;
  if (!c.cle) return iaIndisponible; // IA désactivée par l'organisme
  const signature = JSON.stringify(c);
  const existant = cache.get(of_id);
  if (existant && existant.signature === signature) return existant.assistant;
  const nouveau = creerAssistant(c);
  cache.set(of_id, { signature, assistant: nouveau });
  return nouveau;
}

export async function etatIa(
  s: Services,
  acteur: Acteur,
): Promise<{ disponible: boolean; description: string }> {
  if (acteur.role !== "formateur") return { disponible: false, description: "" };
  const ia = await assistant(s, acteur.of_id);
  return { disponible: ia.disponible, description: ia.disponible ? ia.description : "" };
}

const MESSAGE_INDISPONIBLE =
  "L'assistant IA n'est pas configuré. Demandez à l'administrateur de l'organisme de renseigner la clé d'API dans « Organisme → Assistant IA ».";

async function demander(
  s: Services,
  acteur: Acteur,
  quoi: string,
  demande: string,
  options: OptionsRedaction = {},
): Promise<{ json: unknown; sources: Array<{ titre: string; url: string }> }> {
  const ia = await assistant(s, acteur.of_id);
  if (!ia.disponible) throw new ErreurMetier("conflit", MESSAGE_INDISPONIBLE);
  try {
    const r = await ia.rediger(CONSIGNE_SYSTEME, demande, options);
    await journaliser(s, {
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
    await journaliser(s, {
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
  s: Services,
  acteur: Acteur,
  quoi: string,
  demande: string,
  valider: (
    json: unknown,
    sources: Array<{ titre: string; url: string }>,
  ) => { ok: true; valeur: T } | { ok: false; erreurs: string[] },
  options: OptionsRedaction = {},
): Promise<T> {
  const premiere = await demander(s, acteur, quoi, demande, options);
  const r1 = valider(premiere.json, premiere.sources);
  if (r1.ok) return r1.valeur;
  const rappel = `${demande}\n\nATTENTION : ta réponse précédente a été rejetée (${r1.erreurs.slice(0, 3).join(" ; ")}). Respecte exactement le schéma JSON et les nombres demandés.`;
  const seconde = await demander(s, acteur, `${quoi} (2e tentative)`, rappel, options);
  const r2 = valider(seconde.json, seconde.sources);
  if (r2.ok) return r2.valeur;
  throw invalide("La proposition de l'IA n'est pas exploitable. Relancez la génération.", {
    erreurs: r2.erreurs,
  });
}

/** Modules d'une formation ; à défaut (ancienne formation), un module unique construit sur ses objectifs. */
function modulesDe(f: Awaited<ReturnType<typeof lireFormation>>): ModuleParcours[] {
  const modules = (f.formation_modules ?? []) as ModuleParcours[];
  if (modules.length > 0) return modules;
  const objectifs = f.formation_objectifs
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const contenus = f.programme
    .split("\n")
    .map((x) => x.replace(/^[-•\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 10);
  return [
    {
      titre: f.formation_titre,
      duree_heures: f.formation_duree_heures_total ?? 7,
      objectifs: objectifs.length ? objectifs : [`Maîtriser les fondamentaux de « ${f.formation_titre} »`],
      contenus: contenus.length ? contenus : [f.formation_titre],
      methodes: "",
      mise_en_pratique: "",
      evaluation: "",
    },
  ];
}

const contexte = (f: Awaited<ReturnType<typeof lireFormation>>) => ({
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

// ——— 1. Dossier d'enjeux (recherche web) ———

/** Ce que l'IA reçoit pour constituer le dossier d'enjeux : la description de la FORMATION, rien d'autre. */
interface EntreeEnjeux {
  titre: string;
  niveau: string;
  public_vise: string;
  modalite: string;
  heures: number | null;
}

async function rechercherEnjeux(s: Services, acteur: Acteur, e: EntreeEnjeux): Promise<DossierEnjeux> {
  return demanderValide(
    s,
    acteur,
    `dossier d'enjeux « ${e.titre} »`,
    consigneEnjeux(e),
    (json, sources) => validerPropositionEnjeux(json, sources),
    { recherche: true, maxRecherches: 8, maxTokens: 6000 },
  );
}

/**
 * Constitue (ou reconstitue) le dossier d'enjeux d'une formation existante et l'enregistre sur la formation.
 * Public visé et prérequis vides sont complétés depuis le dossier.
 */
export async function analyserEnjeux(s: Services, acteur: Acteur, donnees: unknown) {
  exigerFormateurValide(acteur);
  const v = z.object({ formation_id: z.string().min(1) }).parse(donnees);
  const f = await lireFormation(s, acteur, v.formation_id);
  const enjeux = await rechercherEnjeux(s, acteur, {
    titre: f.formation_titre,
    niveau: f.formation_niveau,
    public_vise: f.public_vise,
    modalite: f.formation_modalite,
    heures: f.formation_duree_heures_total,
  });
  // L'état précédent (dossier d'enjeux compris) reste dans l'historique des versions, comme pour toute modification.
  await memoriserVersion(
    s,
    acteur,
    "formation",
    f.id,
    f,
    `Avant l'analyse des enjeux du ${s.horloge.maintenant().toISOString()}`,
  );
  await s.bd
    .update(tableFormation)
    .set({
      dossier_enjeux: enjeux,
      enjeux_le: s.horloge.maintenant(),
      public_vise: f.public_vise || enjeux.public_vise,
      formation_prerequis: f.formation_prerequis || enjeux.prerequis,
      maj_le: s.horloge.maintenant(),
    })
    .where(eq(tableFormation.id, f.id));
  await journaliser(s, {
    of_id: acteur.of_id,
    acteur,
    type: "enjeux_analyses",
    libelle: `Dossier d'enjeux constitué pour « ${f.formation_titre} » (${enjeux.sources.length} source(s))`,
  });
  return { enjeux, enjeux_le: s.horloge.maintenant() };
}

/** Le dossier d'enjeux d'une formation, constitué à la demande s'il manque. */
async function enjeuxDe(
  s: Services,
  acteur: Acteur,
  f: Awaited<ReturnType<typeof lireFormation>>,
): Promise<DossierEnjeux> {
  if (f.dossier_enjeux) return f.dossier_enjeux as DossierEnjeux;
  return (await analyserEnjeux(s, acteur, { formation_id: f.id })).enjeux;
}

// ——— 2. Tests : questions de connaissances ———

const SchemaQcm = z.object({
  formation_id: z.string().min(1),
  type: z.enum(["positionnement", "acquis"]),
  nombre: z.number().int().min(BORNES_QCM.min).max(BORNES_QCM.max).default(10),
});

/** Brouillon de QCM (positionnement ou acquis) rédigé par l'IA, fondé sur la formation et son dossier d'enjeux. */
export async function proposerQcm(s: Services, acteur: Acteur, donnees: unknown) {
  exigerFormateurValide(acteur);
  const v = SchemaQcm.parse(donnees);
  const f = await lireFormation(s, acteur, v.formation_id); // vérifie que la formation est bien la sienne
  if (!f.formation_objectifs.trim() && !f.programme.trim() && !(f.formation_modules as unknown[]).length) {
    throw invalide(
      "Renseignez d'abord les objectifs, le programme ou le parcours de la formation : l'IA s'appuie dessus.",
    );
  }
  const enjeux = await enjeuxDe(s, acteur, f);
  const questionnaire = await demanderValide(
    s,
    acteur,
    `${v.type === "positionnement" ? "test de positionnement" : "évaluation des acquis"} « ${f.formation_titre} »`,
    consigneQcm({ ...contexte(f), enjeux }, v.type, v.nombre),
    (json) => validerPropositionQcm(json, v.nombre),
    { recherche: true, maxRecherches: 3, maxTokens: 6000 },
  );
  return { brouillon: true as const, source: "ia" as const, questionnaire };
}

/** Même chose, sous l'ancien nom de route (« mode » ignoré : il n'y a plus de trame). */
export async function proposerTest(s: Services, acteur: Acteur, donnees: unknown) {
  return proposerQcm(s, acteur, donnees);
}

// ——— Objectifs et programme ———

const SchemaProgramme = z.object({
  formation_titre: z.string().trim().min(3, "Indiquez d'abord l'intitulé de la formation.").max(200),
  formation_niveau: z.string().trim().max(100).default(""),
  public_vise: z.string().trim().max(2000).default(""),
  formation_prerequis: z.string().trim().max(2000).default(""),
  formation_duree_heures_total: z.number().positive().max(2000).nullable().default(null),
});

/** Brouillon d'objectifs pédagogiques et de programme détaillé, à partir de l'intitulé et du public. */
export async function proposerProgramme(s: Services, acteur: Acteur, donnees: unknown) {
  exigerFormateurValide(acteur);
  const v = SchemaProgramme.parse(donnees);
  const valeur = await demanderValide(
    s,
    acteur,
    `objectifs et programme « ${v.formation_titre} »`,
    consigneProgramme(v),
    (json) => validerPropositionProgramme(json),
    { recherche: true, maxRecherches: 3 },
  );
  return { brouillon: true as const, ...valeur };
}

// ——— 3. Le parcours complet en un clic ———

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
 * Avec seulement l'intitulé, la durée (heures, jours), le nombre de modules (et le tarif, saisi à côté), propose le
 * parcours complet : dossier d'enjeux (recherche web), modules, objectifs, contenus, méthodes, mise en pratique,
 * évaluations, programme rédigé, public visé et prérequis pour la convention.
 */
export async function proposerParcours(s: Services, acteur: Acteur, donnees: unknown) {
  exigerFormateurValide(acteur);
  const v = SchemaParcours.parse(donnees);
  if (v.heures / v.nb_modules < 0.5)
    throw invalide("Chaque module doit durer au moins une demi-heure : réduisez le nombre de modules.");
  let enjeux: DossierEnjeux | null = null;
  if (v.formation_id) {
    const f = await lireFormation(s, acteur, v.formation_id);
    if (f.dossier_enjeux && f.formation_titre.trim().toLowerCase() === v.titre.toLowerCase())
      enjeux = f.dossier_enjeux as DossierEnjeux;
  }
  enjeux ??= await rechercherEnjeux(s, acteur, {
    titre: v.titre,
    niveau: v.niveau,
    public_vise: v.public_vise,
    modalite: v.modalite,
    heures: v.heures,
  });
  const durees = repartirHeures(v.heures, v.nb_modules);
  const r = await demanderValide(
    s,
    acteur,
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

// ——— 4. Supports de cours PPTX : 20 diapositives par module ———

const SchemaPlan = z.object({
  formation_id: z.string().min(1),
  module_index: z.number().int().min(0).max(11),
});

/** Plan de 20 diapositives d'un module, rédigé par l'IA, à relire et aménager avant de produire le PPTX. */
export async function proposerPlanSupport(s: Services, acteur: Acteur, donnees: unknown) {
  exigerFormateurValide(acteur);
  const v = SchemaPlan.parse(donnees);
  const f = await lireFormation(s, acteur, v.formation_id);
  const modules = modulesDe(f);
  const m = modules[v.module_index];
  if (!m) throw invalide("Ce module n'existe pas dans le parcours.");
  const enjeux = await enjeuxDe(s, acteur, f);
  const diapos = await demanderValide(
    s,
    acteur,
    `support du module ${v.module_index + 1} « ${f.formation_titre} »`,
    consigneDiapos({ ...contexte(f), enjeux }, m, v.module_index + 1),
    (json) => validerPropositionDiapos(json),
    { recherche: true, maxRecherches: 4, maxTokens: 14_000 },
  );
  return { source: "ia" as const, diapos };
}

const SchemaProduction = z.object({
  formation_id: z.string().min(1),
  module_index: z.number().int().min(0).max(11),
  diapos: z.unknown(),
});

/**
 * Produit le PPTX d'un module à partir d'un plan validé, et le range dans le coffre-fort (rubrique « Support de
 * cours », origine « générée »). Le support précédent du même module passe à la corbeille : rien n'est perdu.
 */
export async function produireSupport(s: Services, acteur: Acteur, donnees: unknown) {
  const formateur_id = exigerFormateurValide(acteur);
  const v = SchemaProduction.parse(donnees);
  const f = await lireFormation(s, acteur, v.formation_id);
  const modules = modulesDe(f);
  const m = modules[v.module_index];
  if (!m) throw invalide("Ce module n'existe pas dans le parcours.");
  const plan = validerDiapos(v.diapos);
  if (!plan.ok) throw invalide("Le plan du support est incomplet.", { erreurs: plan.erreurs });
  return enregistrerSupport(s, acteur, formateur_id, f, m, v.module_index, plan.valeur);
}

async function enregistrerSupport(
  s: Services,
  acteur: Acteur,
  formateur_id: string,
  f: Awaited<ReturnType<typeof lireFormation>>,
  m: ModuleParcours,
  index: number,
  diapos: Diapo[],
) {
  const of = await lireOrganisme(s, acteur.of_id);
  const contenu = await rendrePptx({
    formation_titre: f.formation_titre,
    organisme: of.of_nom || "Organisme de formation",
    couleur: of.couleur,
    module: m,
    rang: index + 1,
    diapos,
  });
  const marque = `module:${index + 1}`;
  await s.bd
    .update(coffreFichier)
    .set({ supprime_le: s.horloge.maintenant() })
    .where(
      and(
        eq(coffreFichier.formation_id, f.id),
        eq(coffreFichier.origine, "genere"),
        eq(coffreFichier.description, marque),
        isNull(coffreFichier.supprime_le),
      ),
    );
  const nom = nomSupport(index + 1, m.titre);
  const id = await ecrireDansCoffre(
    s,
    acteur.of_id,
    formateur_id,
    f.id,
    { nom, type_mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", contenu },
    { categorie: "support", description: marque, partageable: true, origine: "genere" },
  );
  await journaliser(s, {
    of_id: acteur.of_id,
    acteur,
    type: "support_genere",
    libelle: `Support PPTX du module ${index + 1} produit pour « ${f.formation_titre} »`,
  });
  return { id, nom, diapositives: diapos.length };
}

/** Tous les supports d'un parcours d'un coup. Un module en échec n'empêche pas les autres. */
export async function produireTousLesSupports(s: Services, acteur: Acteur, donnees: unknown) {
  const formateur_id = exigerFormateurValide(acteur);
  const v = z.object({ formation_id: z.string().min(1) }).parse(donnees);
  const f = await lireFormation(s, acteur, v.formation_id);
  const modules = modulesDe(f);
  const produits: Array<{ nom: string; diapositives: number }> = [];
  const echecs: string[] = [];
  for (const [i, m] of modules.entries()) {
    try {
      const { diapos } = await proposerPlanSupport(s, acteur, { formation_id: f.id, module_index: i });
      produits.push(await enregistrerSupport(s, acteur, formateur_id, f, m, i, diapos));
    } catch (e) {
      echecs.push(`Module ${i + 1} : ${e instanceof Error ? e.message : "échec"}`);
    }
  }
  return { produits, echecs };
}
