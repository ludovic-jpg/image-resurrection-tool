/**
 * Erreurs métier côté serveur — équivalent de `ErreurMetier` de `src/serveur/services/socle.ts`.
 *
 * Dans un service, on LÈVE une `ErreurMetier` (pratique pour interrompre) ; `executer()` l'attrape à la frontière
 * de la fonction serveur et la transforme en résultat typé (`Echec`, voir `@/lib/resultat`). Toute autre exception
 * est une panne : elle est tracée dans les journaux du serveur et l'appelant reçoit un message générique.
 */
import {
  echec,
  succes,
  type CodeErreur,
  type DetailsErreur,
  type Echec,
  type Resultat,
} from "@/lib/resultat";

export { echec, succes };
export type { CodeErreur, DetailsErreur, Echec, Resultat };

export class ErreurMetier extends Error {
  constructor(
    readonly code: CodeErreur,
    message: string,
    readonly details: DetailsErreur | null = null,
  ) {
    super(message);
    this.name = "ErreurMetier";
  }
}

export const nonAuthentifie = (message = "Votre session a expiré. Reconnectez-vous.") =>
  new ErreurMetier("non_authentifie", message);
export const interdit = (message = "Cette action ne vous est pas permise.") =>
  new ErreurMetier("interdit", message);
export const introuvable = (quoi = "Élément") =>
  new ErreurMetier("introuvable", `${quoi} introuvable.`);
export const invalide = (message: string, details: DetailsErreur | null = null) =>
  new ErreurMetier("invalide", message, details);
export const conflit = (message: string) => new ErreurMetier("conflit", message);
export const indisponible = (message: string) => new ErreurMetier("indisponible", message);

export const MESSAGE_PANNE =
  "Une erreur est survenue. Réessayez ; si elle persiste, prévenez l'organisme.";

/** Transforme n'importe quelle exception en résultat d'échec ; seule une `ErreurMetier` garde son message. */
export function versEchec(e: unknown): Echec {
  if (e instanceof ErreurMetier) return echec(e.code, e.message, e.details);
  console.error("[serveur]", e);
  return echec("interne", MESSAGE_PANNE);
}

/** Exécute une action et renvoie `{ ok: true, donnees }` ou l'échec correspondant. Ne lève jamais. */
export async function executer<T>(action: () => Promise<T>): Promise<Resultat<T>> {
  try {
    return succes(await action());
  } catch (e) {
    return versEchec(e);
  }
}

/** Erreur renvoyée par Supabase (PostgREST / Storage) : on la journalise et on lève une panne générique. */
export function leverSiErreurBd(
  erreur: { message?: string; code?: string } | null,
  contexte: string,
): void {
  if (!erreur) return;
  console.error(`[bd] ${contexte}`, erreur);
  throw new Error(`${contexte} : ${erreur.message ?? "erreur inconnue"}`);
}
