// @vitest-environment node
import { describe, expect, it } from "vitest";
import { empreintesEgales, jetonAleatoire, sha256Hex } from "./hacheur.server";

describe("hacheur SHA-256", () => {
  it("reproduit les vecteurs de référence", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it("donne la même empreinte pour un texte et ses octets UTF-8", async () => {
    const texte = "Évaluation — œuvre";
    expect(await sha256Hex(new TextEncoder().encode(texte))).toBe(await sha256Hex(texte));
  });
  it("compare en temps constant, longueurs différentes comprises", () => {
    expect(empreintesEgales("abcd", "abcd")).toBe(true);
    expect(empreintesEgales("abcd", "abce")).toBe(false);
    expect(empreintesEgales("abcd", "abc")).toBe(false);
  });
  it("fabrique des jetons hexadécimaux distincts de la longueur demandée", () => {
    const a = jetonAleatoire();
    const b = jetonAleatoire();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(jetonAleatoire(8)).toHaveLength(16);
  });
});
