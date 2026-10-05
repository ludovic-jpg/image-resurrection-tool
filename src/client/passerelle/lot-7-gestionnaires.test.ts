import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, fauxBd, moi, type Appel } from "@/test/faux-supabase";
import { echec, succes } from "@/lib/resultat";
import { ErreurApi } from "../erreur";

const h = vi.hoisted(() => ({ bd: null as unknown, ordre: [] as string[] }));
vi.mock("../bd", () => ({
  bd: new Proxy({}, { get: (_c, p) => (h.bd as Record<string | symbol, unknown>)[p] }),
}));
const etatIa = vi.fn();
const qcm = vi.fn();
const programme = vi.fn();
const parcours = vi.fn();
const enjeux = vi.fn();
const plan = vi.fn();
const produire = vi.fn();
const zip = vi.fn();
vi.mock("@/lib/pedagogie-ia.functions", () => ({
  lireEtatIa: (...a: unknown[]) => etatIa(...a),
  proposerQcm: (...a: unknown[]) => (h.ordre.push("qcm"), qcm(...a)),
  proposerProgramme: (...a: unknown[]) => programme(...a),
  proposerParcours: (...a: unknown[]) => parcours(...a),
  analyserEnjeux: (...a: unknown[]) => (h.ordre.push("enjeux"), enjeux(...a)),
  proposerPlanSupport: (...a: unknown[]) => (h.ordre.push("plan"), plan(...a)),
}));
vi.mock("@/lib/supports.functions", () => ({
  produireSupport: (...a: unknown[]) => (h.ordre.push("produire"), produire(...a)),
}));
vi.mock("@/lib/coffre-zip.functions", () => ({
  exporterCoffreZip: (...a: unknown[]) => zip(...a),
}));

const { aiguiller, routesEnregistrees } = await import("../aiguilleur");
const { surClicLienZip } = await import("./lot-7-coffre-zip");

const echecApi = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurApi);
    return e as ErreurApi;
  }
  throw new Error("Une ErreurApi était attendue");
};

type Acteur = Record<string, unknown> | null;
function monter(acteur: Acteur, formation: Record<string, unknown> | null = FORMATION) {
  const faux = fauxBd((a: Appel) =>
    a.table === "formation" ? { data: formation ? [formation] : [] } : undefined,
  );
  faux.bd.rpc.mockImplementation(async () => moi(acteur));
  h.bd = faux.bd;
  return faux;
}
const FORMATION = { id: "fo1", formation_modules: [{}, {}, {}], dossier_enjeux: { resume: "x" } };
const DIAPOS = [{ type: "titre", titre: "t", points: [], visuel: "", notes: "" }];

beforeEach(() => {
  vi.resetAllMocks();
  h.ordre.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  qcm.mockResolvedValue(succes({ brouillon: true, source: "ia", questionnaire: {} }));
  plan.mockResolvedValue(succes({ source: "ia", diapos: DIAPOS }));
  enjeux.mockResolvedValue(succes({ enjeux: {}, enjeux_le: "2026-10-05T10:00:00Z" }));
  produire.mockImplementation(async (a: { data: { module_index: number } }) =>
    succes({
      id: `s${a.data.module_index}`,
      nom: `Support ${a.data.module_index + 1}.pptx`,
      diapositives: 20,
    }),
  );
});

