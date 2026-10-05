/**
 * Chiffrement des secrets enregistrés en base (clé d'API IA, mot de passe SMTP) — AES-256-GCM.
 *
 * La clé de chiffrement vient de l'environnement (`CLE_SECRETS`, 32 octets en hexadécimal) ; à défaut, elle est
 * créée une fois pour toutes dans un fichier `.cle-secrets` à côté de la base (mode 600) : sans configuration,
 * l'application reste utilisable, et la base seule ne suffit pas à lire les secrets.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Chiffreur {
  chiffrer(clair: string): string;
  dechiffrer(scelle: string): string;
}

const PREFIXE = "v1:";

export class ChiffreurAesGcm implements Chiffreur {
  constructor(private readonly cle: Buffer) {
    if (cle.length !== 32) throw new Error("La clé de chiffrement doit faire 32 octets.");
  }

  chiffrer(clair: string): string {
    if (!clair) return "";
    const iv = randomBytes(12);
    const chiffre = createCipheriv("aes-256-gcm", this.cle, iv);
    const donnees = Buffer.concat([chiffre.update(clair, "utf8"), chiffre.final()]);
    return `${PREFIXE}${Buffer.concat([iv, chiffre.getAuthTag(), donnees]).toString("base64")}`;
  }

  dechiffrer(scelle: string): string {
    if (!scelle) return "";
    if (!scelle.startsWith(PREFIXE)) throw new Error("Secret illisible : format inconnu.");
    const brut = Buffer.from(scelle.slice(PREFIXE.length), "base64");
    if (brut.length < 28) throw new Error("Secret illisible : données tronquées.");
    const iv = brut.subarray(0, 12);
    const tag = brut.subarray(12, 28);
    const donnees = brut.subarray(28);
    try {
      const dechiffre = createDecipheriv("aes-256-gcm", this.cle, iv);
      dechiffre.setAuthTag(tag);
      return Buffer.concat([dechiffre.update(donnees), dechiffre.final()]).toString("utf8");
    } catch {
      // Clé de chiffrement différente de celle qui a scellé le secret (CLE_SECRETS changée, fichier .cle-secrets perdu).
      throw new Error("Secret illisible : la clé de chiffrement a changé, il faut le ressaisir.");
    }
  }
}

/** Clé d'un environnement de test : aléatoire, jamais écrite. */
export const chiffreurEphemere = (): Chiffreur => new ChiffreurAesGcm(randomBytes(32));

/**
 * Clé de production : `CLE_SECRETS` (hex) si fournie, sinon un fichier créé à côté de la base de données.
 * Pour une base PostgreSQL distante (pas de dossier), le fichier est créé dans `dossierParDefaut`.
 */
export function chiffreurDepuisEnvironnement(cleHex: string, dossierParDefaut: string): Chiffreur {
  if (cleHex) {
    const cle = Buffer.from(cleHex.trim(), "hex");
    if (cle.length !== 32)
      throw new Error("CLE_SECRETS doit contenir 64 caractères hexadécimaux (32 octets).");
    return new ChiffreurAesGcm(cle);
  }
  const chemin = join(dossierParDefaut, ".cle-secrets");
  if (!existsSync(chemin)) {
    mkdirSync(dirname(chemin), { recursive: true });
    writeFileSync(chemin, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return new ChiffreurAesGcm(Buffer.from(readFileSync(chemin, "utf8").trim(), "hex"));
}
