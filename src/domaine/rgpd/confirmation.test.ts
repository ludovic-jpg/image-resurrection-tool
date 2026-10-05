import { describe, expect, it } from "vitest";
import { phraseDeConfirmationValide } from "./confirmation";

describe("phrase de confirmation de la suppression de compte", () => {
  it("accepte la phrase exacte, espaces autour tolérés", () => {
    expect(phraseDeConfirmationValide("SUPPRIMER MON COMPTE")).toBe(true);
    expect(phraseDeConfirmationValide("  SUPPRIMER MON COMPTE\n")).toBe(true);
  });
  it.each([
    "",
    "supprimer mon compte",
    "Supprimer mon compte",
    "SUPPRIMER  MON COMPTE",
    "SUPPRIMER MON COMPTE.",
    "SUPPRIMER MON",
    "SUPPRIMER MON COMPTES",
    "OUI SUPPRIMER MON COMPTE",
  ])("refuse « %s »", (phrase) => {
    expect(phraseDeConfirmationValide(phrase)).toBe(false);
  });
  it("refuse tout ce qui n'est pas du texte", () => {
    for (const v of [undefined, null, 0, true, {}, ["SUPPRIMER MON COMPTE"]])
      expect(phraseDeConfirmationValide(v)).toBe(false);
  });
});
