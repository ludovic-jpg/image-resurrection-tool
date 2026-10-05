/** Registre des gestionnaires d'appels. Séparé de l'aiguilleur pour éviter tout import circulaire avec `./passerelle`. */
import "./erreur";
export interface ContexteAppel {
  params: Record<string, string>;
  requete: URLSearchParams;
  corps: unknown;
}
export type Gestionnaire = (c: ContexteAppel) => Promise<unknown>;

interface Entree {
  methode: string;
  motif: RegExp;
  cles: string[];
  gestionnaire: Gestionnaire;
}
export const table: Entree[] = [];

/** Enregistre un gestionnaire. `:nom` désigne un paramètre de chemin. */
export function route(
  methode: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  chemin: string,
  gestionnaire: Gestionnaire,
) {
  const cles: string[] = [];
  const source = chemin.replace(/:([a-zA-Z_]+)/g, (_, nom: string) => {
    cles.push(nom);
    return "([^/]+)";
  });
  table.push({ methode, motif: new RegExp(`^${source}$`), cles, gestionnaire });
}

/** Les routes enregistrées, pour les tests et pour la carte de couverture. */
export const routesEnregistrees = () => table.map((e) => `${e.methode} ${e.motif.source}`);
