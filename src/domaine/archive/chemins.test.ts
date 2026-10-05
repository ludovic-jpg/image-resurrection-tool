import { describe, expect, it } from "vitest";
import {
  cheminAppartientA,
  cheminCandidature,
  cheminCoffre,
  cheminPiece,
  nomSur,
  ofDuChemin,
} from "./chemins";

describe("nomSur", () => {
  it("retire accents, séparateurs et espaces insécables", () => {
    expect(nomSur("Diplôme n°2 – final.pdf")).toBe("Diplome n_2 _ final.pdf");
    expect(nomSur("a b c.txt")).toBe("a b c.txt");
    expect(nomSur("../../etc/passwd")).toBe("__.._etc_passwd");
    expect(nomSur("a\\b/c:d*e?.pdf")).toBe("a_b_c_d_e_.pdf");
  });
  it("ne renvoie jamais un nom vide ni commençant par un point", () => {
    expect(nomSur("   ")).toBe("fichier");
    expect(nomSur("..")).toBe("_");
    expect(nomSur(".htaccess")).toBe("_htaccess");
  });
  it("borne la longueur en gardant l'extension", () => {
    const r = nomSur(`${"x".repeat(300)}.pdf`);
    expect(r.length).toBe(150);
    expect(r.endsWith(".pdf")).toBe(true);
  });
});

describe("chemins", () => {
  it("candidature : <of>/candidatures/<formateur>/<fichier>", () => {
    expect(cheminCandidature("of1", "f1", "cv_ab12_Mon CV.pdf")).toBe(
      "of1/candidatures/f1/cv_ab12_Mon CV.pdf",
    );
  });
  it("coffre et pièce de dossier gardent la forme de l'ancien serveur", () => {
    expect(cheminCoffre("of1", "fo1", "a.pdf")).toBe("of1/coffres/fo1/a.pdf");
    expect(cheminPiece("of1", "ADF-2026-0001", "Retour", "x.pdf")).toBe(
      "of1/dossiers/ADF-2026-0001/Retour/x.pdf",
    );
  });
  it("un segment d'identifiant ne peut pas sortir de son dossier", () => {
    expect(cheminCandidature("of1", "../of2", "a.pdf")).toBe("of1/candidatures/__of2/a.pdf");
  });
});

describe("appartenance d'un chemin à un organisme", () => {
  it("accepte un chemin sous l'OF, refuse le reste", () => {
    expect(ofDuChemin("of1/dossiers/x")).toBe("of1");
    expect(cheminAppartientA("of1/candidatures/f/a.pdf", "of1")).toBe(true);
    expect(cheminAppartientA("of2/candidatures/f/a.pdf", "of1")).toBe(false);
    expect(cheminAppartientA("of1/../of2/a.pdf", "of1")).toBe(false);
    expect(cheminAppartientA("/of1/a/b", "of1")).toBe(false);
    expect(cheminAppartientA("of1", "of1")).toBe(false);
    expect(cheminAppartientA("of1/a//b", "of1")).toBe(false);
    expect(cheminAppartientA("of1/a", "")).toBe(false);
  });
});
