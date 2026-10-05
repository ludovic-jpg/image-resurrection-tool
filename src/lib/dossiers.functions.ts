/**
 * Fonctions serveur « dossiers » (lot 4) — l'Edge Function `dossiers` de la carte des routes.
 *
 *   • `creerDossier`            — route 88, POST /dossiers                      (formateur validé)
 *   • `definirStagiaires`       — route 93, PUT /dossiers/:id/stagiaires        (formateur validé)
 *   • `inviterApprenantDossier` — route 96, POST /dossiers/:id/inviter          (administrateur, formateur validé)
 *   • `relancerApprenantDossier`— route 97, POST /dossiers/:id/relancer         (administrateur, formateur validé)
 *   • `recreerDossier`          — route 98, POST /dossiers/:id/recreer          (formateur validé, comme l'ancien service)
 *   • `lireFinancesDossier`     — finances de `lireDossier` (route 89), calculées par le noyau côté serveur
 *
 * Pourquoi un serveur : compteur `ADF-AAAA-NNNN`, écritures de pièces, courriers et journal sont interdits au client.
 * L'acteur est reconstruit depuis le jeton de session, jamais depuis le corps. Un dossier d'un autre formateur ou
 * d'un autre organisme est « introuvable ». Les erreurs métier reviennent en résultat typé (`@/lib/resultat`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { agirEnTantQue, gardeFormateurValide, gardeInterne } from "./serveur/acteur.server";
import {
  creerLeDossier,
  definirStagiairesDuDossier,
  financesDuDossier,
  inviterLApprenant,
  recreerDepuisLeDossier,
  relancerLApprenant,
} from "./serveur/dossiers.server";

const identifiant = z.string().min(1).max(100);
const surDossier = z.object({ dossier_id: identifiant });
const surApprenant = z.object({ dossier_id: identifiant, stagiaire_id: identifiant });

/** Route 88. Le corps est validé par le noyau (`validerCreationDossier`) pour renvoyer des messages lisibles. */
export const creerDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.record(z.string(), z.unknown()))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) =>
      creerLeDossier(bd, acteur, data),
    ),
  );

/** Route 93. */
export const definirStagiaires = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ dossier_id: identifiant, stagiaire_ids: z.array(z.string()).max(50) }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) =>
      definirStagiairesDuDossier(bd, acteur, data.dossier_id, data.stagiaire_ids),
    ),
  );

/** Route 96. */
export const inviterApprenantDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(surApprenant)
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeInterne, ({ acteur, bd }) =>
      inviterLApprenant(bd, acteur, data.dossier_id, data.stagiaire_id),
    ),
  );

/** Route 97. */
export const relancerApprenantDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(surApprenant)
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeInterne, ({ acteur, bd }) =>
      relancerLApprenant(bd, acteur, data.dossier_id, data.stagiaire_id),
    ),
  );

/** Route 98. */
export const recreerDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(surDossier)
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeFormateurValide, ({ acteur, bd }) =>
      recreerDepuisLeDossier(bd, acteur, data.dossier_id),
    ),
  );

/** Finances d'un dossier (`calculer` du noyau). Interne seulement : l'apprenant ne voit jamais les finances. */
export const lireFinancesDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(surDossier)
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeInterne, ({ acteur, bd }) =>
      financesDuDossier(bd, acteur, data.dossier_id),
    ),
  );
