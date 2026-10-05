// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, aFiltre, fauxBd, moi, type Appel } from "@/test/faux-supabase";
import { ENJEUX_SIMULES, qcmSimule, reponseApi, simulerReseauIa } from "@/test/reponses-ia";

const etat = vi.hoisted(() => ({ service: null as unknown }));
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
    return etat.service;
  },
}));

const fns = await import("./pedagogie-ia.functions");

type Acteur = Record<string, unknown> | null;
type Retour = { ok: boolean; [k: string]: unknown };

const FORMATION = {
  id: "fo1",
  of_id: "of1",
  formateur_id: "f1",
  formation_titre: "Soudage TIG",
  formation_objectifs: "Souder en TIG\nContrôler un cordon",
  formation_niveau: "Débutant",
  formation_prerequis: "",
  formation_modalite: "presentiel",
  formation_duree_heures_total: 14,
  formation_modules: [],
  public_vise: "",
  programme: "Jour 1 : bases",
  dossier_enjeux: null as unknown,
};

function monter(
  acteur: Acteur,
  options: { formation?: Record<string, unknown> | null; reglages?: Record<string, string> } = {},
) {
  const formation = options.formation === undefined ? FORMATION : options.formation;
  const service = fauxBd((a: Appel) => {
    if (a.table === "reglage")
      return {
        data: Object.entries(options.reglages ?? {}).map(([cle, valeur]) => ({ cle, valeur })),
      };
    if (a.table === "formation" && a.op === "select") {
      // Cloisonnement : la fonction doit filtrer sur l'organisme ET le formateur de l'ACTEUR.
      const ok =
        formation && aFiltre(a, "eq", "of_id", "of1") && aFiltre(a, "eq", "formateur_id", "f1");
      return { data: ok ? [formation] : [] };
    }
    return undefined;
  });
  etat.service = service.bd;
  const utilisateur = fauxBd((a: Appel) =>
    a.table === "formation" && a.op === "update" ? { data: [{ id: "fo1" }] } : undefined,
  );
  utilisateur.bd.rpc.mockImplementation(async () => moi(acteur));
  const contexte = {
    supabase: utilisateur.bd,
    userId: (acteur?.["utilisateur_id"] as string) ?? "x",
  };
  const appeler = (fn: unknown, data?: unknown) =>
    (fn as (e: unknown) => Promise<Retour>)({ data, context: contexte });
  return { service, utilisateur, appeler };
}

const ecrituresService = (m: ReturnType<typeof monter>) =>
  m.service.appels.filter((a) => a.op !== "select");
const sansJournal = (appels: Appel[]) => appels.filter((a) => a.table !== "evenement");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const n of [
    "ANTHROPIC_API_KEY",
    "IA_MODELE",
    "IA_WORKSPACE_ID",
    "IA_RECHERCHE_WEB",
    "CLE_SECRETS",
  ])
    vi.stubEnv(n, "");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-secret-de-test");
  vi.stubEnv("IA_MODELE", "modele-de-test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CORPS = {
  qcm: { formation_id: "fo1", type: "acquis", nombre: 5 },
  programme: { formation_titre: "Soudage TIG", formation_duree_heures_total: 14 },
  parcours: { titre: "Soudage TIG", heures: 14, nb_modules: 2 },
  enjeux: { formation_id: "fo1" },
  plan: { formation_id: "fo1", module_index: 0 },
};
const FONCTIONS: Array<[string, () => unknown, unknown]> = [
  ["proposerQcm", () => fns.proposerQcm, CORPS.qcm],
  ["proposerProgramme", () => fns.proposerProgramme, CORPS.programme],
  ["proposerParcours", () => fns.proposerParcours, CORPS.parcours],
  ["analyserEnjeux", () => fns.analyserEnjeux, CORPS.enjeux],
  ["proposerPlanSupport", () => fns.proposerPlanSupport, CORPS.plan],
];

describe("refus par rôle (l'IA est réservée au formateur validé)", () => {
  for (const [nom, fn, corps] of FONCTIONS) {
    for (const [role, acteur] of [
      ["administrateur", ACTEURS.admin],
      ["apprenant", ACTEURS.apprenant],
      ["candidat non validé", ACTEURS.candidat],
    ] as const) {
      it(`${nom} : ${role} → 403 en français, aucun appel IA, aucune écriture`, async () => {
        const { faux } = simulerReseauIa();
        const m = monter({ ...acteur });
        const r = await m.appeler(fn(), corps);
        expect(r).toMatchObject({ ok: false, code: "interdit", statut: 403 });
        expect(String(r["message"])).toMatch(
          /réservée aux formateurs|candidature doit être validée/,
        );
        expect(faux).not.toHaveBeenCalled();
        expect(m.service.appels).toEqual([]);
        expect(m.utilisateur.appels).toEqual([]);
      });
    }
    it(`${nom} : sans profil actif → 401`, async () => {
      const m = monter(null);
      expect(await m.appeler(fn(), corps)).toMatchObject({ ok: false, statut: 401 });
    });
  }
});

