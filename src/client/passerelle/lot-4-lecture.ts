/**
 * Lot 4 — lectures de dossiers (Client + RLS, RPC SQL) : routes 87, 89, 100, 102, 103, 104 et 106 de la carte.
 *
 *   87  GET /dossiers                                      RPC `s4m_lister_dossiers()` (étapes et sous-statuts : noyau)
 *   89  GET /dossiers/:id                                  voir `lot-4-dossier.ts`
 *   100 GET /dossiers/:id/formulaires                      vue `formulaire_apprenant_vue` + pièces (interne)
 *   102 GET /dossiers/:id/formulaires/:stagiaire/:type/invitation   URL signée du document d'invitation (interne)
 *   103 GET /formulaires                                   vue `formulaire_apprenant_vue` (interne)
 *   104 GET /dossiers/:id/emargement                       `seance` + `emargement` (l'apprenant : ses pointages, par la RLS)
 *   106 GET /dossiers/:id/questionnaires/:type             RPC `s4m_questionnaire()` (corrigé retiré pour l'apprenant)
 *
 * Les routes 100 à 104 et 106 appartiennent à la section 1.13 de la carte et sont de cible « Client + RLS » / « RPC SQL » :
 * elles sont portées ici, pas au lot 5. La RLS cloisonne ; ces gestionnaires refusent le mauvais rôle (403) et
 * traduisent « aucune ligne » en 404 « introuvable ». Aucune écriture.
 */
import {
  CONFIG_EVALUATIONS,
  MOMENTS,
  TYPES_EVALUATION,
  formulaireDe,
  questionnaireOuvert,
  statutFormulaire,
  type TypeEvaluation,
} from "@/domaine/dossier/evaluations";
import { dureeSeanceHeures } from "@/domaine/dossier/formats";
import { ETAPES, SOUS_STATUTS, type SousStatut } from "@/domaine/pipeline/statuts";
import { bd } from "../bd";
import { ErreurApi } from "../erreur";
import { route } from "../registre";
import type {
  CarteDossier,
  EtatFormulaire,
  LigneFormulaire,
  ListeDossiers,
  QuestionnaireVue,
  SeanceEmargement,
} from "../api";
import {
  acteurCourant,
  erreurRpc,
  exiger,
  exigerFormateurValide,
  exigerRole,
  interdit,
  introuvable,
  invalide,
  lire,
  erreurStockage,
} from "./lot-2-commun";
import { lireDossier } from "./lot-4-dossier";

const BUCKET_ARCHIVE = "archive";
type Ligne = Record<string, unknown>;

const typeEvaluation = (valeur: string): TypeEvaluation => {
  if (!(TYPES_EVALUATION as string[]).includes(valeur)) throw invalide("Formulaire inconnu.");
  return valeur as TypeEvaluation;
};

// 87 — GET /dossiers
route("GET", "/dossiers", async (): Promise<ListeDossiers> => {
  const acteur = await acteurCourant();
  // Un formateur dont la candidature n'est pas validée n'a pas de dossiers : refus lisible, comme l'ancien service.
  if (acteur.role === "formateur") exigerFormateurValide(acteur);
  const { data, error } = await bd.rpc("s4m_lister_dossiers");
  if (error) throw erreurRpc(error);
  const cartes = ((data as { dossiers?: CarteDossier[] } | null)?.dossiers ?? []) as CarteDossier[];
  return {
    etapes: ETAPES,
    sous_statuts: SOUS_STATUTS,
    dossiers: cartes,
  } as unknown as ListeDossiers;
});

// 89 — GET /dossiers/:id
route("GET", "/dossiers/:id", ({ params }) => lireDossier(params["id"] ?? ""));

