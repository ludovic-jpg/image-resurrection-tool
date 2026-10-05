// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, connecter, echec, type FausseBd } from "./lot-2-faux-bd";

vi.mock("../bd", async () => ({ bd: (await import("./lot-2-faux-bd")).creerFausseBd() }));
const { bd } = (await import("../bd")) as unknown as { bd: FausseBd };
const { aiguiller } = await import("../aiguilleur");

const entreprise = {
  id: "e-1",
  of_id: "of-1",
  formateur_id: "fo-1",
  entreprise_nom: "ACME",
  archive_le: null,
};
const stagiaire = {
  id: "st-1",
  of_id: "of-1",
  formateur_id: "fo-1",
  entreprise_id: "e-1",
  utilisateur_id: null,
  stagiaire_prenom: "Léa",
  stagiaire_nom: "Martin",
  archive_le: null,
};

beforeEach(() => bd.reinitialiser());
afterEach(() => expect(bd.ecrituresInterdites()).toEqual([]));

const ops = (table: string, i = 0) => bd.operations(bd.surTable(table)[i]!);
const natures = (table: string, i = 0) => bd.surTable(table)[i]!.operations.map(([n]) => n);

describe("routes 71 et 76 — listes", () => {
  it("71 — entreprises actives par ordre alphabétique, sans filtre manuel par formateur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente", { data: [entreprise] });
    expect(await aiguiller("GET", "/entreprises")).toEqual([entreprise]);
    const o = ops("entreprise_cliente");
    expect(o["is"]).toEqual(["archive_le", null]);
    expect(o["order"]).toEqual(["entreprise_nom", { ascending: true }]);
    expect(o["eq"]).toBeUndefined();
  });

  it("76 — apprenants actifs triés par nom puis prénom ; ?archives=1 liste les archivés", async () => {
    connecter(bd, "formatrice");
    bd.reponses("stagiaire", { data: [stagiaire] });
    expect(await aiguiller("GET", "/stagiaires")).toEqual([stagiaire]);
    expect(
      bd
        .surTable("stagiaire")[0]!
        .operations.filter(([n]) => n === "order")
        .map(([, c]) => c),
    ).toEqual(["stagiaire_nom", "stagiaire_prenom"]);
    await aiguiller("GET", "/stagiaires?archives=1");
    expect(ops("stagiaire", 1)["not"]).toEqual(["archive_le", "is", null]);
  });

  it("refuse l'admin, l'apprenant et le candidat non validé (403) sans lire de table", async () => {
    for (const qui of ["admin", "apprenante", "candidat"] as const) {
      bd.reinitialiser();
      connecter(bd, qui);
      expect((await echec(aiguiller("GET", "/entreprises"))).statut).toBe(403);
      expect((await echec(aiguiller("GET", "/stagiaires"))).statut).toBe(403);
      expect(bd.from).not.toHaveBeenCalled();
    }
  });
});

describe("routes 72 et 73 — archiver", () => {
  it("archive (archive_le) ou restaure ({ archiver: false }) sans rien effacer", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente", { data: { id: "e-1" } });
    bd.reponses("stagiaire", { data: { id: "st-1" } });
    expect(await aiguiller("POST", "/entreprises/e-1/archiver", {})).toEqual({ ok: true });
    expect(await aiguiller("POST", "/stagiaires/st-1/archiver", { archiver: false })).toEqual({
      ok: true,
    });
    const archive = ops("entreprise_cliente")["update"]![0] as Record<string, unknown>;
    expect(typeof archive["archive_le"]).toBe("string");
    expect(ops("stagiaire")["update"]).toEqual([{ archive_le: null }]);
    expect(natures("entreprise_cliente")).not.toContain("delete");
  });

  it("répond 404 pour une fiche qui n'est pas la sienne", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente", { data: null });
    bd.reponses("stagiaire", { data: null });
    expect((await echec(aiguiller("POST", "/entreprises/autre/archiver", {}))).message).toBe(
      "Entreprise introuvable.",
    );
    expect((await echec(aiguiller("POST", "/stagiaires/autre/archiver", {}))).message).toBe(
      "Fiche apprenant introuvable.",
    );
  });
});

