/**
 * Fonctions serveur publiques de l'authentification (lot 1). Aucune session n'existe encore à ce stade :
 * l'invitation s'authentifie par son jeton, comparé par empreinte SHA-256, comme dans l'ancien serveur.
 * L'accès aux tables passe par le client « service » ; il est chargé DANS le gestionnaire (jamais en tête de fichier).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const sha256Hex = async (texte: string) => {
  const octets = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return [...new Uint8Array(octets)].map((o) => o.toString(16).padStart(2, "0")).join("");
};

export type ResultatInvitation =
  { ok: true; email: string; prenom: string } | { ok: false; code: "invitation_invalide" };

/** Lecture seule : pré-remplit le formulaire d'invitation. N'écrit rien et ne révèle rien d'autre que l'e-mail et le prénom. */
export const lireInvitation = createServerFn({ method: "POST" })
  .validator(z.object({ jeton: z.string().min(16).max(200) }))
  .handler(async ({ data }): Promise<ResultatInvitation> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: lignes, error } = await supabaseAdmin
      .from("invitation" as never)
      .select("email, prenom")
      .eq("jeton_hash", await sha256Hex(data.jeton))
      .is("utilisee_le", null)
      .gt("expire_le", new Date().toISOString())
      .limit(1);
    if (error) throw error;
    const ligne = (lignes as { email: string; prenom: string }[] | null)?.[0];
    return ligne
      ? { ok: true, email: ligne.email, prenom: ligne.prenom }
      : { ok: false, code: "invitation_invalide" };
  });
