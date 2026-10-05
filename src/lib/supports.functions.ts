/**
 * Fonction serveur de production des supports (lot 7) — « Edge Function `supports-produire` » de la carte des routes.
 *
 *   • `produireSupport` — route 64, POST /supports : produit le PPTX d'UN module à partir d'un plan que le formateur a
 *     validé, et le range dans son coffre-fort. Réservée au formateur validé, sur SES formations (« introuvable » sinon).
 *
 * La route 65 (« produire tous les supports ») n'a pas de fonction serveur à elle : un module = un appel (la durée
 * maximale d'une fonction serveur ne permet pas douze appels d'IA en série). C'est le gestionnaire du lot, côté
 * navigateur, qui boucle module par module (plan → support) — voir `src/client/passerelle/lot-7-supports.ts`.
 *
 * PPTX : `pptxgenjs` s'exécute côté serveur (vérifié sous workerd) ; aucun appel à l'IA dans cette fonction.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { agirEnTantQue, gardeFormateurValide } from "./serveur/acteur.server";
import * as supports from "./serveur/supports.server";

export const produireSupport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.record(z.string(), z.unknown()))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) =>
      supports.produireSupport(bd, acteur, data),
    ),
  );
