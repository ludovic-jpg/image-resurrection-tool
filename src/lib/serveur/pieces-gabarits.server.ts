/**
 * Gabarits HTML des pièces, EMBARQUÉS dans le build — aucune lecture de fichier à l'exécution (Cloudflare Workers
 * n'a pas de disque). `import.meta.glob(..., { query: "?raw", eager: true })` est résolu par Vite à la compilation :
 * le texte des fichiers de `gabarits/` devient des chaînes du bundle serveur. Les fichiers restent la seule source :
 * on ne les recopie pas, on ne les génère pas (le test `pieces-gabarits.test.ts` vérifie l'égalité octet pour octet
 * avec le dossier `gabarits/`, et que chaque pièce générée a bien son gabarit).
 */
import type { Fragments } from "@/domaine/pieces/rendu";
import type { CodePiece } from "@/domaine/referentiel/pieces";

const GABARITS = import.meta.glob("/gabarits/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const FRAGMENTS = import.meta.glob("/gabarits/fragments/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const gabarits = new Map<string, string>(
  Object.entries(GABARITS).map(([chemin, texte]) => [
    chemin.replace(/^.*\//, "").replace(/\.html$/, ""),
    texte,
  ]),
);

/** Codes de pièce pour lesquels un gabarit est embarqué. */
export const codesAvecGabarit = (): string[] => [...gabarits.keys()].sort();

export function gabaritExiste(code: CodePiece): boolean {
  return gabarits.has(code);
}

export function chargerGabarit(code: CodePiece): string {
  const g = gabarits.get(code);
  if (g === undefined) throw new Error(`Aucun gabarit pour la pièce ${code}.`);
  return g;
}

/** Fragments partagés (feuille de style, en-tête, pied de page). */
export function chargerFragments(): Fragments {
  const lire = (nom: string): string => {
    const texte = FRAGMENTS[`/gabarits/fragments/${nom}`];
    if (texte === undefined) throw new Error(`Fragment de gabarit manquant : ${nom}.`);
    return texte;
  };
  return { styles: lire("styles.css"), entete: lire("entete.html"), pied: lire("pied.html") };
}
