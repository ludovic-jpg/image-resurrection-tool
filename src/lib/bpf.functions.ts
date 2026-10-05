/**
 * Fonctions serveur du BPF (lot 8) — « Edge Function `bpf` » de la carte des routes.
 *
 *   • `lireBpf`        — route 115, GET /bpf[?exercice=AAAA]. Administrateur : tout l'organisme ; formateur : ses
 *     dossiers seulement ; apprenant : refusé (403).
 *   • `exporterBpfCsv` — route 116, GET /bpf/export?exercice=AAAA. Même périmètre ; renvoie le fichier CSV
 *     (`{ nom, contenu, type_mime }`) que le gestionnaire du lot remet au navigateur.
 *
 * Pourquoi un serveur : le calcul parcourt les dossiers, séances, émargements et pièces de tout l'organisme, ce que la
 * RLS d'un formateur ne permet pas pour l'administrateur en une seule lecture fiable. L'acteur vient du jeton.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { agirEnTantQue, gardeRoles } from "./serveur/acteur.server";
import { exporterBpfCsv as exporterCsv, lireBpf as lire } from "./serveur/bpf.server";

const exercice = z.number().int().min(1900).max(2200);

export const lireBpf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ exercice: exercice.optional() }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeRoles("admin", "formateur"), ({ acteur, bd }) =>
      lire(bd, acteur, data.exercice),
    ),
  );

export const exporterBpfCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ exercice }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeRoles("admin", "formateur"), ({ acteur, bd }) =>
      exporterCsv(bd, acteur, data.exercice),
    ),
  );
