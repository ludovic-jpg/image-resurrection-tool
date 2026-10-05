// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, connecter, echec, type FausseBd } from "./lot-2-faux-bd";

vi.mock("../bd", async () => ({ bd: (await import("./lot-2-faux-bd")).creerFausseBd() }));
const { bd } = (await import("../bd")) as unknown as { bd: FausseBd };
const { aiguiller } = await import("../aiguilleur");

const formation = {
  id: "f-1",
  of_id: "of-1",
  formateur_id: "fo-1",
  formation_titre: "Excel",
  formation_duree_heures_total: 7,
  formation_modules: [],
  programme: "",
  formation_objectifs: "",
  archivee: false,
};
const module = (titre: string, duree: number) => ({
  titre,
  duree_heures: duree,
  objectifs: [`Objectif ${titre}`],
  contenus: [`Contenu ${titre}`],
  methodes: "",
  mise_en_pratique: "",
  evaluation: "",
});

beforeEach(() => bd.reinitialiser());
afterEach(() => expect(bd.ecrituresInterdites()).toEqual([]));

const ops = (table: string, i = 0) => bd.operations(bd.surTable(table)[i]!);

describe("route 35 — GET /formations", () => {
  it("liste les formations actives, les plus récentes d'abord, sans filtre manuel par formateur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: [formation] });
    const r = await aiguiller("GET", "/formations");
    expect(r).toEqual([formation]);
    const o = ops("formation");
    expect(o["eq"]).toEqual(["archivee", false]);
    expect(o["order"]).toEqual(["cree_le", { ascending: false }]);
    expect(bd.surTable("formation")[0]!.operations.filter(([n]) => n === "eq")).toHaveLength(1);
  });

  it("liste les archivées avec ?archivees=1", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: [] });
    expect(await aiguiller("GET", "/formations?archivees=1")).toEqual([]);
    expect(ops("formation")["eq"]).toEqual(["archivee", true]);
  });

  it("refuse l'admin et le candidat non validé (403) sans lire la table", async () => {
    connecter(bd, "admin");
    expect((await echec(aiguiller("GET", "/formations"))).statut).toBe(403);
    bd.reinitialiser();
    connecter(bd, "candidat");
    const e = await echec(aiguiller("GET", "/formations"));
    expect(e.statut).toBe(403);
    expect(e.message).toMatch(/candidature doit être validée/);
    expect(bd.surTable("formation")).toHaveLength(0);
  });
});

describe("route 36 — POST /formations/:id/restaurer", () => {
  it("sort la formation des archives et la renvoie ; le journal est laissé au déclencheur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: formation });
    expect(await aiguiller("POST", "/formations/f-1/restaurer")).toEqual(formation);
    const o = ops("formation");
    expect(o["update"]).toEqual([{ archivee: false, archivee_le: null }]);
    expect(o["eq"]).toEqual(["id", "f-1"]);
  });

  it("répond 404 (jamais 403) pour la formation d'un autre formateur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: null });
    const e = await echec(aiguiller("POST", "/formations/autre/restaurer"));
    expect([e.statut, e.code, e.message]).toEqual([404, "introuvable", "Formation introuvable."]);
  });
});

describe("route 37 — GET /versions/:type/:id", () => {
  it("renvoie { id, cree_le, libelle, apercu } sans exposer l'instantané", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { id: "f-1" } });
    bd.reponses("version_objet", {
      data: [
        {
          id: "v-2",
          cree_le: "2026-10-02T10:00:00+00:00",
          libelle: "Avant la modification",
          snapshot: {
            formation_titre: "Excel",
            formation_duree_heures_total: 7,
            formation_modules: [1, 2],
          },
        },
      ],
    });
    const r = await aiguiller("GET", "/versions/formation/f-1");
    expect(r).toEqual([
      {
        id: "v-2",
        cree_le: "2026-10-02T10:00:00+00:00",
        libelle: "Avant la modification",
        apercu: "Excel · 7 h · 2 module(s)",
      },
    ]);
    const o = ops("version_objet");
    expect(o["eq"]).toEqual(["objet_id", "f-1"]);
    expect(o["order"]).toEqual(["cree_le", { ascending: false }]);
  });

  it("lit l'objet dans modele_outil pour un outil", async () => {
    connecter(bd, "formatrice");
    bd.reponses("modele_outil", { data: { id: "o-1" } });
    bd.reponses("version_objet", {
      data: [
        {
          id: "v",
          cree_le: "c",
          libelle: "l",
          snapshot: { titre: "QCM", contenu: { questions: [1] } },
        },
      ],
    });
    const r = (await aiguiller("GET", "/versions/outil/o-1")) as Array<{ apercu: string }>;
    expect(r[0]!.apercu).toBe("QCM · 1 question(s)");
    expect(bd.surTable("modele_outil")).toHaveLength(1);
  });

  it("refuse un type inconnu (400) et un objet qui n'est pas le sien (404)", async () => {
    connecter(bd, "formatrice");
    expect((await echec(aiguiller("GET", "/versions/dossier/x"))).message).toBe("Type inconnu.");
    bd.reponses("formation", { data: null });
    const e = await echec(aiguiller("GET", "/versions/formation/autre"));
    expect(e.statut).toBe(404);
    expect(bd.surTable("version_objet")).toHaveLength(0);
  });

  it("n'écrit jamais dans version_objet : lecture seule", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { id: "f-1" } });
    bd.reponses("version_objet", { data: [] });
    await aiguiller("GET", "/versions/formation/f-1");
    expect(bd.surTable("version_objet")[0]!.operations.map(([n]) => n)).not.toContain("insert");
  });
});

