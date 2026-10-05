/**
 * Fonction serveur de suppression de compte (lot 8) — route 9, POST /compte/suppression.
 * (L'aperçu GET de la route 8 est « Client + RLS » : lot 1.)
 *
 * Réservée au formateur connecté (le rôle vient du jeton, jamais du corps). Le corps ne porte que la phrase de
 * confirmation et le mot de passe : ni identifiant, ni rôle, ni organisme. Voir `serveur/rgpd.server.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  agirEnTantQue,
  gardeFormateur,
  type ActeurFormateur,
  type Garde,
} from "./serveur/acteur.server";
import { echec } from "./serveur/erreurs.server";
import { supprimerCompteFormateur } from "./serveur/rgpd.server";

const gardeSuppression: Garde<ActeurFormateur> = (acteur) => {
  const g = gardeFormateur(acteur);
  return g.ok
    ? g
    : echec("interdit", "La suppression de compte en libre-service concerne les formateurs.");
};

export const supprimerMonCompte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ phrase: z.string().max(200), mot_de_passe: z.string().max(1000) }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeSuppression, ({ acteur, bd }) =>
      supprimerCompteFormateur(bd, acteur, data),
    ),
  );
