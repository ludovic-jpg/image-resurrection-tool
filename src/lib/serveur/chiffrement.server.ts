/**
 * Chiffrement des secrets enregistrés en base (clé d'API IA, mot de passe SMTP) — AES-256-GCM par Web Crypto.
 *
 * FORMAT IDENTIQUE à `src/serveur/ports/chiffrement.ts` (donc à `reglages.ts`) : `v1:` + base64( iv[12] ‖ tag[16] ‖
 * données ). Les secrets déjà chiffrés par l'ancien serveur avec la même clé restent lisibles. Attention : Web Crypto
 * renvoie `données ‖ tag` ; on réordonne donc à l'écriture comme à la lecture.
 *
 * La clé est le secret `CLE_SECRETS` : 64 caractères hexadécimaux (32 octets). Sans elle, aucune écriture ni lecture de
 * secret n'est possible : on refuse avec un message qui dit quoi définir, jamais de clé de repli en clair dans le code.
 */
import { indisponible, ErreurMetier } from "./erreurs.server";
import { variable } from "./config.server";

const PREFIXE = "v1:";
const LONGUEUR_IV = 12;
const LONGUEUR_TAG = 16;

export interface Chiffreur {
  chiffrer(clair: string): Promise<string>;
  /** Lève une `ErreurMetier("indisponible")` si le secret est illisible (clé changée, données tronquées). */
  dechiffrer(scelle: string): Promise<string>;
}

export const MESSAGE_CLE_ABSENTE =
  "Le chiffrement des secrets n'est pas configuré : l'administrateur technique doit définir le secret CLE_SECRETS (64 caractères hexadécimaux) dans Lovable Cloud.";
export const MESSAGE_CLE_INVALIDE =
  "Le secret CLE_SECRETS est invalide : il doit contenir exactement 64 caractères hexadécimaux (32 octets).";

function hexVersOctets(hex: string): Uint8Array {
  const octets = new Uint8Array(hex.length / 2);
  for (let i = 0; i < octets.length; i++) octets[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return octets;
}

function enBase64(octets: Uint8Array): string {
  let s = "";
  for (let i = 0; i < octets.length; i += 0x8000)
    s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(s);
}

function deBase64(texte: string): Uint8Array {
  const s = atob(texte);
  const octets = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) octets[i] = s.charCodeAt(i);
  return octets;
}

/** Fabrique un chiffreur à partir d'une clé hexadécimale (64 caractères). Lève `indisponible` si elle est absente ou mal formée. */
export async function creerChiffreur(cleHex: string | undefined): Promise<Chiffreur> {
  if (!cleHex) throw indisponible(MESSAGE_CLE_ABSENTE);
  if (!/^[0-9a-fA-F]{64}$/.test(cleHex.trim())) throw indisponible(MESSAGE_CLE_INVALIDE);
  const cle = await crypto.subtle.importKey(
    "raw",
    hexVersOctets(cleHex.trim()) as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return {
    async chiffrer(clair) {
      if (!clair) return "";
      const iv = crypto.getRandomValues(new Uint8Array(LONGUEUR_IV));
      const sortie = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv as BufferSource, tagLength: LONGUEUR_TAG * 8 },
          cle,
          new TextEncoder().encode(clair),
        ),
      );
      const donnees = sortie.subarray(0, sortie.length - LONGUEUR_TAG);
      const tag = sortie.subarray(sortie.length - LONGUEUR_TAG);
      const scelle = new Uint8Array(LONGUEUR_IV + LONGUEUR_TAG + donnees.length);
      scelle.set(iv, 0);
      scelle.set(tag, LONGUEUR_IV);
      scelle.set(donnees, LONGUEUR_IV + LONGUEUR_TAG);
      return `${PREFIXE}${enBase64(scelle)}`;
    },
    async dechiffrer(scelle) {
      if (!scelle) return "";
      if (!scelle.startsWith(PREFIXE))
        throw new ErreurMetier("indisponible", "Secret illisible : format inconnu.");
      let brut: Uint8Array;
      try {
        brut = deBase64(scelle.slice(PREFIXE.length));
      } catch {
        throw new ErreurMetier("indisponible", "Secret illisible : données corrompues.");
      }
      if (brut.length < LONGUEUR_IV + LONGUEUR_TAG)
        throw new ErreurMetier("indisponible", "Secret illisible : données tronquées.");
      const iv = brut.subarray(0, LONGUEUR_IV);
      const tag = brut.subarray(LONGUEUR_IV, LONGUEUR_IV + LONGUEUR_TAG);
      const donnees = brut.subarray(LONGUEUR_IV + LONGUEUR_TAG);
      const entree = new Uint8Array(donnees.length + LONGUEUR_TAG);
      entree.set(donnees, 0);
      entree.set(tag, donnees.length);
      try {
        const clair = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: iv as BufferSource, tagLength: LONGUEUR_TAG * 8 },
          cle,
          entree as BufferSource,
        );
        return new TextDecoder().decode(clair);
      } catch {
        // Clé différente de celle qui a scellé le secret (CLE_SECRETS changée) : il faut le ressaisir.
        throw new ErreurMetier(
          "indisponible",
          "Secret illisible : la clé de chiffrement a changé, il faut le ressaisir.",
        );
      }
    },
  };
}

/** Chiffreur de production, avec la clé `CLE_SECRETS` de l'environnement. */
export const chiffreurDepuisEnvironnement = (): Promise<Chiffreur> =>
  creerChiffreur(variable("CLE_SECRETS"));

/** `true` si `CLE_SECRETS` est définie (sans en vérifier la forme) — pour l'écran d'état de la configuration. */
export const cleSecretsDefinie = (): boolean => variable("CLE_SECRETS") !== undefined;
