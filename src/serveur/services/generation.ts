/**
 * Génération des pièces (F-ARCH-01 à 03) : agrégat → variables → gabarit → HTML (+ PDF) → archive « Pièces de départ ».
 * Le HTML est TOUJOURS archivé : c'est lui que l'empreinte SHA-256 scelle. Le PDF est un confort de lecture.
 */
import { and, eq, isNull } from "drizzle-orm";
import { FORMULAIRES, type Reponses } from "@/domaine/formulaires/definitions";
import type { Questionnaire } from "@/domaine/formulaires/qcm";
import { rendreGabarit, type Zone } from "@/domaine/gabarits/moteur";
import { zoneGrilleNotes, zoneQcm, zoneReponses, zoneSynthesePositionnement } from "@/domaine/gabarits/zones";
import { resoudreVariables } from "@/domaine/dossier/resolution";
import { definitionPiece, estIndividuelle, type CodePiece } from "@/domaine/referentiel/pieces";
import { blocSignatureHtml, horodatageLisible, type PreuveSignature } from "@/domaine/signature/preuve";
import { piecesAttendues } from "@/domaine/pieces/statut";
import type { SousStatut } from "@/domaine/pipeline/statuts";
import { emargement, evaluation, organismeFormation, pieceDossier, signature } from "../bd/schema";
import { chargerGabarit, chargerInclusions, gabaritExiste } from "../gabarits/chargeur";
import { cheminPiece, nomSur } from "../ports/archive";
import { nouvelId, sha256 } from "../ports/divers";
import { chargerAgregat, seancesDuDossier, stagiairesDuDossier, type LigneDossier } from "./agregat";
import { introuvable, type Services } from "./socle";

export type LignePiece = typeof pieceDossier.$inferSelect;

/** Nom de fichier d'une pièce : nomenclature `NN_PHASE_Libellé`, suffixée du stagiaire pour une pièce individuelle. */
export function nomFichierPiece(code: CodePiece, nomStagiaire: string | null): string {
  const base = definitionPiece(code).fichier;
  return nomStagiaire ? `${base}_${nomSur(nomStagiaire).replace(/\s+/g, "-")}` : base;
}

/** Crée les lignes `piece_dossier` qui doivent exister au sous-statut courant. Idempotent. */
export async function synchroniserPieces(s: Services, d: LigneDossier): Promise<void> {
  const liens = await stagiairesDuDossier(s, d.id);
  const attendues = piecesAttendues(
    d.sous_statut as SousStatut,
    liens.map((l) => l.st.id),
  );
  const existantes = await s.bd.select().from(pieceDossier).where(eq(pieceDossier.dossier_id, d.id));
  for (const a of attendues) {
    if (existantes.some((p) => p.code === a.code && p.stagiaire_id === a.stagiaire_id)) continue;
    await s.bd
      .insert(pieceDossier)
      .values({ id: nouvelId(), dossier_id: d.id, code: a.code, stagiaire_id: a.stagiaire_id })
      .onConflictDoNothing();
  }
}

export async function trouverPiece(
  s: Services,
  dossierId: string,
  code: CodePiece,
  stagiaireId: string | null,
): Promise<LignePiece | null> {
  const [p] = await s.bd
    .select()
    .from(pieceDossier)
    .where(
      and(
        eq(pieceDossier.dossier_id, dossierId),
        eq(pieceDossier.code, code),
        stagiaireId ? eq(pieceDossier.stagiaire_id, stagiaireId) : isNull(pieceDossier.stagiaire_id),
      ),
    );
  return p ?? null;
}

