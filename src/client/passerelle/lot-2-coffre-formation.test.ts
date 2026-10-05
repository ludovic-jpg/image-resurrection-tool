// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, connecter, echec, type FausseBd } from "./lot-2-faux-bd";

vi.mock("../bd", async () => ({ bd: (await import("./lot-2-faux-bd")).creerFausseBd() }));
const { bd } = (await import("../bd")) as unknown as { bd: FausseBd };
const { aiguiller } = await import("../aiguilleur");

const fichier = {
  id: "c-1",
  of_id: "of-1",
  formateur_id: "fo-1",
  formation_id: "f-1",
  nom_fichier: "support.pptx",
  chemin: "of-1/coffres/f-1/ab12cd34_support.pptx",
  taille: 10,
  type_mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  partageable: true,
  categorie: "support",
  description: "",
  origine: "depot",
  supprime_le: null,
};

beforeEach(() => bd.reinitialiser());
afterEach(() => expect(bd.ecrituresInterdites()).toEqual([]));

const ops = (table: string, i = 0) => bd.operations(bd.surTable(table)[i]!);
const envoi = (nom: string, contenu = "contenu", champs: Record<string, string> = {}) => {
  const form = new FormData();
  form.set("fichier", new File([contenu], nom));
  for (const [k, v] of Object.entries(champs)) form.set(k, v);
  return form;
};

describe("route 44 — GET /formations/:id/coffre", () => {
  it("liste les fichiers actifs de la formation visible, par date de dépôt", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { id: "f-1" } });
    bd.reponses("coffre_fichier", { data: [fichier] });
    expect(await aiguiller("GET", "/formations/f-1/coffre")).toEqual([fichier]);
    const o = ops("coffre_fichier");
    expect(o["eq"]).toEqual(["formation_id", "f-1"]);
    expect(o["is"]).toEqual(["supprime_le", null]);
    expect(o["order"]).toEqual(["cree_le", { ascending: true }]);
  });

  it("est ouvert à l'admin de l'organisme", async () => {
    connecter(bd, "admin");
    bd.reponses("formation", { data: { id: "f-1" } });
    bd.reponses("coffre_fichier", { data: [] });
    expect(await aiguiller("GET", "/formations/f-1/coffre")).toEqual([]);
  });

  it("refuse l'apprenant (403) : il passe par GET /coffres, jamais par la table", async () => {
    connecter(bd, "apprenante");
    expect((await echec(aiguiller("GET", "/formations/f-1/coffre"))).statut).toBe(403);
    expect(bd.surTable("coffre_fichier")).toHaveLength(0);
    expect(bd.surTable("formation")).toHaveLength(0);
  });

  it("répond 404 quand la formation n'est pas visible (autre formateur)", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: null });
    expect((await echec(aiguiller("GET", "/formations/autre/coffre"))).statut).toBe(404);
    expect(bd.surTable("coffre_fichier")).toHaveLength(0);
  });
});

