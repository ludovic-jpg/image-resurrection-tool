// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ETAPES, SOUS_STATUTS } from "@/domaine/pipeline/statuts";
import { REGLES } from "@/domaine/pipeline/transitions";
import { NOMENCLATURE } from "@/domaine/referentiel/pieces";
import { ACTEURS, connecter, echec, type FausseBd } from "./lot-2-faux-bd";

vi.mock("../bd", async () => ({ bd: (await import("./lot-2-faux-bd")).creerFausseBd() }));
const { bd } = (await import("../bd")) as unknown as { bd: FausseBd };
const { aiguiller } = await import("../aiguilleur");

const organisme = {
  id: "of-1",
  of_nom: "Skills4mation",
  of_siret: "123",
  of_iban: "FR76 0000",
  couleur: "#1d6a45",
};

beforeEach(() => bd.reinitialiser());
afterEach(() => expect(bd.ecrituresInterdites()).toEqual([]));

describe("route 18 — GET /referentiel (noyau embarqué)", () => {
  it("renvoie la forme exacte du serveur Node, sans aucun appel à la base", async () => {
    const r = (await aiguiller("GET", "/referentiel")) as Record<string, unknown>;
    expect(Object.keys(r)).toEqual(["pieces", "etapes", "sous_statuts", "actions"]);
    expect(r["pieces"]).toBe(NOMENCLATURE);
    expect(r["etapes"]).toBe(ETAPES);
    expect(r["sous_statuts"]).toBe(SOUS_STATUTS);
    expect(r["actions"]).toEqual(
      Object.fromEntries(Object.entries(REGLES).map(([k, v]) => [k, v.libelle])),
    );
    expect(bd.from).not.toHaveBeenCalled();
    expect(bd.rpc).not.toHaveBeenCalled();
  });
});

describe("route 28 — GET /admin/organisme", () => {
  it("renvoie l'organisme et les champs obligatoires manquants (forme de l'écran Admin)", async () => {
    connecter(bd, "admin");
    bd.reponses("organisme_formation", { data: organisme });
    const r = (await aiguiller("GET", "/admin/organisme")) as {
      organisme: typeof organisme;
      manques: string[];
    };
    expect(r.organisme).toEqual(organisme);
    expect(r.manques).toContain("Adresse");
    expect(r.manques).not.toContain("SIRET");
    expect(r.manques).not.toContain("Raison sociale");
  });

  it("laisse la RLS cloisonner : aucun filtre à la main sur l'organisme", async () => {
    connecter(bd, "admin");
    bd.reponses("organisme_formation", { data: organisme });
    await aiguiller("GET", "/admin/organisme");
    const [appel] = bd.surTable("organisme_formation");
    expect(bd.operations(appel!)["eq"]).toBeUndefined();
  });

  it.each(["formatrice", "apprenante"] as const)(
    "refuse le rôle %s (403) sans lire la table",
    async (qui) => {
      connecter(bd, qui);
      const e = await echec(aiguiller("GET", "/admin/organisme"));
      expect([e.statut, e.code]).toEqual([403, "interdit"]);
      expect(bd.surTable("organisme_formation")).toHaveLength(0);
    },
  );

  it("répond 404 « introuvable » quand la RLS ne montre rien", async () => {
    connecter(bd, "admin");
    bd.reponses("organisme_formation", { data: null });
    const e = await echec(aiguiller("GET", "/admin/organisme"));
    expect([e.statut, e.code]).toEqual([404, "introuvable"]);
  });

  it("répond 401 sans session", async () => {
    connecter(bd, null);
    const e = await echec(aiguiller("GET", "/admin/organisme"));
    expect([e.statut, e.code]).toEqual([401, "non_connecte"]);
  });
});

describe("route 29 — PATCH /admin/organisme", () => {
  it("n'envoie que les champs validés, limités à son organisme, et renvoie { organisme, manques }", async () => {
    connecter(bd, "admin");
    bd.reponses("organisme_formation", {
      data: { ...organisme, of_adresse: "1 rue X", of_nom: "Nouveau" },
    });
    const r = (await aiguiller("PATCH", "/admin/organisme", {
      of_nom: "  Nouveau  ",
      of_adresse: "1 rue X",
      id: "autre-of",
      cree_le: "2000-01-01",
    })) as { organisme: { of_nom: string }; manques: string[] };
    expect(r.organisme.of_nom).toBe("Nouveau");
    expect(r.manques).not.toContain("Adresse");
    const ops = bd.operations(bd.surTable("organisme_formation")[0]!);
    expect(ops["update"]).toEqual([{ of_nom: "Nouveau", of_adresse: "1 rue X" }]);
    expect(ops["eq"]).toEqual(["id", ACTEURS.admin.of_id]);
  });

  it("refuse une saisie invalide (400, détail par champ) sans écrire", async () => {
    connecter(bd, "admin");
    const e = await echec(
      aiguiller("PATCH", "/admin/organisme", {
        couleur: "vert",
        of_email_pedagogie: "pas-un-mail",
      }),
    );
    expect([e.statut, e.code]).toEqual([400, "invalide"]);
    expect(Object.keys((e.details as { champs: object }).champs).sort()).toEqual([
      "couleur",
      "of_email_pedagogie",
    ]);
    expect(bd.surTable("organisme_formation")).toHaveLength(0);
  });

  it("refuse le formateur (403) sans écrire", async () => {
    connecter(bd, "formatrice");
    const e = await echec(aiguiller("PATCH", "/admin/organisme", { of_nom: "X" }));
    expect(e.statut).toBe(403);
    expect(bd.surTable("organisme_formation")).toHaveLength(0);
  });

  it("ne fait aucune écriture quand rien ne change", async () => {
    connecter(bd, "admin");
    bd.reponses("organisme_formation", { data: organisme });
    await aiguiller("PATCH", "/admin/organisme", {});
    const ops = bd.operations(bd.surTable("organisme_formation")[0]!);
    expect(ops["update"]).toBeUndefined();
  });

  it("répond 400 sur un corps illisible", async () => {
    connecter(bd, "admin");
    const e = await echec(aiguiller("PATCH", "/admin/organisme", "texte"));
    expect(e.statut).toBe(400);
  });
});
