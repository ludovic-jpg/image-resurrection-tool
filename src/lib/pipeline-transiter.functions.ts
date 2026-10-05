/**
 * Fonction serveur `pipeline-transiter` (lot 4) — route 95, POST /dossiers/:id/actions/:action.
 *
 * Le cœur du pipeline. L'acteur est reconstruit depuis le jeton de session (jamais depuis le corps) ; le noyau
 * (`transiter()` : rôle, étape, garde, motif) décide ; SEULEMENT s'il autorise, `executerTransition` écrit le
 * nouveau sous-statut et exécute les effets. Aucun autre chemin du code n'écrit `sous_statut`.
 *
 * Tout rôle connecté peut APPELER (l'apprenant déclare le dépôt de sa demande) : c'est le noyau, pas la garde de
 * rôle, qui refuse ce qui ne relève pas de l'acteur, avec un message lisible. Les actions réservées au système
 * (`enregistrer_accord`, `reevaluer_completude`) ne passent jamais par ici : aucun rôle utilisateur ne les porte.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { REGLES, type Action } from "@/domaine/pipeline/transitions";
import { agirEnTantQue, gardeRoles } from "./serveur/acteur.server";
import { invalide } from "./serveur/erreurs.server";
import { executerTransition } from "./serveur/pipeline.server";

export const transiterDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      dossier_id: z.string().min(1).max(100),
      action: z.string().max(60),
      motif: z.string().max(2000).optional(),
    }),
  )
  .handler(({ context, data }) =>
    agirEnTantQue(
      context,
      gardeRoles("admin", "formateur", "apprenant"),
      async ({ acteur, bd }) => {
        if (!Object.hasOwn(REGLES, data.action)) throw invalide("Action inconnue.");
        const d = await executerTransition(bd, acteur, data.dossier_id, data.action as Action, {
          motif: data.motif,
        });
        return { dossier_id: d.id, sous_statut: d.sous_statut };
      },
    ),
  );
