/**
 * Données des pièces de dossier côté serveur : chargement de l'agrégat, rendu, génération et archivage.
 *
 * Port de `src/serveur/services/generation.ts` (et des chargeurs de `agregat.ts` dont il dépend) sur le client
 * « service » de Supabase. Le rendu lui-même est PUR (`@/domaine/pieces/rendu`) et le texte des gabarits est embarqué
 * (`./pieces-gabarits.server`). Le cloisonnement est celui de `accederAuDossier` : un dossier d'un autre organisme, ou
 * d'un autre formateur, ou où l'apprenant n'est pas inscrit, est « introuvable ».
 *
 * Utilisable seulement par des `*.functions.ts` (jamais par le navigateur).
 */
import type { AgregatDossier, Evaluations } from "@/domaine/dossier/agregat";
import type { Entreprise, Formateur, Organisme } from "@/domaine/dossier/agregat";
import { dureeSeanceHeures } from "@/domaine/dossier/formats";
import { cheminPiece } from "@/domaine/archive/chemins";
import { nomFichierPiece } from "@/domaine/pieces/retours";
import { rendrePieceHtml, type DonneesRendu } from "@/domaine/pieces/rendu";
import { piecesAttendues, peutVoir } from "@/domaine/pieces/statut";
import type { SousStatut } from "@/domaine/pipeline/statuts";
import { estIndividuelle, type CodePiece } from "@/domaine/referentiel/pieces";
import type { Reponses } from "@/domaine/formulaires/definitions";
import type { Questionnaire } from "@/domaine/formulaires/qcm";
import type { ResultatRendu } from "@/domaine/gabarits/moteur";
import type { PreuveSignature } from "@/domaine/signature/preuve";
import type { Acteur } from "./acteur.server";
import { ouvrirArchive } from "./archive.server";
import type { BdService } from "./bd.server";
import { interdit, introuvable, leverSiErreurBd } from "./erreurs.server";
import { sha256Hex } from "./hacheur.server";
import { chargerFragments, chargerGabarit, gabaritExiste } from "./pieces-gabarits.server";
import { convertirEnPdf } from "./pieces-pdf.server";

// ——— Types des lignes lues (le client est non typé : CONVENTIONS §3) ———

export interface LigneDossier {
  id: string;
  of_id: string;
  dossier_reference: string;
  formateur_id: string;
  entreprise_id: string;
  sous_statut: SousStatut;
  mode_financement: string;
  formation_titre: string;
  formation_date_debut: string;
  formation_date_fin: string;
  formation_duree_heures_total: number | null;
  termine_le: string | null;
  questionnaire_positionnement: unknown;
  questionnaire_acquis: unknown;
  [cle: string]: unknown;
}

export interface LignePiece {
  id: string;
  dossier_id: string;
  code: CodePiece;
  stagiaire_id: string | null;
  statut: string;
  chemin_depart: string | null;
  empreinte_depart: string | null;
  genere_le: string | null;
  chemin_retour: string | null;
  nom_fichier_retour: string | null;
  empreinte_retour: string | null;
  mode_retour: string | null;
  retour_le: string | null;
  retour_par: string | null;
  transmise_le: string | null;
}

export interface LigneStagiaire {
  id: string;
  of_id: string;
  utilisateur_id: string | null;
  stagiaire_prenom: string;
  stagiaire_nom: string;
  stagiaire_email: string;
  stagiaire_poste: string;
  stagiaire_situation_handicap: string;
  [cle: string]: unknown;
}

export interface LigneSeance {
  id: string;
  dossier_id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
}