describe("état de l'assistant (route 57)", () => {
  it("formateur avec une clé : disponible, avec le moteur (jamais la clé)", async () => {
    simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide });
    const r = await m.appeler(fns.lireEtatIa);
    expect(r).toEqual({
      ok: true,
      donnees: { disponible: true, description: "modele-de-test + recherche web" },
    });
    expect(JSON.stringify(r)).not.toContain("sk-secret-de-test");
  });
  it("sans clé : indisponible, sans plantage", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const m = monter({ ...ACTEURS.formateurValide });
    expect(await m.appeler(fns.lireEtatIa)).toEqual({
      ok: true,
      donnees: { disponible: false, description: "" },
    });
  });
  it("administrateur ou apprenant : « indisponible » sans erreur (comme l'ancien serveur)", async () => {
    for (const a of [ACTEURS.admin, ACTEURS.apprenant]) {
      const m = monter({ ...a });
      expect(await m.appeler(fns.lireEtatIa)).toEqual({
        ok: true,
        donnees: { disponible: false, description: "" },
      });
    }
  });
});

describe("clé absente : message français clair, pas de plantage", () => {
  for (const [nom, fn, corps] of FONCTIONS) {
    it(nom, async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      const { faux } = simulerReseauIa();
      const m = monter({ ...ACTEURS.formateurValide });
      const r = await m.appeler(fn(), corps);
      expect(r).toMatchObject({ ok: false, code: "conflit", statut: 409 });
      expect(String(r["message"])).toMatch(/L'assistant IA n'est pas configuré/);
      expect(String(r["message"])).toMatch(/Organisme → Assistant IA/);
      expect(faux).not.toHaveBeenCalled();
      expect(sansJournal(ecrituresService(m))).toEqual([]);
      expect(m.utilisateur.appels).toEqual([]);
    });
  }
});

describe("aucune écriture sans l'accord du formateur (les propositions ne sont que des brouillons)", () => {
  it("QCM, programme, parcours et plan de support : brouillon renvoyé, rien d'enregistré", async () => {
    const { appels } = simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide });
    const qcm = await m.appeler(fns.proposerQcm, CORPS.qcm);
    const programme = await m.appeler(fns.proposerProgramme, CORPS.programme);
    const parcours = await m.appeler(fns.proposerParcours, CORPS.parcours);
    const plan = await m.appeler(fns.proposerPlanSupport, CORPS.plan);
    expect(qcm).toMatchObject({ ok: true, donnees: { brouillon: true, source: "ia" } });
    expect(programme).toMatchObject({ ok: true, donnees: { brouillon: true } });
    expect(parcours).toMatchObject({ ok: true, donnees: { brouillon: true, source: "ia" } });
    expect(plan).toMatchObject({ ok: true, donnees: { source: "ia" } });
    expect(appels.length).toBeGreaterThanOrEqual(4);

    // Les seules écritures du serveur sont des lignes de journal (`evenement`), jamais la formation, les
    // questionnaires, le coffre-fort ni les versions ; et rien n'est écrit avec le jeton du formateur.
    const ecritures = ecrituresService(m);
    expect(ecritures.length).toBeGreaterThan(0);
    expect(ecritures.every((a) => a.table === "evenement" && a.op === "insert")).toBe(true);
    expect(ecritures.every((a) => (a.valeurs as { type: string }).type === "ia_appel")).toBe(true);
    expect(m.utilisateur.appels).toEqual([]);
  });

  it("le dossier d'enjeux d'une formation qui n'en a pas est constitué pour l'appel, jamais enregistré", async () => {
    const { appels } = simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide });
    await m.appeler(fns.proposerQcm, CORPS.qcm);
    // 1 appel d'enjeux (recherche web) + 1 appel de QCM ; aucune écriture de formation.
    expect(appels).toHaveLength(2);
    expect(m.service.appels.some((a) => a.table === "formation" && a.op !== "select")).toBe(false);
    expect(m.utilisateur.appels).toEqual([]);
  });

  it("un dossier d'enjeux déjà enregistré est réutilisé : un seul appel d'IA", async () => {
    const { appels } = simulerReseauIa();
    const m = monter(
      { ...ACTEURS.formateurValide },
      { formation: { ...FORMATION, dossier_enjeux: ENJEUX_SIMULES } },
    );
    await m.appeler(fns.proposerPlanSupport, CORPS.plan);
    expect(appels).toHaveLength(1);
  });

  it("le parcours d'une nouvelle formation renvoie son dossier d'enjeux au lieu de l'enregistrer", async () => {
    simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide });
    const r = (await m.appeler(fns.proposerParcours, CORPS.parcours)) as unknown as {
      donnees: { dossier_enjeux: unknown; modules: unknown[] };
    };
    expect(r.donnees.dossier_enjeux).toMatchObject({ resume: ENJEUX_SIMULES.resume });
    expect(r.donnees.modules).toHaveLength(2);
    expect(sansJournal(ecrituresService(m))).toEqual([]);
  });
});