describe("route 45 — POST /formations/:id/coffre (dépôt)", () => {
  it("dépose dans le bucket coffre sous <of_id>/coffres/<formation_id>/ puis enregistre la ligne", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { id: "f-1" } });
    bd.reponses("coffre_fichier:select", { data: [fichier] });
    const r = await aiguiller(
      "POST",
      "/formations/f-1/coffre",
      envoi("Évaluation finale.pptx", "x".repeat(12), {
        partageable: "non",
        categorie: "evaluation",
        description: "  Test final ",
      }),
    );
    expect(r).toEqual([fichier]);
    expect(bd.buckets).toEqual(["coffre"]);
    const [chemin, , options] = bd.stockage.upload.mock.calls[0] as [
      string,
      unknown,
      Record<string, unknown>,
    ];
    expect(chemin).toMatch(/^of-1\/coffres\/f-1\/[0-9a-f]{8}_Evaluation_finale\.pptx$/);
    expect(options).toMatchObject({ upsert: false });
    const ligne = ops("coffre_fichier")["insert"]![0] as Record<string, unknown>;
    expect(ligne).toMatchObject({
      of_id: "of-1",
      formateur_id: "fo-1",
      formation_id: "f-1",
      nom_fichier: "Évaluation finale.pptx",
      chemin,
      taille: 12,
      partageable: false,
      categorie: "evaluation",
      description: "Test final",
      origine: "depot",
    });
    expect(String(ligne["type_mime"])).toContain("presentationml");
  });

  it("refuse un type de fichier non accepté (400) sans rien déposer", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { id: "f-1" } });
    const e = await echec(aiguiller("POST", "/formations/f-1/coffre", envoi("virus.exe")));
    expect([e.statut, e.code]).toEqual([400, "invalide"]);
    expect(bd.stockage.upload).not.toHaveBeenCalled();
  });

  it("refuse un fichier vide et une requête sans fichier (400)", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { id: "f-1" } });
    expect(
      (await echec(aiguiller("POST", "/formations/f-1/coffre", envoi("vide.pdf", "")))).message,
    ).toBe("Le fichier est vide.");
    expect(
      (await echec(aiguiller("POST", "/formations/f-1/coffre", { partageable: "oui" }))).message,
    ).toBe("Aucun fichier reçu.");
    expect(bd.stockage.upload).not.toHaveBeenCalled();
  });

  it("retire le fichier déposé quand la ligne ne peut pas être enregistrée", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { id: "f-1" } });
    bd.reponses("coffre_fichier:insert", { error: { code: "42501", message: "refusé" } });
    const e = await echec(aiguiller("POST", "/formations/f-1/coffre", envoi("a.pdf")));
    expect(e.statut).toBe(404);
    const chemin = bd.stockage.upload.mock.calls[0]![0];
    expect(bd.stockage.remove).toHaveBeenCalledWith([chemin]);
  });

  it("refuse l'admin (403) et répond 404 pour la formation d'un autre", async () => {
    connecter(bd, "admin");
    expect((await echec(aiguiller("POST", "/formations/f-1/coffre", envoi("a.pdf")))).statut).toBe(
      403,
    );
    bd.reinitialiser();
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: null });
    expect(
      (await echec(aiguiller("POST", "/formations/autre/coffre", envoi("a.pdf")))).statut,
    ).toBe(404);
    expect(bd.stockage.upload).not.toHaveBeenCalled();
  });
});

describe("routes 46 à 48 — réglages, corbeille, restauration", () => {
  it("46 — règle le partage seul", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier", { data: { id: "c-1" } });
    expect(await aiguiller("PATCH", "/coffre/c-1", { partageable: false })).toEqual({ ok: true });
    expect(ops("coffre_fichier")["update"]).toEqual([{ partageable: false }]);
    expect(ops("coffre_fichier")["eq"]).toEqual(["id", "c-1"]);
  });

  it("46 — modifie catégorie et description, rien d'autre", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier", { data: { id: "c-1" } });
    await aiguiller("PATCH", "/coffre/c-1", {
      categorie: "exercice",
      description: "Cas",
      chemin: "x/y",
      of_id: "z",
    });
    expect(ops("coffre_fichier")["update"]).toEqual([
      { categorie: "exercice", description: "Cas" },
    ]);
  });

  it("46 — refuse une catégorie inconnue (400) et répond 404 pour un fichier qui n'est pas le sien", async () => {
    connecter(bd, "formatrice");
    expect((await echec(aiguiller("PATCH", "/coffre/c-1", { categorie: "secret" }))).statut).toBe(
      400,
    );
    bd.reponses("coffre_fichier", { data: null });
    expect((await echec(aiguiller("PATCH", "/coffre/autre", { partageable: true }))).statut).toBe(
      404,
    );
  });

  it("47 — met à la corbeille (supprime_le) sans rien détruire", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier", { data: { id: "c-1" } });
    expect(await aiguiller("DELETE", "/coffre/c-1")).toEqual({ ok: true });
    const envoiMaj = ops("coffre_fichier")["update"]![0] as Record<string, unknown>;
    expect(typeof envoiMaj["supprime_le"]).toBe("string");
    expect(bd.stockage.remove).not.toHaveBeenCalled();
  });

  it("48 — restaure depuis la corbeille", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier", { data: { id: "c-1" } });
    expect(await aiguiller("POST", "/coffre/c-1/restaurer")).toEqual({ ok: true });
    expect(ops("coffre_fichier")["update"]).toEqual([{ supprime_le: null }]);
  });

  it("47 et 48 — 404 pour un fichier introuvable ; l'admin est refusé (403)", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier", { data: null });
    expect((await echec(aiguiller("DELETE", "/coffre/autre"))).statut).toBe(404);
    expect((await echec(aiguiller("POST", "/coffre/autre/restaurer"))).statut).toBe(404);
    bd.reinitialiser();
    connecter(bd, "admin");
    expect((await echec(aiguiller("DELETE", "/coffre/c-1"))).statut).toBe(403);
    expect(bd.surTable("coffre_fichier")).toHaveLength(0);
  });
});

