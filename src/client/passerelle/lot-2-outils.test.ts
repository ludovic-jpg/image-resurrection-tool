// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, connecter, echec, type FausseBd } from "./lot-2-faux-bd";

vi.mock("../bd", async () => ({ bd: (await import("./lot-2-faux-bd")).creerFausseBd() }));
const { bd } = (await import("../bd")) as unknown as { bd: FausseBd };
const { aiguiller } = await import("../aiguilleur");

const outil = {
  id: "o-1",
  of_id: "of-1",
  formateur_id: "fo-1",
  formation_id: "f-1",
  type: "positionnement",
  titre: "QCM",
  contenu: { titre: "QCM", questions: [] },
  archive_le: null,
};
const questionnaire = {
  titre: "QCM Excel",
  questions: [
    { enonce: "Quelle touche ?", propositions: ["F2", "F5"], bonne_reponse: 0 },
    { enonce: "Quel signe ?", propositions: ["=", "+"], bonne_reponse: 0 },
  ],
};

beforeEach(() => bd.reinitialiser());
afterEach(() => expect(bd.ecrituresInterdites()).toEqual([]));

const ops = (table: string, i = 0) => bd.operations(bd.surTable(table)[i]!);

describe("route 66 — GET /outils", () => {
  it("liste les outils actifs, les plus récents d'abord, sans filtre manuel par formateur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("modele_outil", { data: [outil] });
    expect(await aiguiller("GET", "/outils")).toEqual([outil]);
    expect(ops("modele_outil")["is"]).toEqual(["archive_le", null]);
    expect(ops("modele_outil")["order"]).toEqual(["cree_le", { ascending: false }]);
    expect(ops("modele_outil")["eq"]).toBeUndefined();
  });

  it("liste les archivés avec ?archives=1", async () => {
    connecter(bd, "formatrice");
    bd.reponses("modele_outil", { data: [] });
    await aiguiller("GET", "/outils?archives=1");
    expect(ops("modele_outil")["not"]).toEqual(["archive_le", "is", null]);
  });

  it("refuse l'admin et l'apprenant (403)", async () => {
    for (const qui of ["admin", "apprenante"] as const) {
      bd.reinitialiser();
      connecter(bd, qui);
      expect((await echec(aiguiller("GET", "/outils"))).statut).toBe(403);
      expect(bd.surTable("modele_outil")).toHaveLength(0);
    }
  });
});

describe("route 67 — POST /outils/:id/restaurer", () => {
  it("désarchive l'outil et le renvoie ; 404 sinon", async () => {
    connecter(bd, "formatrice");
    bd.reponses("modele_outil", { data: outil });
    expect(await aiguiller("POST", "/outils/o-1/restaurer")).toEqual(outil);
    expect(ops("modele_outil")["update"]).toEqual([{ archive_le: null }]);
    bd.reponses("modele_outil", { data: null });
    expect((await echec(aiguiller("POST", "/outils/autre/restaurer"))).statut).toBe(404);
  });
});

