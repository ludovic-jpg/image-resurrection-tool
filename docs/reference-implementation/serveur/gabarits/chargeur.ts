/**
 * Chargement des gabarits depuis le dossier `gabarits/` du dépôt. Seule partie du moteur qui touche au disque.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { CodePiece } from "@/domaine/referentiel/pieces";

const RACINE = fileURLToPath(new URL("../../../gabarits/", import.meta.url));
const cache = new Map<string, string>();

function lire(chemin: string): string {
  let contenu = cache.get(chemin);
  if (contenu === undefined) {
    contenu = readFileSync(chemin, "utf8");
    cache.set(chemin, contenu);
  }
  return contenu;
}

export function gabaritExiste(code: CodePiece): boolean {
  return existsSync(join(RACINE, `${code}.html`));
}

export function chargerGabarit(code: CodePiece): string {
  const chemin = join(RACINE, `${code}.html`);
  if (!existsSync(chemin)) throw new Error(`Aucun gabarit pour la pièce ${code}.`);
  return lire(chemin);
}

/** Fragments partagés. La couleur de l'organisme est injectée en tête de la feuille de style. */
export function chargerInclusions(couleurOf = "#1d6a45"): Record<string, string> {
  const couleur = /^#[0-9a-fA-F]{6}$/.test(couleurOf) ? couleurOf : "#1d6a45";
  return {
    styles: `:root{--of-couleur:${couleur}}\n${lire(join(RACINE, "fragments/styles.css"))}`,
    entete: lire(join(RACINE, "fragments/entete.html")),
    pied: lire(join(RACINE, "fragments/pied.html")),
  };
}