describe("route 49 — DELETE /coffre/:id/definitif", () => {
  it("refuse la purge d'un fichier qui n'est pas à la corbeille (409)", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier", {
      data: { id: "c-1", chemin: fichier.chemin, supprime_le: null },
    });
    const e = await echec(aiguiller("DELETE", "/coffre/c-1/definitif"));
    expect([e.statut, e.code, e.message]).toEqual([
      409,
      "conflit",
      "Mettez d'abord le fichier à la corbeille.",
    ]);
    expect(bd.surTable("coffre_fichier")[0]!.operations.map(([n]) => n)).not.toContain("delete");
    expect(bd.stockage.remove).not.toHaveBeenCalled();
  });

  it("supprime la ligne puis l'objet Storage ; le journal est laissé au déclencheur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier:select", {
      data: { id: "c-1", chemin: fichier.chemin, supprime_le: "2026-10-01T00:00:00+00:00" },
    });
    bd.reponses("coffre_fichier:delete", { data: { id: "c-1" } });
    expect(await aiguiller("DELETE", "/coffre/c-1/definitif")).toEqual({ ok: true });
    expect(bd.stockage.remove).toHaveBeenCalledWith([fichier.chemin]);
    expect(ops("coffre_fichier", 1)["eq"]).toEqual(["id", "c-1"]);
  });

  it("garde le fichier dans Storage quand la politique refuse la suppression de la ligne", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier:select", {
      data: { id: "c-1", chemin: fichier.chemin, supprime_le: "2026-10-01T00:00:00+00:00" },
    });
    bd.reponses("coffre_fichier:delete", { data: null });
    expect((await echec(aiguiller("DELETE", "/coffre/c-1/definitif"))).statut).toBe(404);
    expect(bd.stockage.remove).not.toHaveBeenCalled();
  });

  it("répond 404 pour un fichier d'un autre formateur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier", { data: null });
    expect((await echec(aiguiller("DELETE", "/coffre/autre/definitif"))).statut).toBe(404);
  });
});

