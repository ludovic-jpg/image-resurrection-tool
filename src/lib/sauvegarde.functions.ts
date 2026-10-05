/**
 * Fonctions serveur de la sauvegarde de l'espace pédagogique (lot 8) — « Edge Function `sauvegarde-rgpd` ».
 *
 *   • `exporterMesDonnees` — route 85, GET /sauvegarde/export : fichier JSON (portabilité, RGPD art. 20) + journal.
 *   • `importerMesDonnees` — route 86, POST /sauvegarde/import : recrée formations et questionnaires en copies + journal.
 *
 * Réservées au formateur dont la candidature est validée. Le jeton fixe l'acteur ; le corps ne porte que le fichier.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TAILLE_MAX_SAUVEGARDE } from "@/domaine/sauvegarde/sauvegarde";
import { agirEnTantQue, gardeFormateurValide } from "./serveur/acteur.server";
import {
  exporterMesDonnees as exporter,
  importerMesDonnees as importer,
} from "./serveur/sauvegarde.server";

export const exporterMesDonnees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) => exporter(bd, acteur)),
  );

export const importerMesDonnees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ contenu: z.string().max(TAILLE_MAX_SAUVEGARDE) }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) =>
      importer(bd, acteur, data.contenu),
    ),
  );
