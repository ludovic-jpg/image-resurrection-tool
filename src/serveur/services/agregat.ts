/** Chargement d'un dossier depuis la base, sous les deux formes dont le noyau a besoin : agrégat et contexte de pipeline. */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AgregatDossier, Evaluations } from "@/domaine/dossier/agregat";
import { dureeSeanceHeures } from "@/domaine/dossier/formats";
import type { ContexteDossier } from "@/domaine/pipeline/transitions";
import type { SousStatut } from "@/domaine/pipeline/statuts";
import type { CodePiece } from "@/domaine/referentiel/pieces";
import {
  dossierFormation,
  emargement,
  entrepriseCliente,
  evaluation,
  factureFormateur,
  factureOf,
  formateur,
  pieceDossier,
  seance,
  signature,
  stagiaire,
  stagiaireDossier,
} from "../bd/schema";
import { dateIso } from "../ports/divers";
import { lireOrganisme, versOrganismeDuNoyau } from "./organisme";
import { interdit, introuvable, type Acteur, type Services } from "./socle";

export type LigneDossier = typeof dossierFormation.$inferSelect;

/**
 * Contrôle d'accès à un dossier — le cloisonnement « strict entre formateurs » du cahier des charges (§9) :
 * un formateur ne voit que SES dossiers, un apprenant que ceux où il est inscrit, un admin que ceux de SON organisme.
 */
export async function accederAuDossier(
  s: Services,
  acteur: Acteur,
  dossierId: string,
): Promise<LigneDossier> {
  const [d] = await s.bd
    .select()
    .from(dossierFormation)
    .where(and(eq(dossierFormation.id, dossierId), eq(dossierFormation.of_id, acteur.of_id)));
  if (!d) throw introuvable("Dossier");
  if (acteur.role === "formateur" && d.formateur_id !== acteur.formateur_id) throw introuvable("Dossier");
  if (acteur.role === "apprenant") {
    if (!acteur.stagiaire_id) throw interdit();
    const [inscrit] = await s.bd
      .select({ id: stagiaireDossier.id })
      .from(stagiaireDossier)
      .where(
        and(
          eq(stagiaireDossier.dossier_id, dossierId),
          eq(stagiaireDossier.stagiaire_id, acteur.stagiaire_id),
        ),
      );
    if (!inscrit) throw introuvable("Dossier");
  }
  return d;
}

export async function stagiairesDuDossier(s: Services, dossierId: string) {
  return s.bd
    .select({ lien: stagiaireDossier, st: stagiaire })
    .from(stagiaireDossier)
    .innerJoin(stagiaire, eq(stagiaire.id, stagiaireDossier.stagiaire_id))
    .where(eq(stagiaireDossier.dossier_id, dossierId))
    .orderBy(asc(stagiaireDossier.rang));
}

export async function seancesDuDossier(s: Services, dossierId: string) {
  return s.bd
    .select()
    .from(seance)
    .where(eq(seance.dossier_id, dossierId))
    .orderBy(asc(seance.date), asc(seance.heure_debut));
}

/**
 * Heures réellement suivies par stagiaire. Émargement électronique : somme des séances signées par le stagiaire.
 * Si la feuille a été retournée sur papier (dépôt d'un fichier), on retient la durée prévue — hypothèse tracée.
 */