describe("route 55 — GET /coffre/:id/telecharger", () => {
  it("crée une URL signée de 60 s et ne renvoie ni chemin ni identifiant interne", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier", {
      data: {
        nom_fichier: "support.pptx",
        chemin: fichier.chemin,
        type_mime: "application/x-test",
      },
    });
    const r = await aiguiller("GET", "/coffre/c-1/telecharger");
    expect(r).toEqual({
      nom: "support.pptx",
      type_mime: "application/x-test",
      url: "https://stockage.test/signe?token=abc",
    });
    expect(bd.buckets).toEqual(["coffre"]);
    expect(bd.stockage.createSignedUrl).toHaveBeenCalledWith(fichier.chemin, 60, {
      download: "support.pptx",
    });
  });

  it("sert l'apprenant dont la RLS montre le fichier, et ne lit que le nécessaire", async () => {
    connecter(bd, "apprenante");
    bd.reponses("coffre_fichier", {
      data: { nom_fichier: "cours.pdf", chemin: "of-1/coffres/f-1/x_cours.pdf", type_mime: "" },
    });
    const r = (await aiguiller("GET", "/coffre/c-1/telecharger")) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(["nom", "type_mime", "url"]);
    expect(r["type_mime"]).toBe("application/pdf");
    expect(ops("coffre_fichier")["select"]).toEqual(["nom_fichier, chemin, type_mime"]);
  });

  it("répond 404 (jamais 403) quand la RLS cache le fichier, sans créer d'URL", async () => {
    connecter(bd, "apprenante");
    bd.reponses("coffre_fichier", { data: null });
    const e = await echec(aiguiller("GET", "/coffre/c-prive/telecharger"));
    expect([e.statut, e.code]).toEqual([404, "introuvable"]);
    expect(bd.stockage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("répond 404 quand l'objet est absent de Storage", async () => {
    connecter(bd, "formatrice");
    bd.reponses("coffre_fichier", { data: { nom_fichier: "a.pdf", chemin: "p", type_mime: "" } });
    bd.stockage.createSignedUrl.mockResolvedValue({
      data: null,
      error: { statusCode: "404", message: "Object not found" },
    });
    expect((await echec(aiguiller("GET", "/coffre/c-1/telecharger"))).statut).toBe(404);
  });
});

describe("route 56 — GET /coffres (apprenant)", () => {
  const coffres = [
    {
      dossier_id: "d-1",
      dossier_reference: "ADF-2026-0001",
      formation_titre: "Excel",
      fichiers: [{ id: "c-1", nom_fichier: "cours.pdf", taille: 10, categorie: "support" }],
    },
  ];

  it("renvoie les coffres ouverts par la RPC s4m_coffres_apprenant, sans chemin ni donnée du formateur", async () => {
    connecter(bd, "apprenante");
    bd.rpcReponse("s4m_coffres_apprenant", { data: coffres });
    const r = await aiguiller("GET", "/coffres");
    expect(r).toEqual(coffres);
    expect(JSON.stringify(r)).not.toMatch(/chemin|formateur|prix|corrig/);
    expect(bd.rpc).toHaveBeenCalledWith("s4m_coffres_apprenant");
    expect(bd.from).not.toHaveBeenCalled();
  });

  it("renvoie une liste vide quand aucun coffre n'est ouvert", async () => {
    connecter(bd, "apprenante");
    bd.rpcReponse("s4m_coffres_apprenant", { data: null });
    expect(await aiguiller("GET", "/coffres")).toEqual([]);
  });

  it.each(["formatrice", "admin"] as const)("refuse le rôle %s (403)", async (qui) => {
    connecter(bd, qui);
    bd.rpcReponse("s4m_coffres_apprenant", { data: coffres });
    expect((await echec(aiguiller("GET", "/coffres"))).statut).toBe(403);
    expect(bd.rpc).not.toHaveBeenCalledWith("s4m_coffres_apprenant");
  });
});

it("l'acteur vient de s4m_moi, jamais du corps de la requête", async () => {
  connecter(bd, "formatrice");
  bd.reponses("formation", { data: { id: "f-1" } });
  await aiguiller(
    "POST",
    "/formations/f-1/coffre",
    envoi("a.pdf", "x", { formateur_id: "pirate", of_id: "pirate" }),
  );
  const ligne = ops("coffre_fichier")["insert"]![0] as Record<string, unknown>;
  expect([ligne["of_id"], ligne["formateur_id"]]).toEqual([
    ACTEURS.formatrice.of_id,
    ACTEURS.formatrice.formateur_id,
  ]);
});
