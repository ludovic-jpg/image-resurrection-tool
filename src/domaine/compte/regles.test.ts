import { describe, expect, it } from "vitest";
import { MOT_DE_PASSE_MIN, normaliserEmail, verifierMotDePasse } from "./regles";

describe("règles de compte", () => {
  it("refuse un mot de passe trop court et accepte la longueur minimale", () => {
    expect(verifierMotDePasse("a".repeat(MOT_DE_PASSE_MIN - 1))).toMatch(/au moins 10 caractères/);
    expect(verifierMotDePasse("a".repeat(MOT_DE_PASSE_MIN))).toBeNull();
  });
  it("normalise l'adresse e-mail", () => {
    expect(normaliserEmail("  Direction@Exemple.FR ")).toBe("direction@exemple.fr");
  });
});