interface Reponse {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

/** Extrait les données d'une réponse PostgREST, ou lève une panne (journalisée) en cas d'erreur. */
export function donnees<T>(r: Reponse, contexte: string): T {
  leverSiErreurBd(r.error, contexte);
  return r.data as T;
}

const iso = (valeur: unknown): string => new Date(String(valeur)).toISOString();

// ——— Accès au dossier ———

/**
 * Contrôle d'accès à un dossier — le cloisonnement « strict entre formateurs » (§ 9 du cahier des charges) :
 * un formateur ne voit que SES dossiers, un apprenant que ceux où il est inscrit, un admin que ceux de SON organisme.
 */
export async function accederAuDossier(
  bd: BdService,
  acteur: Acteur,
  dossierId: string,
): Promise<LigneDossier> {
  const d = donnees<LigneDossier | null>(
    await bd
      .from("dossier_formation")
      .select("*")
      .eq("id", dossierId)
      .eq("of_id", acteur.of_id)
      .maybeSingle(),
    "lecture du dossier",
  );
  if (!d) throw introuvable("Dossier");
  if (acteur.role === "formateur" && d.formateur_id !== acteur.formateur_id)
    throw introuvable("Dossier");
  if (acteur.role === "apprenant") {
    if (!acteur.stagiaire_id) throw interdit();
    const lien = donnees<{ id: string } | null>(
      await bd
        .from("stagiaire_dossier")
        .select("id")
        .eq("dossier_id", dossierId)
        .eq("stagiaire_id", acteur.stagiaire_id)
        .maybeSingle(),
      "lecture de l'inscription",
    );
    if (!lien) throw introuvable("Dossier");
  }
  return d;
}

/** Lecture d'un dossier SANS acteur (pages publiques par jeton, tâches planifiées). */
export async function dossierSysteme(bd: BdService, dossierId: string): Promise<LigneDossier> {
  const d = donnees<LigneDossier | null>(
    await bd.from("dossier_formation").select("*").eq("id", dossierId).maybeSingle(),
    "lecture du dossier",
  );
  if (!d) throw introuvable("Dossier");
  return d;
}

export async function stagiairesDuDossier(
  bd: BdService,
  dossierId: string,
): Promise<Array<{ lien: { stagiaire_id: string; poste_occupe: string }; st: LigneStagiaire }>> {
  const liens = donnees<Array<{ stagiaire_id: string; poste_occupe: string; rang: number }>>(
    await bd
      .from("stagiaire_dossier")
      .select("*")
      .eq("dossier_id", dossierId)
      .order("rang", { ascending: true }),
    "lecture des stagiaires du dossier",
  );
  if (!liens?.length) return [];
  const fiches = donnees<LigneStagiaire[]>(
    await bd
      .from("stagiaire")
      .select("*")
      .in(
        "id",
        liens.map((l) => l.stagiaire_id),
      ),
    "lecture des fiches stagiaires",
  );
  const parId = new Map((fiches ?? []).map((f) => [f.id, f]));
  return liens.flatMap((lien) => {
    const st = parId.get(lien.stagiaire_id);
    return st ? [{ lien, st }] : [];
  });
}

export async function seancesDuDossier(bd: BdService, dossierId: string): Promise<LigneSeance[]> {
  const seances = donnees<LigneSeance[]>(
    await bd
      .from("seance")
      .select("*")
      .eq("dossier_id", dossierId)
      .order("date", { ascending: true })
      .order("heure_debut", { ascending: true }),
    "lecture des séances",
  );
  return seances ?? [];
}

/**
 * Heures réellement suivies par stagiaire. Émargement électronique : somme des séances signées par le stagiaire.
 * Si la feuille a été retournée sur papier (dépôt d'un fichier), on retient la durée prévue — hypothèse tracée.
 */
export async function heuresRealisees(
  bd: BdService,
  d: LigneDossier,
  liens: Awaited<ReturnType<typeof stagiairesDuDossier>>,
  seances: LigneSeance[],
): Promise<Record<string, number>> {
  const signes = seances.length
    ? donnees<Array<{ seance_id: string; stagiaire_id: string }>>(
        await bd
          .from("emargement")
          .select("seance_id, stagiaire_id")
          .in(
            "seance_id",
            seances.map((x) => x.id),
          )
          .eq("signataire", "stagiaire"),
        "lecture des émargements",
      )
    : [];
  const feuilles = donnees<LignePiece[]>(
    await bd.from("piece_dossier").select("*").eq("dossier_id", d.id).eq("code", "06-PDT"),
    "lecture des feuilles d'émargement",
  );
  const sortie: Record<string, number> = {};
  for (const { st } of liens) {
    const parSignature = (signes ?? [])
      .filter((e) => e.stagiaire_id === st.id)
      .reduce((total, e) => {
        const se = seances.find((x) => x.id === e.seance_id);
        return se ? total + dureeSeanceHeures(se.heure_debut, se.heure_fin) : total;
      }, 0);
    const feuille = (feuilles ?? []).find((f) => f.stagiaire_id === st.id);
    const surPapier = feuille?.statut === "valide" && feuille.mode_retour === "depot";
    sortie[st.id] =
      parSignature > 0
        ? Math.round(parSignature * 100) / 100
        : surPapier
          ? (d.formation_duree_heures_total ?? 0)
          : 0;
  }
  return sortie;
}

/** Projection « organisme du noyau » : les colonnes portent le nom des variables, on retire les colonnes techniques. */
export function versOrganismeDuNoyau(of: Record<string, unknown>): Organisme {
  const {
    id: _id,
    cree_le: _c,
    couleur: _co,
    signature_representant_png: _s,
    conservation_annees: _a,
    ...reste
  } = of;
  return reste as unknown as Organisme;
}

export async function lireOrganisme(
  bd: BdService,
  ofId: string,
): Promise<Record<string, unknown> & { of_nom: string; couleur: string }> {
  const of = donnees<(Record<string, unknown> & { of_nom: string; couleur: string }) | null>(
    await bd.from("organisme_formation").select("*").eq("id", ofId).maybeSingle(),
    "lecture de l'organisme",
  );
  if (!of) throw introuvable("Organisme");
  return of;
}

export async function chargerAgregat(bd: BdService, d: LigneDossier): Promise<AgregatDossier> {
  const [of, ent, form, liens, seances, evals, fo, ff, pieceConvention] = await Promise.all([
    lireOrganisme(bd, d.of_id),
    bd.from("entreprise_cliente").select("*").eq("id", d.entreprise_id).maybeSingle(),
    bd.from("formateur").select("*").eq("id", d.formateur_id).maybeSingle(),
    stagiairesDuDossier(bd, d.id),
    seancesDuDossier(bd, d.id),
    bd.from("evaluation").select("*").eq("dossier_id", d.id),
    bd.from("facture_of").select("*").eq("dossier_id", d.id).maybeSingle(),
    bd.from("facture_formateur").select("*").eq("dossier_id", d.id).maybeSingle(),
    bd.from("piece_dossier").select("id").eq("dossier_id", d.id).eq("code", "02-AVT"),
  ]);
  const entreprise = donnees<Record<string, unknown> | null>(ent, "lecture de l'entreprise");
  const formateur = donnees<Record<string, unknown> | null>(form, "lecture du formateur");
  if (!entreprise || !formateur) throw introuvable("Dossier");

  const evaluations: Record<string, Evaluations> = {};
  for (const ev of donnees<
    Array<{
      stagiaire_id: string;
      type: string;
      date: string;
      ajustement: string;
      score: number | null;
    }>
  >(evals, "lecture des évaluations") ?? []) {
    const e = (evaluations[ev.stagiaire_id] ??= {});
    if (ev.type === "recueil") e.recueil_date = ev.date;
    if (ev.type === "positionnement")
      Object.assign(e, { positionnement_date: ev.date, positionnement_ajustement: ev.ajustement });
    if (ev.type === "acquis")
      Object.assign(e, { evaluation_acquis_date: ev.date, evaluation_acquis_score: ev.score });
    if (ev.type === "satisfaction_froid") e.satisfaction_froid_date = ev.date;
  }

  // Date de signature de référence : celle de la convention si elle est signée, sinon la date du jour.
  const idsConvention = (
    donnees<Array<{ id: string }>>(pieceConvention, "lecture de la convention") ?? []
  ).map((p) => p.id);
  const signaturesConvention = idsConvention.length
    ? donnees<Array<{ horodatage: string }>>(
        await bd
          .from("signature")
          .select("horodatage")
          .in("piece_id", idsConvention)
          .order("horodatage", { ascending: true }),
        "lecture de la signature de la convention",
      )
    : [];
  const maintenant = new Date();
  const dateIso = (x: Date) => x.toISOString().slice(0, 10);

  const {
    id: _e,
    of_id: _eo,
    formateur_id: _ef,
    cree_le: _ec,
    ...entrepriseNoyau
  } = entreprise as Record<string, unknown>;
  return {
    dossier_reference: d.dossier_reference,
    sous_statut: d.sous_statut,
    mode_financement: d.mode_financement as AgregatDossier["mode_financement"],
    organisme: versOrganismeDuNoyau(of),
    entreprise: entrepriseNoyau as unknown as Entreprise,
    formateur: formateur as unknown as Formateur,
    formation: d as unknown as AgregatDossier["formation"],
    stagiaires: liens.map(({ lien, st }) => ({
      id: st.id,
      nom: `${st.stagiaire_prenom} ${st.stagiaire_nom}`.trim(),
      poste: lien.poste_occupe || st.stagiaire_poste,
      email: st.stagiaire_email,
      situation_handicap: st.stagiaire_situation_handicap,
    })),
    seances,
    facture_of: donnees<AgregatDossier["facture_of"]>(fo, "lecture de la facture") ?? null,
    facture_formateur:
      donnees<AgregatDossier["facture_formateur"]>(ff, "lecture de la facture du formateur") ??
      null,
    evaluations,
    heures_realisees: await heuresRealisees(bd, d, liens, seances),
    signature_date: dateIso(
      signaturesConvention?.[0] ? new Date(signaturesConvention[0].horodatage) : maintenant,
    ),
    attestation_date: dateIso(d.termine_le ? new Date(d.termine_le) : maintenant),
  };
}

// ——— Pièces ———

export async function trouverPiece(
  bd: BdService,
  dossierId: string,
  code: CodePiece,
  stagiaireId: string | null,
): Promise<LignePiece | null> {
  const requete = bd.from("piece_dossier").select("*").eq("dossier_id", dossierId).eq("code", code);
  const r = await (
    stagiaireId ? requete.eq("stagiaire_id", stagiaireId) : requete.is("stagiaire_id", null)
  ).maybeSingle();
  return donnees<LignePiece | null>(r, "lecture de la pièce") ?? null;
}

/** Crée une ligne `piece_dossier` ; un doublon (course entre deux requêtes) est relu, pas une erreur. */
export async function creerPiece(
  bd: BdService,
  dossierId: string,
  code: CodePiece,
  stagiaireId: string | null,
): Promise<LignePiece> {
  const { data, error } = await bd
    .from("piece_dossier")
    .insert({ dossier_id: dossierId, code, stagiaire_id: stagiaireId })
    .select("*")
    .single();
  if (error?.code === "23505") {
    const existante = await trouverPiece(bd, dossierId, code, stagiaireId);
    if (existante) return existante;
  }
  leverSiErreurBd(error, "création de la pièce");
  return data as LignePiece;
}

/** Crée les lignes `piece_dossier` qui doivent exister au sous-statut courant. Idempotent. */
export async function synchroniserPieces(bd: BdService, d: LigneDossier): Promise<void> {
  const liens = await stagiairesDuDossier(bd, d.id);
  const attendues = piecesAttendues(
    d.sous_statut,
    liens.map((l) => l.st.id),
  );
  const existantes =
    donnees<LignePiece[]>(
      await bd.from("piece_dossier").select("*").eq("dossier_id", d.id),
      "lecture des pièces",
    ) ?? [];
  for (const a of attendues) {
    if (existantes.some((p) => p.code === a.code && p.stagiaire_id === a.stagiaire_id)) continue;
    await creerPiece(bd, d.id, a.code, a.stagiaire_id);
  }
}

/** Nom du stagiaire (`Prénom Nom`) s'il est inscrit au dossier. */
export async function nomDuStagiaire(
  bd: BdService,
  dossierId: string,
  stagiaireId: string | null,
): Promise<string | null> {
  if (!stagiaireId) return null;
  const st = (await stagiairesDuDossier(bd, dossierId)).find((l) => l.st.id === stagiaireId)?.st;
  return st ? `${st.stagiaire_prenom} ${st.stagiaire_nom}` : null;
}

/** Rend le HTML courant d'une pièce, signatures et réponses comprises. C'est ce que voit — et signe — l'utilisateur. */
export async function rendrePiece(
  bd: BdService,
  d: LigneDossier,
  piece: LignePiece,
): Promise<ResultatRendu> {
  const code = piece.code;
  if (!gabaritExiste(code)) throw introuvable("Gabarit de la pièce");
  const agregat = await chargerAgregat(bd, d);
  const of = await lireOrganisme(bd, d.of_id);

  const signatures = (
    donnees<Array<Record<string, unknown>>>(
      await bd.from("signature").select("*").eq("piece_id", piece.id),
      "lecture des signatures",
    ) ?? []
  ).map(
    (s) =>
      ({
        ...s,
        // Forme normalisée (`…Z`) : identique à celle posée à la signature, donc au HTML scellé.
        horodatage: iso(s["horodatage"]),
      }) as unknown as PreuveSignature & { zone: string },
  );

  const evals = piece.stagiaire_id
    ? (donnees<Array<{ type: string; reponses: unknown }>>(
        await bd
          .from("evaluation")
          .select("type, reponses")
          .eq("dossier_id", d.id)
          .eq("stagiaire_id", piece.stagiaire_id),
        "lecture des évaluations",
      ) ?? [])
    : [];
  const reponses: DonneesRendu["reponses"] = {};
  for (const e of evals) reponses[e.type] = e.reponses as Reponses | Array<number | null>;

  const seances = await seancesDuDossier(bd, d.id);
  const pointages =
    code === "06-PDT" && seances.length
      ? (donnees<
          Array<{ seance_id: string; signataire: string; trace_png: string; horodatage: string }>
        >(
          await bd
            .from("emargement")
            .select("seance_id, signataire, trace_png, horodatage")
            .eq("stagiaire_id", piece.stagiaire_id ?? ""),
          "lecture des émargements",
        ) ?? [])
      : [];

  return rendrePieceHtml(chargerGabarit(code), chargerFragments(), {
    code,
    agregat,
    stagiaireId: estIndividuelle(code) ? piece.stagiaire_id : null,
    organisme: {
      of_nom: of.of_nom,
      couleur: of.couleur,
      signature_representant_png: String(of["signature_representant_png"] ?? ""),
    },
    signatures,
    reponses,
    questionnaires: {
      positionnement: (d.questionnaire_positionnement as Questionnaire | null) ?? null,
      acquis: (d.questionnaire_acquis as Questionnaire | null) ?? null,
    },
    seances,
    pointages: pointages.map((p) => ({ ...p, horodatage: iso(p.horodatage) })),
  });
}

/** Archive un rendu (HTML, et PDF si un service de conversion est configuré). Retourne le chemin du document principal. */
export async function archiverRendu(
  bd: BdService,
  d: LigneDossier,
  sousDossier: "Pièces de départ" | "Retour",
  nom: string,
  html: string,
): Promise<{ chemin: string; chemin_html: string }> {
  const archive = ouvrirArchive(bd, { ofId: d.of_id });
  const chemin_html = await archive.ecrire(
    cheminPiece(d.of_id, d.dossier_reference, sousDossier, `${nom}.html`),
    html,
    "text/html; charset=utf-8",
  );
  const pdf = await convertirEnPdf(html);
  if (!pdf) return { chemin: chemin_html, chemin_html };
  return {
    chemin: await archive.ecrire(
      cheminPiece(d.of_id, d.dossier_reference, sousDossier, `${nom}.pdf`),
      pdf,
      "application/pdf",
    ),
    chemin_html,
  };
}

/** Génère (ou régénère) une pièce dans « Pièces de départ » et scelle son empreinte. */
export async function genererPiece(
  bd: BdService,
  d: LigneDossier,
  code: CodePiece,
  stagiaireId: string | null = null,
): Promise<LignePiece> {
  await synchroniserPieces(bd, d);
  // Pièce hors du cycle « attendu » (trame de facture formateur, régénération anticipée) : créée à la demande.
  const piece =
    (await trouverPiece(bd, d.id, code, stagiaireId)) ??
    (await creerPiece(bd, d.id, code, stagiaireId));
  const { html } = await rendrePiece(bd, d, piece);
  const nom = nomFichierPiece(code, await nomDuStagiaire(bd, d.id, stagiaireId));
  const { chemin } = await archiverRendu(bd, d, "Pièces de départ", nom, html);
  const { error } = await bd
    .from("piece_dossier")
    .update({
      chemin_depart: chemin,
      empreinte_depart: await sha256Hex(html),
      genere_le: new Date().toISOString(),
    })
    .eq("id", piece.id);
  leverSiErreurBd(error, "enregistrement de la pièce générée");
  return (await trouverPiece(bd, d.id, code, stagiaireId))!;
}

/** Cloisonnement de lecture d'une pièce (`peutVoir` du noyau) : « introuvable » plutôt qu'« interdit ». */
export function pieceVisible(piece: LignePiece, acteur: Acteur): boolean {
  return peutVoir({ code: piece.code, stagiaire_id: piece.stagiaire_id }, acteur);
}

/** Charge une pièce et son dossier pour un acteur ; « introuvable » si cloisonné. */
export async function chargerPiece(
  bd: BdService,
  acteur: Acteur,
  pieceId: string,
): Promise<{ d: LigneDossier; piece: LignePiece }> {
  const piece = donnees<LignePiece | null>(
    await bd.from("piece_dossier").select("*").eq("id", pieceId).maybeSingle(),
    "lecture de la pièce",
  );
  if (!piece) throw introuvable("Pièce");
  const d = await accederAuDossier(bd, acteur, piece.dossier_id);
  if (!pieceVisible(piece, acteur)) throw introuvable("Pièce");
  return { d, piece };
}
