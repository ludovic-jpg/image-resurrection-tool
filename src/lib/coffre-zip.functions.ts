/**
 * Fonction serveur de l'export ZIP du coffre-fort (lot 7) — « Edge Function `coffre` » de la carte des routes.
 *
 *   • `exporterCoffreZip` — route 53, GET /coffres-parcours/:id/zip. Réservée au personnel de l'organisme :
 *     l'administrateur (formations de son organisme) ou le formateur validé (ses formations) ; « introuvable » sinon.
 *
 * Le ZIP (JSZip, lecture de Storage) est renvoyé dans le résultat, encodé en base64 : une fonction serveur renvoie du
 * JSON, et le navigateur ne peut pas joindre le jeton de session à un simple lien. Voir
 * `src/client/passerelle/lot-7-coffre-zip.ts` pour la manière dont l'écran existant le télécharge.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { agirEnTantQue, gardeInterne } from "./serveur/acteur.server";
import { exporterCoffreZip as exporter } from "./serveur/coffre-zip.server";

export const exporterCoffreZip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ formation_id: z.string().min(1) }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeInterne, ({ acteur, bd }) =>
      exporter(bd, acteur, data.formation_id),
    ),
  );