// 100 — GET /dossiers/:id/formulaires : pour chaque apprenant et chaque type, envoyé quand, combien de fois, répondu.
route("GET", "/dossiers/:id/formulaires", async ({ params }): Promise<EtatFormulaire[]> => {
  const acteur = await acteurCourant();
  exigerRole(acteur, "admin", "formateur");
  const id = params["id"] ?? "";
  const d = exiger<Ligne>(
    await bd.from("dossier_formation").select("id, sous_statut").eq("id", id).maybeSingle(),
    "Dossier",
  );
  const [lignes, pieces, liens] = await Promise.all([
    lire(await bd.from("formulaire_apprenant_vue").select("*").eq("dossier_id", id)),
    lire(
      await bd.from("piece_dossier").select("id, code, stagiaire_id, statut").eq("dossier_id", id),
    ),
    lire(
      await bd
        .from("stagiaire_dossier")
        .select("stagiaire_id")
        .eq("dossier_id", id)
        .order("rang", { ascending: true }),
    ),
  ]);
  const maintenant = new Date().toISOString();
  const formulaires = (lignes ?? []) as Ligne[];
  const piecesDuDossier = (pieces ?? []) as Ligne[];
  const statutDossier = d["sous_statut"] as SousStatut;
  return ((liens ?? []) as Ligne[]).flatMap((l) =>
    TYPES_EVALUATION.map((type) => {
      const sid = l["stagiaire_id"] as string;
      const f = formulaires.find((x) => x["stagiaire_id"] === sid && x["type"] === type);
      const piece = piecesDuDossier.find(
        (p) => p["code"] === CONFIG_EVALUATIONS[type].code && p["stagiaire_id"] === sid,
      );
      return {
        stagiaire_id: sid,
        type,
        libelle: CONFIG_EVALUATIONS[type].libelle,
        code: CONFIG_EVALUATIONS[type].code,
        moment: MOMENTS[type],
        ouvert: questionnaireOuvert(statutDossier, type),
        envoye_le: (f?.["envoye_le"] as string | null | undefined) ?? null,
        envois: (f?.["envois"] as number | undefined) ?? 0,
        statut: statutFormulaire({
          pieceValidee: piece?.["statut"] === "valide",
          formulaire: f
            ? { statut: f["statut"] as string, expire_le: f["expire_le"] as string }
            : null,
          maintenant,
        }),
        signe_le: (f?.["signe_le"] as string | null | undefined) ?? null,
        piece_id: (piece?.["id"] as string | undefined) ?? null,
        invitation: Boolean(f?.["invitation"]),
      };
    }),
  ) as EtatFormulaire[];
});

/**
 * 102 — document d'invitation d'un formulaire (QR code). Renvoie `{ url, nom }` : un lien `<a href="/api/…">` ne
 * s'authentifie pas, c'est à l'écran d'appeler cette route puis d'ouvrir `url` (comme la route 24 du lot 3).
 * Réservé à l'interne : la table `formulaire_apprenant` ne se lit pas côté apprenant, qui reçoit « introuvable ».
 */
route(
  "GET",
  "/dossiers/:id/formulaires/:stagiaire/:type/invitation",
  async ({ params }): Promise<{ url: string; nom: string }> => {
    const type = typeEvaluation(params["type"] ?? "");
    const f = exiger<Ligne>(
      await bd
        .from("formulaire_apprenant")
        .select("chemin_invitation")
        .eq("dossier_id", params["id"] ?? "")
        .eq("stagiaire_id", params["stagiaire"] ?? "")
        .eq("type", type)
        .maybeSingle(),
      "Document d'invitation",
    );
    const chemin = f["chemin_invitation"] as string | null;
    if (!chemin) throw introuvable("Document d'invitation");
    const nom = chemin.split("/").pop() ?? "invitation";
    const { data, error } = await bd.storage
      .from(BUCKET_ARCHIVE)
      .createSignedUrl(chemin, 60, { download: nom });
    if (error || !data?.signedUrl) throw erreurStockage(error ?? { status: 404 });
    return { url: data.signedUrl, nom };
  },
);

