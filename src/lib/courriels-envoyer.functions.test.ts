// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, aFiltre, fauxBd, moi, type Appel } from "@/test/faux-supabase";

const etat = vi.hoisted(() => ({ bd: null as unknown }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validation: { parse(x: unknown): unknown } | undefined;
    const b = {
      middleware: () => b,
      validator: (v: { parse(x: unknown): unknown }) => ((validation = v), b),
      handler:
        (fn: (a: { data: unknown; context: unknown }) => unknown) =>
        (entree?: { data?: unknown; context?: unknown }) =>
          fn({
            data: validation ? validation.parse(entree?.data) : entree?.data,
            context: entree?.context,
          }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return etat.bd;
  },
}));

const { envoyerCourrielTest, renvoyerCourrier } = await import("./courriels-envoyer.functions");

type Acteur = Record<string, unknown>;
const appeler = (fn: unknown, acteur: Acteur, data?: unknown) =>
  (fn as (e: unknown) => Promise<{ ok: boolean; [k: string]: unknown }>)({
    data,
    context: {
      supabase: { rpc: vi.fn(async () => moi(acteur)) },
      userId: acteur["utilisateur_id"],
    },
  });

const COURRIER = {
  id: "c1",
  of_id: "of1",
  dossier_id: "d1",
  formateur_id: "f1",
  type: "invitation_apprenant",
  destinataire: "anne@of.fr",
  sujet: "Votre espace",
  corps_html: "<p>x</p>",
  pieces_jointes: [{ nom: "a.pdf", chemin: "of1/dossiers/ADF/a.pdf" }, { nom: 3 }, null],
};

function scenario(courrier: Record<string, unknown> | null = COURRIER, dossierFormateur = "f1") {
  const faux = fauxBd((a: Appel) => {
    if (a.table === "courrier" && a.op === "select") return { data: courrier ? [courrier] : [] };
    if (a.table === "dossier_formation") return { data: [{ formateur_id: dossierFormateur }] };
    return undefined;
  });
  etat.bd = faux.bd;
  return faux;
}
const insertCourrier = (appels: Appel[]) =>
  appels.filter((a) => a.table === "courrier" && a.op === "insert");

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("envoyerCourrielTest (route 32)", () => {
  it("refuse tout autre rôle que l'administrateur", async () => {
    for (const a of [ACTEURS.formateurValide, ACTEURS.candidat, ACTEURS.apprenant]) {
      const { appels } = scenario();
      expect(await appeler(envoyerCourrielTest, a)).toMatchObject({
        ok: false,
        code: "interdit",
        statut: 403,
      });
      expect(appels).toHaveLength(0);
    }
  });

  it("sans clé d'envoi : rien ne part, le test est consigné, et la réponse l'explique", async () => {
    const { appels } = scenario();
    const r = await appeler(envoyerCourrielTest, ACTEURS.admin);
    expect(r).toMatchObject({
      ok: true,
      donnees: { statut: "journalise", erreur: "", actif: false, destinataire: "admin@of.fr" },
    });
    expect((r["donnees"] as { info: string }).info).toContain("RESEND_API_KEY");
    expect(insertCourrier(appels)[0]!.valeurs).toMatchObject({
      type: "test_smtp",
      destinataire: "admin@of.fr",
      statut: "journalise",
    });
  });

  it("avec clé et expéditeur : part par l'API et revient « envoye »", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_x");
    vi.stubEnv("COURRIER_EXPEDITEUR", "no-reply@of.fr");
    const appelHttp = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", appelHttp);
    scenario();
    const r = await appeler(envoyerCourrielTest, ACTEURS.admin);
    expect(r).toMatchObject({ ok: true, donnees: { statut: "envoye", actif: true } });
    expect(appelHttp).toHaveBeenCalledTimes(1);
  });
});

describe("renvoyerCourrier (route 34)", () => {
  it("refuse un apprenant et un formateur non validé, sans lire la base", async () => {
    for (const a of [ACTEURS.apprenant, ACTEURS.candidat]) {
      const { appels } = scenario();
      expect(await appeler(renvoyerCourrier, a, { courrier_id: "c1" })).toMatchObject({
        ok: false,
        code: "interdit",
        statut: 403,
      });
      expect(appels).toHaveLength(0);
    }
  });

  it("l'administrateur renvoie : nouvelle ligne identique, pièces jointes mal formées écartées", async () => {
    const { appels } = scenario();
    const r = await appeler(renvoyerCourrier, ACTEURS.admin, { courrier_id: "c1" });
    expect(r).toMatchObject({ ok: true, donnees: { statut: "journalise" } });
    const [lecture] = appels.filter((a) => a.op === "select" && a.table === "courrier");
    expect(aFiltre(lecture!, "eq", "of_id", "of1")).toBe(true);
    const [nouveau] = insertCourrier(appels);
    expect(nouveau!.valeurs).toMatchObject({
      type: "invitation_apprenant",
      destinataire: "anne@of.fr",
      sujet: "Votre espace",
      dossier_id: "d1",
      formateur_id: "f1",
      pieces_jointes: [{ nom: "a.pdf", chemin: "of1/dossiers/ADF/a.pdf" }],
    });
  });

  it("un courrier d'un autre organisme est « introuvable »", async () => {
    scenario(null);
    expect(
      await appeler(renvoyerCourrier, ACTEURS.admin, { courrier_id: "c-ailleurs" }),
    ).toMatchObject({
      ok: false,
      code: "introuvable",
      statut: 404,
    });
  });

  it("un formateur renvoie les courriers de ses dossiers ou les siens, jamais ceux d'un autre", async () => {
    // Courrier du formateur f1 lui-même.
    scenario();
    expect(
      (await appeler(renvoyerCourrier, ACTEURS.formateurValide, { courrier_id: "c1" }))["ok"],
    ).toBe(true);
    // Courrier d'un autre formateur sur un dossier du même formateur (f1).
    scenario({ ...COURRIER, formateur_id: null }, "f1");
    expect(
      (await appeler(renvoyerCourrier, ACTEURS.formateurValide, { courrier_id: "c1" }))["ok"],
    ).toBe(true);
    // Courrier d'un autre formateur, dossier d'un autre formateur : introuvable, rien d'envoyé.
    const { appels } = scenario({ ...COURRIER, formateur_id: "f9" }, "f9");
    expect(
      await appeler(renvoyerCourrier, ACTEURS.formateurValide, { courrier_id: "c1" }),
    ).toMatchObject({
      ok: false,
      code: "introuvable",
    });
    expect(insertCourrier(appels)).toHaveLength(0);
  });

  it("un courrier sans dossier d'un autre formateur : introuvable", async () => {
    scenario({ ...COURRIER, dossier_id: null, formateur_id: "f9" });
    expect(
      await appeler(renvoyerCourrier, ACTEURS.formateurValide, { courrier_id: "c1" }),
    ).toMatchObject({
      ok: false,
      code: "introuvable",
    });
  });
});
