import { describe, expect, it } from "vitest";
import { construireApercuSuppression } from "./apercu";

describe("aperçu de suppression de compte", () => {
  it("compte les brouillons, les dossiers conservés et ceux en cours", () => {
    const a = construireApercuSuppression([
      "brouillon",
      "brouillon",
      "archive",
      "formation_en_cours",
    ]);
    expect(a.dossiers_en_cours).toBe(1);
    expect(a.supprime).toContain("Vos 2 dossier(s) en brouillon");
    expect(a.conserve[0]).toMatch(/^2 dossier\(s\) de formation instruits/);
    expect(a.avertissement).toMatch(/1 dossier\(s\) sont encore en cours/);
  });
  it("ne met aucun avertissement s'il n'y a rien en cours", () => {
    expect(construireApercuSuppression([]).avertissement).toBe("");
  });
});
