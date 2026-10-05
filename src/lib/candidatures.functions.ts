/**
 * Fonctions serveur des candidatures de formateur (lot 3) — « Edge Function `candidatures` » de la carte des routes.
 *
 *   • `soumettreCandidature` — route 23, POST /candidature/soumettre. Réservée au formateur (même non validé).
 *     Contrôle des manques, passage à « soumise », journal, e-mail à chaque administrateur actif de l'organisme.
 *   • `deciderCandidature`   — route 27, POST /admin/candidatures/:id/decision. Réservée à l'administrateur.
 *     Validation ou rejet (motif obligatoire), journal, e-mail au candidat.
 *
 * Pourquoi un serveur ici (et non le client + RLS) : le passage à « soumise » doit vérifier les pièces obligatoires,
 * la décision écrit dans le journal (`evenement`, interdit au client) et les deux envoient un e-mail (`courrier`).
 * L'acteur est reconstruit depuis le jeton de session, jamais depuis les paramètres. Les erreurs métier reviennent en
 * résultat typé (`@/lib/resultat`) : un formateur qui appelle « décider » reçoit un refus 403 en français.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { courriels } from "@/domaine/courriels/modeles";
import { manquesCandidature } from "@/domaine/candidature/pieces";
import { agirEnTantQue, gardeAdmin, gardeFormateur } from "./serveur/acteur.server";
import { urlApplication } from "./serveur/config.server";
import { envoyerCourrier } from "./serveur/courrier.server";
import { conflit, introuvable, invalide, leverSiErreurBd } from "./serveur/erreurs.server";
import { journaliser } from "./serveur/journal.server";

export const soumettreCandidature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    agirEnTantQue(context, gardeFormateur, async ({ acteur, bd }) => {
      const { data: f, error } = await bd
        .from("formateur")
        .select("*")
        .eq("id", acteur.formateur_id)
        .eq("of_id", acteur.of_id)
        .maybeSingle();
      leverSiErreurBd(error, "lecture de la candidature");
      if (!f) throw introuvable("Candidature");
      if (f.statut_candidature === "validee") throw conflit("Votre candidature est déjà validée.");
      if (f.statut_candidature === "soumise")
        throw conflit("Votre candidature est déjà en cours d'étude.");

      const { data: pieces, error: errPieces } = await bd
        .from("piece_formateur")
        .select("type")
        .eq("formateur_id", f.id);
      leverSiErreurBd(errPieces, "lecture des pièces");
      const manques = manquesCandidature(f, (pieces ?? []) as Array<{ type: string }>);
      if (manques.length > 0) throw invalide("Votre candidature est incomplète.", { manques });

      // Le filtre sur l'ancien statut évite qu'une double soumission simultanée écrive deux fois.
      const { data: modifiees, error: errMaj } = await bd
        .from("formateur")
        .update({
          statut_candidature: "soumise",
          soumise_le: new Date().toISOString(),
          motif_decision: "",
        })
        .eq("id", f.id)
        .eq("statut_candidature", f.statut_candidature)
        .select("id");
      leverSiErreurBd(errMaj, "soumission de la candidature");
      if (!modifiees?.length)
        throw conflit("Votre candidature vient de changer d'état. Rechargez la page.");

      await journaliser(bd, {
        of_id: acteur.of_id,
        acteur,
        type: "candidature_soumise",
        libelle: `Candidature soumise par ${acteur.nom}`,
      });

      // Information des administrateurs : un échec d'e-mail ne défait pas la soumission.
      const [{ data: of }, { data: admins }] = await Promise.all([
        bd.from("organisme_formation").select("of_nom").eq("id", acteur.of_id).maybeSingle(),
        bd
          .from("utilisateur")
          .select("email")
          .eq("of_id", acteur.of_id)
          .eq("role", "admin")
          .eq("actif", true)
          .is("supprime_le", null),
      ]);
      const lien = `${await urlApplication()}/admin/candidatures`;
      for (const admin of (admins ?? []) as Array<{ email: string }>) {
        const c = courriels.candidatureSoumise({
          of_nom: (of as { of_nom?: string } | null)?.of_nom ?? "",
          candidat: acteur.nom,
          lien,
        });
        await envoyerCourrier(bd, {
          of_id: acteur.of_id,
          type: "candidature_soumise",
          destinataire: admin.email,
          ...c,
        });
      }
      return { formateur_id: f.id as string };
    }),
  );

export const deciderCandidature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      formateur_id: z.string().min(1).max(100),
      validee: z.boolean(),
      motif: z.string().max(2000).optional(),
    }),
  )
  .handler(({ context, data }) =>
    agirEnTantQue(context, gardeAdmin, async ({ acteur, bd }) => {
      // Le filtre sur l'organisme de l'administrateur : une candidature d'un autre organisme est « introuvable ».
      const { data: f, error } = await bd
        .from("formateur")
        .select("*")
        .eq("id", data.formateur_id)
        .eq("of_id", acteur.of_id)
        .maybeSingle();
      leverSiErreurBd(error, "lecture de la candidature");
      if (!f) throw introuvable("Candidature");
      if (f.statut_candidature !== "soumise")
        throw conflit("Seule une candidature soumise peut recevoir une décision.");
      const motif = data.motif?.trim() ?? "";
      if (!data.validee && !motif)
        throw invalide("Un motif est obligatoire pour rejeter une candidature.", {
          champs: { motif: "Indiquez le motif du rejet." },
        });

      const { data: modifiees, error: errMaj } = await bd
        .from("formateur")
        .update({
          statut_candidature: data.validee ? "validee" : "refusee",
          motif_decision: motif,
          decidee_le: new Date().toISOString(),
        })
        .eq("id", f.id)
        .eq("statut_candidature", "soumise")
        .select("id");
      leverSiErreurBd(errMaj, "enregistrement de la décision");
      if (!modifiees?.length)
        throw conflit("Cette candidature vient de recevoir une décision. Rechargez la page.");

      await journaliser(bd, {
        of_id: acteur.of_id,
        acteur,
        type: data.validee ? "candidature_validee" : "candidature_refusee",
        libelle: `Candidature de ${f.formateur_prenom} ${f.formateur_nom} ${data.validee ? "validée" : "rejetée"}`,
        detail: { formateur_id: f.id, motif },
      });

      const { data: of } = await bd
        .from("organisme_formation")
        .select("of_nom")
        .eq("id", acteur.of_id)
        .maybeSingle();
      const c = courriels.decisionCandidature({
        of_nom: (of as { of_nom?: string } | null)?.of_nom ?? "",
        prenom: f.formateur_prenom,
        validee: data.validee,
        motif,
        lien: `${await urlApplication()}/`,
      });
      const envoi = await envoyerCourrier(bd, {
        of_id: acteur.of_id,
        formateur_id: f.id,
        type: "candidature_decision",
        destinataire: f.formateur_email,
        ...c,
      });
      return {
        formateur_id: f.id as string,
        statut: data.validee ? "validee" : "refusee",
        courrier: envoi.statut,
      };
    }),
  );