describe("routes 68 et 69 — enregistrer un outil", () => {
  it("68 — crée un questionnaire pour le formateur connecté (acteur issu de s4m_moi)", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { id: "f-1" } });
    bd.reponses("modele_outil", { data: outil });
    const r = await aiguiller("POST", "/outils", {
      type: "positionnement",
      titre: "QCM Excel",
      formation_id: "f-1",
      contenu: questionnaire,
      of_id: "pirate",
      formateur_id: "pirate",
    });
    expect(r).toEqual(outil);
    const ligne = ops("modele_outil")["insert"]![0] as Record<string, unknown>;
    expect(ligne).toEqual({
      of_id: ACTEURS.formatrice.of_id,
      formateur_id: ACTEURS.formatrice.formateur_id,
      type: "positionnement",
      titre: "QCM Excel",
      formation_id: "f-1",
      contenu: questionnaire,
    });
  });

  it("68 — un recueil prend des questions supplémentaires (liste vide par défaut)", async () => {
    connecter(bd, "formatrice");
    bd.reponses("modele_outil", { data: outil });
    await aiguiller("POST", "/outils", {
      type: "recueil",
      titre: "Recueil",
      contenu: { questions_supplementaires: ["Une attente ?"] },
    });
    await aiguiller("POST", "/outils", { type: "recueil", titre: "Recueil", contenu: {} });
    const contenus = bd
      .surTable("modele_outil")
      .map((a) => (bd.operations(a)["insert"]![0] as Record<string, unknown>)["contenu"]);
    expect(contenus).toEqual([
      { questions_supplementaires: ["Une attente ?"] },
      { questions_supplementaires: [] },
    ]);
  });

  it("68 — refuse un questionnaire incomplet avec la liste des erreurs (400)", async () => {
    connecter(bd, "formatrice");
    const e = await echec(
      aiguiller("POST", "/outils", {
        type: "acquis",
        titre: "QCM",
        contenu: {
          titre: "QCM",
          questions: [{ enonce: "Q ?", propositions: ["A", "A"], bonne_reponse: 5 }],
        },
      }),
    );
    expect([e.statut, e.code, e.message]).toEqual([
      400,
      "invalide",
      "Le questionnaire est incomplet.",
    ]);
    expect((e.details as { erreurs: string[] }).erreurs).toEqual([
      "Question 1 : propositions en double.",
      "Question 1 : la bonne réponse ne désigne aucune proposition.",
    ]);
    expect(bd.surTable("modele_outil")).toHaveLength(0);
  });

  it("68 — refuse un type inconnu et un titre vide (400, détail par champ)", async () => {
    connecter(bd, "formatrice");
    const e = await echec(aiguiller("POST", "/outils", { type: "autre", titre: "", contenu: {} }));
    expect(e.statut).toBe(400);
    expect(Object.keys((e.details as { champs: object }).champs).sort()).toEqual(["titre", "type"]);
  });

  it("68 — 404 quand la formation visée n'est pas visible", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: null });
    const e = await echec(
      aiguiller("POST", "/outils", {
        type: "positionnement",
        titre: "QCM",
        formation_id: "autre",
        contenu: questionnaire,
      }),
    );
    expect(e.statut).toBe(404);
    expect(bd.surTable("modele_outil")).toHaveLength(0);
  });

  it("69 — modifie titre, formation et contenu d'un outil actif ; la version est laissée au déclencheur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("modele_outil", { data: outil });
    await aiguiller("PUT", "/outils/o-1", {
      type: "positionnement",
      titre: "QCM v2",
      contenu: questionnaire,
    });
    const o = ops("modele_outil");
    expect(o["update"]).toEqual([{ titre: "QCM v2", formation_id: null, contenu: questionnaire }]);
    expect(o["eq"]).toEqual(["id", "o-1"]);
    expect(o["is"]).toEqual(["archive_le", null]);
    expect(bd.surTable("version_objet")).toHaveLength(0);
  });

  it("69 — 404 quand l'outil est archivé ou n'est pas le sien", async () => {
    connecter(bd, "formatrice");
    bd.reponses("modele_outil", { data: null });
    expect(
      (
        await echec(
          aiguiller("PUT", "/outils/autre", {
            type: "positionnement",
            titre: "QCM",
            contenu: questionnaire,
          }),
        )
      ).statut,
    ).toBe(404);
  });
});

describe("route 70 — DELETE /outils/:id", () => {
  it("archive l'outil (archive_le), ne le supprime pas", async () => {
    connecter(bd, "formatrice");
    bd.reponses("modele_outil", { data: { id: "o-1" } });
    expect(await aiguiller("DELETE", "/outils/o-1")).toEqual({ ok: true });
    const envoi = ops("modele_outil")["update"]![0] as Record<string, unknown>;
    expect(typeof envoi["archive_le"]).toBe("string");
    expect(bd.surTable("modele_outil")[0]!.operations.map(([n]) => n)).not.toContain("delete");
  });

  it("répond 404 pour un outil déjà archivé ou d'un autre formateur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("modele_outil", { data: null });
    expect((await echec(aiguiller("DELETE", "/outils/autre"))).statut).toBe(404);
  });
});
