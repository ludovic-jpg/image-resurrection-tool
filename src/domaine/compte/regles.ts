/** Règles de compte partagées par l'interface et les fonctions serveur. Pur : aucun import technique. */

/** Longueur minimale d'un mot de passe. À régler à l'identique dans Authentication → Sign In / Providers. */
export const MOT_DE_PASSE_MIN = 10;

/** Renvoie le message d'erreur à afficher, ou `null` si le mot de passe convient. */
export function verifierMotDePasse(motDePasse: string): string | null {
  if (motDePasse.length < MOT_DE_PASSE_MIN) {
    return `Le mot de passe doit comporter au moins ${MOT_DE_PASSE_MIN} caractères.`;
  }
  return null;
}

/** Les adresses e-mail sont comparées en minuscules, sans espaces autour. */
export const normaliserEmail = (email: string) => email.trim().toLowerCase();
