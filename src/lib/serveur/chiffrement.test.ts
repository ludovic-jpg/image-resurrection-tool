// @vitest-environment node
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ChiffreurAesGcm } from "@/serveur/ports/chiffrement";
import { ErreurMetier } from "./erreurs.server";
import { creerChiffreur } from "./chiffrement.server";

const CLE = randomBytes(32).toString("hex");

describe("chiffrement des secrets (Web Crypto, format « v1: »)", () => {
  it("chiffre puis déchiffre, avec un format v1: et un aléa différent à chaque fois", async () => {
    const c = await creerChiffreur(CLE);
    const a = await c.chiffrer("sk-ant-secret é€");
    const b = await c.chiffrer("sk-ant-secret é€");
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toContain("secret");
    expect(a).not.toBe(b);
    expect(await c.dechiffrer(a)).toBe("sk-ant-secret é€");
  });

  it("une chaîne vide reste vide dans les deux sens", async () => {
    const c = await creerChiffreur(CLE);
    expect(await c.chiffrer("")).toBe("");
    expect(await c.dechiffrer("")).toBe("");
  });

  it("relit un secret scellé par l'ancien serveur (node:crypto), avec la même clé", async () => {
    const ancien = new ChiffreurAesGcm(Buffer.from(CLE, "hex"));
    const c = await creerChiffreur(CLE);
    expect(await c.dechiffrer(ancien.chiffrer("mot-de-passe-smtp"))).toBe("mot-de-passe-smtp");
  });

  it("produit un secret que l'ancien serveur sait relire", async () => {
    const ancien = new ChiffreurAesGcm(Buffer.from(CLE, "hex"));
    const c = await creerChiffreur(CLE);
    expect(ancien.dechiffrer(await c.chiffrer("clé d'API ünï"))).toBe("clé d'API ünï");
  });

  it("refuse un secret altéré ou scellé avec une autre clé, sans fuite", async () => {
    const c = await creerChiffreur(CLE);
    const autre = await creerChiffreur(randomBytes(32).toString("hex"));
    const scelle = await c.chiffrer("valeur");
    await expect(autre.dechiffrer(scelle)).rejects.toThrow(/clé de chiffrement a changé/);
    const abime = scelle.slice(0, -4) + (scelle.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(c.dechiffrer(abime)).rejects.toBeInstanceOf(ErreurMetier);
    await expect(c.dechiffrer("v1:AAAA")).rejects.toThrow(/tronquées/);
    await expect(c.dechiffrer("v1:court")).rejects.toThrow(/corrompues/);
    await expect(c.dechiffrer("clair")).rejects.toThrow(/format inconnu/);
  });

  it("sans clé ou avec une clé mal formée : refus clair qui nomme CLE_SECRETS", async () => {
    await expect(creerChiffreur(undefined)).rejects.toMatchObject({
      code: "indisponible",
      message: expect.stringContaining("CLE_SECRETS"),
    });
    await expect(creerChiffreur("pas-hexadecimal")).rejects.toThrow(/64 caractères hexadécimaux/);
    await expect(creerChiffreur("ab".repeat(31))).rejects.toThrow(/64 caractères hexadécimaux/);
  });
});
