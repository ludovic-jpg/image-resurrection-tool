// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, aFiltre, fauxBd, moi, type Appel } from "@/test/faux-supabase";
import { ErreurApi } from "../erreur";
import { echec, succes } from "@/lib/resultat";

const h = vi.hoisted(() => ({ bd: null as unknown }));
vi.mock("../bd", () => ({
  bd: new Proxy({}, { get: (_c, p) => (h.bd as Record<string | symbol, unknown>)[p] }),
}));
const inviter = vi.fn();
const relancer = vi.fn();
const lienPdf = vi.fn();
const lire = vi.fn();
const brouillon = vi.fn();
const signer = vi.fn();
vi.mock("@/lib/positionnements.functions", () => ({
  inviterAuPositionnement: (...a: unknown[]) => inviter(...a),
  relancerPositionnement: (...a: unknown[]) => relancer(...a),
  lienPdfPositionnement: (...a: unknown[]) => lienPdf(...a),
}));
vi.mock("@/lib/public-positionnement.functions", () => ({
  lirePositionnementPublic: (...a: unknown[]) => lire(...a),
  enregistrerBrouillonPublic: (...a: unknown[]) => brouillon(...a),
  signerPositionnementPublic: (...a: unknown[]) => signer(...a),
}));

const { aiguiller, routesEnregistrees } = await import("../aiguilleur");

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
const toutesLesRequetes: Appel[] = [];
function monter(
  acteur: Acteur,
  repondre: (a: Appel) => { data?: unknown; error?: unknown } | undefined = () => undefined,
) {
  const faux = fauxBd((a) => {
    toutesLesRequetes.push(a);
    return repondre(a) as never;
  });
  faux.bd.rpc.mockImplementation(async () => moi(acteur));
  h.bd = faux.bd;
  return faux;
}

const LIGNE_LISTE = {
  id: "pos1",
  formation_id: "fo1",
  formation_titre: "Soudure TIG",
  stagiaire_id: "s1",
  apprenant: "Anne Martin",
  email: "anne@exemple.fr",
  entreprise: "Atelier",
  statut: "complet",
  expire: false,
  score: 75,
  envoye_le: "2026-10-01T09:00:00Z",
  signe_le: "2026-10-02T09:00:00Z",
  pdf: true,
  archive_le: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  // Règle du lot : le client ne touche jamais au jeton, aux réponses, à la signature, au PDF ni au statut.
  const interdites = toutesLesRequetes.filter(
    (a) =>
      a.table === "positionnement" &&
      (a.op === "insert" ||
        a.op === "upsert" ||
        a.op === "delete" ||
        (a.op === "update" &&
          Object.keys((a.valeurs ?? {}) as object).some((c) => c !== "archive_le"))),
  );
  expect(interdites).toEqual([]);
});

