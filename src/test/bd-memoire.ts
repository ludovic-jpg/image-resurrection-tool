/**
 * Faux client Supabase « en mémoire » pour les tests du lot 8 : il tient de vraies lignes (par table) et applique
 * réellement les filtres, l'ordre et la pagination de PostgREST. Contrairement à `faux-supabase.ts` (qui rejoue des
 * réponses programmées), il permet de comparer un résultat calculé sur des données complètes à celui de l'ancien serveur.
 *
 * Supporté : select (liste de colonnes), eq neq in is not lte lt gte gt, order, range, limit, maybeSingle, single,
 * insert / update / delete (avec select). Pas de jointure : les tests lisent table par table, comme le serveur.
 */
import { vi } from "vitest";

export type LigneMemoire = Record<string, unknown>;

type Filtre = (l: LigneMemoire) => boolean;
const nombreOuTexte = (v: unknown) => v as number | string;

export function bdMemoire(
  initial: Record<string, LigneMemoire[]> = {},
  options: {
    rpc?: Record<string, (args: unknown) => Promise<{ data: unknown; error: unknown }>>;
  } = {},
) {
  // Copie JSON : les dates deviennent des chaînes ISO, comme dans une réponse PostgREST.
  const tables: Record<string, LigneMemoire[]> = Object.fromEntries(
    Object.entries(initial).map(([t, l]) => [t, JSON.parse(JSON.stringify(l)) as LigneMemoire[]]),
  );
  const requetes: Array<{ table: string; op: string; valeurs?: unknown; filtres: string[] }> = [];

  function from(table: string) {
    const filtres: Filtre[] = [];
    const trace: string[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let valeurs: unknown;
    let colonnes: string[] | null = null;
    let tri: Array<[string, boolean]> = [];
    let fenetre: [number, number] | null = null;
    let limite: number | null = null;
    let fin: "maybeSingle" | "single" | null = null;
    let retour = false;

    const ajouter = (nom: string, args: unknown[], f: Filtre) => {
      trace.push(`${nom}:${args.map(String).join(",")}`);
      filtres.push(f);
      return b;
    };
    const b: Record<string, unknown> = {
      select: (cols?: string) => {
        if (op !== "select") retour = true;
        if (cols && cols !== "*") colonnes = cols.split(",").map((c) => c.trim());
        return b;
      },
      insert: (v: unknown) => ((op = "insert"), (valeurs = v), b),
      update: (v: unknown) => ((op = "update"), (valeurs = v), b),
      delete: () => ((op = "delete"), b),
      eq: (c: string, v: unknown) => ajouter("eq", [c, v], (l) => l[c] === v),
      neq: (c: string, v: unknown) => ajouter("neq", [c, v], (l) => l[c] !== v),
      in: (c: string, v: unknown[]) => ajouter("in", [c, v], (l) => v.includes(l[c])),
      is: (c: string, v: unknown) => ajouter("is", [c, v], (l) => (l[c] ?? null) === v),
      not: (c: string, o: string, v: unknown) =>
        ajouter("not", [c, o, v], (l) => (o === "is" ? (l[c] ?? null) !== v : l[c] !== v)),
      lte: (c: string, v: unknown) =>
        ajouter("lte", [c, v], (l) => nombreOuTexte(l[c]) <= nombreOuTexte(v)),
      lt: (c: string, v: unknown) =>
        ajouter("lt", [c, v], (l) => nombreOuTexte(l[c]) < nombreOuTexte(v)),
      gte: (c: string, v: unknown) =>
        ajouter("gte", [c, v], (l) => nombreOuTexte(l[c]) >= nombreOuTexte(v)),
      gt: (c: string, v: unknown) =>
        ajouter("gt", [c, v], (l) => nombreOuTexte(l[c]) > nombreOuTexte(v)),
      order: (c: string, o?: { ascending?: boolean }) => (
        (tri = [...tri, [c, o?.ascending !== false]]),
        b
      ),
      range: (de: number, a: number) => ((fenetre = [de, a]), b),
      limit: (n: number) => ((limite = n), b),
      maybeSingle: () => ((fin = "maybeSingle"), b),
      single: () => ((fin = "single"), b),
    };
    b["then"] = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      requetes.push({ table, op, valeurs, filtres: trace });
      const lignes = (tables[table] ??= []);
      let data: unknown;
      if (op === "insert") {
        const nouvelles = (Array.isArray(valeurs) ? valeurs : [valeurs]).map((v) => ({
          id: crypto.randomUUID(),
          ...JSON.parse(JSON.stringify(v)),
        }));
        lignes.push(...nouvelles);
        data = nouvelles;
      } else {
        const cibles = lignes.filter((l) => filtres.every((f) => f(l)));
        if (op === "update") {
          for (const c of cibles) Object.assign(c, JSON.parse(JSON.stringify(valeurs)));
          data = cibles;
        } else if (op === "delete") {
          tables[table] = lignes.filter((l) => !cibles.includes(l));
          data = cibles;
        } else {
          let r = [...cibles];
          for (const [c, asc] of [...tri].reverse())
            r.sort((x, y) => {
              const [p, q] = [nombreOuTexte(x[c] ?? ""), nombreOuTexte(y[c] ?? "")];
              return (p < q ? -1 : p > q ? 1 : 0) * (asc ? 1 : -1);
            });
          if (fenetre) r = r.slice(fenetre[0], fenetre[1] + 1);
          if (limite !== null) r = r.slice(0, limite);
          data = r;
        }
      }
      let rows = data as LigneMemoire[];
      if (colonnes && (op === "select" || retour))
        rows = rows.map((l) => Object.fromEntries(colonnes!.map((c) => [c, l[c]])));
      const resultat =
        op !== "select" && !retour
          ? { data: null, error: null }
          : fin
            ? { data: rows[0] ?? null, error: null }
            : { data: rows, error: null };
      return Promise.resolve(resultat).then(ok, ko);
    };
    return b;
  }

  const stockage = {
    upload: vi.fn(async () => ({ data: {}, error: null as unknown })),
    list: vi.fn(async (..._a: unknown[]) => ({
      data: [] as Array<{ name: string }>,
      error: null as unknown,
    })),
    remove: vi.fn(async (..._a: unknown[]) => ({ data: [], error: null as unknown })),
  };
  const bd = {
    from: vi.fn(from),
    rpc: vi.fn(async (nom: string, args: unknown) => {
      const f = options.rpc?.[nom];
      return f ? f(args) : { data: null, error: { message: `rpc ${nom} non simulée` } };
    }),
    storage: { from: vi.fn(() => stockage) },
    auth: {
      admin: {
        getUserById: vi.fn(async (_id: string) => ({
          data: { user: { email: "" } } as { user: { email: string } | null },
          error: null as { status?: number; message: string } | null,
        })),
        deleteUser: vi.fn(async (_id: string) => ({
          error: null as { status?: number; message: string } | null,
        })),
      },
    },
  };
  return { bd, tables, requetes, stockage };
}
