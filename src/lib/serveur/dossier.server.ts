/**
 * Accès serveur aux dossiers — équivalent de `src/serveur/services/agregat.ts` (cloisonnement, chargements) et des
 * utilitaires de `generation.ts` / `pipeline.ts` qui touchent à la base (`synchroniserPieces`, `numeroSuivant`).
 *
 * Tout passe par le client « service » (il contourne la RLS) : c'est donc ICI que le cloisonnement est appliqué, à la
 * main et avant toute lecture ou écriture, exactement comme `accederAuDossier` : un formateur ne voit que SES dossiers,
 * un apprenant que ceux où il est inscrit, un administrateur que ceux de SON organisme. Un dossier cloisonné est
 * « introuvable », jamais « interdit ».
 */
import type { ContexteDossier } from "@/domaine/pipeline/transitions";
import type { SousStatut } from "@/domaine/pipeline/statuts";
import { manquesAvantSoumission } from "@/domaine/dossier/soumission";
import { formaterNumero, type PrefixeNumero } from "@/domaine/dossier/numerotation";
import { piecesAttendues } from "@/domaine/pieces/statut";
import type { CodePiece } from "@/domaine/referentiel/pieces";
import type { Acteur } from "./acteur.server";
import type { BdService } from "./bd.server";
import { conflit, interdit, introuvable, leverSiErreurBd } from "./erreurs.server";

export interface LigneDossier {
  id: string;
  of_id: string;
  dossier_reference: string;
  formateur_id: string;
  entreprise_id: string;
  formation_id: string | null;
  sous_statut: SousStatut;
  mode_financement: string;
  formation_titre: string;
  formation_objectifs: string;
  formation_programme: string;
  formation_date_debut: string;
  formation_date_fin: string;
  formation_duree_heures_total: number | null;
  formation_prix_unitaire_ht: number | null;
  formation_modalite: string;
  formation_lieu_adresse: string;
  formation_lien_visio: string;
  signature_lieu: string;
  questionnaire_positionnement: unknown;
  questionnaire_acquis: unknown;
  termine_le: string | null;
  [cle: string]: unknown;
}

export interface LignePieceServeur {
  id: string;
  dossier_id: string;
  code: CodePiece;
  stagiaire_id: string | null;
  statut: "en_attente" | "valide";
  chemin_depart: string | null;
  [cle: string]: unknown;
}

export interface StagiaireDuDossier {
  lien: {
    id: string;
    dossier_id: string;
    stagiaire_id: string;
    poste_occupe: string;
    rang: number;
  };
  st: {
    id: string;
    of_id: string;
    formateur_id: string;
    utilisateur_id: string | null;
    stagiaire_prenom: string;
    stagiaire_nom: string;
    stagiaire_email: string;
    stagiaire_poste: string;
    [cle: string]: unknown;
  };
}

/** Le dossier, s'il est accessible à cet acteur (cloisonnement strict, cahier des charges §9). */
export async function accederAuDossier(
  bd: BdService,
  acteur: Acteur,
  dossierId: string,
): Promise<LigneDossier> {
  const { data: d, error } = await bd
    .from("dossier_formation")
    .select("*")
    .eq("id", dossierId)
    .eq("of_id", acteur.of_id)
    .maybeSingle();
  leverSiErreurBd(error, "lecture du dossier");
  if (!d) throw introuvable("Dossier");
  if (acteur.role === "formateur" && d.formateur_id !== acteur.formateur_id)
    throw introuvable("Dossier");
  if (acteur.role === "apprenant") {
    if (!acteur.stagiaire_id) throw interdit();
    const { data: inscrit, error: errInscrit } = await bd
      .from("stagiaire_dossier")
      .select("id")
      .eq("dossier_id", dossierId)
      .eq("stagiaire_id", acteur.stagiaire_id)
      .maybeSingle();
    leverSiErreurBd(errInscrit, "lecture de l'inscription");
    if (!inscrit) throw introuvable("Dossier");
  }
  return d as LigneDossier;
}

/** Dossier lu sans acteur (tâche système) : l'organisme n'est pas filtré, l'appelant est le serveur lui-même. */
export async function dossierPourSysteme(bd: BdService, dossierId: string): Promise<LigneDossier> {
  const { data: d, error } = await bd
    .from("dossier_formation")
    .select("*")
    .eq("id", dossierId)
    .maybeSingle();
  leverSiErreurBd(error, "lecture du dossier");
  if (!d) throw introuvable("Dossier");
  return d as LigneDossier;
}

export async function stagiairesDuDossier(
  bd: BdService,
  dossierId: string,
): Promise<StagiaireDuDossier[]> {
  const { data: liens, error } = await bd
    .from("stagiaire_dossier")
    .select("*")
    .eq("dossier_id", dossierId)
    .order("rang", { ascending: true });
  leverSiErreurBd(error, "lecture des apprenants du dossier");
  const lignes = (liens ?? []) as StagiaireDuDossier["lien"][];
  if (lignes.length === 0) return [];
  const { data: fiches, error: errFiches } = await bd
    .from("stagiaire")
    .select("*")
    .in(
      "id",
      lignes.map((l) => l.stagiaire_id),
    );
  leverSiErreurBd(errFiches, "lecture des fiches apprenants");
  const parId = new Map(((fiches ?? []) as StagiaireDuDossier["st"][]).map((s) => [s.id, s]));
  return lignes.flatMap((lien) => {
    const st = parId.get(lien.stagiaire_id);
    return st ? [{ lien, st }] : [];
  });
}

