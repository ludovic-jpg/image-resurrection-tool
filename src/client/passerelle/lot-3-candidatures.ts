/**
 * Lot 3 — candidature du formateur et décision de l'administrateur (routes 19 à 27 de la carte, sauf 28 et 29 : lot 2).
 *
 * Client + RLS : 19, 20, 21, 22, 24, 25, 26. Fonctions serveur : 23 (soumettre) et 27 (décider), via
 * `src/lib/candidatures.functions.ts` — elles écrivent dans le journal et envoient des e-mails.
 * Les formes de réponse sont celles de `src/serveur/services/candidatures.ts` (types de `src/client/api.ts`).
 *
 * Aucun `update` du statut de candidature n'est fait ici : le passage à « soumise » et la décision sont serveur seulement.
 */
import {
  TYPES_PIECE_FORMATEUR,
  echeancesPieces,
  erreurDepotPiece,
  manquesCandidature,
} from "@/domaine/candidature/pieces";
import {
  CHAMPS_FIGES_APRES_VALIDATION,
  MESSAGE_IDENTITE_FIGEE,
  MESSAGE_PIECES_EN_ETUDE,
  MESSAGE_PROFIL_EN_ETUDE,
  validerProfilFormateur,
} from "@/domaine/candidature/profil";
import { cheminCandidature } from "@/domaine/archive/chemins";
import { deciderCandidature, soumettreCandidature } from "@/lib/candidatures.functions";
import { appelerServeur, corpsDe, exigerActeur, introuvable } from "../appel-serveur";
import { bd } from "../bd";
import { ErreurApi } from "../erreur";
import { route } from "../registre";
import type { Candidature, CandidatureAdmin, LigneCandidature } from "../api";

const BUCKET_ARCHIVE = "archive";

/** Le formateur connecté (même non validé : il accède à sa candidature) ; 403 pour tout autre rôle. */
async function monActeur() {
  const acteur = await exigerActeur(["formateur"], "Cette action est réservée aux formateurs.");
  if (!acteur.formateur_id)
    throw new ErreurApi("Cette action est réservée aux formateurs.", 403, "interdit", null);
  return { acteur, formateurId: acteur.formateur_id };
}

/** Route 19. `formateur` + `piece_formateur` du formateur connecté (la RLS limite aux siens). */
async function lireMaCandidature(): Promise<Candidature> {
  const { formateurId: id } = await monActeur();
  const { data: f, error } = await bd.from("formateur").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!f) throw introuvable("Candidature");
  const { data: pieces, error: errPieces } = await bd
    .from("piece_formateur")
    .select("*")
    .eq("formateur_id", id)
    .order("cree_le", { ascending: true });
  if (errPieces) throw errPieces;
  const liste = (pieces ?? []) as Array<{
    id: string;
    type: string;
    nom_fichier: string;
    expire_le: string;
  }>;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  return {
    formateur: f,
    pieces: liste,
    types: TYPES_PIECE_FORMATEUR,
    manques: manquesCandidature(f, liste),
    echeances: echeancesPieces(liste, aujourdhui),
  } as unknown as Candidature;
}

/** Route 26 : détail d'une candidature côté administrateur (la RLS limite à son organisme). */
async function lireCandidatureAdmin(formateurId: string): Promise<CandidatureAdmin> {
  await exigerActeur(["admin"], "Cette action est réservée à l'administrateur de l'organisme.");
  const { data: f, error } = await bd
    .from("formateur")
    .select("*")
    .eq("id", formateurId)
    .maybeSingle();
  if (error) throw error;
  if (!f) throw introuvable("Candidature");
  const { data: pieces, error: errPieces } = await bd
    .from("piece_formateur")
    .select("*")
    .eq("formateur_id", formateurId)
    .order("cree_le", { ascending: true });
  if (errPieces) throw errPieces;
  return {
    formateur: f,
    pieces: pieces ?? [],
    types: TYPES_PIECE_FORMATEUR,
  } as unknown as CandidatureAdmin;
}

/** Les triggers SQL signalent une règle métier par une exception : leur message est déjà en français. */
function erreurDeRegleSql(e: unknown): unknown {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === "P0001" && err.message) return new ErreurApi(err.message, 409, "conflit", null);
  return e;
}

route("GET", "/candidature", () => lireMaCandidature());

route("PATCH", "/candidature", async ({ corps }) => {
  const { formateurId: id } = await monActeur();
  const v = validerProfilFormateur(corpsDe(corps));
  if (!v.ok)
    throw new ErreurApi(Object.values(v.champs)[0] ?? "Données invalides.", 400, "invalide", {
      champs: v.champs,
    });
  const valeurs: Record<string, unknown> = { ...v.valeurs };

  const { data: actuel, error } = await bd
    .from("formateur")
    .select("statut_candidature, formateur_prenom, formateur_nom")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!actuel) throw introuvable("Candidature");
  if (actuel.statut_candidature === "soumise")
    throw new ErreurApi(MESSAGE_PROFIL_EN_ETUDE, 409, "conflit", null);
  if (actuel.statut_candidature === "validee") {
    for (const cle of CHAMPS_FIGES_APRES_VALIDATION) {
      if (cle in valeurs && valeurs[cle] !== actuel[cle])
        throw new ErreurApi(MESSAGE_IDENTITE_FIGEE, 400, "invalide", null);
      delete valeurs[cle];
    }
  }
  if (Object.keys(valeurs).length > 0) {
    // Le trigger SQL recopie prénom/nom dans `utilisateur` et journalise un profil validé : rien d'autre à faire ici.
    const { data: lignes, error: errMaj } = await bd
      .from("formateur")
      .update(valeurs)
      .eq("id", id)
      .select("id");
    if (errMaj) throw erreurDeRegleSql(errMaj);
    if (!lignes?.length) throw introuvable("Candidature");
  }
  return lireMaCandidature();
});

