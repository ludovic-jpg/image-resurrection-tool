/**
 * Fonctions serveur du positionnement, côté formateur (lot 6) — « Edge Function `positionnements` » de la carte.
 *
 *   • `inviterAuPositionnement` — route 80, POST /positionnements. Formateur validé.
 *   • `relancerPositionnement`  — route 81, POST /positionnements/:id/relancer. Formateur validé (l'admin reçoit un 403).
 *   • `lienPdfPositionnement`   — route 83, GET /positionnements/:id/pdf. Formateur propriétaire ou admin de l'organisme.
 *
 * L'acteur est reconstruit depuis le jeton de session (jamais depuis les paramètres) ; la logique est dans
 * `./serveur/positionnement.server`. Les erreurs métier reviennent en résultat typé (`@/lib/resultat`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  agirEnTantQue,
  gardeFormateurValide,
  gardeRoles,
  type Garde,
  type ActeurFormateurValide,
} from "./serveur/acteur.server";
import { echec } from "./serveur/erreurs.server";
import { inviter, relancer, urlPdf } from "./serveur/positionnement.server";

// Validation de FORME seulement (chaînes bornées) : les messages métier en français sont produits par le serveur.
const Texte = z.string().max(5000);

export const inviterAuPositionnement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ stagiaire_id: Texte, formation_id: Texte, message: Texte }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) => inviter(bd, acteur, data)),
  );

const gardeRelance: Garde<ActeurFormateurValide> = (a) =>
  a.role === "admin"
    ? echec("interdit", "La relance est faite par le formateur.")
    : gardeFormateurValide(a);

export const relancerPositionnement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeRelance, ({ acteur, bd }) => relancer(bd, acteur, data.id)),
  );

export const lienPdfPositionnement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeRoles("admin", "formateur"), ({ acteur, bd }) =>
      urlPdf(bd, acteur, data.id),
    ),
  );