describe("route 38 — POST /versions/:id/restaurer", () => {
  it("passe par la RPC s4m_restaurer_version et renvoie { type, id }", async () => {
    connecter(bd, "formatrice");
    bd.rpcReponse("s4m_restaurer_version", { data: { type: "formation", id: "f-1" } });
    expect(await aiguiller("POST", "/versions/v-3/restaurer")).toEqual({
      type: "formation",
      id: "f-1",
    });
    expect(bd.rpc).toHaveBeenCalledWith("s4m_restaurer_version", { p_version_id: "v-3" });
    expect(bd.surTable("version_objet")).toHaveLength(0);
  });

  it("traduit « Version introuvable. » en 404", async () => {
    connecter(bd, "formatrice");
    bd.rpcReponse("s4m_restaurer_version", {
      error: { message: "Version introuvable.", code: "P0001" },
    });
    const e = await echec(aiguiller("POST", "/versions/v-x/restaurer"));
    expect([e.statut, e.code]).toEqual([404, "introuvable"]);
  });

  it("refuse l'admin (403) sans appeler la RPC", async () => {
    connecter(bd, "admin");
    expect((await echec(aiguiller("POST", "/versions/v-3/restaurer"))).statut).toBe(403);
    expect(bd.rpc).toHaveBeenCalledTimes(1); // s4m_moi seulement
  });
});

describe("route 39 — POST /formations", () => {
  const modules = [module("A", 3), module("B", 4)];

  it("crée la formation pour le formateur connecté et déduit programme, objectifs et nombre de modules", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { ...formation, formation_titre: "Parcours" } });
    const r = await aiguiller("POST", "/formations", {
      formation_titre: "Parcours",
      formation_duree_heures_total: 7,
      formation_modules: modules,
      of_id: "of-pirate",
      formateur_id: "fo-pirate",
    });
    expect(r).toMatchObject({ id: "f-1" });
    const ligne = ops("formation")["insert"]![0] as Record<string, unknown>;
    expect(ligne["of_id"]).toBe(ACTEURS.formatrice.of_id);
    expect(ligne["formateur_id"]).toBe(ACTEURS.formatrice.formateur_id);
    expect(ligne["formation_nb_modules"]).toBe(2);
    expect(String(ligne["programme"])).toContain("Module 1 — A (3 h)");
    expect(String(ligne["formation_objectifs"])).toContain("Objectif A");
    expect(ligne["enjeux_le"]).toBeNull();
    expect(ligne).not.toHaveProperty("id");
    expect(ligne).not.toHaveProperty("archivee");
  });

  it("refuse une saisie invalide avec le détail par champ (400)", async () => {
    connecter(bd, "formatrice");
    const e = await echec(aiguiller("POST", "/formations", { formation_titre: "ab" }));
    expect([e.statut, e.code, e.message]).toEqual([400, "invalide", "L'intitulé est obligatoire."]);
    expect(e.details).toEqual({ champs: { formation_titre: "L'intitulé est obligatoire." } });
    expect(bd.surTable("formation")).toHaveLength(0);
  });

  it("refuse une incohérence de durée (400) sans écrire", async () => {
    connecter(bd, "formatrice");
    const e = await echec(
      aiguiller("POST", "/formations", {
        formation_titre: "Parcours",
        formation_duree_heures_total: 10,
        formation_modules: modules,
      }),
    );
    expect(e.statut).toBe(400);
    expect(e.message).toMatch(/somme des durées des modules \(7 h\)/);
    expect(bd.surTable("formation")).toHaveLength(0);
  });

  it("refuse l'admin et l'apprenant (403)", async () => {
    for (const qui of ["admin", "apprenante"] as const) {
      bd.reinitialiser();
      connecter(bd, qui);
      expect(
        (await echec(aiguiller("POST", "/formations", { formation_titre: "Parcours" }))).statut,
      ).toBe(403);
      expect(bd.surTable("formation")).toHaveLength(0);
    }
  });
});