describe("couverture du lot 7", () => {
  it("enregistre les routes 53 et 57 à 65", () => {
    const routes = routesEnregistrees().map((r) => r.replace(/\\\//g, "/"));
    for (const attendue of [
      "GET ^/coffres-parcours/([^/]+)/zip$",
      "GET ^/ia/etat$",
      "POST ^/ia/qcm$",
      "POST ^/ia/programme$",
      "POST ^/ia/parcours$",
      "POST ^/ia/enjeux$",
      "POST ^/ia/test$",
      "POST ^/ia/plan-support$",
      "POST ^/supports$",
      "POST ^/supports/tous$",
    ])
      expect(routes, attendue).toContain(attendue);
  });
});

describe("route 57 — état de l'IA", () => {
  it("renvoie la réponse de la fonction serveur", async () => {
    monter({ ...ACTEURS.formateurValide });
    etatIa.mockResolvedValue(succes({ disponible: true, description: "modèle + recherche web" }));
    expect(await aiguiller("GET", "/ia/etat")).toEqual({
      disponible: true,
      description: "modèle + recherche web",
    });
  });
  it("une session expirée devient un 401 français", async () => {
    monter(null);
    etatIa.mockRejectedValue(new Error("Unauthorized: No authorization header provided"));
    const e = await echecApi(aiguiller("GET", "/ia/etat"));
    expect(e.statut).toBe(401);
  });
});

describe("routes 58 et 62 — QCM (le dossier d'enjeux d'abord, au besoin)", () => {
  for (const chemin of ["/ia/qcm", "/ia/test"]) {
    it(`${chemin} : un dossier d'enjeux existant n'est pas refait`, async () => {
      monter({ ...ACTEURS.formateurValide });
      const corps = { formation_id: "fo1", type: "acquis", nombre: 5 };
      expect(await aiguiller("POST", chemin, corps)).toMatchObject({ brouillon: true });
      expect(enjeux).not.toHaveBeenCalled();
      expect(qcm).toHaveBeenCalledWith({ data: corps });
    });
    it(`${chemin} : sans dossier d'enjeux, la route 61 passe avant le QCM`, async () => {
      monter({ ...ACTEURS.formateurValide }, { ...FORMATION, dossier_enjeux: null });
      await aiguiller("POST", chemin, { formation_id: "fo1", type: "acquis" });
      expect(h.ordre).toEqual(["enjeux", "qcm"]);
      expect(enjeux).toHaveBeenCalledWith({ data: { formation_id: "fo1" } });
    });
    it(`${chemin} : un administrateur est refusé (403) avant toute lecture ou appel d'IA`, async () => {
      const faux = monter({ ...ACTEURS.admin });
      const e = await echecApi(aiguiller("POST", chemin, { formation_id: "fo1" }));
      expect(e.statut).toBe(403);
      expect(faux.appels).toEqual([]);
      expect(qcm).not.toHaveBeenCalled();
      expect(enjeux).not.toHaveBeenCalled();
    });
  }
  it("un candidat non validé est refusé (403 français)", async () => {
    monter({ ...ACTEURS.candidat });
    const e = await echecApi(aiguiller("POST", "/ia/qcm", { formation_id: "fo1" }));
    expect(e.statut).toBe(403);
    expect(e.message).toMatch(/candidature doit être validée/);
  });
  it("la formation d'un autre formateur : 404, aucun appel serveur", async () => {
    monter({ ...ACTEURS.formateurValide }, null);
    const e = await echecApi(aiguiller("POST", "/ia/qcm", { formation_id: "fo-autre" }));
    expect(e.statut).toBe(404);
    expect(qcm).not.toHaveBeenCalled();
    expect(enjeux).not.toHaveBeenCalled();
  });
  it("l'échec typé du serveur (IA non configurée) devient une ErreurApi 409 avec son message", async () => {
    monter({ ...ACTEURS.formateurValide });
    qcm.mockResolvedValue(echec("conflit", "L'assistant IA n'est pas configuré."));
    const e = await echecApi(aiguiller("POST", "/ia/qcm", { formation_id: "fo1" }));
    expect([e.statut, e.code, e.message]).toEqual([
      409,
      "conflit",
      "L'assistant IA n'est pas configuré.",
    ]);
  });
});

describe("routes 59, 60, 61 — programme, parcours, enjeux", () => {
  it("transmettent le corps tel quel et renvoient la réponse du serveur", async () => {
    monter({ ...ACTEURS.formateurValide });
    programme.mockResolvedValue(succes({ brouillon: true, programme: "p" }));
    parcours.mockResolvedValue(succes({ brouillon: true, modules: [] }));
    expect(await aiguiller("POST", "/ia/programme", { formation_titre: "T" })).toEqual({
      brouillon: true,
      programme: "p",
    });
    expect(programme).toHaveBeenCalledWith({ data: { formation_titre: "T" } });
    expect(
      await aiguiller("POST", "/ia/parcours", { titre: "T", heures: 7, nb_modules: 1 }),
    ).toEqual({
      brouillon: true,
      modules: [],
    });
    expect(await aiguiller("POST", "/ia/enjeux", { formation_id: "fo1" })).toMatchObject({
      enjeux_le: "2026-10-05T10:00:00Z",
    });
    expect(enjeux).toHaveBeenCalledWith({ data: { formation_id: "fo1" } });
  });
  it("le refus de rôle du serveur (403) arrive tel quel à l'écran", async () => {
    monter({ ...ACTEURS.admin });
    parcours.mockResolvedValue(echec("interdit", "Cette action est réservée aux formateurs."));
    const e = await echecApi(aiguiller("POST", "/ia/parcours", {}));
    expect([e.statut, e.code]).toEqual([403, "interdit"]);
  });
});

describe("route 63 — plan de support", () => {
  it("dossier d'enjeux d'abord s'il manque, puis le plan", async () => {
    monter({ ...ACTEURS.formateurValide }, { ...FORMATION, dossier_enjeux: null });
    const corps = { formation_id: "fo1", module_index: 1 };
    expect(await aiguiller("POST", "/ia/plan-support", corps)).toMatchObject({ source: "ia" });
    expect(h.ordre).toEqual(["enjeux", "plan"]);
    expect(plan).toHaveBeenCalledWith({ data: corps });
  });
  it("refuse l'administrateur et l'apprenant avant tout appel", async () => {
    for (const a of [ACTEURS.admin, ACTEURS.apprenant]) {
      monter({ ...a });
      expect(
        (await echecApi(aiguiller("POST", "/ia/plan-support", { formation_id: "fo1" }))).statut,
      ).toBe(403);
    }
    expect(plan).not.toHaveBeenCalled();
  });
});

describe("route 64 — produire un support", () => {
  it("transmet le plan validé et renvoie { id, nom, diapositives }", async () => {
    monter({ ...ACTEURS.formateurValide });
    const corps = { formation_id: "fo1", module_index: 0, diapos: DIAPOS };
    expect(await aiguiller("POST", "/supports", corps)).toEqual({
      id: "s0",
      nom: "Support 1.pptx",
      diapositives: 20,
    });
    expect(produire).toHaveBeenCalledWith({ data: corps });
  });
  it("le refus de rôle du serveur arrive en 403", async () => {
    monter({ ...ACTEURS.apprenant });
    produire.mockResolvedValue(echec("interdit", "Cette action est réservée aux formateurs."));
    expect((await echecApi(aiguiller("POST", "/supports", {}))).statut).toBe(403);
  });
});

describe("route 65 — tous les supports : le navigateur boucle module par module", () => {
  it("un appel de plan puis un appel de support PAR module, dans l'ordre, avec le plan reçu", async () => {
    monter({ ...ACTEURS.formateurValide });
    const r = (await aiguiller("POST", "/supports/tous", { formation_id: "fo1" })) as {
      produits: Array<{ nom: string }>;
      echecs: string[];
    };
    expect(h.ordre).toEqual(["plan", "produire", "plan", "produire", "plan", "produire"]);
    expect(plan.mock.calls.map((c) => c[0].data.module_index)).toEqual([0, 1, 2]);
    expect(produire.mock.calls.every((c) => c[0].data.diapos === DIAPOS)).toBe(true);
    expect(r.produits.map((p) => p.nom)).toEqual([
      "Support 1.pptx",
      "Support 2.pptx",
      "Support 3.pptx",
    ]);
    expect(r.echecs).toEqual([]);
    expect(enjeux).not.toHaveBeenCalled();
  });

  it("le dossier d'enjeux manquant est constitué UNE seule fois, avant la boucle", async () => {
    monter({ ...ACTEURS.formateurValide }, { ...FORMATION, dossier_enjeux: null });
    await aiguiller("POST", "/supports/tous", { formation_id: "fo1" });
    expect(h.ordre.filter((x) => x === "enjeux")).toHaveLength(1);
    expect(h.ordre[0]).toBe("enjeux");
  });

  it("un module en échec n'empêche pas les autres", async () => {
    monter({ ...ACTEURS.formateurValide });
    plan.mockImplementation(async (a: { data: { module_index: number } }) =>
      a.data.module_index === 1
        ? echec("conflit", "L'assistant IA est saturé (limite de débit).")
        : succes({ source: "ia", diapos: DIAPOS }),
    );
    const r = (await aiguiller("POST", "/supports/tous", { formation_id: "fo1" })) as {
      produits: unknown[];
      echecs: string[];
    };
    expect(r.produits).toHaveLength(2);
    expect(r.echecs).toEqual(["Module 2 : L'assistant IA est saturé (limite de débit)."]);
  });

  it("une session expirée interrompt la boucle (401)", async () => {
    monter({ ...ACTEURS.formateurValide });
    plan.mockRejectedValue(new Error("Unauthorized: Invalid token"));
    const e = await echecApi(aiguiller("POST", "/supports/tous", { formation_id: "fo1" }));
    expect(e.statut).toBe(401);
    expect(plan).toHaveBeenCalledTimes(1);
  });

  it("une formation sans parcours en modules compte pour un module", async () => {
    monter({ ...ACTEURS.formateurValide }, { ...FORMATION, formation_modules: [] });
    const r = (await aiguiller("POST", "/supports/tous", { formation_id: "fo1" })) as {
      produits: unknown[];
    };
    expect(r.produits).toHaveLength(1);
  });

  it("refuse l'administrateur (403) ; la formation d'un autre est introuvable (404) ; rien n'est appelé", async () => {
    monter({ ...ACTEURS.admin });
    expect(
      (await echecApi(aiguiller("POST", "/supports/tous", { formation_id: "fo1" }))).statut,
    ).toBe(403);
    monter({ ...ACTEURS.formateurValide }, null);
    expect(
      (await echecApi(aiguiller("POST", "/supports/tous", { formation_id: "fo1" }))).statut,
    ).toBe(404);
    expect(plan).not.toHaveBeenCalled();
    expect(produire).not.toHaveBeenCalled();
  });
});

describe("route 53 — ZIP du coffre", () => {
  it("appelle la fonction serveur avec l'identifiant du chemin et renvoie le ZIP", async () => {
    monter({ ...ACTEURS.formateurValide });
    const recu = {
      nom: "Coffre-fort - X.zip",
      type_mime: "application/zip",
      taille: 3,
      contenu_base64: "AQID",
    };
    zip.mockResolvedValue(succes(recu));
    expect(await aiguiller("GET", "/coffres-parcours/fo1/zip")).toEqual(recu);
    expect(zip).toHaveBeenCalledWith({ data: { formation_id: "fo1" } });
  });
  it("404 et 403 du serveur arrivent à l'écran", async () => {
    monter({ ...ACTEURS.formateurValide });
    zip.mockResolvedValue(echec("introuvable", "Formation introuvable."));
    expect((await echecApi(aiguiller("GET", "/coffres-parcours/x/zip"))).statut).toBe(404);
    zip.mockResolvedValue(echec("interdit", "Cette action ne vous est pas permise."));
    expect((await echecApi(aiguiller("GET", "/coffres-parcours/x/zip"))).statut).toBe(403);
  });
});

describe("lien « Tout télécharger (ZIP) » de l'écran du coffre (non réécrit)", () => {
  const cliquer = (href: string, init: MouseEventInit = {}) => {
    const a = document.createElement("a");
    a.setAttribute("href", href);
    document.body.appendChild(a);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    Object.defineProperty(ev, "target", { value: a });
    return { ev, a };
  };
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    window.alert = vi.fn();
  });

  it("intercepte le clic, appelle la fonction serveur (avec le jeton) et fait télécharger le ZIP", async () => {
    zip.mockResolvedValue(
      succes({
        nom: "Coffre-fort - X.zip",
        type_mime: "application/zip",
        taille: 3,
        contenu_base64: "AQID",
      }),
    );
    const { ev, a } = cliquer("/api/coffres-parcours/fo1/zip");
    const clics: string[] = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clics.push(`${this.download}|${this.href}`);
    };
    await surClicLienZip(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(zip).toHaveBeenCalledWith({ data: { formation_id: "fo1" } });
    expect(clics).toEqual(["Coffre-fort - X.zip|blob:test"]);
    a.remove();
  });
  it("une erreur du serveur est montrée en français, sans téléchargement", async () => {
    zip.mockResolvedValue(echec("introuvable", "Formation introuvable."));
    const { ev } = cliquer("/api/coffres-parcours/x/zip");
    await surClicLienZip(ev);
    expect(window.alert).toHaveBeenCalledWith("Formation introuvable.");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("ne touche ni aux autres liens ni aux clics modifiés (nouvel onglet)", async () => {
    const autre = cliquer("/api/coffre/abc/telecharger");
    await surClicLienZip(autre.ev);
    expect(autre.ev.defaultPrevented).toBe(false);
    const modifie = cliquer("/api/coffres-parcours/fo1/zip", { ctrlKey: true });
    await surClicLienZip(modifie.ev);
    expect(modifie.ev.defaultPrevented).toBe(false);
    expect(zip).not.toHaveBeenCalled();
  });
});
