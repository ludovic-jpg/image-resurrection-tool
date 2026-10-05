/**
 * Lot 0 — démarrage : ce qu'il faut pour que le cadre de l'application s'affiche.
 * Authentification complète (inscription, invitation, mot de passe) : lot 1.
 */
import { route } from "../registre";
import { ErreurApi } from "../erreur";
import { bd } from "../bd";
import type { Moi } from "../api";

route("GET", "/auth/moi", async () => {
  const { data: session } = await bd.auth.getSession();
  if (!session.session) return { acteur: null } satisfies Moi;
  const { data, error } = await bd.rpc("s4m_moi");
  if (error) throw error;
  return (data ?? { acteur: null }) as Moi;
});

route("POST", "/auth/deconnexion", async () => {
  const { error } = await bd.auth.signOut();
  if (error) throw new ErreurApi("La déconnexion a échoué. Réessayez.", 500, "interne", null);
  return { ok: true };
});
