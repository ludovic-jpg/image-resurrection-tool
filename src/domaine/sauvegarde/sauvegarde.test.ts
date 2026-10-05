import { describe, expect, it } from "vitest";
import {
  construireSauvegarde,
  lireSauvegarde,
  nomFichierSauvegarde,
  VERSION_SAUVEGARDE,
} from "./sauvegarde";

const fichier = (surcharge: Record<string, unknown> = {}) =>
  JSON.stringify({
    application: "s4m-plateforme",
    version: 1,
    formations: [],
    outils: [],
    ...surcharge,
  });

describe("construction de la sauvegarde", () => {
  const s = construireSauvegarde({
    date: new Date("2026-10-05T10:00:00Z"),
    formateur: "Sophie Lambert",
    formations: [{ id: "f", of_id: "of", formateur_id: "fo", formation_titre: "Excel" }],
    outils: [{ id: "o", of_id: "of", formateur_id: "fo", titre: "QCM" }],
    stagiaires: [
      { id: "s", of_id: "of", formateur_id: "fo", utilisateur_id: "u", stagiaire_nom: "Martin" },
    ],
    entreprises: [{ id: "e", of_id: "of", formateur_id: "fo", entreprise_nom: "Dupont" }],
  });
  it("entête et date", () => {
    expect(s).toMatchObject({
      application: "s4m-plateforme",
      version: VERSION_SAUVEGARDE,
      exportee_le: "2026-10-05T10:00:00.000Z",
      formateur: "Sophie Lambert",
    });
    expect(nomFichierSauvegarde(new Date("2026-10-05T10:00:00Z"))).toBe(
      "sauvegarde-espace-pedagogique-2026-10-05.json",
    );
  });
  it("aucun identifiant de rattachement (organisme, formateur, compte)", () => {
    expect(s.formations).toEqual([{ id: "f", formation_titre: "Excel" }]);
    expect(s.outils).toEqual([{ id: "o", titre: "QCM" }]);
    expect(s.stagiaires).toEqual([{ id: "s", stagiaire_nom: "Martin" }]);
    expect(s.entreprises).toEqual([{ id: "e", entreprise_nom: "Dupont" }]);
  });
});

describe("lecture d'une sauvegarde", () => {
  it("accepte une sauvegarde valide", () => {
    expect(lireSauvegarde(fichier({ formations: [{ id: "f" }], outils: [{ id: "o" }] }))).toEqual({
      ok: true,
      formations: [{ id: "f" }],
      outils: [{ id: "o" }],
    });
  });
  it.each([
    ["pas du JSON", "ceci n'est pas du json", "Le fichier n'est pas un JSON lisible."],
    [
      "autre application",
      fichier({ application: "autre" }),
      "Ce fichier n'est pas une sauvegarde de la plateforme.",
    ],
    ["un tableau", "[]", "Ce fichier n'est pas une sauvegarde de la plateforme."],
    [
      "version trop récente",
      fichier({ version: 2 }),
      "Sauvegarde produite par une version plus récente de l'application.",
    ],
    ["version illisible", fichier({ version: "1" }), "La version de la sauvegarde est illisible."],
    [
      "formations absentes",
      fichier({ formations: undefined }),
      "Les formations de la sauvegarde sont illisibles.",
    ],
    [
      "formations mal formées",
      fichier({ formations: [1] }),
      "Les formations de la sauvegarde sont illisibles.",
    ],
    [
      "outils absents",
      fichier({ outils: "x" }),
      "Les questionnaires de la sauvegarde sont illisibles.",
    ],
  ])("refuse : %s", (_nom, contenu, message) => {
    expect(lireSauvegarde(contenu)).toEqual({ ok: false, message });
  });
  it("refuse plus de 500 formations et plus de 2000 questionnaires", () => {
    expect(
      lireSauvegarde(fichier({ formations: Array.from({ length: 501 }, () => ({})) })).ok,
    ).toBe(false);
    expect(lireSauvegarde(fichier({ outils: Array.from({ length: 2001 }, () => ({})) })).ok).toBe(
      false,
    );
    expect(
      lireSauvegarde(fichier({ formations: Array.from({ length: 500 }, () => ({})) })).ok,
    ).toBe(true);
  });
});
