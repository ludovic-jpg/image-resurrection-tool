import { describe, expect, it } from "vitest";
import { echeancesPieces, erreurDepotPiece, manquesCandidature } from "./pieces";
import { validerProfilFormateur } from "./profil";

describe("manques d'une candidature", () => {
  const complet = [{ type: "cv" }, { type: "identite" }, { type: "diplome" }];
  it("liste téléphone, parcours et pièces obligatoires absentes", () => {
    expect(manquesCandidature({ formateur_telephone: "", parcours: "" }, [])).toEqual([
      "Téléphone",
      "Parcours professionnel",
      "Curriculum vitæ",
      "Pièce d'identité",
      "Diplômes et titres",
    ]);
  });
  it("ne réclame pas les pièces facultatives", () => {
    expect(manquesCandidature({ formateur_telephone: "06", parcours: "x" }, complet)).toEqual([]);
    expect(
      manquesCandidature({ formateur_telephone: "06", parcours: "x" }, [{ type: "cv" }]),
    ).toEqual(["Pièce d'identité", "Diplômes et titres"]);
  });
});

describe("échéances", () => {
  it("n'inclut que les pièces datées et marque les expirées", () => {
    const r = echeancesPieces(
      [
        { id: "1", nom_fichier: "a", expire_le: "" },
        { id: "2", nom_fichier: "b", expire_le: "2026-01-01" },
        { id: "3", nom_fichier: "c", expire_le: "2026-12-31" },
      ],
      "2026-10-05",
    );
    expect(r.map((e) => [e.id, e.expiree])).toEqual([
      ["2", true],
      ["3", false],
    ]);
  });
});

describe("dépôt d'une pièce", () => {
  const ok = { type: "cv", nom: "cv.PDF", taille: 1000, expire_le: "" };
  it("accepte un dépôt valide", () => {
    expect(erreurDepotPiece(ok)).toBeNull();
    expect(erreurDepotPiece({ ...ok, expire_le: "2027-01-31" })).toBeNull();
  });
  it("refuse type inconnu, date mal formée, fichier vide, trop gros, extension interdite", () => {
    expect(erreurDepotPiece({ ...ok, type: "x" })).toMatch(/inconnu/);
    expect(erreurDepotPiece({ ...ok, expire_le: "31/01/2027" })).toMatch(/AAAA-MM-JJ/);
    expect(erreurDepotPiece({ ...ok, taille: 0 })).toMatch(/vide/);
    expect(erreurDepotPiece({ ...ok, taille: 16 * 1024 * 1024 })).toMatch(/15 Mo/);
    expect(erreurDepotPiece({ ...ok, nom: "virus.exe" })).toMatch(/non accepté/);
    expect(erreurDepotPiece({ ...ok, nom: "sans-extension" })).toMatch(/non accepté/);
  });
});

describe("profil du formateur", () => {
  it("ne retient que les clés envoyées et rogne les textes", () => {
    const r = validerProfilFormateur({ formateur_telephone: " 06 12 ", inconnue: "x" });
    expect(r).toEqual({ ok: true, valeurs: { formateur_telephone: "06 12" } });
  });
  it("une mise à jour vide ne change rien", () => {
    expect(validerProfilFormateur({})).toEqual({ ok: true, valeurs: {} });
  });
  it("refuse prénom vide, texte trop long, LinkedIn invalide, tarif non entier", () => {
    const r = validerProfilFormateur({
      formateur_prenom: "  ",
      formateur_bio: "x".repeat(1501),
      formateur_linkedin: "pas une url",
      formateur_tarif_journalier: 12.5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.champs).sort()).toEqual([
        "formateur_bio",
        "formateur_linkedin",
        "formateur_prenom",
        "formateur_tarif_journalier",
      ]);
      expect(r.champs["formateur_linkedin"]).toBe("Adresse de profil invalide.");
    }
  });
  it("accepte LinkedIn vide, tarif nul, domaines nettoyés", () => {
    const r = validerProfilFormateur({
      formateur_linkedin: "",
      formateur_tarif_journalier: null,
      formateur_domaines: [" Soudure ", "Rail"],
    });
    expect(r).toEqual({
      ok: true,
      valeurs: {
        formateur_linkedin: "",
        formateur_tarif_journalier: null,
        formateur_domaines: ["Soudure", "Rail"],
      },
    });
  });
  it("refuse un LinkedIn javascript:", () => {
    expect(validerProfilFormateur({ formateur_linkedin: "javascript:alert(1)" }).ok).toBe(false);
  });
  it("refuse un corps qui n'est pas un objet", () => {
    expect(validerProfilFormateur(null).ok).toBe(false);
    expect(validerProfilFormateur([]).ok).toBe(false);
  });
});
