/**
 * Parcours de formation découpé en modules — « Modification 1 » du 23/09/2026 :
 * « générer le parcours de formation avec seulement titre, heures et jours de formation, tarif, nombre de modules ;
 * le formateur peut aménager le contenu et l'enregistrer ».
 *
 * Version 7 (23/09/2026) : le contenu est TOUJOURS rédigé par l'assistant IA, après une recherche documentaire sur le
 * sujet réel (les anciennes « trames » génériques sans IA ont été retirées : un programme passe-partout ne sert ni le
 * formateur ni l'auditeur Qualiopi). Ce module ne garde que la structure, les calculs et les validations.
 *
 * Module pur : aucun appel réseau, aucune base. Tout ce qui est dérivé (durées, programme, objectifs) est calculé ici,
 * donc testé et reproductible.
 */

export interface ModuleParcours {
  titre: string;
  duree_heures: number;
  objectifs: string[];
  contenus: string[];
  methodes: string;
  mise_en_pratique: string;
  evaluation: string;
}

export interface EntreeParcours {
  titre: string;
  heures: number;
  jours: number | null;
  nb_modules: number;
  niveau?: string;
  public_vise?: string;
  modalite?: "presentiel" | "distanciel" | "mixte";
}

export const BORNES_MODULES = { min: 1, max: 12 } as const;
export const DIAPOS_PAR_MODULE = 20;

/** Répartit une durée totale entre n modules, par demi-heures, le reliquat allant aux premiers modules. */
export function repartirHeures(total: number, n: number): number[] {
  if (n < 1) return [];
  const demiHeures = Math.max(0, Math.round(total * 2));
  const base = Math.floor(demiHeures / n);
  const reste = demiHeures - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < reste ? 1 : 0)) / 2);
}

export const heuresTexte = (h: number): string => `${String(h).replace(".", ",")} h`;

