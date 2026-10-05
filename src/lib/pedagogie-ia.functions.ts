/**
 * Fonctions serveur de l'assistant IA pédagogique (lot 7) — « Edge Function `ia-assistant` » de la carte des routes.
 *
 *   • `lireEtatIa`          — route 57, GET  /ia/etat        : l'assistant est-il configuré ? avec quel moteur ?
 *   • `proposerQcm`         — routes 58 et 62, POST /ia/qcm et /ia/test (alias) : brouillon de QCM
 *   • `proposerProgramme`   — route 59, POST /ia/programme   : brouillon d'objectifs et de programme
 *   • `proposerParcours`    — route 60, POST /ia/parcours    : brouillon de parcours complet (recherche web)
 *   • `analyserEnjeux`      — route 61, POST /ia/enjeux      : dossier d'enjeux, ENREGISTRÉ sur la formation à la demande
 *   • `proposerPlanSupport` — route 63, POST /ia/plan-support: plan de 20 diapositives d'un module
 *
 * L'IA ne sert qu'à l'espace pédagogique : jamais pour les conventions, les pièces, le pipeline ni les montants (test de
 * garde `src/lib/serveur/ia-perimetre.test.ts`). Seuls les formateurs dont la candidature est validée peuvent
 * l'appeler (un administrateur ou un apprenant reçoit un 403 en français). Chaque proposition est un BROUILLON montré
 * au formateur : rien n'est enregistré sans son geste, sauf l'analyse des enjeux qu'il lance lui-même (route 61).
 *
 * Secrets : ANTHROPIC_API_KEY (ou clé chiffrée de l'organisme), IA_MODELE, IA_WORKSPACE_ID, IA_RECHERCHE_WEB, et
 * CLE_SECRETS pour lire la clé de l'organisme — voir `src/lib/serveur/ia.server.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  agirEnTantQue,
  gardeFormateurValide,
  gardeRoles,
  type ActeurFormateurValide,
} from "./serveur/acteur.server";
import type { BdService } from "./serveur/bd.server";
import * as ia from "./serveur/ia-pedagogie.server";

const corps = z.record(z.string(), z.unknown());

const contexteIa = (
  acteur: ActeurFormateurValide,
  bd: BdService,
  utilisateur?: unknown,
): ia.ContexteIa => ({ acteur, bd, bdUtilisateur: utilisateur as BdService | undefined });

export const lireEtatIa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    agirEnTantQue(context, gardeRoles("admin", "formateur", "apprenant"), ({ acteur, bd }) =>
      ia.etatIa(bd, acteur),
    ),
  );

export const proposerQcm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(corps)
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) =>
      ia.proposerQcm(contexteIa(acteur, bd), data),
    ),
  );

export const proposerProgramme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(corps)
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) =>
      ia.proposerProgramme(contexteIa(acteur, bd), data),
    ),
  );

export const proposerParcours = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(corps)
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) =>
      ia.proposerParcours(contexteIa(acteur, bd), data),
    ),
  );

export const analyserEnjeux = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(corps)
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) =>
      ia.analyserEnjeux(contexteIa(acteur, bd, context.supabase), data),
    ),
  );

export const proposerPlanSupport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(corps)
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) =>
      ia.proposerPlanSupport(contexteIa(acteur, bd), data),
    ),
  );
