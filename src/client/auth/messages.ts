/**
 * Traduction des erreurs Supabase Auth en messages lisibles (français, sans détail technique).
 * Le détail technique reste dans la console, conformément à la règle « Erreurs » de KNOWLEDGE.md.
 */
type ErreurAuth =
  | { code?: string | undefined; message?: string | undefined; status?: number | undefined }
  | null
  | undefined;

export const LONGUEUR_MIN_MOT_DE_PASSE = 10;

export function messageConnexion(erreur: ErreurAuth): string {
  switch (erreur?.code) {
    case "email_not_confirmed":
      return "Votre adresse e-mail n’est pas encore confirmée. Ouvrez le lien reçu par e-mail, puis reconnectez-vous.";
    case "invalid_credentials":
      return "Adresse e-mail ou mot de passe incorrect.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
    case "user_banned":
      return "Ce compte est désactivé. Contactez votre organisme de formation.";
    default:
      return "La connexion a échoué. Vérifiez votre adresse e-mail et votre mot de passe.";
  }
}

export function messageInscription(erreur: ErreurAuth): string {
  switch (erreur?.code) {
    case "user_already_exists":
    case "email_exists":
      return "Un compte existe déjà avec cette adresse. Connectez-vous ou réinitialisez votre mot de passe.";
    case "weak_password":
      return `Mot de passe trop faible : ${LONGUEUR_MIN_MOT_DE_PASSE} caractères au minimum, évitez les mots de passe courants.`;
    case "signup_disabled":
      return "Les inscriptions sont fermées pour le moment.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
    case "unexpected_failure":
      // Le trigger `s4m_creer_profil_depuis_auth` a refusé l'inscription (organisme non configuré, rôle refusé…).
      return "L’inscription n’a pas pu être enregistrée par l’organisme. Réessayez plus tard ou contactez-le.";
    default:
      return "La création du compte a échoué. Vérifiez les informations puis réessayez.";
  }
}

export function journaliser(contexte: string, erreur: unknown) {
  console.error(`[S4M auth] ${contexte}`, erreur);
}
