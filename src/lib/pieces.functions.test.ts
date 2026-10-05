// @vitest-environment node
/** Fonctions serveur des pièces : l'acteur vient du jeton de session ; refus par rôle ; cloisonnement. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, aFiltre, fauxBd, moi, type Appel } from "@/test/faux-supabase";

const etat = vi.hoisted(() => ({ bd: null as unknown }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validation: { parse(x: unknown): unknown } | { (x: unknown): unknown } | undefined;
    const b = {
      middleware: () => b,
      validator: (v: typeof validation) => ((validation = v), b),
      handler:
        (fn: (a: { data: unknown; context: unknown }) => unknown) =>
        (entree?: { data?: unknown; context?: unknown }) =>
          fn({
            data: !validation
              ? entree?.data
              : typeof validation === "function"
                ? validation(entree?.data)
                : validation.parse(entree?.data),
            context: entree?.context,
          }),
    };
    return b;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ headers: new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }) }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return etat.bd;
  },
}));

const p = await import("./pieces.functions");

const contexte = (acteur: Record<string, unknown> | null) => ({
  supabase: { rpc: vi.fn(async () => moi(acteur)) },
  userId: (acteur?.["utilisateur_id"] as string) ?? "inconnu",
});
const appeler = (fn: unknown, data: unknown, acteur: Record<string, unknown> | null) =>
  (fn as (e: unknown) => Promise<{ ok: boolean; [k: string]: unknown }>)({
    data,
    context: contexte(acteur),
  });

const PIECE = {
  id: "p1",
  dossier_id: "d1",
  code: "00-AVT",
  stagiaire_id: "s1",
  statut: "a_signer",
};
const DOSSIER = { id: "d1", of_id: "of1", formateur_id: "f1", sous_statut: "brouillon" };
function monde(piece: unknown = PIECE, dossier: unknown = DOSSIER) {
  const faux = fauxBd((a: Appel) => {
    if (a.op !== "select") return undefined;
    if (a.table === "piece_dossier") return { data: piece ? [piece] : [] };
    if (a.table === "dossier_formation") return { data: dossier ? [dossier] : [] };
    return undefined;
  });
  etat.bd = faux.bd;
  return faux;
}
const TRACE = "data:image/png;base64," + "A".repeat(800);

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("acteur et cloisonnement", () => {
  it("sans profil actif : 401, rien n'est lu", async () => {
    const { appels } = monde();
    const r = await appeler(p.integritePieceDossier, { piece_id: "p1" }, null);
    expect(r).toMatchObject({ ok: false, statut: 401 });
    expect(appels).toHaveLength(0);
  });

  it("pièce d'un dossier d'un autre formateur : 404 (jamais 403)", async () => {
    monde(PIECE, { ...DOSSIER, formateur_id: "autre" });
    const r = await appeler(p.integritePieceDossier, { piece_id: "p1" }, ACTEURS.formateurValide);
    expect(r).toMatchObject({ ok: false, statut: 404, code: "introuvable" });
  });

  it("pièce inconnue : 404", async () => {
    monde(null);
    const r = await appeler(p.apercuPieceDossier, { piece_id: "zz" }, ACTEURS.admin);
    expect(r).toMatchObject({ ok: false, statut: 404 });
  });

  it("l'acteur ne vient jamais du corps : `role` et `of_id` du corps sont ignorés, le filtre est celui du jeton", async () => {
    const { appels } = monde();
    await appeler(
      p.integritePieceDossier,
      { piece_id: "p1", role: "admin", of_id: "autre-of" },
      ACTEURS.formateurValide,
    );
    const lecture = appels.find((a) => a.table === "dossier_formation")!;
    expect(aFiltre(lecture, "eq", "of_id", "of1")).toBe(true);
    expect(JSON.stringify(appels)).not.toContain("autre-of");
  });
});

describe("refus par rôle", () => {
  it("l'administrateur ne signe pas (403)", async () => {
    monde();
    const r = await appeler(
      p.signerPieceDossier,
      { piece_id: "p1", trace_png: TRACE, lieu: "Lyon", consentement: true },
      ACTEURS.admin,
    );
    expect(r).toMatchObject({ ok: false, statut: 403, code: "interdit" });
  });

  it("l'apprenant ne régénère pas (403)", async () => {
    monde();
    const r = await appeler(p.regenererPieceDossier, { piece_id: "p1" }, ACTEURS.apprenant);
    expect(r).toMatchObject({ ok: false, statut: 403 });
  });

  it("l'apprenant n'obtient pas la trame de facture du formateur (403)", async () => {
    monde();
    const r = await appeler(p.trameFactureDossier, { dossier_id: "d1" }, ACTEURS.apprenant);
    expect(r).toMatchObject({ ok: false, statut: 403 });
  });

  it("un formateur n'enregistre pas un questionnaire à la place de l'apprenant (403)", async () => {
    monde();
    const r = await appeler(
      p.enregistrerQuestionnaire,
      { dossier_id: "d1", type: "acquis", reponses: [0] },
      ACTEURS.formateurValide,
    );
    expect(r).toMatchObject({ ok: false, statut: 403 });
  });

  it("type de questionnaire inconnu : 400", async () => {
    monde();
    const r = await appeler(
      p.enregistrerQuestionnaire,
      { dossier_id: "d1", type: "nimporte", reponses: [] },
      ACTEURS.apprenant,
    );
    expect(r).toMatchObject({ ok: false, statut: 400 });
  });

  it("dépôt sans fichier : 400", async () => {
    monde();
    const form = new FormData();
    form.set("piece_id", "p1");
    const r = await appeler(p.deposerPieceDossier, form, ACTEURS.formateurValide);
    expect(r).toMatchObject({ ok: false, statut: 400 });
  });

  it("dépôt d'un corps qui n'est pas un FormData : refusé par la validation", () => {
    expect(() =>
      appeler(p.deposerPieceDossier, { piece_id: "p1" }, ACTEURS.formateurValide),
    ).toThrow();
  });
});
