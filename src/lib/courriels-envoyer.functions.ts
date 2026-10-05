/**
 * Fonctions serveur d'envoi d'e-mails (lot 3) — « Edge Function `courriels-envoyer` » de la carte des routes.
 *
 *   • `envoyerCourrielTest` — route 32, POST /admin/reglages/test-courriel (action « test »). Administrateur seulement :
 *     part à l'adresse de l'administrateur connecté et renvoie le résultat en clair (envoyé / seulement consigné / échec).
 *   • `renvoyerCourrier`    — route 34, POST /courriers/:id/renvoyer (action « renvoyer »). Administrateur, ou formateur
 *     validé pour SES courriers (ceux qui lui sont adressés ou qui portent sur ses dossiers). Un courrier d'un autre
 *     organisme, ou hors de la visibilité du formateur, est « introuvable ». Le renvoi crée une nouvelle ligne dans la
 *     boîte d'envoi, comme l'ancien serveur ; les pièces jointes sont relues dans l'archive.
 * L'envoi réel dépend du secret RESEND_API_KEY ; sans lui, tout est consigné et rien ne part (voir courrier.server.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { courrielDeTest } from "@/domaine/courriels/modeles";
import { agirEnTantQue, gardeAdmin, gardeInterne } from "./serveur/acteur.server";
import { envoyerCourrier, type PieceJointe } from "./serveur/courrier.server";
import { introuvable, leverSiErreurBd } from "./serveur/erreurs.server";

export const envoyerCourrielTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    agirEnTantQue(context, gardeAdmin, async ({ acteur, bd }) => {
      const c = courrielDeTest({ nom: acteur.nom, instant: new Date() });
      const r = await envoyerCourrier(bd, {
        of_id: acteur.of_id,
        type: "test_smtp",
        destinataire: acteur.email,
        ...c,
      });
      // `actif` : rien n'a empêché l'envoi réel (clé présente et envoi non coupé par l'organisme).
      return { ...r, actif: r.info === "", destinataire: acteur.email };
    }),
  );

const piecesJointesValides = (brut: unknown): PieceJointe[] =>
  Array.isArray(brut)
    ? brut.filter(
        (p): p is PieceJointe =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as PieceJointe).nom === "string" &&
          typeof (p as PieceJointe).chemin === "string",
      )
    : [];

export const renvoyerCourrier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ courrier_id: z.string().min(1).max(100) }))
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeInterne, async ({ acteur, bd }) => {
      const { data: l, error } = await bd
        .from("courrier")
        .select("*")
        .eq("id", data.courrier_id)
        .eq("of_id", acteur.of_id)
        .maybeSingle();
      leverSiErreurBd(error, "lecture du courrier");
      if (!l) throw introuvable("Courrier");

      if (acteur.role === "formateur") {
        let visible = l.formateur_id === acteur.formateur_id;
        if (!visible && l.dossier_id) {
          const { data: d, error: errD } = await bd
            .from("dossier_formation")
            .select("formateur_id")
            .eq("id", l.dossier_id)
            .maybeSingle();
          leverSiErreurBd(errD, "lecture du dossier");
          visible = (d as { formateur_id?: string } | null)?.formateur_id === acteur.formateur_id;
        }
        if (!visible) throw introuvable("Courrier");
      }

      return envoyerCourrier(bd, {
        of_id: l.of_id,
        dossier_id: l.dossier_id,
        formateur_id: l.formateur_id,
        type: l.type,
        destinataire: l.destinataire,
        sujet: l.sujet,
        corps_html: l.corps_html,
        pieces_jointes: piecesJointesValides(l.pieces_jointes),
      });
    }),
  );
