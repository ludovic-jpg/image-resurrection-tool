/**
 * Lot 5 — formulaires apprenant.
 *
 * Fonction serveur authentifiée : 101 (envoi). Fonctions serveur PUBLIQUES (aucun JWT, jeton du lien) : 14, 15, 16, 17.
 * Client + RLS : 100 (état par dossier), 102 (URL signée du document d'invitation), 103 (liste de l'organisme).
 * Les vues `formulaire_apprenant_vue` ne contiennent ni jeton, ni brouillon : rien de sensible n'atteint le navigateur.
 *
 * Adaptation de TRANSPORT : 17 renvoie `{ url, nom, type_mime }` (URL signée de 60 s) et 102 la même forme, au lieu
 * d'un flux — voir le compte rendu du lot sur les liens `href` directs.
 */
import {
  CONFIG_EVALUATIONS,
  MOMENTS,
  TYPES_EVALUATION,
  estTypeEvaluation,
  questionnaireOuvert,
  statutSuiviFormulaire,
} from "@/domaine/formulaires/evaluations";
import { typeMimeDe } from "@/domaine/fichiers/regles";
import {
  enregistrerBrouillon,
  envoyerFormulaireApprenant,
  lireFormulaire,
  pdfFormulaire,
  signerFormulaire,
} from "@/lib/formulaires.functions";
import { appelerServeur, corpsDe } from "../appel-serveur";
import { bd } from "../bd";
import { route } from "../registre";
import { acteurCourant, exiger, interdit, introuvable, invalide, lire } from "./lot-2-commun";

const BUCKET_ARCHIVE = "archive";

// ——— Pages publiques (jeton) ———

route("GET", "/public/formulaire/:jeton", ({ params }) =>
  appelerServeur(() => lireFormulaire({ data: { jeton: params["jeton"] ?? "" } })),
);
route("PUT", "/public/formulaire/:jeton/brouillon", ({ params, corps }) =>
  appelerServeur(() =>
    enregistrerBrouillon({ data: { jeton: params["jeton"] ?? "", corps: corpsDe(corps) } }),
  ),
);
route("POST", "/public/formulaire/:jeton/signer", ({ params, corps }) =>
  appelerServeur(() =>
    signerFormulaire({ data: { jeton: params["jeton"] ?? "", corps: corpsDe(corps) } }),
  ),
);
route("GET", "/public/formulaire/:jeton/pdf", ({ params }) =>
  appelerServeur(() => pdfFormulaire({ data: { jeton: params["jeton"] ?? "" } })),
);

// ——— Côté formateur / organisme ———

route("POST", "/dossiers/:id/formulaires/envoyer", ({ params, corps }) => {
  const c = corpsDe(corps);
  const type = typeof c["type"] === "string" ? c["type"] : "";
  if (!estTypeEvaluation(type)) throw invalide("Formulaire inconnu.");
  return appelerServeur(() =>
    envoyerFormulaireApprenant({
      data: {
        dossier_id: params["id"] ?? "",
        stagiaire_id: typeof c["stagiaire_id"] === "string" ? c["stagiaire_id"] : "",
        type,
        ...(typeof c["message"] === "string" ? { message: c["message"] } : {}),
      },
    }),
  );
});

/** Étape du dossier : table complète pour l'interne, vue `dossier_formation_apprenant` pour l'apprenant. */
async function sousStatutDuDossier(dossierId: string, role: string): Promise<string> {
  const table = role === "apprenant" ? "dossier_formation_apprenant" : "dossier_formation";
  const d = exiger(
    await bd.from(table).select("sous_statut").eq("id", dossierId).maybeSingle(),
    "Dossier",
  ) as { sous_statut: string };
  return d.sous_statut;
}

