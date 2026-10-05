/**
 * Fonctions serveur des réglages de l'organisme (lot 3) — « Edge Function `reglages` » de la carte des routes.
 *
 *   • `enregistrerReglages` — route 31, PATCH /admin/reglages. Réservée à l'administrateur. Les secrets (clé d'IA, mot
 *     de passe SMTP) sont chiffrés en AES-GCM avec `CLE_SECRETS` (format « v1: » de l'ancien serveur) AVANT d'être
 *     écrits ; un secret vide = inchangé, « - » = effacer. Le journal ne reçoit que les NOMS des clés modifiées.
 *   • `etatConfiguration`   — état du serveur (secrets définis ou non), sans jamais en révéler la valeur : permet aux
 *     écrans d'expliquer ce qui manque au lieu d'échouer en silence.
 *
 * La LECTURE des réglages (route 30) ne passe pas par ici : elle lit la vue `reglage_vue`, qui n'expose aucun secret.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ecrituresReglages, validerReglages } from "@/domaine/reglages/catalogue";
import { agirEnTantQue, gardeAdmin } from "./serveur/acteur.server";
import { chiffreurDepuisEnvironnement, cleSecretsDefinie } from "./serveur/chiffrement.server";
import { envoiReelConfigure } from "./serveur/courrier.server";
import { invalide, leverSiErreurBd } from "./serveur/erreurs.server";
import { variable } from "./serveur/config.server";
import { journaliser } from "./serveur/journal.server";

export const enregistrerReglages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.record(z.string(), z.unknown()))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeAdmin, async ({ acteur, bd }) => {
      const v = validerReglages(data);
      if (!v.ok) throw invalide("Certains réglages sont invalides.", { champs: v.champs });
      const ecritures = ecrituresReglages(v.valeurs);
      if (ecritures.length === 0) return { cles: [] as string[] };

      // La clé n'est exigée que si un secret doit réellement être écrit (l'effacement n'en a pas besoin).
      const chiffreur = ecritures.some((e) => e.secret && e.clair !== "")
        ? await chiffreurDepuisEnvironnement()
        : null;
      const maj_le = new Date().toISOString();
      const lignes = [];
      for (const e of ecritures) {
        const valeur = e.secret && e.clair !== "" ? await chiffreur!.chiffrer(e.clair) : e.clair;
        lignes.push({ of_id: acteur.of_id, cle: e.cle, valeur, secret: e.secret, maj_le });
      }
      const { error } = await bd.from("reglage").upsert(lignes, { onConflict: "of_id,cle" });
      leverSiErreurBd(error, "enregistrement des réglages");

      const cles = ecritures.map((e) => e.cle);
      await journaliser(bd, {
        of_id: acteur.of_id,
        acteur,
        type: "reglages_modifies",
        libelle: "Réglages de l'organisme modifiés",
        detail: { cles },
      });
      return { cles };
    }),
  );

export interface EtatConfiguration {
  /** CLE_SECRETS définie : les secrets des réglages peuvent être enregistrés. */
  cle_secrets: boolean;
  /** RESEND_API_KEY définie : les e-mails peuvent réellement partir. */
  envoi_reel: boolean;
  /** COURRIER_EXPEDITEUR défini : adresse d'expédition par défaut. */
  expediteur_par_defaut: boolean;
  /** APP_URL défini : liens des e-mails fiables. */
  app_url: boolean;
  /** ANTHROPIC_API_KEY définie : l'assistant IA fonctionne sans clé propre à l'organisme. */
  ia_defaut_serveur: boolean;
}

export const etatConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    agirEnTantQue(context, gardeAdmin, async (): Promise<EtatConfiguration> => ({
      cle_secrets: cleSecretsDefinie(),
      envoi_reel: envoiReelConfigure(),
      expediteur_par_defaut: variable("COURRIER_EXPEDITEUR") !== undefined,
      app_url: variable("APP_URL") !== undefined,
      ia_defaut_serveur: variable("ANTHROPIC_API_KEY") !== undefined,
    })),
  );
