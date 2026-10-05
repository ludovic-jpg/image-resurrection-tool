// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { ACTEURS, aFiltre, fauxBd, moi, type Appel } from "@/test/faux-supabase";
import { diaposSimulees } from "@/test/reponses-ia";

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

const { produireSupport } = await import("./supports.functions");

type Retour = { ok: boolean; [k: string]: unknown };
const MODULES = [
  {
    titre: "Les bases du TIG",
    duree_heures: 7,
    objectifs: ["Régler le poste"],
    contenus: ["Gaz", "Électrode"],
    methodes: "Démonstration",
    mise_en_pratique: "Atelier",
    evaluation: "Quiz",
  },
  {
    titre: "Contrôle des cordons",
    duree_heures: 7,
    objectifs: ["Contrôler"],
    contenus: ["Défauts"],
    methodes: "",
    mise_en_pratique: "",
    evaluation: "",
  },
];
const FORMATION = {
  id: "fo1",
  of_id: "of1",
  formateur_id: "f1",
  formation_titre: "Soudage TIG",
  formation_objectifs: "Souder",
  formation_modules: MODULES,
  programme: "",
  dossier_enjeux: null,
};

function monter(acteur: Record<string, unknown> | null, formation: unknown = FORMATION) {
  const service = fauxBd((a: Appel) => {
    if (a.table === "formation" && a.op === "select") {
      const ok =
        formation && aFiltre(a, "eq", "of_id", "of1") && aFiltre(a, "eq", "formateur_id", "f1");
      return { data: ok ? [formation] : [] };
    }
    if (a.table === "organisme_formation")
      return { data: [{ of_nom: "Mon OF", couleur: "#1d6a45" }] };
    return undefined;
  });
  etat.service = service.bd;
  service.bd.rpc.mockImplementation(async () => moi(acteur));
  const contexte = { supabase: service.bd, userId: (acteur?.["utilisateur_id"] as string) ?? "x" };
  const appeler = (data?: unknown) =>
    (produireSupport as unknown as (e: unknown) => Promise<Retour>)({ data, context: contexte });
  return { service, appeler };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CORPS = { formation_id: "fo1", module_index: 0, diapos: diaposSimulees() };

describe("produireSupport (route 64)", () => {
  for (const [role, acteur] of [
    ["administrateur", ACTEURS.admin],
    ["apprenant", ACTEURS.apprenant],
    ["candidat non validé", ACTEURS.candidat],
  ] as const) {
    it(`${role} : 403 en français, aucune écriture`, async () => {
      const m = monter({ ...acteur });
      expect(await m.appeler(CORPS)).toMatchObject({ ok: false, code: "interdit", statut: 403 });
      expect(m.service.appels).toEqual([]);
      expect(m.service.stockage.upload).not.toHaveBeenCalled();
    });
  }

  it("produit un vrai PPTX, le dépose dans le coffre (bucket coffre), enregistre la ligne et journalise", async () => {
    const m = monter({ ...ACTEURS.formateurValide });
    const r = (await m.appeler(CORPS)) as unknown as {
      ok: true;
      donnees: { id: string; nom: string; diapositives: number };
    };
    expect(r.ok).toBe(true);
    expect(r.donnees).toMatchObject({
      nom: "Support — Module 1 — Les bases du TIG.pptx",
      diapositives: 20,
    });

    // Fichier : bucket « coffre », chemin sous l'organisme et la formation, contenu = archive ZIP (PPTX) de 20 diapos.
    expect(m.service.bd.storage.from).toHaveBeenCalledWith("coffre");
    expect(m.service.stockage.upload).toHaveBeenCalledTimes(1);
    const [chemin, contenu, options] = m.service.stockage.upload.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      { contentType: string },
    ];
    expect(chemin.startsWith("of1/coffres/fo1/")).toBe(true);
    expect(options.contentType).toContain("presentationml.presentation");
    expect([contenu[0], contenu[1]]).toEqual([0x50, 0x4b]); // « PK »
    const pptx = await JSZip.loadAsync(contenu);
    expect(
      Object.keys(pptx.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)),
    ).toHaveLength(20);
    expect(Object.keys(pptx.files).some((n) => n.startsWith("ppt/notesSlides/"))).toBe(true);

    // Ligne du coffre : origine « genere », rubrique « support », repère du module, formateur = l'acteur.
    const insertion = m.service.appels.find(
      (a) => a.table === "coffre_fichier" && a.op === "insert",
    )!;
    expect(insertion.valeurs).toMatchObject({
      id: r.donnees.id,
      of_id: "of1",
      formateur_id: "f1",
      formation_id: "fo1",
      origine: "genere",
      categorie: "support",
      description: "module:1",
      partageable: true,
      chemin,
    });
    // L'ancien support du même module passe à la corbeille, jamais le nouveau.
    const corbeille = m.service.appels.find(
      (a) => a.table === "coffre_fichier" && a.op === "update",
    )!;
    expect(corbeille.valeurs).toHaveProperty("supprime_le");
    expect(aFiltre(corbeille, "eq", "description", "module:1")).toBe(true);
    expect(aFiltre(corbeille, "eq", "origine", "genere")).toBe(true);
    expect(aFiltre(corbeille, "neq", "id", r.donnees.id)).toBe(true);
    // Journal.
    const journal = m.service.appels.find((a) => a.table === "evenement")!;
    expect(journal.valeurs).toMatchObject({ type: "support_genere", acteur_id: "u-form" });
    // Aucun appel réseau (donc aucun appel d'IA) : le support est mis en forme, pas rédigé.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("le module est repéré par son rang dans le coffre (module 2 → « module:2 »)", async () => {
    const m = monter({ ...ACTEURS.formateurValide });
    const r = (await m.appeler({ ...CORPS, module_index: 1 })) as unknown as {
      donnees: { nom: string };
    };
    expect(r.donnees.nom).toBe("Support — Module 2 — Contrôle des cordons.pptx");
    const insertion = m.service.appels.find(
      (a) => a.table === "coffre_fichier" && a.op === "insert",
    )!;
    expect((insertion.valeurs as { description: string }).description).toBe("module:2");
  });

  it("un plan incomplet est refusé (400) : rien n'est écrit", async () => {
    const m = monter({ ...ACTEURS.formateurValide });
    const r = await m.appeler({ ...CORPS, diapos: diaposSimulees().slice(0, 5) });
    expect(r).toMatchObject({ ok: false, code: "invalide", statut: 400 });
    expect(String(r["message"])).toMatch(/plan du support est incomplet/);
    expect(m.service.stockage.upload).not.toHaveBeenCalled();
    expect(m.service.appels.some((a) => a.op !== "select")).toBe(false);
  });

  it("un module qui n'existe pas : 400 ; la formation d'un autre : 404", async () => {
    const m = monter({ ...ACTEURS.formateurValide });
    expect(await m.appeler({ ...CORPS, module_index: 9 })).toMatchObject({
      ok: false,
      message: "Ce module n'existe pas dans le parcours.",
    });
    const autre = monter({ ...ACTEURS.formateurValide }, null);
    expect(await autre.appeler(CORPS)).toMatchObject({
      ok: false,
      code: "introuvable",
      statut: 404,
    });
    expect(autre.service.stockage.upload).not.toHaveBeenCalled();
  });

  it("une formation sans parcours en modules est traitée comme un module unique", async () => {
    const m = monter({ ...ACTEURS.formateurValide }, { ...FORMATION, formation_modules: [] });
    const r = (await m.appeler(CORPS)) as unknown as { ok: boolean; donnees: { nom: string } };
    expect(r.ok).toBe(true);
    expect(r.donnees.nom).toBe("Support — Module 1 — Soudage TIG.pptx");
  });

  it("si l'écriture de la ligne échoue, le fichier déposé est retiré de Storage", async () => {
    const m = monter({ ...ACTEURS.formateurValide });
    const service = m.service;
    (service.bd.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const b: Record<string, unknown> = {};
      for (const k of ["select", "eq", "update", "is", "neq", "maybeSingle", "insert"])
        b[k] = () => b;
      b["then"] = (ok: (v: unknown) => unknown) =>
        Promise.resolve(
          table === "organisme_formation"
            ? { data: { of_nom: "OF", couleur: "#1d6a45" }, error: null }
            : table === "coffre_fichier"
              ? { data: null, error: { message: "refus" } }
              : { data: FORMATION, error: null },
        ).then(ok);
      return b;
    });
    expect(await m.appeler(CORPS)).toMatchObject({ ok: false, code: "interne", statut: 500 });
    expect(service.stockage.remove).toHaveBeenCalledTimes(1);
  });
});
