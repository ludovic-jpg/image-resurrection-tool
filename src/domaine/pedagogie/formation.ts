/**
 * Règles de la fiche formation qui ne tiennent pas dans un schéma champ par champ.
 *
 * Versions PURES de `controlerCoherence`, `completerDepuisModules` et `resumer` de
 * `src/serveur/services/formations.ts` : mêmes résultats, mais `controlerCoherence` RENVOIE l'anomalie au lieu de la
 * lever (le gestionnaire du client la convertit en erreur 400 « invalide »).
 */
import {
  objectifsDepuisModules,
  programmeDepuisModules,
  validerModules,
  type ModuleParcours,
} from "./parcours";

/** Les seuls champs de la formation que ces règles lisent. */
export interface ChampsCoherence {
  formation_effectif_min?: number | null;
  formation_effectif_max?: number | null;
  formation_duree_heures_total?: number | null;
  formation_duree_heures_presentiel?: number | null;
  formation_duree_heures_distanciel?: number | null;
  formation_modules?: ModuleParcours[];
}

/** Une incohérence : le message (le premier relevé) et, selon le cas, les champs fautifs ou la liste d'erreurs. */
export interface Incoherence {
  message: string;
  details: { champs?: Record<string, string>; erreurs?: string[] };
}

/** `null` quand la formation est cohérente ; sinon l'incohérence à présenter à la personne qui saisit. */
export function controlerCoherence(f: ChampsCoherence): Incoherence | null {
  const erreurs: Record<string, string> = {};
  if (
    f.formation_effectif_min != null &&
    f.formation_effectif_max != null &&
    f.formation_effectif_min > f.formation_effectif_max
  ) {
    erreurs.formation_effectif_max = "L'effectif maximum doit être supérieur ou égal au minimum.";
  }
  const total = f.formation_duree_heures_total;
  const somme =
    (f.formation_duree_heures_presentiel ?? 0) + (f.formation_duree_heures_distanciel ?? 0);
  if (
    total != null &&
    (f.formation_duree_heures_presentiel != null || f.formation_duree_heures_distanciel != null) &&
    Math.abs(somme - total) > 0.01
  ) {
    erreurs.formation_duree_heures_presentiel = `Présentiel + distanciel (${somme} h) doit égaler la durée totale (${total} h).`;
  }
  if (f.formation_modules?.length) {
    const r = validerModules(f.formation_modules);
    if (!r.ok) return { message: "Le parcours est incomplet.", details: { erreurs: r.erreurs } };
    if (total != null) {
      const sommeModules = f.formation_modules.reduce((a, m) => a + m.duree_heures, 0);
      if (Math.abs(sommeModules - total) > 0.01)
        erreurs.formation_modules = `La somme des durées des modules (${sommeModules} h) doit égaler la durée totale (${total} h).`;
    }
  }
  const premiere = Object.values(erreurs)[0];
  return premiere === undefined ? null : { message: premiere, details: { champs: erreurs } };
}

interface ChampsModules {
  formation_modules?: ModuleParcours[];
  formation_nb_modules?: number | null;
  programme?: string;
  formation_objectifs?: string;
}

/** Quand le parcours est renseigné, programme et objectifs vides en sont déduits (le formateur peut les réécrire). */
export function completerDepuisModules<T extends ChampsModules>(v: T): T {
  const modules = v.formation_modules;
  if (!modules?.length) return v;
  return {
    ...v,
    formation_nb_modules: modules.length,
    programme: v.programme?.trim() ? v.programme : programmeDepuisModules(modules),
    formation_objectifs: v.formation_objectifs?.trim()
      ? v.formation_objectifs
      : objectifsDepuisModules(modules),
  };
}

/** Ligne d'aperçu d'une version d'historique (formation ou outil). */
export function resumer(type: "formation" | "outil", snapshot: unknown): string {
  const o = (snapshot ?? {}) as Record<string, unknown>;
  if (type === "formation") {
    const modules = Array.isArray(o.formation_modules) ? o.formation_modules.length : 0;
    return `${String(o.formation_titre ?? "")} · ${o.formation_duree_heures_total ?? "—"} h · ${modules} module(s)`;
  }
  const questions = ((o.contenu as { questions?: unknown[] } | undefined)?.questions ?? []).length;
  return `${String(o.titre ?? "")} · ${questions} question(s)`;
}
