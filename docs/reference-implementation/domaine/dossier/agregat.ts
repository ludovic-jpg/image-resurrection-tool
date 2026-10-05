/**
 * Agrégat « dossier de formation » tel que le noyau le voit.
 *
 * Convention : les propriétés qui portent une donnée du dictionnaire ont EXACTEMENT le nom de la variable
 * harmonisée (`of_siret`, `formation_titre`…). Base de données, noyau et gabarits parlent donc la même
 * langue, et la résolution des variables n'a presque rien à traduire — donc presque rien à casser.
 *
 * Les montants sont en centimes (entiers), les dates en ISO `AAAA-MM-JJ`, les heures en `HH:MM`.
 */
import type { SousStatut } from "../pipeline/statuts";

export type Modalite = "presentiel" | "distanciel" | "mixte";
export type ModeFinancement = "opco" | "faf" | "entreprise" | "fonds_propres";

export interface Organisme {
  of_nom: string;
  of_forme_juridique: string;
  of_adresse: string;
  of_siret: string;
  of_nda_numero: string;
  of_dreets_region: string;
  of_qualiopi_numero: string;
  of_certification_complementaire_numero: string;
  of_representant_civilite: string;
  of_representant_prenom: string;
  of_representant_nom: string;
  of_email_pedagogie: string;
  of_email_comptabilite: string;
  of_tribunal_competent: string;
  of_iban: string;
  of_bic: string;
  of_banque_nom: string;
  of_tva_intracom: string;
  of_telephone: string;
  formation_clause_subrogation: string;
  /** Taux de commission de portage, en pourcentage (ex. 25). */
  portage_commission_pourcentage: number;
  /** Taux de TVA appliqué aux factures de l'OF, en pourcentage. 0 = exonération art. 261.4.4° CGI. */
  tva_pourcentage: number;
  /** Délai de paiement des factures, en jours. */
  delai_paiement_jours: number;
}

export interface Entreprise {
  entreprise_nom: string;
  entreprise_nom_commercial: string;
  entreprise_adresse: string;
  entreprise_siret: string;
  entreprise_representant_civilite: string;
  entreprise_representant_prenom: string;
  entreprise_representant_nom: string;
  entreprise_representant_telephone: string;
  entreprise_representant_email: string;
}

export interface Formateur {
  formateur_prenom: string;
  formateur_nom: string;
  formateur_email: string;
  formateur_telephone: string;
  formateur_entreprise_nom: string;
  formateur_entreprise_adresse: string;
  formateur_entreprise_siret: string;
  formateur_nda_numero: string;
  formateur_dreets_region: string;
  formateur_iban: string;
  formateur_bic: string;
}

export interface StagiaireDuDossier {
  id: string;
  /** Prénom et nom, tels qu'ils apparaissent sur les pièces (`stagiaire_N_nom`). */
  nom: string;
  poste: string;
  email: string;
  situation_handicap: string;
}

export interface Seance {
  id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
}

export interface DonneesFormation {
  formation_titre: string;
  formation_objectifs: string;
  formation_objectifs_atteints: string;
  formation_niveau: string;
  formation_prerequis: string;
  formation_public_vise: string;
  /** Programme détaillé, figé dans le dossier à sa création (annexe de la convention, pièce PRG). */
  formation_programme: string;
  formation_duree_heures_total: number | null;
  formation_duree_jours: number | null;
  formation_duree_heures_presentiel: number | null;
  formation_duree_heures_distanciel: number | null;
  formation_modalite: Modalite;
  formation_lieu_nom: string;
  formation_lieu_adresse: string;
  formation_lieu_siret: string;
  formation_lien_visio: string;
  formation_date_debut: string;
  formation_date_fin: string;
  formation_opco: string;
  formation_prix_unitaire_ht: number | null;
  formation_prix_presentiel_ht: number | null;
  /** Saisi au contrat de sous-traitance ; s'il est vide, il est déduit de la commission de portage. */
  formateur_cout_horaire: number | null;
  signature_lieu: string;
}

export interface FactureOf {
  facture_of_numero: string;
  facture_of_date: string;
  facture_of_code_client: string;
  facture_of_numero_adherent: string;
  facture_of_acompte: number | null;
}

export interface FactureFormateur {
  facture_formateur_numero: string;
  facture_formateur_date: string;
}

export interface Evaluations {
  recueil_date?: string;
  positionnement_date?: string;
  positionnement_ajustement?: string;
  evaluation_acquis_date?: string;
  /** Score sur 100. */
  evaluation_acquis_score?: number | null;
  satisfaction_froid_date?: string;
}

export interface AgregatDossier {
  dossier_reference: string;
  sous_statut: SousStatut;
  mode_financement: ModeFinancement;
  organisme: Organisme;
  entreprise: Entreprise;
  formateur: Formateur;
  formation: DonneesFormation;
  stagiaires: StagiaireDuDossier[];
  seances: Seance[];
  facture_of?: FactureOf | null;
  facture_formateur?: FactureFormateur | null;
  /** Évaluations par stagiaire (clé = id du stagiaire). */
  evaluations?: Record<string, Evaluations>;
  /** Heures réellement émargées par stagiaire (clé = id du stagiaire). */
  heures_realisees?: Record<string, number>;
  /** Date de la signature de référence de la pièce (horodatage de la signature électronique). */
  signature_date?: string;
  attestation_date?: string;
}