export async function heuresRealisees(s: Services, d: LigneDossier): Promise<Record<string, number>> {
  const seances = await seancesDuDossier(s, d.id);
  const liens = await stagiairesDuDossier(s, d.id);
  const signes = seances.length
    ? await s.bd
        .select()
        .from(emargement)
        .where(
          and(
            inArray(
              emargement.seance_id,
              seances.map((x) => x.id),
            ),
            eq(emargement.signataire, "stagiaire"),
          ),
        )
    : [];
  const feuilles = await s.bd
    .select()
    .from(pieceDossier)
    .where(and(eq(pieceDossier.dossier_id, d.id), eq(pieceDossier.code, "06-PDT")));
  const sortie: Record<string, number> = {};
  for (const { st } of liens) {
    const parSignature = signes
      .filter((e) => e.stagiaire_id === st.id)
      .reduce(
        (total, e) =>
          total +
          dureeSeanceHeures(
            seances.find((x) => x.id === e.seance_id)!.heure_debut,
            seances.find((x) => x.id === e.seance_id)!.heure_fin,
          ),
        0,
      );
    const feuille = feuilles.find((f) => f.stagiaire_id === st.id);
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

export async function chargerAgregat(s: Services, d: LigneDossier): Promise<AgregatDossier> {
  const [of, [ent], [form], liens, seances, evals, [fo], [ff]] = await Promise.all([
    lireOrganisme(s, d.of_id),
    s.bd.select().from(entrepriseCliente).where(eq(entrepriseCliente.id, d.entreprise_id)),
    s.bd.select().from(formateur).where(eq(formateur.id, d.formateur_id)),
    stagiairesDuDossier(s, d.id),
    seancesDuDossier(s, d.id),
    s.bd.select().from(evaluation).where(eq(evaluation.dossier_id, d.id)),
    s.bd.select().from(factureOf).where(eq(factureOf.dossier_id, d.id)),
    s.bd.select().from(factureFormateur).where(eq(factureFormateur.dossier_id, d.id)),
  ]);
  if (!ent || !form) throw introuvable("Dossier");

  const evaluations: Record<string, Evaluations> = {};
  for (const ev of evals) {
    const e = (evaluations[ev.stagiaire_id] ??= {});
    if (ev.type === "recueil") e.recueil_date = ev.date;
    if (ev.type === "positionnement")
      Object.assign(e, { positionnement_date: ev.date, positionnement_ajustement: ev.ajustement });
    if (ev.type === "acquis")
      Object.assign(e, { evaluation_acquis_date: ev.date, evaluation_acquis_score: ev.score });
    if (ev.type === "satisfaction_froid") e.satisfaction_froid_date = ev.date;
  }

  // Date de signature de référence : celle de la convention si elle est signée, sinon la date du jour.
  const [conv] = await s.bd
    .select({ h: signature.horodatage })
    .from(signature)
    .innerJoin(pieceDossier, eq(pieceDossier.id, signature.piece_id))
    .where(and(eq(pieceDossier.dossier_id, d.id), eq(pieceDossier.code, "02-AVT")));

  const { id: _e, of_id: _eo, formateur_id: _ef, cree_le: _ec, ...entreprise } = ent;
  return {
    dossier_reference: d.dossier_reference,
    sous_statut: d.sous_statut as SousStatut,
    mode_financement: d.mode_financement,
    organisme: versOrganismeDuNoyau(of),
    entreprise,
    formateur: form,
    formation: d,
    stagiaires: liens.map(({ lien, st }) => ({
      id: st.id,
      nom: `${st.stagiaire_prenom} ${st.stagiaire_nom}`.trim(),
      poste: lien.poste_occupe || st.stagiaire_poste,
      email: st.stagiaire_email,
      situation_handicap: st.stagiaire_situation_handicap,
    })),
    seances,
    facture_of: fo ?? null,
    facture_formateur: ff ?? null,
    evaluations,
    heures_realisees: await heuresRealisees(s, d),
    signature_date: dateIso(conv?.h ?? s.horloge.maintenant()),
    attestation_date: dateIso(d.termine_le ?? s.horloge.maintenant()),
  };
}

export async function chargerContextePipeline(s: Services, d: LigneDossier): Promise<ContexteDossier> {
  const [pieces, liens] = await Promise.all([
    s.bd.select().from(pieceDossier).where(eq(pieceDossier.dossier_id, d.id)),
    stagiairesDuDossier(s, d.id),
  ]);
  return {
    sous_statut: d.sous_statut as SousStatut,
    pieces: pieces.map((p) => ({
      code: p.code as CodePiece,
      stagiaire_id: p.stagiaire_id,
      statut: p.statut,
    })),
    stagiaire_ids: liens.map((l) => l.st.id),
  };
}