// 103 — GET /formulaires[?dossier_id=…] : suivi des formulaires envoyés (administrateur, formateur).
route("GET", "/formulaires", async ({ requete }): Promise<LigneFormulaire[]> => {
  const acteur = await acteurCourant();
  exigerRole(acteur, "admin", "formateur");
  let q = bd.from("formulaire_apprenant_vue").select("*").eq("of_id", acteur.of_id);
  const dossierId = requete.get("dossier_id");
  if (dossierId) q = q.eq("dossier_id", dossierId);
  const lignes = ((lire(await q.order("envoye_le", { ascending: false })) ?? []) as Ligne[]).map(
    (f) => ({
      id: f["id"],
      dossier_id: f["dossier_id"],
      dossier_reference: f["dossier_reference"],
      formation_titre: f["formation_titre"],
      apprenant: f["apprenant"],
      type: f["type"],
      libelle: f["libelle"],
      statut: f["statut"],
      envois: f["envois"],
      envoye_le: f["envoye_le"],
      signe_le: f["signe_le"],
    }),
  );
  return lignes as unknown as LigneFormulaire[];
});

// 104 — GET /dossiers/:id/emargement
route("GET", "/dossiers/:id/emargement", async ({ params }): Promise<SeanceEmargement[]> => {
  const id = params["id"] ?? "";
  // Le dossier doit être visible (RLS) : sinon « introuvable ». L'apprenant lit la vue, l'interne la table.
  const acteur = await acteurCourant();
  exiger(
    await bd
      .from(acteur.role === "apprenant" ? "dossier_formation_apprenant" : "dossier_formation")
      .select("id")
      .eq("id", id)
      .maybeSingle(),
    "Dossier",
  );
  const seances = (lire(
    await bd
      .from("seance")
      .select("*")
      .eq("dossier_id", id)
      .order("date", { ascending: true })
      .order("heure_debut", { ascending: true }),
  ) ?? []) as Array<Ligne & { id: string; heure_debut: string; heure_fin: string }>;
  const pointages = seances.length
    ? ((lire(
        await bd
          .from("emargement")
          .select("seance_id, stagiaire_id, signataire, horodatage")
          .in(
            "seance_id",
            seances.map((s) => s.id),
          ),
      ) ?? []) as Ligne[])
    : [];
  return seances.map((se) => ({
    ...se,
    duree_heures: dureeSeanceHeures(se.heure_debut, se.heure_fin),
    signatures: pointages
      .filter((e) => e["seance_id"] === se.id)
      .map((e) => ({
        stagiaire_id: e["stagiaire_id"],
        signataire: e["signataire"],
        horodatage: e["horodatage"],
      })),
  })) as unknown as SeanceEmargement[];
});

// 106 — GET /dossiers/:id/questionnaires/:type[?stagiaire_id=…]
route("GET", "/dossiers/:id/questionnaires/:type", async ({ params, requete }) => {
  const type = (() => {
    try {
      return typeEvaluation(params["type"] ?? "");
    } catch {
      throw invalide("Type de questionnaire inconnu.");
    }
  })();
  const { data, error } = await bd.rpc("s4m_questionnaire", {
    p_dossier_id: params["id"] ?? "",
    p_type: type,
    p_stagiaire_id: requete.get("stagiaire_id") || null,
  });
  if (error) {
    const message = (error as { message?: string }).message ?? "";
    if (/interdit/i.test(message)) throw interdit(message);
    if (/introuvable/i.test(message)) throw erreurRpc(error);
    // Les autres règles de la fonction (stagiaire à préciser, type inconnu) sont des erreurs de saisie lisibles.
    if ((error as { code?: string }).code === "P0001" && message) throw invalide(message);
    throw erreurRpc(error);
  }
  // La RPC renvoie `formulaire: null` : le formulaire fixe vient du noyau. Le corrigé est déjà retiré pour l'apprenant.
  return { ...(data as object), formulaire: formulaireDe(type) } as unknown as QuestionnaireVue;
});
