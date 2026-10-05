/**
 * Lot 7 — export du coffre-fort d'un parcours en ZIP (route 53 de la carte).
 *
 *  53  GET /coffres-parcours/:id/zip   fonction serveur `exporterCoffreZip` (JSZip + lecture de Storage).
 *      Réponse : `{ nom, type_mime, taille, contenu_base64 }`.
 *
 * L'écran du coffre (non réécrit) propose le ZIP par un simple lien `<a href="/api/coffres-parcours/:id/zip">`. Un lien
 * ne peut pas porter le jeton de session (Supabase le garde dans le navigateur, pas dans un cookie) : on intercepte donc
 * ici le clic sur CE lien, on appelle la fonction serveur avec le jeton, puis on fait télécharger le fichier reçu.
 * L'interception ne concerne que ce motif d'adresse ; elle ne s'installe qu'une fois et seulement dans un navigateur.
 */
import { exporterCoffreZip } from "@/lib/coffre-zip.functions";
import { appelerServeur } from "../appel-serveur";
import { route } from "../registre";

export interface ZipRecu {
  nom: string;
  type_mime: string;
  taille: number;
  contenu_base64: string;
}

route(
  "GET",
  "/coffres-parcours/:id/zip",
  async ({ params }) =>
    (await appelerServeur(() =>
      exporterCoffreZip({ data: { formation_id: params["id"] ?? "" } }),
    )) as ZipRecu,
);

export function octetsDepuisBase64(base64: string): Uint8Array {
  const texte = atob(base64);
  const octets = new Uint8Array(texte.length);
  for (let i = 0; i < texte.length; i++) octets[i] = texte.charCodeAt(i);
  return octets;
}

/** Déclenche le téléchargement d'un fichier reçu en base64 (lien temporaire, libéré aussitôt). */
export function faireTelecharger(zip: ZipRecu): void {
  const blob = new Blob([octetsDepuisBase64(zip.contenu_base64) as BlobPart], {
    type: zip.type_mime,
  });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = zip.nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const MOTIF_LIEN_ZIP = /^\/api\/coffres-parcours\/([^/?#]+)\/zip$/;

/** Gestionnaire du clic : ignore les clics modifiés (nouvel onglet) comme le fait un lien ordinaire. */
export async function surClicLienZip(ev: MouseEvent): Promise<void> {
  if (
    ev.defaultPrevented ||
    ev.button !== 0 ||
    ev.metaKey ||
    ev.ctrlKey ||
    ev.shiftKey ||
    ev.altKey
  )
    return;
  const lien = (ev.target as Element | null)?.closest?.("a[href]");
  const m = MOTIF_LIEN_ZIP.exec(lien?.getAttribute("href") ?? "");
  if (!m) return;
  ev.preventDefault();
  try {
    const id = decodeURIComponent(m[1] ?? "");
    const zip = await appelerServeur(() => exporterCoffreZip({ data: { formation_id: id } }));
    faireTelecharger(zip);
  } catch (e) {
    window.alert(
      e instanceof Error && e.message
        ? e.message
        : "L'export du coffre-fort a échoué. Réessayez dans un instant.",
    );
  }
}

declare global {
  interface Window {
    __s4mZipInstalle?: boolean;
  }
}

if (typeof document !== "undefined" && !window.__s4mZipInstalle) {
  window.__s4mZipInstalle = true;
  // Phase de capture : avant les gestionnaires de l'application, sans rien y changer.
  document.addEventListener("click", (ev) => void surClicLienZip(ev), true);
}