describe("routes 40 à 43", () => {
  it("40 — lit une formation ; 404 si la RLS ne la montre pas", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: formation });
    expect(await aiguiller("GET", "/formations/f-1")).toEqual(formation);
    bd.reponses("formation", { data: null });
    expect((await echec(aiguiller("GET", "/formations/autre"))).statut).toBe(404);
  });

  it("41 — sans changement, renvoie la formation sans écrire", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: formation });
    expect(await aiguiller("PATCH", "/formations/f-1", {})).toEqual(formation);
    expect(bd.surTable("formation")).toHaveLength(1);
  });

  it("41 — n'envoie que les champs modifiés ; l'historique est laissé au déclencheur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: formation });
    await aiguiller("PATCH", "/formations/f-1", { formation_titre: "Excel avancé", id: "x" });
    expect(ops("formation", 1)["update"]).toEqual([{ formation_titre: "Excel avancé" }]);
    expect(ops("formation", 1)["eq"]).toEqual(["id", "f-1"]);
    expect(bd.surTable("version_objet")).toHaveLength(0);
  });

  it("41 — contrôle la cohérence avec l'état actuel (400) avant d'écrire", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { ...formation, formation_effectif_min: 10 } });
    const e = await echec(aiguiller("PATCH", "/formations/f-1", { formation_effectif_max: 4 }));
    expect(e.statut).toBe(400);
    expect(bd.surTable("formation")).toHaveLength(1);
  });

  it("41 — quand les modules changent, complète programme et objectifs vides", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { ...formation, formation_duree_heures_total: 7 } });
    await aiguiller("PATCH", "/formations/f-1", {
      formation_modules: [module("A", 3), module("B", 4)],
    });
    const envoi = ops("formation", 1)["update"]![0] as Record<string, unknown>;
    expect(envoi["formation_nb_modules"]).toBe(2);
    expect(String(envoi["programme"])).toContain("Module 2 — B (4 h)");
  });

  it("41 — 404 quand la formation n'est pas la sienne", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: null });
    expect(
      (await echec(aiguiller("PATCH", "/formations/autre", { formation_titre: "Zéro" }))).statut,
    ).toBe(404);
  });

  it("42 — duplique par la RPC atomique s4m_dupliquer_formation", async () => {
    connecter(bd, "formatrice");
    bd.rpcReponse("s4m_dupliquer_formation", {
      data: { ...formation, id: "f-2", formation_titre: "Excel (copie)" },
    });
    expect(await aiguiller("POST", "/formations/f-1/dupliquer")).toMatchObject({ id: "f-2" });
    expect(bd.rpc).toHaveBeenCalledWith("s4m_dupliquer_formation", { p_formation_id: "f-1" });
    expect(bd.surTable("formation")).toHaveLength(0);
  });

  it("42 — 404 quand la RPC dit « Formation introuvable. »", async () => {
    connecter(bd, "formatrice");
    bd.rpcReponse("s4m_dupliquer_formation", { error: { message: "Formation introuvable." } });
    expect((await echec(aiguiller("POST", "/formations/autre/dupliquer"))).statut).toBe(404);
  });

  it("43 — archive (archivee = true) et renvoie { ok: true } ; 404 sinon", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: { id: "f-1" } });
    expect(await aiguiller("DELETE", "/formations/f-1")).toEqual({ ok: true });
    const envoi = ops("formation")["update"]![0] as Record<string, unknown>;
    expect(envoi["archivee"]).toBe(true);
    expect(typeof envoi["archivee_le"]).toBe("string");
    expect(bd.surTable("formation")[0]!.operations.map(([n]) => n)).not.toContain("delete");
    bd.reponses("formation", { data: null });
    expect((await echec(aiguiller("DELETE", "/formations/autre"))).statut).toBe(404);
  });
});