describe("analyse des enjeux (route 61) : l'écriture est cloisonnée et tracée", () => {
  it("écrit le dossier avec le jeton du formateur (RLS), complète public/prérequis vides, journalise", async () => {
    simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide });
    const r = (await m.appeler(fns.analyserEnjeux, CORPS.enjeux)) as unknown as {
      ok: true;
      donnees: { enjeux: typeof ENJEUX_SIMULES; enjeux_le: string };
    };
    expect(r.ok).toBe(true);
    expect(r.donnees.enjeux.resume).toBe(ENJEUX_SIMULES.resume);
    expect(typeof r.donnees.enjeux_le).toBe("string");

    const maj = m.utilisateur.appels.filter((a) => a.op === "update");
    expect(maj).toHaveLength(1);
    expect(maj[0]).toMatchObject({ table: "formation" });
    expect(aFiltre(maj[0]!, "eq", "id", "fo1")).toBe(true);
    expect(maj[0]!.valeurs).toMatchObject({
      public_vise: ENJEUX_SIMULES.public_vise,
      formation_prerequis: ENJEUX_SIMULES.prerequis,
    });
    expect(
      (maj[0]!.valeurs as { dossier_enjeux: { sources: unknown[] } }).dossier_enjeux.sources,
    ).not.toHaveLength(0);
    // Le service n'écrit que le journal.
    expect(ecrituresService(m).map((a) => (a.valeurs as { type: string }).type)).toEqual([
      "ia_appel",
      "enjeux_analyses",
    ]);
  });

  it("garde le public visé déjà saisi", async () => {
    simulerReseauIa();
    const m = monter(
      { ...ACTEURS.formateurValide },
      {
        formation: { ...FORMATION, public_vise: "Soudeurs confirmés", formation_prerequis: "CAP" },
      },
    );
    await m.appeler(fns.analyserEnjeux, CORPS.enjeux);
    const maj = m.utilisateur.appels.find((a) => a.op === "update")!;
    expect(maj.valeurs).toMatchObject({
      public_vise: "Soudeurs confirmés",
      formation_prerequis: "CAP",
    });
  });

  it("la formation d'un autre formateur : 404, aucun appel d'IA, aucune écriture", async () => {
    const { faux } = simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide }, { formation: null });
    const r = await m.appeler(fns.analyserEnjeux, { formation_id: "fo-autre" });
    expect(r).toMatchObject({ ok: false, code: "introuvable", statut: 404 });
    expect(faux).not.toHaveBeenCalled();
    expect(m.utilisateur.appels).toEqual([]);
  });

  it("si la RLS refuse l'écriture (0 ligne) : 404, pas de journal « enjeux_analyses »", async () => {
    simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide });
    (m.utilisateur.bd.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const b: Record<string, unknown> = {};
      for (const k of ["update", "eq", "select"]) b[k] = () => b;
      b["then"] = (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(ok);
      return b;
    });
    const r = await m.appeler(fns.analyserEnjeux, CORPS.enjeux);
    expect(r).toMatchObject({ ok: false, code: "introuvable", statut: 404 });
    expect(
      ecrituresService(m).some((a) => (a.valeurs as { type: string }).type === "enjeux_analyses"),
    ).toBe(false);
  });
});

describe("cloisonnement : l'acteur ne vient jamais du corps", () => {
  it("un of_id, un formateur_id ou un rôle glissés dans le corps sont ignorés", async () => {
    simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide });
    const r = await m.appeler(fns.proposerPlanSupport, {
      ...CORPS.plan,
      of_id: "of-autre",
      formateur_id: "f-autre",
      role: "admin",
      utilisateur_id: "u-autre",
    });
    expect(r.ok).toBe(true);
    const lecture = m.service.appels.find((a) => a.table === "formation")!;
    expect(aFiltre(lecture, "eq", "of_id", "of1")).toBe(true);
    expect(aFiltre(lecture, "eq", "formateur_id", "f1")).toBe(true);
    for (const e of ecrituresService(m)) {
      expect(e.valeurs).toMatchObject({ of_id: "of1", acteur_id: "u-form" });
    }
  });

  it("proposerQcm sur la formation d'un autre : 404 sans appel d'IA", async () => {
    const { faux } = simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide }, { formation: null });
    expect(await m.appeler(fns.proposerQcm, CORPS.qcm)).toMatchObject({
      ok: false,
      statut: 404,
    });
    expect(faux).not.toHaveBeenCalled();
  });
});

