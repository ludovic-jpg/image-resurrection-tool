/**
 * Lot 6 — positionnement avant dossier, côté formateur et organisme (section 1.11 de la carte, routes 79 à 83).
 *
 *   79  GET  /positionnements              Client + RLS : vue `positionnement_vue` (sans jeton, brouillon, questionnaire,
 *                                          réponses ni signature). Formateur validé : les siens ; admin : son organisme.
 *   80  POST /positionnements              fonction serveur (jeton + hash, questionnaire figé, e-mail, journal).
 *   81  POST /positionnements/:id/relancer fonction serveur (nouveau jeton, nouvel e-mail).
 *   82  POST /positionnements/:id/archiver Client + RLS (la colonne `archive_le` n'est pas verrouillée par le trigger).
 *   83  GET  /positionnements/:id/pdf      fonction serveur → `{ url, nom }` : lien signé de 60 s. La politique Storage de
 *                                          `archive` ne couvre pas `<of_id>/positionnements/` ; le serveur contrôle l'accès.
 *
 * Le résultat d'un apprenant (score, signature, PDF) se lit dans la liste et dans le document ; le détail des réponses
 * n'est jamais renvoyé par la liste. Aucun `update` du jeton, des réponses ou du statut n'est fait ici.
 */
import {
  inviterAuPositionnement,
  lienPdfPositionnement,
  relancerPositionnement,
} from "@/lib/positionnements.functions";
import { appelerServeur, corpsDe, exigerActeur, introuvable } from "../appel-serveur";
import { bd } from "../bd";
import { ErreurApi } from "../erreur";
import { route } from "../registre";
import type { LignePositionnement } from "../api";

/** Colonnes de la vue renvoyées à l'écran : exactement la forme de `listerPositionnements` du service Node. */
const COLONNES_LISTE =
  "id, formation_id, formation_titre, stagiaire_id, apprenant, email, entreprise, statut, expire, score, envoye_le, signe_le, pdf, archive_le";

const texte = (v: unknown) => (typeof v === "string" ? v : "");

route("GET", "/positionnements", async ({ requete }) => {
  const acteur = await exigerActeur(["admin", "formateur"]);
  if (acteur.role === "formateur" && !acteur.formateur_valide)
    throw new ErreurApi(
      "Votre candidature doit être validée par l'organisme avant d'accéder à cet espace.",
      403,
      "interdit",
      null,
    );
  let q = bd.from("positionnement_vue").select(COLONNES_LISTE);
  q = requete.get("archives") === "1" ? q.not("archive_le", "is", null) : q.is("archive_le", null);
  const formationId = requete.get("formation_id");
  if (formationId) q = q.eq("formation_id", formationId);
  if (acteur.role === "formateur") q = q.eq("formateur_id", acteur.formateur_id ?? "");
  const { data, error } = await q.order("cree_le", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as LignePositionnement[];
});

route("POST", "/positionnements", async ({ corps }) => {
  const c = corpsDe(corps);
  // L'acteur n'est pas lu dans le corps : le serveur le reconstruit depuis la session.
  return appelerServeur(() =>
    inviterAuPositionnement({
      data: {
        stagiaire_id: texte(c["stagiaire_id"]),
        formation_id: texte(c["formation_id"]),
        message: texte(c["message"]),
      },
    }),
  );
});

route("POST", "/positionnements/:id/relancer", ({ params }) =>
  appelerServeur(() => relancerPositionnement({ data: { id: params["id"] ?? "" } })),
);

route("POST", "/positionnements/:id/archiver", async ({ params, corps }) => {
  const acteur = await exigerActeur(["formateur"], "Cette action est réservée au formateur.");
  if (!acteur.formateur_valide)
    throw new ErreurApi(
      "Votre candidature doit être validée par l'organisme avant d'accéder à cet espace.",
      403,
      "interdit",
      null,
    );
  const archiver = corpsDe(corps)["archiver"] !== false;
  const { data, error } = await bd
    .from("positionnement")
    .update({ archive_le: archiver ? new Date().toISOString() : null })
    .eq("id", params["id"] ?? "")
    .eq("formateur_id", acteur.formateur_id ?? "")
    .select("id");
  if (error) throw error;
  if (!data?.length) throw introuvable("Positionnement");
  return { ok: true };
});

route("GET", "/positionnements/:id/pdf", ({ params }) =>
  appelerServeur(() => lienPdfPositionnement({ data: { id: params["id"] ?? "" } })),
);
