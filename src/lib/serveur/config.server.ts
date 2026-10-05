/**
 * Configuration du serveur lue dans les variables d'environnement (secrets de Lovable Cloud / Cloudflare Workers).
 *
 * AUCUN secret dans le code. Chaque variable est facultative pour que l'application démarre ; c'est la fonction qui en
 * a besoin qui refuse proprement, avec un message qui nomme la variable à définir. Valeurs vides = non définies.
 *
 * Variables lues par le socle :
 *   CLE_SECRETS          64 caractères hexadécimaux (32 octets) — chiffrement des secrets des réglages
 *   RESEND_API_KEY       clé de l'API Resend — sans elle, aucun e-mail ne part (tout est seulement journalisé)
 *   COURRIER_EXPEDITEUR  adresse d'expédition par défaut (domaine vérifié chez Resend), ex. « Skills4mation <no-reply@…> »
 *   APP_URL              adresse publique de l'application, pour les liens des e-mails (repli : adresse de la requête)
 *   ARCHIVE_BUCKET, COFFRE_BUCKET, SUPPORTS_BUCKET   noms de buckets (défauts : archive, coffre, supports)
 * Fournies automatiquement par Lovable Cloud : SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */

export type NomVariable =
  | "CLE_SECRETS"
  | "RESEND_API_KEY"
  | "COURRIER_EXPEDITEUR"
  | "APP_URL"
  | "ARCHIVE_BUCKET"
  | "COFFRE_BUCKET"
  | "SUPPORTS_BUCKET"
  | "ANTHROPIC_API_KEY";

export function variable(nom: NomVariable): string | undefined {
  const brut = typeof process !== "undefined" ? process.env?.[nom] : undefined;
  const v = brut?.trim();
  return v ? v : undefined;
}

/**
 * Adresse publique de l'application, sans « / » final. `APP_URL` d'abord ; à défaut l'origine de la requête en cours
 * (le navigateur appelle la fonction serveur depuis l'application elle-même). Chaîne vide si rien n'est disponible :
 * l'appelant fabrique alors un lien relatif plutôt que de planter.
 */
export async function urlApplication(): Promise<string> {
  const configuree = variable("APP_URL");
  if (configuree) return configuree.replace(/\/+$/, "");
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const requete = getRequest();
    if (requete?.url) return new URL(requete.url).origin;
  } catch {
    /* hors requête (test, tâche planifiée) : pas d'adresse */
  }
  return "";
}
