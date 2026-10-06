/**
 * Résolution des variables : agrégat du dossier → table `{{variable}}` prête pour le moteur de gabarits.
 * C'est ici que les tables enfants (stagiaires, séances) redeviennent `stagiaire_1..8` et `session_1..20`
 * — uniquement le temps de générer le document (règle d'or n° 5).
 */
import { RANG_MAX, estVariableConnue } from "../referentiel/variables";
import type { Variables } from "../gabarits/moteur";
import type { AgregatDossier } from "./agregat";
import { ajouterJours, calculer, niveauAtteinte } from "./calculs";
import { formaterDate, formaterHeure, formaterModalite, formaterMontant, formaterNombre, formaterPourcentage } from "./formats";

export interface OptionsResolution {
  /**
   * Pour une pièce individuelle : identifiant du stagiaire concerné. Il est alors seul dans le groupe
   * répétable (rang 1), et ses évaluations alimentent les variables `recueil_*`, `evaluation_acquis_*`…
   */
  stagiaireId?: string;
}

export function resoudreVariables(d: AgregatDossier, options: OptionsResolution = {}): Variables {
  const c = calculer(d);
  const f = d.formation;
  const stagiaires = options.stagiaireId ? d.stagiaires.filter((s) => s.id === options.stagiaireId) : d.stagiaires;
  if (options.stagiaireId && stagiaires.length === 0) {
    throw new Error(`Le stagiaire ${options.stagiaireId} n'appartient pas au dossier ${d.dossier_reference}.`);
  }

  const v: Variables = {
    dossier_reference: d.dossier_reference,
    ...texteSeulement(d.organisme),
    ...texteSeulement(d.entreprise),
    ...texteSeulement(d.formateur),

    formation_titre: f.formation_titre,
    formation_objectifs: f.formation_objectifs,
    formation_objectifs_atteints: f.formation_objectifs_atteints,
    formation_niveau: f.formation_niveau,
    formation_prerequis: f.formation_prerequis,
    formation_public_vise: f.formation_public_vise,
    formation_programme: f.formation_programme,
    formation_duree_heures_total: formaterNombre(f.formation_duree_heures_total),
    formation_duree_jours: formaterNombre(f.formation_duree_jours),
    formation_duree_heures_presentiel: formaterNombre(f.formation_duree_heures_presentiel || null),
    formation_duree_heures_distanciel: formaterNombre(f.formation_duree_heures_distanciel || null),
    formation_modalite: formaterModalite(f.formation_modalite),
    formation_lieu_nom: f.formation_lieu_nom,
    formation_lieu_adresse: f.formation_lieu_adresse,
    formation_lieu_siret: f.formation_lieu_siret,
    formation_lien_visio: f.formation_lien_visio,
    formation_date_debut: formaterDate(f.formation_date_debut),
    formation_date_fin: formaterDate(f.formation_date_fin),
    formation_opco: f.formation_opco,
    formation_clause_subrogation: d.mode_financement === "opco" || d.mode_financement === "faf" ? d.organisme.formation_clause_subrogation : "",

    signature_lieu: f.signature_lieu,
    signature_date: formaterDate(d.signature_date),

    // Champs calculés
    formation_liste_stagiaires: d.stagiaires.map((s) => s.nom).filter(Boolean).join(", "),
    formation_nb_stagiaires: String(c.formation_nb_stagiaires),
    formation_prix_unitaire_ht: formaterMontant(f.formation_prix_unitaire_ht),
    formation_prix_presentiel_ht: formaterMontant(f.formation_prix_presentiel_ht),
    formation_prix_total_ht: formaterMontant(c.formation_prix_total_ht),
    formateur_cout_horaire: formaterMontant(c.formateur_cout_horaire),
    formateur_montant_total: formaterMontant(c.formateur_montant_total),
    portage_commission_pourcentage: formaterPourcentage(c.portage_commission_pourcentage),
    portage_commission_montant: formaterMontant(c.portage_commission_montant),
    facture_formateur_net_a_payer: formaterMontant(c.facture_formateur_net_a_payer),
  };

  if (d.facture_of) {
    const fo = d.facture_of;
    Object.assign(v, {
      facture_of_numero: fo.facture_of_numero,
      facture_of_date: formaterDate(fo.facture_of_date),
      facture_of_date_echeance: formaterDate(ajouterJours(fo.facture_of_date, d.organisme.delai_paiement_jours)),
      facture_of_code_client: fo.facture_of_code_client,
      facture_of_numero_adherent: fo.facture_of_numero_adherent,
      facture_of_prix_unitaire_ht: formaterMontant(c.facture_of_prix_unitaire_ht),
      facture_of_montant_ht: formaterMontant(c.facture_of_montant_ht),
      facture_of_montant_tva: formaterMontant(c.facture_of_montant_tva),
      facture_of_montant_ttc: formaterMontant(c.facture_of_montant_ttc),
      facture_of_acompte: fo.facture_of_acompte ? formaterMontant(fo.facture_of_acompte) : "",
      facture_of_solde_du: formaterMontant(c.facture_of_solde_du),
    });
  }
  if (d.facture_formateur) {
    const ff = d.facture_formateur;
    Object.assign(v, {
      facture_formateur_numero: ff.facture_formateur_numero,
      facture_formateur_date: formaterDate(ff.facture_formateur_date),
      facture_formateur_date_echeance: formaterDate(ajouterJours(ff.facture_formateur_date, d.organisme.delai_paiement_jours)),
    });
  }

  stagiaires.slice(0, RANG_MAX.stagiaire).forEach((s, i) => {
    const n = i + 1;
    v[`stagiaire_${n}_nom`] = s.nom;
    v[`stagiaire_${n}_poste`] = s.poste;
    v[`stagiaire_${n}_email`] = s.email;
    v[`stagiaire_${n}_situation_handicap`] = s.situation_handicap;
  });

  d.seances.slice(0, RANG_MAX.session).forEach((s, i) => {
    const n = i + 1;
    v[`session_${n}_date`] = formaterDate(s.date);
    v[`session_${n}_heure_debut`] = formaterHeure(s.heure_debut);
    v[`session_${n}_heure_fin`] = formaterHeure(s.heure_fin);
  });

  if (options.stagiaireId) {
    const e = d.evaluations?.[options.stagiaireId] ?? {};
    Object.assign(v, {
      recueil_date: formaterDate(e.recueil_date),
      positionnement_date: formaterDate(e.positionnement_date),
      positionnement_ajustement: e.positionnement_ajustement ?? "",
      evaluation_acquis_date: formaterDate(e.evaluation_acquis_date),
      evaluation_acquis_score:
        e.evaluation_acquis_score === null || e.evaluation_acquis_score === undefined ? "" : `${formaterNombre(e.evaluation_acquis_score)} / 100`,
      evaluation_acquis_niveau_atteinte: niveauAtteinte(e.evaluation_acquis_score),
      satisfaction_froid_date: formaterDate(e.satisfaction_froid_date),
      attestation_heures_realisees: formaterNombre(d.heures_realisees?.[options.stagiaireId] ?? null),
      attestation_date: formaterDate(d.attestation_date),
    });
  }

  return v;
}

/**
 * Ne garde que les propriétés textuelles qui SONT des variables du dictionnaire : une ligne de base de
 * données porte aussi des colonnes techniques (identifiants, statuts) qui n'ont rien à faire dans une pièce.
 */
function texteSeulement(objet: object): Variables {
  const sortie: Variables = {};
  for (const [cle, valeur] of Object.entries(objet)) if (typeof valeur === "string" && estVariableConnue(cle)) sortie[cle] = valeur;
  return sortie;
}
