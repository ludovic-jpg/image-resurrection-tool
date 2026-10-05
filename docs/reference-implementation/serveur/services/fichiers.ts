/** Contrôle des fichiers déposés : taille bornée, extensions en liste blanche, nom assaini. */
import { invalide } from "./socle";

export interface FichierDepose {
  nom: string;
  type_mime: string;
  contenu: Buffer;
}

export const TAILLE_MAX_PIECE = 15 * 1024 * 1024;
export const TAILLE_MAX_COFFRE = 100 * 1024 * 1024;

const DOCUMENTS = ["pdf", "png", "jpg", "jpeg", "webp", "doc", "docx", "odt", "xls", "xlsx", "ods", "csv", "txt"];
const SUPPORTS = [...DOCUMENTS, "ppt", "pptx", "odp", "zip", "mp4", "mp3", "md"];

export function extensionDe(nom: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(nom);
  return m ? m[1]!.toLowerCase() : "";
}

export function validerFichier(f: FichierDepose, usage: "piece" | "coffre"): void {
  const max = usage === "coffre" ? TAILLE_MAX_COFFRE : TAILLE_MAX_PIECE;
  const autorisees = usage === "coffre" ? SUPPORTS : DOCUMENTS;
  if (f.contenu.length === 0) throw invalide("Le fichier est vide.");
  if (f.contenu.length > max) throw invalide(`Le fichier dépasse la taille maximale de ${Math.round(max / 1024 / 1024)} Mo.`);
  if (!autorisees.includes(extensionDe(f.nom))) throw invalide(`Type de fichier non accepté. Formats admis : ${autorisees.join(", ")}.`);
}

const TYPES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", html: "text/html; charset=utf-8",
  csv: "text/csv; charset=utf-8", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet", odp: "application/vnd.oasis.opendocument.presentation",
};

/** Type MIME déduit de l'extension — on ne fait jamais confiance à celui annoncé par le navigateur. */
export function typeMimeDe(nom: string): string {
  return TYPES[extensionDe(nom)] ?? "application/octet-stream";
}
