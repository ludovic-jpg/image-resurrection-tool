/**
 * Lectures volumineuses sur Supabase (PostgREST).
 *
 * Deux limites que l'ancien serveur (SQL direct) n'avait pas : une requête renvoie au plus 1000 lignes par défaut, et
 * un filtre `in (…)` passe dans l'adresse de la requête, qui ne supporte pas des milliers d'identifiants. Ces deux
 * aides lisent par pages et par lots, pour qu'un organisme de plusieurs centaines de dossiers ne soit jamais tronqué en
 * silence (un BPF faux sans erreur serait pire qu'un BPF en panne).
 */
import { leverSiErreurBd } from "./erreurs.server";

const TAILLE_PAGE = 1000;
const TAILLE_LOT = 100;

interface Page<T> {
  data: T[] | null;
  error: { message?: string; code?: string } | null;
}

/** Lit toutes les lignes d'une requête, page par page. La requête DOIT être ordonnée (ordre stable entre les pages). */
export async function lireTout<T>(
  page: (de: number, a: number) => PromiseLike<Page<T>>,
  contexte: string,
): Promise<T[]> {
  const lignes: T[] = [];
  for (let de = 0; ; de += TAILLE_PAGE) {
    const { data, error } = await page(de, de + TAILLE_PAGE - 1);
    leverSiErreurBd(error, contexte);
    const recues = data ?? [];
    lignes.push(...recues);
    if (recues.length < TAILLE_PAGE) return lignes;
  }
}

/** Lit toutes les lignes dont une colonne vaut l'un des identifiants, par lots de 100 identifiants. */
export async function lireParLots<T>(
  ids: readonly string[],
  page: (lot: string[], de: number, a: number) => PromiseLike<Page<T>>,
  contexte: string,
): Promise<T[]> {
  const uniques = [...new Set(ids)];
  const lignes: T[] = [];
  for (let i = 0; i < uniques.length; i += TAILLE_LOT) {
    const lot = uniques.slice(i, i + TAILLE_LOT);
    lignes.push(...(await lireTout((de, a) => page(lot, de, a), contexte)));
  }
  return lignes;
}