/** Route 100 : pour chaque stagiaire et chaque type, état d'envoi et de réponse (sans jeton ni brouillon). */
route("GET", "/dossiers/:id/formulaires", async ({ params }) => {
  const dossierId = params["id"] ?? "";
  const acteur = await acteurCourant();
  const sousStatut = (await sousStatutDuDossier(dossierId, acteur.role)) as Parameters<
    typeof questionnaireOuvert
  >[0];
  const liens = (lire(
    await bd.from("stagiaire_dossier").select("stagiaire_id").eq("dossier_id", dossierId),
  ) ?? []) as Array<{ stagiaire_id: string }>;
  const lignes = (lire(
    await bd.from("formulaire_apprenant_vue").select("*").eq("dossier_id", dossierId),
  ) ?? []) as Array<{
    stagiaire_id: string;
    type: string;
    statut: string;
    envois: number;
    envoye_le: string | null;
    expire_le: string;
    signe_le: string | null;
    invitation: boolean;
  }>;
  const pieces = (lire(
    await bd
      .from("piece_dossier")
      .select("id, code, stagiaire_id, statut")
      .eq("dossier_id", dossierId),
  ) ?? []) as Array<{ id: string; code: string; stagiaire_id: string | null; statut: string }>;
  const maintenant = new Date();
  return liens
    .filter((l) => acteur.role !== "apprenant" || l.stagiaire_id === acteur.stagiaire_id)
    .flatMap(({ stagiaire_id }) =>
      TYPES_EVALUATION.map((type) => {
        const f = lignes.find((x) => x.stagiaire_id === stagiaire_id && x.type === type);
        const piece = pieces.find(
          (p) => p.code === CONFIG_EVALUATIONS[type].code && p.stagiaire_id === stagiaire_id,
        );
        return {
          stagiaire_id,
          type,
          libelle: CONFIG_EVALUATIONS[type].libelle,
          code: CONFIG_EVALUATIONS[type].code,
          moment: MOMENTS[type],
          ouvert: questionnaireOuvert(sousStatut, type),
          envoye_le: f?.envoye_le ?? null,
          envois: f?.envois ?? 0,
          statut: statutSuiviFormulaire(f, piece?.statut === "valide", maintenant),
          signe_le: f?.signe_le ?? null,
          piece_id: piece?.id ?? null,
          invitation: Boolean(f?.invitation),
        };
      }),
    );
});

/** Route 102 : URL signée (60 s) du document d'invitation, s'il existe. Lecture de la ligne soumise à la RLS. */
route("GET", "/dossiers/:id/formulaires/:stagiaire/:type/invitation", async ({ params }) => {
  const type = params["type"] ?? "";
  if (!estTypeEvaluation(type)) throw introuvable("Document d'invitation");
  await acteurCourant();
  const f = lire(
    await bd
      .from("formulaire_apprenant")
      .select("chemin_invitation")
      .eq("dossier_id", params["id"] ?? "")
      .eq("stagiaire_id", params["stagiaire"] ?? "")
      .eq("type", type)
      .maybeSingle(),
  ) as { chemin_invitation: string | null } | null;
  if (!f?.chemin_invitation) throw introuvable("Document d'invitation");
  const nom = f.chemin_invitation.split("/").pop() ?? "invitation";
  const { data, error } = await bd.storage
    .from(BUCKET_ARCHIVE)
    .createSignedUrl(f.chemin_invitation, 60, { download: nom });
  if (error || !data?.signedUrl) throw introuvable("Document d'invitation");
  return { url: data.signedUrl, nom, type_mime: typeMimeDe(nom) };
});

/** Route 103 : formulaires de l'organisme (boîte d'envoi). Refusée à l'apprenant ; la RLS cloisonne les formateurs. */
route("GET", "/formulaires", async ({ requete }) => {
  const acteur = await acteurCourant();
  if (acteur.role === "apprenant") throw interdit();
  let q = bd.from("formulaire_apprenant_vue").select("*");
  const dossierId = requete.get("dossier_id");
  if (dossierId) q = q.eq("dossier_id", dossierId);
  const lignes = (lire(await q.order("envoye_le", { ascending: false })) ?? []) as Array<
    Record<string, unknown> & { type: string }
  >;
  return lignes.map((f) => ({
    id: f["id"],
    dossier_id: f["dossier_id"],
    dossier_reference: f["dossier_reference"],
    formation_titre: f["formation_titre"],
    apprenant: f["apprenant"],
    type: f.type,
    libelle: estTypeEvaluation(f.type) ? CONFIG_EVALUATIONS[f.type].libelle : f.type,
    statut: f["statut"],
    envois: f["envois"],
    envoye_le: f["envoye_le"],
    signe_le: f["signe_le"],
  }));
});