describe("couverture du lot 6", () => {
  it("enregistre les routes 10 à 12 et 79 à 83 (la 13 est la route serveur du lien PDF)", () => {
    const attendues = [
      "GET ^/public/positionnement/([^/]+)$",
      "PUT ^/public/positionnement/([^/]+)/brouillon$",
      "POST ^/public/positionnement/([^/]+)/signer$",
      "GET ^/positionnements$",
      "POST ^/positionnements$",
      "POST ^/positionnements/([^/]+)/relancer$",
      "POST ^/positionnements/([^/]+)/archiver$",
      "GET ^/positionnements/([^/]+)/pdf$",
    ];
    const reelles = routesEnregistrees().map((r) => r.replace(/\\\//g, "/"));
    for (const r of attendues) expect(reelles).toContain(r);
  });
});

describe("route 79 : GET /positionnements", () => {
  it("renvoie les lignes de la vue, avec exactement les champs du service Node", async () => {
    const { appels } = monter(ACTEURS.formateurValide, (a) =>
      a.table === "positionnement_vue" ? { data: [LIGNE_LISTE] } : undefined,
    );
    const r = (await aiguiller("GET", "/positionnements")) as Array<Record<string, unknown>>;
    expect(Object.keys(r[0]!).sort()).toEqual(Object.keys(LIGNE_LISTE).sort());
    const q = appels.find((a) => a.table === "positionnement_vue")!;
    expect(q.colonnes).toBe(
      "id, formation_id, formation_titre, stagiaire_id, apprenant, email, entreprise, statut, expire, score, envoye_le, signe_le, pdf, archive_le",
    );
    for (const secret of [
      "jeton_hash",
      "brouillon",
      "questionnaire",
      "reponses",
      "recueil",
      "signature_png",
    ])
      expect(q.colonnes).not.toContain(secret);
    expect(aFiltre(q, "is", "archive_le", null)).toBe(true);
    expect(aFiltre(q, "eq", "formateur_id", "f1")).toBe(true);
    expect(aFiltre(q, "order", "cree_le", { ascending: false })).toBe(true);
  });

  it("?archives=1 et ?formation_id= filtrent ; l'admin voit son organisme sans filtre formateur", async () => {
    const { appels } = monter(ACTEURS.admin, () => ({ data: [] }));
    await aiguiller("GET", "/positionnements?archives=1&formation_id=fo1");
    const q = appels.find((a) => a.table === "positionnement_vue")!;
    expect(aFiltre(q, "not", "archive_le", "is", null)).toBe(true);
    expect(aFiltre(q, "eq", "formation_id", "fo1")).toBe(true);
    expect(q.filtres.some((f) => f[1] === "formateur_id")).toBe(false);
  });

  it("refuse l'apprenant (403), le candidat (403) et l'absence de session (401)", async () => {
    for (const acteur of [ACTEURS.apprenant, ACTEURS.candidat]) {
      const { appels } = monter(acteur);
      const e = await echecApi(aiguiller("GET", "/positionnements"));
      expect(e.statut).toBe(403);
      expect(appels).toHaveLength(0);
    }
    monter(null);
    expect((await echecApi(aiguiller("GET", "/positionnements"))).statut).toBe(401);
  });
});

describe("route 80 : POST /positionnements", () => {
  it("ne transmet que l'apprenant, le parcours et le message : jamais un acteur, un organisme ou un rôle", async () => {
    monter(ACTEURS.formateurValide);
    inviter.mockResolvedValue(
      succes({ id: "pos1", lien: "https://x/positionnement/abc", test_cree: false }),
    );
    const r = await aiguiller("POST", "/positionnements", {
      stagiaire_id: "s1",
      formation_id: "fo1",
      message: "Bonjour",
      of_id: "of-autre",
      formateur_id: "f-autre",
      role: "admin",
      jeton_hash: "x",
    });
    expect(r).toEqual({ id: "pos1", lien: "https://x/positionnement/abc", test_cree: false });
    expect(inviter).toHaveBeenCalledWith({
      data: { stagiaire_id: "s1", formation_id: "fo1", message: "Bonjour" },
    });
  });

  it("convertit un refus du serveur en ErreurApi (statut, code, détails)", async () => {
    monter(ACTEURS.apprenant);
    inviter.mockResolvedValue(echec("interdit", "Cette action est réservée aux formateurs."));
    const e = await echecApi(aiguiller("POST", "/positionnements", {}));
    expect([e.statut, e.code, e.message]).toEqual([
      403,
      "interdit",
      "Cette action est réservée aux formateurs.",
    ]);
    inviter.mockResolvedValue(
      echec("invalide", "Ce parcours n'a pas encore de test de positionnement : …"),
    );
    expect(
      /test de positionnement/i.test(
        (await echecApi(aiguiller("POST", "/positionnements", {}))).message,
      ),
    ).toBe(true);
  });

  it("un corps absent ou non textuel devient des chaînes vides (le serveur refuse en français)", async () => {
    monter(ACTEURS.formateurValide);
    inviter.mockResolvedValue(succes({ id: "p", lien: "l", test_cree: false }));
    await aiguiller("POST", "/positionnements", { stagiaire_id: 12, formation_id: null });
    expect(inviter).toHaveBeenCalledWith({
      data: { stagiaire_id: "", formation_id: "", message: "" },
    });
  });
});

describe("route 81 : relancer", () => {
  it("passe l'identifiant du chemin, et seulement lui", async () => {
    monter(ACTEURS.formateurValide);
    relancer.mockResolvedValue(succes({ lien: "https://x/positionnement/nouveau" }));
    expect(
      await aiguiller("POST", "/positionnements/pos1/relancer", { id: "autre", of_id: "of2" }),
    ).toEqual({
      lien: "https://x/positionnement/nouveau",
    });
    expect(relancer).toHaveBeenCalledWith({ data: { id: "pos1" } });
  });

  it("l'admin reçoit le 403 du serveur", async () => {
    monter(ACTEURS.admin);
    relancer.mockResolvedValue(echec("interdit", "La relance est faite par le formateur."));
    const e = await echecApi(aiguiller("POST", "/positionnements/pos1/relancer"));
    expect([e.statut, e.message]).toEqual([403, "La relance est faite par le formateur."]);
  });
});

describe("route 82 : archiver (Client + RLS)", () => {
  it("ne change que `archive_le`, sur un positionnement du formateur", async () => {
    const { appels } = monter(ACTEURS.formateurValide, (a) =>
      a.table === "positionnement" ? { data: [{ id: "pos1" }] } : undefined,
    );
    expect(await aiguiller("POST", "/positionnements/pos1/archiver", { archiver: true })).toEqual({
      ok: true,
    });
    const maj = appels.find((a) => a.table === "positionnement" && a.op === "update")!;
    expect(Object.keys(maj.valeurs as object)).toEqual(["archive_le"]);
    expect(typeof (maj.valeurs as { archive_le: unknown }).archive_le).toBe("string");
    expect(aFiltre(maj, "eq", "id", "pos1")).toBe(true);
    expect(aFiltre(maj, "eq", "formateur_id", "f1")).toBe(true);
  });

  it("restaure avec { archiver: false } ; archive par défaut", async () => {
    const f = monter(ACTEURS.formateurValide, () => ({ data: [{ id: "pos1" }] }));
    await aiguiller("POST", "/positionnements/pos1/archiver", { archiver: false });
    await aiguiller("POST", "/positionnements/pos1/archiver", {});
    const [a, b] = f.appels.filter((x) => x.op === "update");
    expect((a!.valeurs as { archive_le: unknown }).archive_le).toBeNull();
    expect(typeof (b!.valeurs as { archive_le: unknown }).archive_le).toBe("string");
  });

  it("refuse l'admin, l'apprenant et le candidat (403) sans rien écrire ; objet d'autrui = 404", async () => {
    for (const acteur of [ACTEURS.admin, ACTEURS.apprenant, ACTEURS.candidat]) {
      const { appels } = monter(acteur);
      expect((await echecApi(aiguiller("POST", "/positionnements/pos1/archiver", {}))).statut).toBe(
        403,
      );
      expect(appels.filter((a) => a.op === "update")).toEqual([]);
    }
    monter(ACTEURS.formateurValide, () => ({ data: [] }));
    expect(
      (await echecApi(aiguiller("POST", "/positionnements/pos-autrui/archiver", {}))).statut,
    ).toBe(404);
  });
});

describe("route 83 : GET /positionnements/:id/pdf", () => {
  it("renvoie le lien signé du serveur, sans autre champ", async () => {
    monter(ACTEURS.formateurValide);
    lienPdf.mockResolvedValue(succes({ url: "https://stockage.test/signe", nom: "p.html" }));
    expect(await aiguiller("GET", "/positionnements/pos1/pdf")).toEqual({
      url: "https://stockage.test/signe",
      nom: "p.html",
    });
    expect(lienPdf).toHaveBeenCalledWith({ data: { id: "pos1" } });
  });

  it("introuvable et refus remontent tels quels", async () => {
    monter(ACTEURS.apprenant);
    lienPdf.mockResolvedValue(echec("interdit", "Cette action ne vous est pas permise."));
    expect((await echecApi(aiguiller("GET", "/positionnements/pos1/pdf"))).statut).toBe(403);
    lienPdf.mockResolvedValue(echec("introuvable", "Positionnement introuvable."));
    expect((await echecApi(aiguiller("GET", "/positionnements/pos1/pdf"))).statut).toBe(404);
  });
});

describe("routes 10 à 12 : page publique, sans session", () => {
  it("n'appellent jamais s4m_moi ni la base du navigateur : le jeton du chemin est le seul justificatif", async () => {
    const faux = monter(null);
    lire.mockResolvedValue(succes({ statut: "envoye" }));
    brouillon.mockResolvedValue(succes({ enregistre_le: "x" }));
    signer.mockResolvedValue(succes({ statut: "complet" }));
    await aiguiller("GET", "/public/positionnement/jeton123");
    await aiguiller("PUT", "/public/positionnement/jeton123/brouillon", { recueil: {} });
    await aiguiller("POST", "/public/positionnement/jeton123/signer", { recueil: {} });
    expect(faux.bd.rpc).not.toHaveBeenCalled();
    expect(faux.appels).toHaveLength(0);
    expect(lire).toHaveBeenCalledWith({ data: { jeton: "jeton123" } });
  });

  it("10 : renvoie la lecture du serveur (sans corrigé, garanti côté serveur)", async () => {
    monter(null);
    lire.mockResolvedValue(
      succes({ statut: "envoye", questionnaire: { titre: "T", questions: [] } }),
    );
    const r = await aiguiller("GET", "/public/positionnement/jeton123");
    expect(JSON.stringify(r)).not.toContain("bonne_reponse");
  });

  it("11 et 12 : ne transmettent que les champs attendus (aucune IP, aucun score, aucun statut du corps)", async () => {
    monter(null);
    brouillon.mockResolvedValue(succes({ enregistre_le: "x" }));
    signer.mockResolvedValue(succes({ statut: "complet" }));
    await aiguiller("PUT", "/public/positionnement/jeton123/brouillon", {
      recueil: { a: "b" },
      reponses: [1],
      date: "2026-10-05",
      score: 100,
      statut: "complet",
    });
    expect(brouillon).toHaveBeenCalledWith({
      data: {
        jeton: "jeton123",
        reponses: { recueil: { a: "b" }, reponses: [1], date: "2026-10-05" },
      },
    });
    await aiguiller("POST", "/public/positionnement/jeton123/signer", {
      recueil: {},
      reponses: [],
      date: "d",
      trace_png: "t",
      lieu: "l",
      consentement: true,
      adresse_ip: "6.6.6.6",
      score: 100,
    });
    const envoye = JSON.stringify(signer.mock.calls[0]);
    expect(envoye).not.toContain("6.6.6.6");
    expect(envoye).not.toContain("score");
    expect(Object.keys(signer.mock.calls[0]![0].data.reponses).sort()).toEqual([
      "consentement",
      "date",
      "lieu",
      "recueil",
      "reponses",
      "trace_png",
    ]);
  });

  it("un jeton invalide, expiré ou déjà utilisé donne une erreur claire (404 / 409)", async () => {
    monter(null);
    lire.mockResolvedValue(echec("introuvable", "Lien de positionnement introuvable."));
    const e = await echecApi(aiguiller("GET", "/public/positionnement/jetonbidon"));
    expect([e.statut, e.code, e.message]).toEqual([
      404,
      "introuvable",
      "Lien de positionnement introuvable.",
    ]);
    signer.mockResolvedValue(echec("conflit", "Ce positionnement est déjà signé."));
    expect(
      (await echecApi(aiguiller("POST", "/public/positionnement/jeton123/signer", {}))).statut,
    ).toBe(409);
    signer.mockResolvedValue(
      echec("invalide", "Le positionnement est incomplet.", {
        erreurs: ["Indiquez la date."],
        champs: {},
      }),
    );
    const inv = await echecApi(aiguiller("POST", "/public/positionnement/jeton123/signer", {}));
    expect(inv.details?.erreurs).toEqual(["Indiquez la date."]);
  });
});