/** Rend le HTML courant d'une pièce, signatures et réponses comprises. C'est ce que voit — et signe — l'utilisateur. */
export async function rendrePiece(
  s: Services,
  d: LigneDossier,
  piece: LignePiece,
): Promise<{ html: string; manquantes: string[] }> {
  const code = piece.code as CodePiece;
  if (!gabaritExiste(code)) throw introuvable("Gabarit de la pièce");
  const agregat = await chargerAgregat(s, d);
  const variables = resoudreVariables(
    agregat,
    estIndividuelle(code) && piece.stagiaire_id ? { stagiaireId: piece.stagiaire_id } : {},
  );
  const [of] = await s.bd.select().from(organismeFormation).where(eq(organismeFormation.id, d.of_id));

  const signatures = await s.bd.select().from(signature).where(eq(signature.piece_id, piece.id));
  const preuve = (zone: string): PreuveSignature | null => {
    const sig = signatures.find((x) => x.zone === zone);
    return sig
      ? {
          ...sig,
          signataire_role: sig.signataire_role as PreuveSignature["signataire_role"],
          horodatage: sig.horodatage.toISOString(),
        }
      : null;
  };

  const evals = piece.stagiaire_id
    ? await s.bd
        .select()
        .from(evaluation)
        .where(and(eq(evaluation.dossier_id, d.id), eq(evaluation.stagiaire_id, piece.stagiaire_id)))
    : [];
  const reponsesDe = (type: string) =>
    evals.find((e) => e.type === type)?.reponses as Reponses | Array<number | null> | undefined;

  const seances = await seancesDuDossier(s, d.id);
  const pointages =
    code === "06-PDT" && seances.length
      ? await s.bd
          .select()
          .from(emargement)
          .where(eq(emargement.stagiaire_id, piece.stagiaire_id ?? ""))
      : [];
  const caseEmargement =
    (signataire: "stagiaire" | "formateur"): Zone =>
    (rangs) => {
      const se = seances[(rangs.session ?? 0) - 1];
      const p = se && pointages.find((x) => x.seance_id === se.id && x.signataire === signataire);
      return p
        ? `<img src="${p.trace_png}" alt="Signature"><small>${horodatageLisible(p.horodatage.toISOString())}</small>`
        : "";
    };

  const zones: Record<string, Zone> = {
    logo_of: () => "",
    // L'organisme signe ses propres pièces par le tracé enregistré de son représentant légal.
    signature_of: () =>
      of?.signature_representant_png
        ? `<img src="${of.signature_representant_png}" alt="Signature de l'organisme"><div class="preuve">Pour ${of.of_nom}</div>`
        : "",
    signature_apprenant: () => blocSignatureHtml(preuve("apprenant")),
    signature_formateur: () => blocSignatureHtml(preuve("formateur")),
    reponses_recueil: () =>
      zoneReponses(FORMULAIRES["00-AVT"], reponsesDe("recueil") as Reponses | undefined),
    questions_positionnement: () =>
      zoneQcm(
        d.questionnaire_positionnement as Questionnaire | null,
        reponsesDe("positionnement") as Array<number | null> | undefined,
      ),
    synthese_positionnement: () =>
      zoneSynthesePositionnement(
        d.questionnaire_positionnement as Questionnaire | null,
        reponsesDe("positionnement") as Array<number | null> | undefined,
      ),
    questions_acquis: () =>
      zoneQcm(
        d.questionnaire_acquis as Questionnaire | null,
        reponsesDe("acquis") as Array<number | null> | undefined,
      ),
    grille_satisfaction_chaud: () =>
      zoneGrilleNotes(FORMULAIRES["08-FIN"], reponsesDe("satisfaction_chaud") as Reponses | undefined),
    grille_satisfaction_froid: () =>
      zoneGrilleNotes(FORMULAIRES["12-APR"], reponsesDe("satisfaction_froid") as Reponses | undefined),
    emargement_stagiaire: caseEmargement("stagiaire"),
    emargement_formateur: caseEmargement("formateur"),
  };

  return rendreGabarit(chargerGabarit(code), {
    variables,
    zones,
    inclusions: chargerInclusions(of?.couleur),
  });
}

/** Archive un rendu (HTML, et PDF si un Chromium est disponible). Retourne le chemin du document principal. */
export async function archiverRendu(
  s: Services,
  d: LigneDossier,
  sousDossier: "Pièces de départ" | "Retour",
  nom: string,
  html: string,
): Promise<{ chemin: string; chemin_html: string }> {
  const chemin_html = await s.archive.ecrire(
    cheminPiece(d.of_id, d.dossier_reference, sousDossier, `${nom}.html`),
    html,
  );
  const pdf = await s.pdf.convertir(html);
  if (!pdf) return { chemin: chemin_html, chemin_html };
  return {
    chemin: await s.archive.ecrire(cheminPiece(d.of_id, d.dossier_reference, sousDossier, `${nom}.pdf`), pdf),
    chemin_html,
  };
}

/** Génère (ou régénère) une pièce dans « Pièces de départ » et scelle son empreinte. */
export async function genererPiece(
  s: Services,
  d: LigneDossier,
  code: CodePiece,
  stagiaireId: string | null = null,
): Promise<LignePiece> {
  await synchroniserPieces(s, d);
  let piece = await trouverPiece(s, d.id, code, stagiaireId);
  if (!piece) {
    // Pièce hors du cycle « attendu » (trame de facture formateur, régénération anticipée).
    const id = nouvelId();
    await s.bd.insert(pieceDossier).values({ id, dossier_id: d.id, code, stagiaire_id: stagiaireId });
    piece = (await trouverPiece(s, d.id, code, stagiaireId))!;
  }
  const { html } = await rendrePiece(s, d, piece);
  const liens = stagiaireId ? await stagiairesDuDossier(s, d.id) : [];
  const st = liens.find((l) => l.st.id === stagiaireId)?.st;
  const nom = nomFichierPiece(code, st ? `${st.stagiaire_prenom} ${st.stagiaire_nom}` : null);
  const { chemin } = await archiverRendu(s, d, "Pièces de départ", nom, html);
  await s.bd
    .update(pieceDossier)
    .set({ chemin_depart: chemin, empreinte_depart: sha256(html), genere_le: s.horloge.maintenant() })
    .where(eq(pieceDossier.id, piece.id));
  return (await trouverPiece(s, d.id, code, stagiaireId))!;
}

/** Génère toutes les pièces d'un ensemble de codes, en déclinant les pièces individuelles par stagiaire. */
export async function genererPieces(
  s: Services,
  d: LigneDossier,
  codes: readonly CodePiece[],
): Promise<LignePiece[]> {
  const liens = await stagiairesDuDossier(s, d.id);
  const sortie: LignePiece[] = [];
  for (const code of codes) {
    if (estIndividuelle(code)) for (const { st } of liens) sortie.push(await genererPiece(s, d, code, st.id));
    else sortie.push(await genererPiece(s, d, code, null));
  }
  return sortie;
}