/** Le programme détaillé (annexe de la convention) écrit à partir des modules. */
export function programmeDepuisModules(modules: readonly ModuleParcours[]): string {
  return modules
    .map((m, i) =>
      [
        `Module ${i + 1} — ${m.titre} (${heuresTexte(m.duree_heures)})`,
        m.objectifs.length ? `Objectifs : ${m.objectifs.join(" ; ")}.` : "",
        ...m.contenus.map((c) => `- ${c}`),
        m.methodes ? `Méthodes : ${m.methodes}` : "",
        m.mise_en_pratique ? `Mise en pratique : ${m.mise_en_pratique}` : "",
        m.evaluation ? `Évaluation : ${m.evaluation}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

/** Objectifs de la formation (convention, attestation) : un objectif majeur par module, 3 à 8 au total. */
export function objectifsDepuisModules(modules: readonly ModuleParcours[]): string {
  const principaux = modules.map((m) => m.objectifs[0]).filter((x): x is string => Boolean(x?.trim()));
  const complements = modules.flatMap((m) => m.objectifs.slice(1)).filter((x) => !principaux.includes(x));
  return [...principaux, ...complements].slice(0, Math.max(3, Math.min(8, principaux.length))).join("\n");
}

export type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreurs: string[] };

const texte = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const liste = (x: unknown, max: number): string[] =>
  Array.isArray(x)
    ? x
        .filter(texte)
        .map((v) => v.trim().replace(/^[-•\d.)\s]+/, ""))
        .filter(Boolean)
        .slice(0, max)
    : [];

/**
 * Valide des modules (saisis par le formateur ou proposés par l'IA). Les durées ne sont jamais demandées à l'IA :
 * elles viennent de `repartirHeures` quand `durees` est fourni.
 */
export function validerModules(
  brut: unknown,
  attendu?: { nombre: number; durees?: number[] },
): Resultat<ModuleParcours[]> {
  if (!Array.isArray(brut)) return { ok: false, erreurs: ["Les modules ne sont pas une liste."] };
  const erreurs: string[] = [];
  if (brut.length === 0) erreurs.push("Le parcours doit compter au moins un module.");
  if (brut.length > BORNES_MODULES.max)
    erreurs.push(`Le parcours compte ${BORNES_MODULES.max} modules au plus.`);
  if (attendu && brut.length !== attendu.nombre)
    erreurs.push(`${brut.length} module(s) proposé(s) au lieu de ${attendu.nombre}.`);
  const modules = brut.map((m, i): ModuleParcours => {
    const o = (m ?? {}) as Record<string, unknown>;
    const duree =
      attendu?.durees?.[i] ??
      (typeof o.duree_heures === "number"
        ? o.duree_heures
        : Number(String(o.duree_heures ?? "").replace(",", ".")));
    const module: ModuleParcours = {
      titre: texte(o.titre) ? o.titre.trim().slice(0, 200) : "",
      duree_heures: Number.isFinite(duree) ? Math.round(duree * 100) / 100 : 0,
      objectifs: liste(o.objectifs, 8),
      contenus: liste(o.contenus, 15),
      methodes: texte(o.methodes) ? o.methodes.trim().slice(0, 2000) : "",
      mise_en_pratique: texte(o.mise_en_pratique) ? o.mise_en_pratique.trim().slice(0, 2000) : "",
      evaluation: texte(o.evaluation) ? o.evaluation.trim().slice(0, 1000) : "",
    };
    if (!module.titre) erreurs.push(`Module ${i + 1} : titre manquant.`);
    if (module.duree_heures <= 0 || module.duree_heures > 400)
      erreurs.push(`Module ${i + 1} : durée invalide.`);
    if (module.objectifs.length === 0) erreurs.push(`Module ${i + 1} : au moins un objectif.`);
    if (module.contenus.length === 0) erreurs.push(`Module ${i + 1} : au moins un point de contenu.`);
    return module;
  });
  return erreurs.length > 0 ? { ok: false, erreurs } : { ok: true, valeur: modules };
}

// ——— Plan des supports de cours (PPTX) : 20 diapositives par module ———

export type TypeDiapo =
  | "titre"
  | "objectifs"
  | "sommaire"
  | "amorce"
  | "notion"
  | "schema"
  | "exemple"
  | "point_etape"
  | "pratique"
  | "debriefing"
  | "vigilance"
  | "synthese"
  | "quiz";

export interface Diapo {
  type: TypeDiapo;
  titre: string;
  points: string[];
  /** Visuel suggéré (double codage : un texte court + une image ou un schéma). */
  visuel: string;
  /** Notes du formateur : déroulé, questions à poser, timing. */
  notes: string;
}

export const TYPES_DIAPO: readonly TypeDiapo[] = [
  "titre",
  "objectifs",
  "sommaire",
  "amorce",
  "notion",
  "schema",
  "exemple",
  "point_etape",
  "pratique",
  "debriefing",
  "vigilance",
  "synthese",
  "quiz",
];

/** Valide un plan de diapositives (saisi ou proposé par l'IA) : exactement 20, une idée par diapositive, 6 points au plus. */
export function validerDiapos(brut: unknown, attendu = DIAPOS_PAR_MODULE): Resultat<Diapo[]> {
  if (!Array.isArray(brut)) return { ok: false, erreurs: ["Le plan n'est pas une liste de diapositives."] };
  const erreurs: string[] = [];
  if (brut.length !== attendu) erreurs.push(`${brut.length} diapositive(s) au lieu de ${attendu}.`);
  const diapos = brut.map((x, i): Diapo => {
    const o = (x ?? {}) as Record<string, unknown>;
    const type = TYPES_DIAPO.includes(o.type as TypeDiapo) ? (o.type as TypeDiapo) : "notion";
    const d: Diapo = {
      type,
      titre: texte(o.titre) ? o.titre.trim().slice(0, 160) : "",
      points: liste(o.points, 6).map((p) => p.slice(0, 220)),
      visuel: texte(o.visuel) ? o.visuel.trim().slice(0, 200) : "",
      notes: texte(o.notes) ? o.notes.trim().slice(0, 2000) : "",
    };
    if (!d.titre) erreurs.push(`Diapositive ${i + 1} : titre manquant.`);
    return d;
  });
  return erreurs.length > 0 ? { ok: false, erreurs } : { ok: true, valeur: diapos };
}