describe("appel de l'IA : modèle, journal, validation", () => {
  it("envoie le modèle du secret IA_MODELE et journalise l'usage sans jamais écrire la clé", async () => {
    const { appels } = simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide });
    await m.appeler(fns.proposerProgramme, CORPS.programme);
    expect(appels[0]!.corps["model"]).toBe("modele-de-test");
    expect(appels[0]!.entetes["x-api-key"]).toBe("sk-secret-de-test");
    const journal = ecrituresService(m)[0]!.valeurs as { type: string; detail: unknown };
    expect(journal.type).toBe("ia_appel");
    expect(journal.detail).toMatchObject({ tokens_entree: 100, tokens_sortie: 200 });
    expect(JSON.stringify(ecrituresService(m))).not.toContain("sk-secret-de-test");
  });

  it("une réponse mal formée déclenche une seconde tentative, puis une erreur si elle reste invalide", async () => {
    const { faux } = simulerReseauIa(() => ({ n_importe_quoi: true }));
    const m = monter({ ...ACTEURS.formateurValide });
    const r = await m.appeler(fns.proposerProgramme, CORPS.programme);
    expect(r).toMatchObject({ ok: false, code: "invalide", statut: 400 });
    expect(String(r["message"])).toMatch(/pas exploitable/);
    expect(faux).toHaveBeenCalledTimes(2);
  });

  it("première réponse invalide, seconde valide : la proposition est renvoyée", async () => {
    let n = 0;
    simulerReseauIa((_c, demande) => {
      if (/choix multiples/i.test(demande))
        return ++n === 1 ? { titre: "x", questions: [] } : qcmSimule(5);
      return undefined;
    });
    const m = monter(
      { ...ACTEURS.formateurValide },
      { formation: { ...FORMATION, dossier_enjeux: ENJEUX_SIMULES } },
    );
    const r = await m.appeler(fns.proposerQcm, CORPS.qcm);
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
  });

  it("échec de l'API (401) : message français, échec journalisé, rien d'autre", async () => {
    simulerReseauIa(
      () =>
        new Response(JSON.stringify({ error: { message: "détail-de-compte" } }), { status: 401 }),
    );
    const m = monter({ ...ACTEURS.formateurValide });
    const r = await m.appeler(fns.proposerProgramme, CORPS.programme);
    expect(r).toMatchObject({ ok: false, code: "conflit", statut: 409 });
    expect(String(r["message"])).toMatch(/Clé d'API IA refusée/);
    expect(String(r["message"])).not.toContain("détail-de-compte");
    expect(ecrituresService(m).map((a) => (a.valeurs as { type: string }).type)).toEqual([
      "ia_echec",
    ]);
  });

  it("entrées invalides : 400 avec le message du champ", async () => {
    const { faux } = simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide });
    expect(await m.appeler(fns.proposerQcm, { ...CORPS.qcm, nombre: 99 })).toMatchObject({
      ok: false,
      code: "invalide",
      statut: 400,
    });
    expect(
      await m.appeler(fns.proposerParcours, { titre: "Soudage TIG", nb_modules: 2 }),
    ).toMatchObject({ ok: false, message: "Indiquez la durée en heures." });
    expect(
      await m.appeler(fns.proposerParcours, { titre: "Soudage TIG", heures: 1, nb_modules: 6 }),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/demi-heure/) });
    expect(
      await m.appeler(fns.proposerPlanSupport, { formation_id: "fo1", module_index: 5 }),
    ).toMatchObject({ ok: false, message: "Ce module n'existe pas dans le parcours." });
    expect(faux).not.toHaveBeenCalled();
  });

  it("une formation sans objectifs, programme ni parcours : l'IA demande de les renseigner d'abord", async () => {
    const { faux } = simulerReseauIa();
    const m = monter(
      { ...ACTEURS.formateurValide },
      { formation: { ...FORMATION, formation_objectifs: "", programme: "" } },
    );
    expect(await m.appeler(fns.proposerQcm, CORPS.qcm)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Renseignez d'abord/),
    });
    expect(faux).not.toHaveBeenCalled();
  });

  it("n'envoie que la description de la formation : jamais de donnée d'apprenant ni d'identifiant interne", async () => {
    const { appels } = simulerReseauIa();
    const m = monter({ ...ACTEURS.formateurValide });
    await m.appeler(fns.proposerQcm, CORPS.qcm);
    const envoye = JSON.stringify(appels.map((a) => a.corps));
    expect(envoye).toContain("Soudage TIG");
    for (const interdit of ["of1", "f1", "u-form", "fred@of.fr", "Fred Formateur"])
      expect(envoye).not.toContain(interdit);
  });
});
