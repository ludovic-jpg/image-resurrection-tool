/**
 * Migration d'un ancien gabarit vers les variables harmonisées, à l'aide de la table d'alias.
 * Ne devine rien : ce qui est inconnu ou ambigu est rapporté et laissé en l'état, pour arbitrage humain.
 */
import { resoudreAlias } from "../referentiel/alias";
import { estVariableConnue } from "../referentiel/variables";

export interface RapportMigration {
  html: string;
  remplacements: Array<{ ancien: string; nouveau: string }>;
  ambigus: Array<{ ancien: string; candidats: readonly string[] }>;
  inconnus: string[];
}

export function migrerGabarit(ancienHtml: string): RapportMigration {
  const remplacements = new Map<string, string>();
  const ambigus = new Map<string, readonly string[]>();
  const inconnus = new Set<string>();

  const html = ancienHtml.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (tout, brut: string) => {
    const nom = brut.trim();
    if (estVariableConnue(nom)) return `{{${nom}}}`;
    const resolution = resoudreAlias(nom);
    if (resolution.statut === "resolu") {
      const nouveau = resolution.cibles.map((c) => `{{${c}}}`).join(" ");
      remplacements.set(nom, nouveau);
      return nouveau;
    }
    if (resolution.statut === "ambigu") ambigus.set(nom, resolution.candidats);
    else inconnus.add(nom);
    return tout;
  });

  return {
    html,
    remplacements: [...remplacements].map(([ancien, nouveau]) => ({ ancien, nouveau })),
    ambigus: [...ambigus].map(([ancien, candidats]) => ({ ancien, candidats })),
    inconnus: [...inconnus].sort(),
  };
}
