/**
 * Accès au client « service » de Supabase (clé `service_role`, contourne la RLS).
 *
 * À utiliser seulement pour les écritures sensibles listées dans `lovable/KNOWLEDGE.md` (pipeline, pièces, signature,
 * factures, compteurs, journal, versions, courriers, IA, routes publiques par jeton) et pour LIRE ce que la RLS cache
 * à bon droit. Le client est chargé à l'appel (jamais en tête d'un `*.functions.ts`) et passé en paramètre aux modules
 * du socle : ils restent testables avec un client simulé et ne détiennent aucun état global.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Client non typé : les types générés sont vides tant que les migrations ne sont pas appliquées (CONVENTIONS §3). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BdService = SupabaseClient<any>;

export async function clientService(): Promise<BdService> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as BdService;
}
