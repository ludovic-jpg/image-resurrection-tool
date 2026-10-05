// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  TAILLE_MAX_COFFRE,
  cheminCoffre,
  erreurFichierCoffre,
  extensionDe,
  nomDeStockage,
  nomSur,
  typeMimeDe,
} from "./regles";

describe("règles des fichiers du coffre", () => {
  it("accepte un support courant et refuse vide, trop gros ou extension inconnue", () => {
    expect(erreurFichierCoffre({ nom: "support.pptx", taille: 1024 })).toBeNull();
    expect(erreurFichierCoffre({ nom: "support.pptx", taille: 0 })).toBe("Le fichier est vide.");
    expect(erreurFichierCoffre({ nom: "film.mp4", taille: TAILLE_MAX_COFFRE + 1 })).toBe(
      "Le fichier dépasse la taille maximale de 100 Mo.",
    );
    expect(erreurFichierCoffre({ nom: "virus.exe", taille: 10 })).toMatch(
      /^Type de fichier non accepté\. Formats admis : pdf, /,
    );
    expect(erreurFichierCoffre({ nom: "sans-extension", taille: 10 })).toMatch(/non accepté/);
  });

  it("déduit le type MIME de l'extension, jamais de ce qu'annonce le navigateur", () => {
    expect(extensionDe("Cours.FINAL.PDF")).toBe("pdf");
    expect(typeMimeDe("a.pdf")).toBe("application/pdf");
    expect(typeMimeDe("a.pptx")).toContain("presentationml");
    expect(typeMimeDe("a.inconnu")).toBe("application/octet-stream");
  });

  it("assainit un nom de segment de chemin en gardant les accents", () => {
    expect(nomSur("Cours: été/2026?.pdf")).toBe("Cours_ été_2026_.pdf");
    expect(nomSur("..caché")).toBe("_caché");
    expect(nomSur("   ")).toBe("fichier");
  });

  it("donne une clé de stockage sans accent, espace ni caractère risqué", () => {
    expect(nomDeStockage("Évaluation des acquis (v2).pdf")).toBe("Evaluation_des_acquis_v2_.pdf");
    expect(nomDeStockage("日本語")).toBe("fichier");
    expect(nomDeStockage("...")).toBe("fichier");
  });

  it("range le fichier sous <of_id>/coffres/<formation_id>/ : le préfixe que les politiques Storage exigent", () => {
    const chemin = cheminCoffre("of-1", "form-9", "ab12cd34_Évaluation finale.docx");
    expect(chemin).toBe("of-1/coffres/form-9/ab12cd34_Evaluation_finale.docx");
    expect(chemin.split("/").slice(0, 3)).toEqual(["of-1", "coffres", "form-9"]);
  });
});
