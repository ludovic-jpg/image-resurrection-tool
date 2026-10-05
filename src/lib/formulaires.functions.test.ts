// @vitest-environment node
/**
 * Fonctions serveur des formulaires apprenant : l'envoi (101) est authentifié et refusé à l'apprenant ; les pages
 * publiques (14 à 17) n'ont AUCUN middleware d'authentification et s'appuient sur le jeton seul.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, fauxBd, moi, type Appel } from "@/test/faux-supabase";

const etat = vi.hoisted(() => ({ bd: null as unknown, middlewares: new Map<string, unknown[]>() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validation: { parse(x: unknown): unknown } | undefined;
    let mw: unknown[] = [];
    const b = {
      middleware: (m: unknown[]) => ((mw = m), b),
      validator: (v: { parse(x: unknown): unknown }) => ((validation = v), b),
      handler: (fn: (a: { data: unknown; context: unknown }) => unknown) => {
        const appel = (entree?: { data?: unknown; context?: unknown }) =>
          fn({
            data: validation ? validation.parse(entree?.data) : entree?.data,
            context: entree?.context,
          });
        appel.middleware = mw;
        return appel;
      },
    };
    return b;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ headers: new Headers({ "cf-connecting-ip": "203.0.113.7" }) }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { nom: "auth" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return etat.bd;
  },
}));

const f = await import("./formulaires.functions");

const contexte = (acteur: Record<string, unknown> | null) => ({
  supabase: { rpc: vi.fn(async () => moi(acteur)) },
  userId: (acteur?.["utilisateur_id"] as string) ?? "inconnu",
});
const appeler = (fn: unknown, data: unknown, acteur?: Record<string, unknown> | null) =>
  (fn as (e: unknown) => Promise<{ ok: boolean; [k: string]: unknown }>)({
    data,
    context: acteur === undefined ? undefined : contexte(acteur),
  });

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("authentification des fonctions", () => {
  it("l'envoi exige le middleware d'authentification ; les 4 pages publiques n'en ont aucun", () => {
    const mw = (fn: unknown) => (fn as { middleware: unknown[] }).middleware;
    expect(mw(f.envoyerFormulaireApprenant)).toHaveLength(1);
    for (const publique of [
      f.lireFormulaire,
      f.enregistrerBrouillon,
      f.signerFormulaire,
      f.pdfFormulaire,
    ])
      expect(mw(publique)).toHaveLength(0);
  });
});

describe("envoi (route 101)", () => {
  const donnees = { dossier_id: "d1", stagiaire_id: "s1", type: "recueil" };

  it("l'apprenant ne s'envoie pas de formulaire : 403, aucune écriture", async () => {
    const { bd, appels } = fauxBd();
    etat.bd = bd;
    (bd.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(moi(ACTEURS.apprenant));
    const r = await appeler(f.envoyerFormulaireApprenant, donnees, ACTEURS.apprenant);
    expect(r).toMatchObject({ ok: false, statut: 403, code: "interdit" });
    expect(appels.filter((a: Appel) => a.op !== "select")).toHaveLength(0);
  });

  it("type inconnu : refusé par la validation, avant tout accès à la base", () => {
    expect(() =>
      appeler(f.envoyerFormulaireApprenant, { ...donnees, type: "piratage" }, ACTEURS.admin),
    ).toThrow();
  });

  it("dossier inconnu ou d'un autre formateur : 404", async () => {
    const { bd } = fauxBd();
    etat.bd = bd;
    const r = await appeler(f.envoyerFormulaireApprenant, donnees, ACTEURS.formateurValide);
    expect(r).toMatchObject({ ok: false, statut: 404, code: "introuvable" });
  });
});

describe("pages publiques (sans JWT)", () => {
  it("jeton trop court : refusé par la validation", () => {
    expect(() => appeler(f.lireFormulaire, { jeton: "court" })).toThrow();
  });

  it("jeton inconnu : résultat typé 404 (pas d'exception, pas de détail)", async () => {
    const { bd } = fauxBd();
    etat.bd = bd;
    const r = await appeler(f.lireFormulaire, { jeton: "b".repeat(40) });
    expect(r).toMatchObject({ ok: false, statut: 404, code: "introuvable" });
    expect(String(r["message"])).toMatch(/n'est plus valable/);
  });

  it("jeton expiré : 404 avec message d'expiration", async () => {
    const { bd } = fauxBd((a: Appel) =>
      a.table === "formulaire_apprenant" && a.op === "select"
        ? {
            data: [
              {
                id: "fa1",
                statut: "envoye",
                expire_le: "2020-01-01T00:00:00Z",
                stagiaire_id: "s1",
              },
            ],
          }
        : undefined,
    );
    etat.bd = bd;
    const r = await appeler(f.signerFormulaire, { jeton: "b".repeat(40), corps: {} });
    expect(r).toMatchObject({ ok: false, statut: 404 });
    expect(String(r["message"])).toMatch(/expiré/);
  });

  it("jeton déjà utilisé : la signature est refusée (409)", async () => {
    const { bd } = fauxBd((a: Appel) => {
      if (a.op !== "select") return undefined;
      if (a.table === "formulaire_apprenant")
        return {
          data: [
            {
              id: "fa1",
              dossier_id: "d1",
              stagiaire_id: "s1",
              type: "recueil",
              statut: "complet",
              expire_le: "2020-01-01T00:00:00Z",
            },
          ],
        };
      if (a.table === "stagiaire") return { data: [{ id: "s1" }] };
      if (a.table === "dossier_formation")
        return { data: [{ id: "d1", sous_statut: "brouillon" }] };
      return undefined;
    });
    etat.bd = bd;
    const r = await appeler(f.signerFormulaire, { jeton: "b".repeat(40), corps: {} });
    expect(r).toMatchObject({ ok: false, statut: 409, code: "conflit" });
  });
});
