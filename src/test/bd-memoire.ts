/**
 * Base en mémoire pour les tests du lot 4 (réutilisable aux lots 5 à 8) : `fauxBd` de `faux-supabase.ts` avec un vrai
 * état. `select`, `insert`, `update` et `delete` lisent et écrivent des lignes ; les filtres `eq`, `neq`, `in`, `is`,
 * `ilike` s'appliquent comme en SQL ; des clés uniques simulent l'erreur 23505. Cela permet de vérifier ce qui est
 * RÉELLEMENT écrit (sous-statut, pièces, compteurs) et pas seulement quels appels ont eu lieu.
 */
import { fauxBd, type Appel, type Reponse } from "./faux-supabase";

export type Ligne = Record<string, unknown>;
export type Tables = Record<string, Ligne[]>;

export interface OptionsMemoire {
  /** Colonnes uniques par table : une insertion en doublon répond 23505. */
  uniques?: Record<string, string[]>;
  /** Appelé avant chaque écriture (simule une modification concurrente en changeant `tables`). */
  avantEcriture?: (appel: Appel, tables: Tables) => void;
  /** Réponse imposée pour un appel donné (erreur simulée…). `undefined` : comportement normal. */
  imposer?: (appel: Appel) => Reponse | undefined;
}

const UNIQUES_PAR_DEFAUT: Record<string, string[]> = {
  compteur: ["of_id", "cle"],
  facture_of: ["dossier_id"],
  facture_formateur: ["dossier_id"],
  stagiaire_dossier: ["dossier_id", "stagiaire_id"],
  invitation: ["jeton_hash"],
};

function correspond(ligne: Ligne, filtres: Appel["filtres"]): boolean {
  return filtres.every(([nom, col, val]) => {
    const v = ligne[col as string];
    switch (nom) {
      case "eq":
        return v === val;
      case "neq":
        return v !== val;
      case "in":
        return (val as unknown[]).includes(v);
      case "is":
        return val === null ? v === null || v === undefined : v === val;
      case "ilike":
        return (
          typeof v === "string" &&
          v.toLowerCase() ===
            String(val)
              .replace(/\\([\\%_])/g, "$1")
              .toLowerCase()
        );
      default:
        return true; // order, limit, not… : sans effet sur le filtrage
    }
  });
}

let compteurId = 0;

export function bdMemoire(tables: Tables, options: OptionsMemoire = {}) {
  const uniques = { ...UNIQUES_PAR_DEFAUT, ...options.uniques };
  const faux = fauxBd((a) => {
    const imposee = options.imposer?.(a);
    if (imposee) return imposee;
    const lignes = (tables[a.table] ??= []);
    if (a.op !== "select") options.avantEcriture?.(a, tables);
    switch (a.op) {
      case "select":
        return { data: lignes.filter((l) => correspond(l, a.filtres)).map((l) => ({ ...l })) };
      case "insert": {
        const entrees = (Array.isArray(a.valeurs) ? a.valeurs : [a.valeurs]) as Ligne[];
        const ajoutees: Ligne[] = [];
        for (const e of entrees) {
          const cles = uniques[a.table];
          if (cles && lignes.some((l) => cles.every((c) => (l[c] ?? null) === (e[c] ?? null))))
            return { error: { message: "duplicate key value", code: "23505" } };
          const ligne = { id: `id-${++compteurId}`, ...e };
          lignes.push(ligne);
          ajoutees.push({ ...ligne });
        }
        return { data: ajoutees };
      }
      case "update": {
        const touchees = lignes.filter((l) => correspond(l, a.filtres));
        for (const l of touchees) Object.assign(l, a.valeurs as Ligne);
        return { data: touchees.map((l) => ({ ...l })) };
      }
      case "delete": {
        const supprimees = lignes.filter((l) => correspond(l, a.filtres));
        tables[a.table] = lignes.filter((l) => !supprimees.includes(l));
        return { data: supprimees };
      }
      default:
        return undefined;
    }
  });
  return { ...faux, tables };
}

/** Les écritures (insert / update / delete) d'une table, dans l'ordre. */
export const ecritures = (appels: Appel[], table: string, op?: Appel["op"]) =>
  appels.filter((a) => a.table === table && a.op !== "select" && (!op || a.op === op));
