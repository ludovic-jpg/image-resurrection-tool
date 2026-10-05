/**
 * Fonctions serveur des formulaires apprenant (lot 5).
 *
 *   • 101 `envoyerFormulaireApprenant` — authentifiée (formateur ou administrateur du dossier).
 *   • 14 à 17 `lireFormulaire`, `enregistrerBrouillon`, `signerFormulaire`, `pdfFormulaire` — PUBLIQUES : aucun JWT,
 *     l'apprenant n'a pas toujours de compte. Elles s'authentifient par le JETON du lien, comparé par `sha256` ; un
 *     jeton inconnu, remplacé ou expiré donne « introuvable ». L'IP de l'appelant est consignée dans la preuve.
 *     La signature ne crée jamais de compte : au besoin, une ligne `invitation` est insérée et le lien envoyé.
 *
 * `supabaseAdmin` n'est jamais importé en tête de fichier : le client « service » est chargé dans le gestionnaire.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TYPES_EVALUATION } from "@/domaine/formulaires/evaluations";
import { agirEnTantQue, gardeRoles } from "./serveur/acteur.server";
import { clientService } from "./serveur/bd.server";
import { executer } from "./serveur/erreurs.server";
import { envoyerFormulaire } from "./serveur/formulaires.server";
import {
  enregistrerBrouillonPublic,
  lireFormulairePublic,
  signerFormulairePublic,
  telechargerPdfPublic,
} from "./serveur/formulaires-public.server";
import { adresseIpDeLaRequete } from "./serveur/requete.server";

/** Route 101. L'apprenant ne s'envoie pas de formulaire : `envoyerFormulaire` le refuse (403). */
export const envoyerFormulaireApprenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      dossier_id: z.string().min(1).max(100),
      stagiaire_id: z.string().min(1).max(100),
      type: z.enum(TYPES_EVALUATION as unknown as [string, ...string[]]),
      message: z.string().max(2000).optional(),
    }),
  )
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeRoles("admin", "formateur", "apprenant"), ({ acteur, bd }) =>
      envoyerFormulaire(
        bd,
        acteur,
        data.dossier_id,
        data.stagiaire_id,
        data.type as (typeof TYPES_EVALUATION)[number],
        { message: data.message },
      ),
    ),
  );

const jeton = z.object({ jeton: z.string().min(16).max(200) });

/** Route 14. */
export const lireFormulaire = createServerFn({ method: "POST" })
  .validator(jeton)
  .handler(async ({ data }) =>
    executer(async () => lireFormulairePublic(await clientService(), data.jeton)),
  );

/** Route 15. */
export const enregistrerBrouillon = createServerFn({ method: "POST" })
  .validator(jeton.extend({ corps: z.unknown() }))
  .handler(async ({ data }) =>
    executer(async () => enregistrerBrouillonPublic(await clientService(), data.jeton, data.corps)),
  );

/** Route 16. */
export const signerFormulaire = createServerFn({ method: "POST" })
  .validator(jeton.extend({ corps: z.unknown() }))
  .handler(async ({ data }) =>
    executer(async () =>
      signerFormulairePublic(
        await clientService(),
        data.jeton,
        data.corps,
        await adresseIpDeLaRequete(),
      ),
    ),
  );

/** Route 17. */
export const pdfFormulaire = createServerFn({ method: "POST" })
  .validator(jeton)
  .handler(async ({ data }) =>
    executer(async () => telechargerPdfPublic(await clientService(), data.jeton)),
  );
