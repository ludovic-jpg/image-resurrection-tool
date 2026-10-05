import type { AuthError } from "@supabase/supabase-js";

type ErreurAuth = Pick<AuthError, "code" | "status">;

const TROP_DE_TENTATIVES = "Trop de tentatives. Patientez quelques minutes puis réessayez.";

function limiteAtteinte(e: ErreurAuth): boolean {
  return (
    e.status === 429 ||
    e.code === "over_request_rate_limit" ||
    e.code === "over_email_send_rate_limit"
  );
}

export const MESSAGE_COMPTE_EXISTANT =
  "Un compte existe déjà avec cette adresse e-mail. Connectez-vous, ou réinitialisez votre mot de passe si vous l’avez oublié.";

export const MESSAGE_MOT_DE_PASSE_FAIBLE =
  "Ce mot de passe est trop faible ou trop courant. Choisissez-en un plus long et moins prévisible.";

export function messageConnexion(e: ErreurAuth): string {
  if (e.code === "email_not_confirmed") {
    return "Votre adresse e-mail n’est pas encore confirmée. Consultez votre messagerie.";
  }
  if (limiteAtteinte(e)) return TROP_DE_TENTATIVES;
  return "La connexion a échoué. Vérifiez votre adresse e-mail et votre mot de passe.";
}

export function messageInscription(e: ErreurAuth): string {
  if (e.code === "user_already_exists" || e.code === "email_exists") return MESSAGE_COMPTE_EXISTANT;
  if (e.code === "weak_password") return MESSAGE_MOT_DE_PASSE_FAIBLE;
  if (e.code === "signup_disabled") return "Les inscriptions sont momentanément fermées.";
  if (limiteAtteinte(e)) return TROP_DE_TENTATIVES;
  return "La création du compte a échoué. Vérifiez les informations puis réessayez. Si le problème persiste, contactez l’organisme.";
}

/** Le serveur refuse une invitation périmée, déjà utilisée ou émise pour une autre adresse : l'erreur reste générique côté Supabase. */
export function messageInvitation(e: ErreurAuth): string {
  if (e.code === "user_already_exists" || e.code === "email_exists") return MESSAGE_COMPTE_EXISTANT;
  if (e.code === "weak_password") return MESSAGE_MOT_DE_PASSE_FAIBLE;
  if (limiteAtteinte(e)) return TROP_DE_TENTATIVES;
  return "Cette invitation n’est plus valable ou ne correspond pas à cette adresse e-mail. Demandez un nouveau lien à l’organisme.";
}

export function messageReinitialisation(e: ErreurAuth): string {
  if (e.code === "same_password") return "Choisissez un mot de passe différent de l’ancien.";
  if (e.code === "weak_password") return MESSAGE_MOT_DE_PASSE_FAIBLE;
  if (limiteAtteinte(e)) return TROP_DE_TENTATIVES;
  return "Le mot de passe n’a pas pu être modifié. Le lien a peut-être expiré : demandez-en un nouveau.";
}
