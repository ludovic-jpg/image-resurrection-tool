/**
 * Hachage SHA-256 par Web Crypto (`crypto.subtle`) — disponible dans Cloudflare Workers, sans `node:crypto`.
 *
 * Sert aux empreintes de documents (signature, scellement), aux jetons d'invitation et de lien public (on ne stocke que
 * `sha256(jeton)`) et à toute comparaison d'intégrité. Remplace `createHash` de l'ancien serveur : l'appel est
 * asynchrone (CARTE_DES_ROUTES §3.9).
 */

const enHex = (octets: ArrayBuffer): string =>
  [...new Uint8Array(octets)].map((o) => o.toString(16).padStart(2, "0")).join("");

/** Empreinte SHA-256 en hexadécimal minuscule (64 caractères). Un texte est encodé en UTF-8. */
export async function sha256Hex(donnees: string | Uint8Array | ArrayBuffer): Promise<string> {
  const octets = typeof donnees === "string" ? new TextEncoder().encode(donnees) : donnees;
  return enHex(await crypto.subtle.digest("SHA-256", octets as BufferSource));
}

/** Jeton aléatoire cryptographique (hexadécimal, `octets` × 2 caractères) — 32 octets par défaut = 256 bits. */
export function jetonAleatoire(octets = 32): string {
  const tampon = new Uint8Array(octets);
  crypto.getRandomValues(tampon);
  return [...tampon].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/** Comparaison de deux empreintes en temps constant (évite de révéler la position de la première différence). */
export function empreintesEgales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i++) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}
