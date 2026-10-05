/**
 * Faux client Supabase pour les tests de la couche serveur et des gestionnaires (lot 3, réutilisable aux lots 4 à 8).
 *
 * `fauxBd(repondre)` renvoie un client dont `from(table)…` enregistre chaque requête (table, opération, valeurs,
 * filtres) dans `appels` et obtient sa réponse de `repondre(appel)`. Les chaînes `.select().eq().maybeSingle()` etc.
 * sont reproduites ; `maybeSingle` / `single` prennent la première ligne. Sans réponse, `data` vaut `null`.
 * `bd.rpc` et `bd.storage.from(bucket)` sont des `vi.fn()` à régler dans chaque test.
 */
import { vi } from "vitest";

export interface Appel {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  colonnes?: string;
  valeurs?: unknown;
  options?: unknown;
  filtres: Array<[string, ...unknown[]]>;
  fin?: "maybeSingle" | "single";
}
export interface Reponse {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

/** Le filtre `eq(colonne, valeur)` a-t-il été posé ? */
export const aFiltre = (a: Appel, methode: string, ...args: unknown[]) =>
  a.filtres.some(
    (f) => f[0] === methode && args.every((x, i) => JSON.stringify(f[i + 1]) === JSON.stringify(x)),
  );

export function fauxBd(repondre: (a: Appel) => Reponse | undefined = () => undefined) {
  const appels: Appel[] = [];
  const construire = (table: string) => {
    const a: Appel = { table, op: "select", filtres: [] };
    const b: Record<string, unknown> = {};
    const chaine =
      (nom: string) =>
      (...args: unknown[]) => {
        a.filtres.push([nom, ...args]);
        return b;
      };
    for (const nom of ["eq", "neq", "in", "is", "gt", "lt", "order", "limit", "not", "ilike"])
      b[nom] = chaine(nom);
    b["select"] = (colonnes?: string) => {
      a.colonnes = colonnes ?? "*";
      return b;
    };
    for (const op of ["insert", "update", "upsert"] as const)
      b[op] = (valeurs: unknown, options?: unknown) => {
        a.op = op;
        a.valeurs = valeurs;
        a.options = options;
        return b;
      };
    b["delete"] = () => {
      a.op = "delete";
      return b;
    };
    for (const fin of ["maybeSingle", "single"] as const)
      b[fin] = () => {
        a.fin = fin;
        return b;
      };
    b["then"] = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      appels.push(a);
      const r = repondre(a) ?? {};
      let data = r.data ?? null;
      if (a.fin && Array.isArray(data)) data = data[0] ?? null;
      return Promise.resolve({ data, error: r.error ?? null }).then(ok, ko);
    };
    return b;
  };
  const stockage = {
    upload: vi.fn(async () => ({ data: {}, error: null })),
    download: vi.fn(async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    move: vi.fn(async () => ({ data: {}, error: null })),
    createSignedUrl: vi.fn(async () => ({
      data: { signedUrl: "https://stockage.test/signe" },
      error: null,
    })),
  };
  const bd = {
    from: vi.fn((table: string) => construire(table)),
    rpc: vi.fn(),
    storage: { from: vi.fn(() => stockage) },
  };
  return { bd, appels, stockage };
}

/** Réponse de `s4m_moi()` pour un acteur donné. */
export const moi = (acteur: Record<string, unknown> | null) => ({
  data: acteur ? { acteur } : { acteur: null },
  error: null,
});

export const ACTEURS = {
  admin: {
    utilisateur_id: "u-admin",
    of_id: "of1",
    role: "admin",
    formateur_id: null,
    formateur_valide: false,
    stagiaire_id: null,
    nom: "Alice Admin",
    email: "admin@of.fr",
  },
  formateurValide: {
    utilisateur_id: "u-form",
    of_id: "of1",
    role: "formateur",
    formateur_id: "f1",
    formateur_valide: true,
    stagiaire_id: null,
    nom: "Fred Formateur",
    email: "fred@of.fr",
  },
  candidat: {
    utilisateur_id: "u-cand",
    of_id: "of1",
    role: "formateur",
    formateur_id: "f2",
    formateur_valide: false,
    stagiaire_id: null,
    nom: "Paul Candidat",
    email: "paul@of.fr",
  },
  apprenant: {
    utilisateur_id: "u-app",
    of_id: "of1",
    role: "apprenant",
    formateur_id: null,
    formateur_valide: false,
    stagiaire_id: "s1",
    nom: "Anne Apprenante",
    email: "anne@of.fr",
  },
} as const;