describe("routes 74 et 75 — entreprises", () => {
  it("74 — crée une entreprise pour le formateur connecté (jamais celui du corps)", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente", { data: entreprise });
    expect(
      await aiguiller("POST", "/entreprises", {
        entreprise_nom: "  ACME  ",
        of_id: "pirate",
        formateur_id: "pirate",
      }),
    ).toEqual(entreprise);
    const ligne = ops("entreprise_cliente")["insert"]![0] as Record<string, unknown>;
    expect(ligne).toMatchObject({
      entreprise_nom: "ACME",
      entreprise_siret: "",
      of_id: ACTEURS.formatrice.of_id,
      formateur_id: ACTEURS.formatrice.formateur_id,
    });
  });

  it("74 — refuse une raison sociale trop courte et un e-mail invalide (400, détail par champ)", async () => {
    connecter(bd, "formatrice");
    const e = await echec(
      aiguiller("POST", "/entreprises", {
        entreprise_nom: "A",
        entreprise_representant_email: "x",
      }),
    );
    expect([e.statut, e.code]).toEqual([400, "invalide"]);
    expect(e.details).toEqual({
      champs: {
        entreprise_nom: "La raison sociale est obligatoire.",
        entreprise_representant_email: "Adresse e-mail invalide.",
      },
    });
    expect(bd.surTable("entreprise_cliente")).toHaveLength(0);
  });

  it("75 — modifie seulement les champs envoyés ; 404 si la fiche n'est pas la sienne", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente", { data: entreprise });
    await aiguiller("PATCH", "/entreprises/e-1", { entreprise_siret: "123", id: "x" });
    expect(ops("entreprise_cliente")["update"]).toEqual([{ entreprise_siret: "123" }]);
    bd.reponses("entreprise_cliente", { data: null });
    expect(
      (await echec(aiguiller("PATCH", "/entreprises/autre", { entreprise_siret: "1" }))).statut,
    ).toBe(404);
  });

  it("75 — sans changement, relit la fiche sans écrire", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente", { data: entreprise });
    expect(await aiguiller("PATCH", "/entreprises/e-1", {})).toEqual(entreprise);
    expect(natures("entreprise_cliente")).not.toContain("update");
  });
});

