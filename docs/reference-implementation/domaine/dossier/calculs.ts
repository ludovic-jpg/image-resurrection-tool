/**
 * Champs calculés du dossier — règle d'or n° 6 : jamais saisis, toujours recalculés ici.
 * Tous les montants sont en centimes.
 */
import type { AgregatDossier } from "./agregat";

export interface Calculs {
  formation_nb_stagiaires: number;
  formation_prix_total_ht: number | null;
  formateur_cout_horaire: number | null;
  formateur_montant_total: number | null;
  portage_commission_pourcentage: number | null;
  portage_commission_montant: number | null;
  facture_formateur_net_a_payer: number | null;
  facture_of_prix_unitaire_ht: number | null;
  facture_of_montant_ht: number | null;
  facture_of_montant_tva: number | null;
  facture_of_montant_ttc: number | null;
  facture_of_solde_du: number | null;
}

/**
 * Modèle financier du portage (repris de `commission.ts`, base B) :
 *   prix de vente HT  −  commission de portage  =  net reversé au formateur.
 * Si un coût horaire a été saisi au contrat de sous-traitance, il prime : le total formateur vaut
 * coût horaire × heures, et la commission affichée est la différence réellement constatée.
 */
export function calculer(d: AgregatDossier): Calculs {
  const nb = d.stagiaires.length;
  const pu = d.formation.formation_prix_unitaire_ht;
  const total = pu === null ? null : pu * nb;
  const heures = d.formation.formation_duree_heures_total;
  const tauxConfig = d.organisme.portage_commission_pourcentage;

  let coutHoraire = d.formation.formateur_cout_horaire;
  let montantFormateur: number | null = null;
  let commission: number | null = null;
  let taux: number | null = tauxConfig;

  if (coutHoraire !== null && heures !== null) {
    montantFormateur = Math.round(coutHoraire * heures);
    if (total !== null) {
      commission = total - montantFormateur;
      taux = total > 0 ? Math.round((commission / total) * 10000) / 100 : null;
    }
  } else if (total !== null) {
    commission = Math.round((total * tauxConfig) / 100);
    montantFormateur = total - commission;
    coutHoraire = heures && heures > 0 ? Math.round(montantFormateur / heures) : null;
  }

  const tva = total === null ? null : Math.round((total * d.organisme.tva_pourcentage) / 100);
  const ttc = total === null || tva === null ? null : total + tva;
  const acompte = d.facture_of?.facture_of_acompte ?? 0;

  return {
    formation_nb_stagiaires: nb,
    formation_prix_total_ht: total,
    formateur_cout_horaire: coutHoraire,
    formateur_montant_total: montantFormateur,
    portage_commission_pourcentage: taux,
    portage_commission_montant: commission,
    facture_formateur_net_a_payer: montantFormateur,
    facture_of_prix_unitaire_ht: pu,
    facture_of_montant_ht: total,
    facture_of_montant_tva: tva,
    facture_of_montant_ttc: ttc,
    facture_of_solde_du: ttc === null ? null : ttc - acompte,
  };
}

/** Ajoute des jours à une date ISO (échéances de facture). */
export function ajouterJours(iso: string, jours: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + jours));
  return d.toISOString().slice(0, 10);
}

/** Niveau d'atteinte des objectifs, déduit du score sur 100 de l'évaluation des acquis. */
export function niveauAtteinte(score: number | null | undefined): string {
  if (score === null || score === undefined) return "";
  if (score >= 80) return "Objectifs atteints";
  if (score >= 50) return "Objectifs partiellement atteints";
  return "Objectifs non atteints";
}
