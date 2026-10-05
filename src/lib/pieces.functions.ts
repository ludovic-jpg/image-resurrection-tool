/**
 * Fonctions serveur des pièces de dossier (lot 5) — « Edge Functions `pieces-*`, `signature-signer`, `emargement` ».
 *
 *   • 99  `deposerPieceExterneDossier`  • 105 `trameFactureDossier`      • 107 `enregistrerQuestionnaire`
 *   • 108 `apercuPieceDossier`          • 109 `telechargerPieceDossier`  • 110 `integritePieceDossier`
 *   • 111 `signerPieceDossier`          • 112 `deposerPieceDossier`      • 113 `regenererPieceDossier`
 *   • 114 `emargerSeance`
 *
 * Pourquoi un serveur : écritures dans `piece_dossier`, `signature`, `emargement`, `evaluation`, le journal et
 * l'archive (aucune politique d'écriture côté client), horodatage et empreinte calculés ICI, adresse IP relevée sur la
 * requête. L'acteur est reconstruit depuis le jeton de session, jamais depuis le corps. Un objet cloisonné par le rôle
 * (dossier d'un autre formateur, pièce d'un autre apprenant) est « introuvable ». Les dépôts de fichiers passent en
 * `FormData` (champ `fichier`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { estTypeEvaluation } from "@/domaine/formulaires/evaluations";
import { agirEnTantQue, gardeRoles } from "./serveur/acteur.server";
import { invalide } from "./serveur/erreurs.server";
import {
  apercuPiece,
  deposerPieceExterne,
  deposerRetour,
  emarger,
  enregistrerEvaluation,
  regenererPiece,
  signerPiece,
  telechargerPiece,
  trameFactureFormateur,
  verifierIntegritePiece,
} from "./serveur/pieces-retours.server";
import { adresseIpDeLaRequete } from "./serveur/requete.server";

const toutRole = gardeRoles("admin", "formateur", "apprenant");
const identifiant = z.string().min(1).max(100);

const demandeSignature = z.object({
  piece_id: identifiant,
  trace_png: z.string().max(400_000),
  lieu: z.string().max(200),
  consentement: z.boolean(),
});

/** Route 111 — signature en ligne d'une pièce. */
export const signerPieceDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(demandeSignature)
  .handler(({ context, data }) =>
    agirEnTantQue(context, toutRole, async ({ acteur, bd }) => {
      const piece = await signerPiece(
        bd,
        acteur,
        data.piece_id,
        { trace_png: data.trace_png, lieu: data.lieu, consentement: data.consentement },
        await adresseIpDeLaRequete(),
      );
      return { piece };
    }),
  );

/** Extrait le fichier d'un `FormData` ; refus lisible sinon. */
async function fichierDe(form: FormData) {
  const f = form.get("fichier");
  if (!(f instanceof File) || f.size === 0) throw invalide("Choisissez un fichier à déposer.");
  return { nom: f.name, contenu: new Uint8Array(await f.arrayBuffer()) };
}
const validerForm = (d: unknown): FormData => {
  if (!(d instanceof FormData)) throw new Error("Corps attendu : FormData.");
  return d;
};
const champ = (form: FormData, nom: string) => {
  const v = form.get(nom);
  return typeof v === "string" ? v.slice(0, 100) : "";
};

/** Route 112 — dépôt du retour d'une pièce (signée hors ligne, ou document externe). */
export const deposerPieceDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validerForm)
  .handler(({ context, data }) =>
    agirEnTantQue(context, toutRole, async ({ acteur, bd }) => {
      const piece = await deposerRetour(bd, acteur, champ(data, "piece_id"), await fichierDe(data));
      return { piece };
    }),
  );

/** Route 99 — dépôt d'une pièce externe (accord ou refus de financement) qui n'existe pas encore. */
export const deposerPieceExterneDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validerForm)
  .handler(({ context, data }) =>
    agirEnTantQue(context, toutRole, async ({ acteur, bd }) => {
      const piece = await deposerPieceExterne(
        bd,
        acteur,
        champ(data, "dossier_id"),
        champ(data, "code"),
        await fichierDe(data),
      );
      return { piece };
    }),
  );

/** Route 113 — régénération d'une pièce non validée. */
export const regenererPieceDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ piece_id: identifiant }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, toutRole, async ({ acteur, bd }) => ({
      piece: await regenererPiece(bd, acteur, data.piece_id),
    })),
  );

/** Route 108 — aperçu HTML courant. */
export const apercuPieceDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ piece_id: identifiant }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, toutRole, async ({ acteur, bd }) => ({
      html: await apercuPiece(bd, acteur, data.piece_id),
    })),
  );

/** Route 109 — lien de téléchargement temporaire (60 s). */
export const telechargerPieceDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ piece_id: identifiant, version: z.enum(["depart", "retour"]) }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, toutRole, ({ acteur, bd }) =>
      telechargerPiece(bd, acteur, data.piece_id, data.version),
    ),
  );

/** Route 110 — contrôle d'intégrité : relit le fichier archivé et compare l'empreinte scellée. */
export const integritePieceDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ piece_id: identifiant }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, toutRole, ({ acteur, bd }) =>
      verifierIntegritePiece(bd, acteur, data.piece_id),
    ),
  );

/** Route 105 — trame de facture pré-remplie (formateur ou administrateur). */
export const trameFactureDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ dossier_id: identifiant }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, toutRole, async ({ acteur, bd }) => ({
      html: await trameFactureFormateur(bd, acteur, data.dossier_id),
    })),
  );

/** Route 114 — émargement électronique d'une séance. */
export const emargerSeance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      seance_id: identifiant,
      trace_png: z.string().max(400_000),
      stagiaire_id: identifiant.optional(),
    }),
  )
  .handler(({ context, data }) =>
    agirEnTantQue(context, toutRole, async ({ acteur, bd }) => {
      await emarger(bd, acteur, data.seance_id, {
        trace_png: data.trace_png,
        stagiaire_id: data.stagiaire_id,
      });
      return { ok: true as const };
    }),
  );

/** Route 107 — réponses d'un questionnaire renseigné en ligne par l'apprenant connecté. */
export const enregistrerQuestionnaire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      dossier_id: identifiant,
      type: z.string().max(40),
      reponses: z.unknown(),
      ajustement: z.string().max(2000).optional(),
    }),
  )
  .handler(({ context, data }) =>
    agirEnTantQue(context, toutRole, async ({ acteur, bd }) => {
      if (!estTypeEvaluation(data.type)) throw invalide("Type de questionnaire inconnu.");
      return enregistrerEvaluation(bd, acteur, data.dossier_id, data.type, {
        reponses: data.reponses,
        ajustement: data.ajustement,
      });
    }),
  );
