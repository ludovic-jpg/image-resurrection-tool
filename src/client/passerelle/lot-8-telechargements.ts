/**
 * Lot 8 — téléchargements des écrans « BPF » et « Archives » (liens `<a href="/api/…">` déjà en place).
 *
 * Un lien ne porte pas le jeton de session : avec Supabase, `GET /api/bpf/export` ouvert par le navigateur serait
 * anonyme. Les écrans ne sont pas réécrits ; ce module intercepte donc, au clic, UNIQUEMENT les deux liens d'export
 * du lot (BPF en CSV, sauvegarde en JSON), appelle la route correspondante par l'aiguilleur (qui, lui, est
 * authentifié) puis remet le fichier au navigateur. Tout autre lien est laissé tel quel.
 */

/** Chemins interceptés : chacun correspond à une route du lot qui renvoie `{ nom, contenu, type_mime }`. */
export const LIENS_DE_TELECHARGEMENT: readonly string[] = [
  "/api/bpf/export",
  "/api/sauvegarde/export",
];

export interface FichierATelecharger {
  nom: string;
  contenu: string;
  type_mime: string;
}

/** Remet un fichier texte au navigateur (le BOM UTF-8 du CSV est conservé : Excel affiche ainsi les accents). */
export function enregistrerFichier({ nom, contenu, type_mime }: FichierATelecharger): void {
  const url = URL.createObjectURL(new Blob([contenu], { type: type_mime }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  lien.style.display = "none";
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Si ce `href` est un lien d'export du lot, renvoie la route de l'aiguilleur (sans le préfixe `/api`). */
export function routeDuLien(href: string | null): string | null {
  if (!href) return null;
  const chemin = href.split("?")[0] ?? "";
  return LIENS_DE_TELECHARGEMENT.includes(chemin) ? href.slice("/api".length) : null;
}

async function surClic(evenement: MouseEvent): Promise<void> {
  if (evenement.defaultPrevented || evenement.button !== 0) return;
  const cible = evenement.target instanceof Element ? evenement.target.closest("a[href]") : null;
  const route = routeDuLien(cible?.getAttribute("href") ?? null);
  if (!route) return;
  evenement.preventDefault();
  try {
    const { aiguiller } = await import("../aiguilleur");
    enregistrerFichier((await aiguiller("GET", route)) as FichierATelecharger);
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "Le téléchargement a échoué. Réessayez.");
  }
}

const MARQUE = "__s4m_telechargements_lot8";
if (typeof document !== "undefined" && !(MARQUE in globalThis)) {
  Object.defineProperty(globalThis, MARQUE, { value: true });
  document.addEventListener("click", (e) => void surClic(e), true);
}
