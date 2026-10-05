/**
 * Chemins de fichiers dans les buckets Storage (`archive`, `coffre`, `supports`) — règle PURE.
 *
 * Tous les chemins commencent par `<of_id>/` : c'est ce préfixe que lisent les politiques `storage.objects`
 * (`storage.foldername(name)[1] = s4m_of_id()`). Les formes sont celles de l'ancien serveur
 * (`src/serveur/ports/archive.ts`) ; seule différence : `nomSur` produit des clés acceptées par Storage
 * (ASCII sans caractère réservé), le nom d'origine restant mémorisé à part (`nom_fichier`).
 */

export type SousDossier = "Pièces de départ" | "Retour";

/** Espaces insécables (fine, figure, normale) que Storage refuse dans une clé. */
const ESPACES_INSECABLES = new RegExp("[\u00a0\u2007\u202f]", "g");
/** Séparateurs, caractères de contrôle et caractères que Storage déconseille ou refuse. */
// eslint-disable-next-line no-control-regex -- les caractères de contrôle sont précisément ce qu'on veut retirer
const INTERDITS = /[\\/:*?"<>|#%{}^~[\]`\u0000-\u001f\u007f]/g;

/**
 * Nettoie un nom pour en faire UN segment de chemin sûr : pas de séparateur, pas de point en tête (`..`), accents
 * retirés (« Diplôme n°2.pdf » → « Diplome n2.pdf »), longueur bornée à 150 en gardant l'extension.
 */
export function nomSur(nom: string): string {
  const ascii = nom
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/ß/g, "ss")
    .replace(ESPACES_INSECABLES, " ")
    .replace(/[^\x20-\x7e]/g, "_");
  const propre = ascii.replace(INTERDITS, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "_");
  if (!propre) return "fichier";
  if (propre.length <= 150) return propre;
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(propre)?.[0] ?? "";
  return propre.slice(0, 150 - ext.length) + ext;
}

export function cheminCandidature(ofId: string, formateurId: string, fichier: string): string {
  return [nomSur(ofId), "candidatures", nomSur(formateurId), nomSur(fichier)].join("/");
}

export function cheminCoffre(ofId: string, formationId: string, fichier: string): string {
  return [nomSur(ofId), "coffres", nomSur(formationId), nomSur(fichier)].join("/");
}

export function cheminSupport(ofId: string, formationId: string, fichier: string): string {
  return [nomSur(ofId), "supports", nomSur(formationId), nomSur(fichier)].join("/");
}

export function cheminPiece(
  ofId: string,
  dossierReference: string,
  sousDossier: SousDossier,
  fichier: string,
): string {
  return [nomSur(ofId), "dossiers", nomSur(dossierReference), sousDossier, nomSur(fichier)].join(
    "/",
  );
}

/** Le premier segment d'un chemin = l'organisme propriétaire. Sert à refuser un chemin d'un autre OF. */
export function ofDuChemin(chemin: string): string {
  return chemin.split("/")[0] ?? "";
}

/** Un chemin est acceptable s'il est relatif, sans `..` et placé sous l'organisme indiqué. */
export function cheminAppartientA(chemin: string, ofId: string): boolean {
  if (!ofId || chemin.startsWith("/") || chemin.includes("\\")) return false;
  const segments = chemin.split("/");
  if (segments.length < 2 || segments.some((s) => s === "" || s === "." || s === ".."))
    return false;
  return segments[0] === ofId;
}