route("POST", "/candidature/pieces", async ({ corps }) => {
  const { acteur, formateurId: id } = await monActeur();
  const form = corps instanceof FormData ? corps : null;
  const fichier = form?.get("fichier");
  if (!(fichier instanceof File)) throw new ErreurApi("Aucun fichier reçu.", 400, "invalide", null);
  const type = String(form?.get("type") ?? "");
  const expire_le = String(form?.get("expire_le") ?? "");
  const message = erreurDepotPiece({ type, nom: fichier.name, taille: fichier.size, expire_le });
  if (message) throw new ErreurApi(message, 400, "invalide", null);

  const { data: f, error } = await bd
    .from("formateur")
    .select("statut_candidature")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (f?.statut_candidature === "soumise")
    throw new ErreurApi(MESSAGE_PIECES_EN_ETUDE, 409, "conflit", null);

  const pieceId = crypto.randomUUID();
  const chemin = cheminCandidature(
    acteur.of_id,
    id,
    `${type}_${pieceId.slice(0, 8)}_${fichier.name}`,
  );
  const { error: errEnvoi } = await bd.storage
    .from(BUCKET_ARCHIVE)
    .upload(chemin, fichier, { contentType: fichier.type || undefined, upsert: false });
  if (errEnvoi) throw errEnvoi;
  const { error: errLigne } = await bd.from("piece_formateur").insert({
    id: pieceId,
    formateur_id: id,
    type,
    nom_fichier: fichier.name,
    chemin,
    taille: fichier.size,
    expire_le,
  });
  if (errLigne) {
    // Pas de fichier orphelin : on retire ce qu'on vient d'envoyer.
    await bd.storage.from(BUCKET_ARCHIVE).remove([chemin]);
    throw errLigne;
  }
  return lireMaCandidature();
});

route("DELETE", "/candidature/pieces/:id", async ({ params }) => {
  const { formateurId } = await monActeur();
  const { data: p, error } = await bd
    .from("piece_formateur")
    .select("id, chemin")
    .eq("id", params["id"] ?? "")
    .eq("formateur_id", formateurId)
    .maybeSingle();
  if (error) throw error;
  if (!p) throw introuvable("Pièce");
  // La ligne d'abord (la RLS tranche), le fichier ensuite : au pire un fichier orphelin, jamais une ligne sans fichier.
  const { data: supprimees, error: errSuppr } = await bd
    .from("piece_formateur")
    .delete()
    .eq("id", p.id)
    .select("id");
  if (errSuppr) throw errSuppr;
  if (!supprimees?.length) throw introuvable("Pièce");
  const { error: errFichier } = await bd.storage.from(BUCKET_ARCHIVE).remove([p.chemin]);
  if (errFichier) console.error("[candidature] fichier de pièce non supprimé", errFichier);
  return lireMaCandidature();
});

route("POST", "/candidature/soumettre", async () => {
  await appelerServeur(() => soumettreCandidature());
  return lireMaCandidature();
});

/**
 * Route 24 — lien de téléchargement temporaire d'une pièce de candidature (la RLS et la politique Storage limitent au
 * propriétaire et à l'administrateur de l'organisme). Renvoie `{ url, nom }` : un lien `<a href="/api/…">` ne
 * s'authentifie pas, c'est à l'écran d'appeler cette route puis d'ouvrir `url`.
 */
route("GET", "/pieces-formateur/:id", async ({ params }) => {
  await exigerActeur(["formateur", "admin"]);
  const { data: p, error } = await bd
    .from("piece_formateur")
    .select("chemin, nom_fichier")
    .eq("id", params["id"] ?? "")
    .maybeSingle();
  if (error) throw error;
  if (!p) throw introuvable("Pièce");
  const { data, error: errUrl } = await bd.storage
    .from(BUCKET_ARCHIVE)
    .createSignedUrl(p.chemin, 60, { download: p.nom_fichier });
  if (errUrl || !data?.signedUrl) throw introuvable("Pièce");
  return { url: data.signedUrl, nom: p.nom_fichier as string };
});

route("GET", "/admin/candidatures", async () => {
  const acteur = await exigerActeur(
    ["admin"],
    "Cette action est réservée à l'administrateur de l'organisme.",
  );
  const { data, error } = await bd
    .from("formateur")
    .select("*")
    .eq("of_id", acteur.of_id)
    .order("soumise_le", { ascending: false })
    .order("cree_le", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as LigneCandidature[];
});

route("GET", "/admin/candidatures/:id", ({ params }) => lireCandidatureAdmin(params["id"] ?? ""));

route("POST", "/admin/candidatures/:id/decision", async ({ params, corps }) => {
  const c = corpsDe(corps);
  const id = params["id"] ?? "";
  // Pas de pré-contrôle de rôle ici : c'est le serveur qui décide (refus 403 en français pour un formateur).
  await appelerServeur(() =>
    deciderCandidature({
      data: { formateur_id: id, validee: c["validee"] === true, motif: String(c["motif"] ?? "") },
    }),
  );
  return lireCandidatureAdmin(id);
});