export async function seancesDuDossier(bd: BdService, dossierId: string) {
  const { data, error } = await bd
    .from("seance")
    .select("*")
    .eq("dossier_id", dossierId)
    .order("date", { ascending: true })
    .order("heure_debut", { ascending: true });
  leverSiErreurBd(error, "lecture du planning");
  return (data ?? []) as Array<{
    id: string;
    date: string;
    heure_debut: string;
    heure_fin: string;
  }>;
}

export async function piecesDuDossier(bd: BdService, dossierId: string) {
  const { data, error } = await bd.from("piece_dossier").select("*").eq("dossier_id", dossierId);
  leverSiErreurBd(error, "lecture des pièces");
  return (data ?? []) as LignePieceServeur[];
}

/** Le dossier sous la forme dont `transiter()` a besoin. */
export async function contextePipeline(bd: BdService, d: LigneDossier): Promise<ContexteDossier> {
  const [pieces, liens] = await Promise.all([
    piecesDuDossier(bd, d.id),
    stagiairesDuDossier(bd, d.id),
  ]);
  return {
    sous_statut: d.sous_statut,
    pieces: pieces.map((p) => ({ code: p.code, stagiaire_id: p.stagiaire_id, statut: p.statut })),
    stagiaire_ids: liens.map((l) => l.st.id),
  };
}

/** Crée les lignes `piece_dossier` qui doivent exister au sous-statut courant. Idempotent. */
export async function synchroniserPieces(bd: BdService, d: LigneDossier): Promise<void> {
  const liens = await stagiairesDuDossier(bd, d.id);
  const attendues = piecesAttendues(
    d.sous_statut,
    liens.map((l) => l.st.id),
  );
  const existantes = await piecesDuDossier(bd, d.id);
  const manquantes = attendues
    .filter((a) => !existantes.some((p) => p.code === a.code && p.stagiaire_id === a.stagiaire_id))
    .map((a) => ({ dossier_id: d.id, code: a.code, stagiaire_id: a.stagiaire_id }));
  if (manquantes.length === 0) return;
  const { error } = await bd.from("piece_dossier").insert(manquantes);
  if (!error) return;
  if (error.code !== "23505") leverSiErreurBd(error, "création des pièces");
  // Une synchronisation concurrente a déjà créé certaines pièces : on insère une à une, en ignorant les doublons.
  for (const ligne of manquantes) {
    const { error: e } = await bd.from("piece_dossier").insert(ligne);
    if (e && e.code !== "23505") leverSiErreurBd(e, "création d'une pièce");
  }
}

/**
 * Numérotation continue par organisme et par année (`ADF-2026-0001`…). PostgREST n'a pas d'incrément atomique : on
 * procède par comparaison-et-échange — lecture, puis écriture conditionnée à l'ancienne valeur ; si quelqu'un est
 * passé entre-temps (0 ligne modifiée, ou doublon à la création), on recommence.
 */
export async function numeroSuivant(
  bd: BdService,
  ofId: string,
  prefixe: PrefixeNumero,
  maintenant: Date = new Date(),
): Promise<string> {
  const annee = maintenant.getUTCFullYear();
  const cle = `${prefixe}-${annee}`;
  for (let essai = 0; essai < 12; essai++) {
    const { data: ligne, error } = await bd
      .from("compteur")
      .select("valeur")
      .eq("of_id", ofId)
      .eq("cle", cle)
      .maybeSingle();
    leverSiErreurBd(error, "lecture du compteur");
    if (!ligne) {
      const { error: errCreation } = await bd
        .from("compteur")
        .insert({ of_id: ofId, cle, valeur: 1 });
      if (!errCreation) return formaterNumero(prefixe, annee, 1);
      if (errCreation.code !== "23505") leverSiErreurBd(errCreation, "création du compteur");
      continue;
    }
    const valeur = Number(ligne.valeur) + 1;
    const { data: modifiees, error: errMaj } = await bd
      .from("compteur")
      .update({ valeur })
      .eq("of_id", ofId)
      .eq("cle", cle)
      .eq("valeur", ligne.valeur)
      .select("valeur");
    leverSiErreurBd(errMaj, "mise à jour du compteur");
    if (modifiees && modifiees.length > 0) return formaterNumero(prefixe, annee, valeur);
  }
  throw conflit("La numérotation est très sollicitée. Réessayez dans un instant.");
}

/** Ce qui manque avant de demander la validation du dossier (lit l'entreprise et le planning). */
export async function manquesDeSoumission(bd: BdService, d: LigneDossier): Promise<string[]> {
  const { data: ent, error } = await bd
    .from("entreprise_cliente")
    .select("*")
    .eq("id", d.entreprise_id)
    .maybeSingle();
  leverSiErreurBd(error, "lecture de l'entreprise");
  const seances = await seancesDuDossier(bd, d.id);
  return manquesAvantSoumission(d, ent, seances.length);
}
