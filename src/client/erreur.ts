/** Erreur renvoyée à l'interface, quelle que soit la source (RLS, fonction SQL, fonction serveur). */
export class ErreurApi extends Error {
  constructor(
    message: string,
    readonly statut: number,
    readonly code: string | null,
    readonly details: {
      manques?: string[];
      champs?: Record<string, string>;
      erreurs?: string[] | Record<string, string>;
    } | null,
  ) {
    super(message);
  }
}
