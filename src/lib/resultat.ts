/**
 * Résultat typé des fonctions serveur (`src/lib/*.functions.ts`) — importable par le serveur ET par le navigateur.
 *
 * Une fonction serveur ne lève pas d'exception pour une erreur métier : elle renvoie `{ ok: false, code, statut,
 * message, details }`, que le gestionnaire du lot (`src/client/passerelle/`) convertit en `ErreurApi` via
 * `src/client/appel-serveur.ts`. Les messages sont en français lisible ; le détail technique reste dans les
 * journaux du serveur. Format aligné sur la convention du projet : `{ erreur, code, details }` + 400/401/403/404/409.
 */

export type CodeErreur =
  | "non_authentifie" // 401
  | "interdit" // 403
  | "introuvable" // 404 — aussi pour un objet cloisonné : on ne révèle pas son existence
  | "invalide" // 400
  | "conflit" // 409
  | "indisponible" // 503 — configuration serveur manquante (secret, clé d'envoi…)
  | "interne"; // 500

export const STATUT_DU_CODE: Record<CodeErreur, number> = {
  non_authentifie: 401,
  interdit: 403,
  introuvable: 404,
  invalide: 400,
  conflit: 409,
  indisponible: 503,
  interne: 500,
};

export interface DetailsErreur {
  manques?: string[];
  champs?: Record<string, string>;
  erreurs?: string[] | Record<string, string>;
}

export interface Echec {
  ok: false;
  code: CodeErreur;
  statut: number;
  message: string;
  details: DetailsErreur | null;
}

export interface Succes<T> {
  ok: true;
  donnees: T;
}

export type Resultat<T> = Succes<T> | Echec;

export const succes = <T>(donnees: T): Succes<T> => ({ ok: true, donnees });

export function echec(
  code: CodeErreur,
  message: string,
  details: DetailsErreur | null = null,
): Echec {
  return { ok: false, code, statut: STATUT_DU_CODE[code], message, details };
}
