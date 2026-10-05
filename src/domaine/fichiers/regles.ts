/**
 * Règles des fichiers déposés dans le coffre-fort : taille bornée, extensions en liste blanche, type MIME déduit de
 * l'extension, chemin de stockage `<of_id>/coffres/<formation_id>/<fichier>`.
 *
 * Versions PURES de `src/serveur/services/fichiers.ts` (le contenu est remplacé par sa taille) et de `nomSur` /
 * `cheminCoffre` de `src/serveur/ports/archive.ts`.
 */

export const TAILLE_MAX_COFFRE = 100 * 1024 * 1024;

const DOCUMENTS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "doc",
  "docx",
  "odt",
  "xls",
  "xlsx",
  "ods",
  "csv",
  "txt",
];
export const EXTENSIONS_COFFRE = [...DOCUMENTS, "ppt", "pptx", "odp", "zip", "mp4", "mp3", "md"];

export function extensionDe(nom: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(nom);
  return m ? m[1]!.toLowerCase() : "";
}

/** Message d'erreur lisible, ou `null` si le fichier est accepté dans le coffre. */
export function erreurFichierCoffre(f: { nom: string; taille: number }): string | null {
  if (f.taille === 0) return "Le fichier est vide.";
  if (f.taille > TAILLE_MAX_COFFRE)
    return `Le fichier dépasse la taille maximale de ${Math.round(TAILLE_MAX_COFFRE / 1024 / 1024)} Mo.`;
  if (!EXTENSIONS_COFFRE.includes(extensionDe(f.nom)))
    return `Type de fichier non accepté. Formats admis : ${EXTENSIONS_COFFRE.join(", ")}.`;
  return null;
}

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  html: "text/html; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  zip: "application/zip",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
};

/** Type MIME déduit de l'extension — on ne fait jamais confiance à celui annoncé par le navigateur. */
export function typeMimeDe(nom: string): string {
  return TYPES[extensionDe(nom)] ?? "application/octet-stream";
}

/** Nettoie un nom pour en faire un segment de chemin sûr, en conservant les accents lisibles. */
export function nomSur(nom: string): string {
  const propre = nom
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex -- les caractères de contrôle sont précisément ce qu'on veut retirer
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "_");
  return (propre || "fichier").slice(0, 150);
}

/**
 * Nom de fichier sûr pour une CLÉ de stockage : lettres, chiffres, point, tiret et soulignement uniquement.
 * Le nom d'origine (accents, espaces) reste dans `coffre_fichier.nom_fichier` ; seule la clé est simplifiée, car
 * Supabase Storage refuse certains caractères dans les clés d'objet.
 */
export function nomDeStockage(nom: string): string {
  const propre = nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 120);
  return propre || "fichier";
}

/** `<of_id>/coffres/<formation_id>/<fichier>` : le préfixe `<of_id>` est celui que les politiques Storage exigent. */
export function cheminCoffre(ofId: string, formationId: string, fichier: string): string {
  return [nomSur(ofId), "coffres", nomSur(formationId), nomDeStockage(fichier)].join("/");
}
