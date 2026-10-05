/**
 * Lot 8 — suppression de compte (route 9 de la carte). L'aperçu (route 8) est au lot 1.
 *
 * Fonction serveur (`src/lib/rgpd.functions.ts`) : phrase exacte « SUPPRIMER MON COMPTE » + mot de passe vérifié par
 * reconnexion, effacement atomique, suppression des fichiers et du compte Auth. Le corps ne porte ni identifiant ni
 * rôle : le serveur reconstruit l'acteur depuis le jeton. Aucune pré-vérification ici : toutes les règles sont serveur.
 */
import { supprimerMonCompte } from "@/lib/rgpd.functions";
import { appelerServeur, corpsDe } from "../appel-serveur";
import { bd } from "../bd";
import { route } from "../registre";

// 9 — POST /compte/suppression { phrase, mot_de_passe }
route("POST", "/compte/suppression", async ({ corps }) => {
  const c = corpsDe(corps);
  await appelerServeur(() =>
    supprimerMonCompte({
      data: { phrase: String(c["phrase"] ?? ""), mot_de_passe: String(c["mot_de_passe"] ?? "") },
    }),
  );
  // Le compte n'existe plus : on referme la session locale (l'ancien serveur supprimait le cookie).
  try {
    await bd.auth.signOut();
  } catch {
    /* session déjà invalide : rien à fermer */
  }
  return { ok: true };
});