describe("routes 77 et 78 — apprenants", () => {
  it("77 — crée une fiche pour le formateur connecté, sans jamais écrire utilisateur_id", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente", { data: { id: "e-1" } });
    bd.reponses("stagiaire", { data: stagiaire });
    expect(
      await aiguiller("POST", "/stagiaires", {
        stagiaire_prenom: "Léa",
        stagiaire_nom: "Martin",
        stagiaire_email: " LEA@Exemple.fr ",
        entreprise_id: "e-1",
        utilisateur_id: "u-pirate",
        formateur_id: "pirate",
      }),
    ).toEqual(stagiaire);
    const ligne = ops("stagiaire")["insert"]![0] as Record<string, unknown>;
    expect(ligne).toMatchObject({
      stagiaire_email: "lea@exemple.fr",
      entreprise_id: "e-1",
      of_id: "of-1",
      formateur_id: "fo-1",
    });
    expect(ligne).not.toHaveProperty("utilisateur_id");
    expect(ligne).not.toHaveProperty("nouvelle_entreprise");
  });

  it("77 — crée l'entreprise « dans le même geste » puis la fiche rattachée", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente", { data: { ...entreprise, id: "e-neuve" } });
    bd.reponses("stagiaire", { data: stagiaire });
    await aiguiller("POST", "/stagiaires", {
      stagiaire_prenom: "Léa",
      stagiaire_nom: "Martin",
      nouvelle_entreprise: { entreprise_nom: "Nouvelle SARL" },
    });
    expect(ops("entreprise_cliente")["insert"]![0]).toMatchObject({
      entreprise_nom: "Nouvelle SARL",
      formateur_id: "fo-1",
    });
    expect(ops("stagiaire")["insert"]![0]).toMatchObject({ entreprise_id: "e-neuve" });
  });

  it("77 — archive l'entreprise créée si la fiche ne peut pas être enregistrée (pas d'orpheline dans les listes)", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente:insert", { data: { ...entreprise, id: "e-neuve" } });
    bd.reponses("stagiaire", { error: { code: "23505", message: "doublon" } });
    const e = await echec(
      aiguiller("POST", "/stagiaires", {
        stagiaire_prenom: "Léa",
        stagiaire_nom: "Martin",
        nouvelle_entreprise: { entreprise_nom: "Nouvelle SARL" },
      }),
    );
    expect(e.statut).toBe(409);
    const archivage = bd.surTable("entreprise_cliente")[1]!;
    expect(bd.operations(archivage)["eq"]).toEqual(["id", "e-neuve"]);
    expect(Object.keys(bd.operations(archivage)["update"]![0] as object)).toEqual(["archive_le"]);
  });

  it("77 — 404 quand l'entreprise indiquée n'est pas visible ; aucune fiche créée", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente", { data: null });
    const e = await echec(
      aiguiller("POST", "/stagiaires", {
        stagiaire_prenom: "Léa",
        stagiaire_nom: "Martin",
        entreprise_id: "autre",
      }),
    );
    expect(e.statut).toBe(404);
    expect(bd.surTable("stagiaire")).toHaveLength(0);
  });

  it("77 — refuse prénom ou nom manquant (400)", async () => {
    connecter(bd, "formatrice");
    const e = await echec(
      aiguiller("POST", "/stagiaires", { stagiaire_prenom: "", stagiaire_nom: "" }),
    );
    expect(e.statut).toBe(400);
    expect(Object.keys((e.details as { champs: object }).champs).sort()).toEqual([
      "stagiaire_nom",
      "stagiaire_prenom",
    ]);
    expect(bd.surTable("stagiaire")).toHaveLength(0);
  });

  it("78 — modifie seulement les champs envoyés ; utilisateur_id est ignoré ; 404 si pas la sienne", async () => {
    connecter(bd, "formatrice");
    bd.reponses("stagiaire", { data: stagiaire });
    await aiguiller("PATCH", "/stagiaires/st-1", {
      stagiaire_poste: "Chef",
      utilisateur_id: "pirate",
    });
    expect(ops("stagiaire")["update"]).toEqual([{ stagiaire_poste: "Chef" }]);
    bd.reponses("stagiaire", { data: null });
    expect(
      (await echec(aiguiller("PATCH", "/stagiaires/autre", { stagiaire_poste: "x" }))).statut,
    ).toBe(404);
  });

  it("78 — rattache à une entreprise visible ; 404 sinon, sans rien écrire", async () => {
    connecter(bd, "formatrice");
    bd.reponses("entreprise_cliente", { data: null });
    expect(
      (await echec(aiguiller("PATCH", "/stagiaires/st-1", { entreprise_id: "autre" }))).statut,
    ).toBe(404);
    expect(bd.surTable("stagiaire")).toHaveLength(0);
  });

  it("77 et 78 — refusent l'admin et l'apprenant (403)", async () => {
    for (const qui of ["admin", "apprenante"] as const) {
      bd.reinitialiser();
      connecter(bd, qui);
      expect(
        (
          await echec(
            aiguiller("POST", "/stagiaires", { stagiaire_prenom: "A", stagiaire_nom: "B" }),
          )
        ).statut,
      ).toBe(403);
      expect(
        (await echec(aiguiller("PATCH", "/stagiaires/st-1", { stagiaire_poste: "x" }))).statut,
      ).toBe(403);
      expect(bd.from).not.toHaveBeenCalled();
    }
  });
});
