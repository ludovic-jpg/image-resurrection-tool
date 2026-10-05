/**
 * Vérification d'un mot de passe par RECONNEXION (`signInWithPassword`), pour les actions irréversibles.
 *
 * Supabase n'expose aucune « vérification » de mot de passe : la seule preuve est une connexion réussie. On l'effectue
 * avec un client jetable (clé publique, aucune session conservée) pour ne pas toucher à la session de l'appelant.
 * Le mot de passe n'est jamais journalisé ni renvoyé.
 */
import { createClient } from "@supabase/supabase-js";

export type VerificateurMotDePasse = (email: string, motDePasse: string) => Promise<boolean>;

const estCleOpaque = (v: string) => v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");

/** Même contournement que les clients générés : une clé opaque n'est pas un jeton « Bearer ». */
function fetchPourCle(cle: string): typeof fetch {
  return (input, init) => {
    const entetes = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((v, k) => entetes.set(k, v));
    if (estCleOpaque(cle) && entetes.get("Authorization") === `Bearer ${cle}`)
      entetes.delete("Authorization");
    entetes.set("apikey", cle);
    return fetch(input, { ...init, headers: entetes });
  };
}

export const verifierParReconnexion: VerificateurMotDePasse = async (email, motDePasse) => {
  const url = process.env["SUPABASE_URL"];
  const cle = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !cle) {
    console.error("[rgpd] SUPABASE_URL ou SUPABASE_PUBLISHABLE_KEY manquant");
    throw new Error("Configuration Supabase incomplète.");
  }
  const client = createClient(url, cle, {
    global: { fetch: fetchPourCle(cle) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: motDePasse });
  if (!error) {
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    return true;
  }
  // Identifiants refusés : mot de passe faux. Toute autre cause (réseau, service) est une panne, pas un refus.
  if (error.status === 400 || error.status === 401 || error.code === "invalid_credentials")
    return false;
  console.error("[rgpd] vérification du mot de passe impossible", error);
  throw new Error("Vérification du mot de passe impossible.");
};
