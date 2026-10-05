/**
 * Passerelle entre les gestionnaires de `src/client/passerelle/` et les fonctions serveur (`src/lib/*.functions.ts`),
 * puis aide commune aux gestionnaires « Client + RLS ». Créé au lot 3 ; les lots 4 à 8 le réutilisent.
 *
 *   • `appelerServeur(() => maFonction(...))` : exécute une fonction serveur et convertit son résultat typé
 *     (`{ ok: false, code, statut, message, details }`, voir `@/lib/resultat`) en `ErreurApi` — le format que les
 *     écrans connaissent. Un jeton absent ou expiré (refus du middleware d'authentification) devient un 401 français.
 *   • `acteurCourant()` / `exigerActeur(...roles)` : l'acteur de la session, lu par la fonction SQL `s4m_moi()`
 *     (même source que la RLS). Pour un gestionnaire « Client + RLS » dont la route est réservée à un rôle : la RLS
 *     protège les données, mais ne produit pas un refus 403 lisible.
 *
 * Aucun secret ici : ce module est livré au navigateur.
 */
import type { Resultat } from "@/lib/resultat";
import { bd } from "./bd";
import { ErreurApi } from "./erreur";
import type { Moi } from "./api";

export type ActeurClient = NonNullable<Moi["acteur"]>;

/** Convertit un résultat typé en valeur, ou lève l'`ErreurApi` correspondante. */
export function resoudre<T>(r: Resultat<T>): T {
  if (r.ok) return r.donnees;
  throw new ErreurApi(r.message, r.statut, r.code, r.details);
}

const SESSION_EXPIREE = () =>
  new ErreurApi("Votre session a expiré. Reconnectez-vous.", 401, "non_connecte", null);

export async function appelerServeur<T>(appel: () => Promise<Resultat<T>>): Promise<T> {
  try {
    return resoudre(await appel());
  } catch (e) {
    if (e instanceof ErreurApi) throw e;
    // Le middleware d'authentification lève « Unauthorized: … » quand le jeton manque ou n'est pas valide.
    if (e instanceof Error && /^Unauthorized/i.test(e.message)) throw SESSION_EXPIREE();
    throw e;
  }
}

/** L'acteur de la session courante, ou `null` sans session / sans profil actif. */
export async function acteurCourant(): Promise<ActeurClient | null> {
  const { data, error } = await bd.rpc("s4m_moi");
  if (error) throw error;
  return (data as Moi | null)?.acteur ?? null;
}

/** Exige un des rôles indiqués : 401 sans session, 403 (message français) sinon. */
export async function exigerActeur(
  roles: ReadonlyArray<ActeurClient["role"]>,
  messageRefus = "Cette action ne vous est pas permise.",
): Promise<ActeurClient> {
  const acteur = await acteurCourant();
  if (!acteur) throw SESSION_EXPIREE();
  if (!roles.includes(acteur.role)) throw new ErreurApi(messageRefus, 403, "interdit", null);
  return acteur;
}

export const corpsDe = (corps: unknown): Record<string, unknown> =>
  corps && typeof corps === "object" && !(corps instanceof FormData)
    ? (corps as Record<string, unknown>)
    : {};

/** « Introuvable » : un objet cloisonné par la RLS ne se distingue pas d'un objet absent. */
export const introuvable = (quoi: string) =>
  new ErreurApi(`${quoi} introuvable.`, 404, "introuvable", null);
