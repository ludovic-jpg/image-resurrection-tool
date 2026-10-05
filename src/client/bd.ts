/**
 * Client Supabase du navigateur, non typé.
 * Les types générés (`integrations/supabase/types.ts`) viennent de la base connectée : tant que les migrations
 * de `supabase/migrations/` ne sont pas appliquées, ils sont vides. Les types métier des réponses viennent
 * de `src/client/api.ts`, qui reste la référence de ce que les écrans attendent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const bd = supabase as unknown as SupabaseClient<any>;
