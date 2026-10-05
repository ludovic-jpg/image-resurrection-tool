/**
 * Faux client Supabase pour les tests du lot 2 (jamais importé par l'application).
 *
 * Il enregistre chaque appel (table, opérations enchaînées, RPC, Storage) et renvoie les réponses programmées :
 * `reponses("formation", …)` pour toute opération sur la table, ou `reponses("formation:update", …)` pour une seule.
 * Il ne simule PAS la RLS : une ligne que la RLS cacherait se programme par une réponse vide (`data: null`), ce qui
 * est exactement ce que voit le client.
 */
import { vi } from "vitest";

export interface Reponse {
  data?: unknown;
  error?: unknown;
}
export interface AppelTable {
  table: string;
  operations: Array<[string, ...unknown[]]>;
}

const ECRITURES = ["insert", "update", "delete", "upsert"];

export function creerFausseBd() {
  const appels: AppelTable[] = [];
  const files = new Map<string, Reponse[]>();
  const rpcs = new Map<string, Reponse>();

  const prochaine = (cle: string): Reponse | undefined => {
    const file = files.get(cle);
    if (!file || file.length === 0) return undefined;
    return file.length > 1 ? file.shift() : file[0];
  };

  function chaine(appel: AppelTable) {
    const resoudre = () => {
      const premiere = appel.operations[0]?.[0] ?? "select";
      const r = prochaine(`${appel.table}:${premiere}`) ?? prochaine(appel.table) ?? {};
      return { data: r.data ?? null, error: r.error ?? null };
    };
    const proxy: unknown = new Proxy(
      {},
      {
        get(_cible, nom: string) {
          if (nom === "then")
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
              Promise.resolve(resoudre()).then(ok, ko);
          return (...args: unknown[]) => {
            appel.operations.push([nom, ...args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const storage = {
    upload: vi.fn(async (..._a: unknown[]) => ({ data: { path: "" }, error: null as unknown })),
    remove: vi.fn(async (..._a: unknown[]) => ({ data: [], error: null as unknown })),
    createSignedUrl: vi.fn(async (..._a: unknown[]) => ({
      data: { signedUrl: "https://stockage.test/signe?token=abc" } as { signedUrl: string } | null,
      error: null as unknown,
    })),
  };
  const buckets: string[] = [];

  const faux = {
    from: vi.fn((table: string) => {
      const appel: AppelTable = { table, operations: [] };
      appels.push(appel);
      return chaine(appel);
    }),
    rpc: vi.fn(async (nom: string, _args?: unknown) => {
      const r = rpcs.get(nom) ?? {};
      return { data: r.data ?? null, error: r.error ?? null };
    }),
    storage: {
      from: vi.fn((bucket: string) => {
        buckets.push(bucket);
        return storage;
      }),
    },
    auth: {},
  };

  return Object.assign(faux, {
    appels,
    buckets,
    stockage: storage,
    reponses(cle: string, ...r: Reponse[]) {
      files.set(cle, r);
    },
    rpcReponse(nom: string, r: Reponse) {
      rpcs.set(nom, r);
    },
    reinitialiser() {
      appels.length = 0;
      buckets.length = 0;
      files.clear();
      rpcs.clear();
      faux.from.mockClear();
      faux.rpc.mockClear();
      faux.storage.from.mockClear();
      storage.upload.mockReset().mockResolvedValue({ data: { path: "" }, error: null });
      storage.remove.mockReset().mockResolvedValue({ data: [], error: null });
      storage.createSignedUrl.mockReset().mockResolvedValue({
        data: { signedUrl: "https://stockage.test/signe?token=abc" },
        error: null,
      });
    },
    /** Les appels visant une table, dans l'ordre. */
    surTable: (table: string) => appels.filter((a) => a.table === table),
    /** Les opérations enchaînées d'un appel, sous forme `{ nom: [arguments] }` (la dernière occurrence l'emporte). */
    operations: (a: AppelTable) =>
      Object.fromEntries(a.operations.map(([n, ...args]) => [n, args])),
    /** Écritures interdites au client : journal, versions, compteurs, ou changement d'un sous-statut. */
    ecrituresInterdites: () =>
      appels.filter((a) => {
        const ecrit = a.operations.some(([n]) => ECRITURES.includes(n));
        if (!ecrit) return false;
        if (["evenement", "version_objet", "compteur"].includes(a.table)) return true;
        return a.operations.some(
          ([, ...args]) =>
            typeof args[0] === "object" &&
            args[0] !== null &&
            ("sous_statut" in (args[0] as object) || "coffre_ouvert" in (args[0] as object)),
        );
      }),
  });
}
export type FausseBd = ReturnType<typeof creerFausseBd>;

// ——— Acteurs et aides communes aux tests ———

export const ACTEURS = {
  formatrice: {
    utilisateur_id: "u-form",
    of_id: "of-1",
    role: "formateur",
    formateur_id: "fo-1",
    formateur_valide: true,
    stagiaire_id: null,
    nom: "Formatrice Démo",
    email: "formatrice@demo.example",
  },
  candidat: {
    utilisateur_id: "u-cand",
    of_id: "of-1",
    role: "formateur",
    formateur_id: "fo-9",
    formateur_valide: false,
    stagiaire_id: null,
    nom: "Paul Candidat",
    email: "candidat@demo.example",
  },
  admin: {
    utilisateur_id: "u-adm",
    of_id: "of-1",
    role: "admin",
    formateur_id: null,
    formateur_valide: false,
    stagiaire_id: null,
    nom: "Admin Démo",
    email: "admin@demo.example",
  },
  apprenante: {
    utilisateur_id: "u-app",
    of_id: "of-1",
    role: "apprenant",
    formateur_id: null,
    formateur_valide: false,
    stagiaire_id: "st-1",
    nom: "Apprenante Démo",
    email: "apprenante@demo.example",
  },
} as const;

/** Programme `s4m_moi()` : la personne connectée est `qui` (ou personne). */
export function connecter(bd: FausseBd, qui: keyof typeof ACTEURS | null) {
  bd.rpcReponse("s4m_moi", { data: { acteur: qui ? ACTEURS[qui] : null } });
}

/** Rend l'erreur levée par une promesse (échoue si elle réussit). */
export async function echec(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { message: string; statut: number; code: string | null; details: unknown };
  }
  throw new Error("Une erreur était attendue");
}
