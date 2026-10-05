/**
 * Table d'alias : anciens noms de variables rencontrés dans les gabarits → noms harmonisés.
 *
 * Sert UNIQUEMENT à migrer un gabarit existant. Un ancien nom ne doit plus apparaître
 * dans un nouveau document (contrôlé par les tests des gabarits).
 *
 * Un alias peut viser plusieurs variables : `nomformateur` devient
 * `{{formateur_prenom}} {{formateur_nom}}` car prénom et nom sont toujours scindés.
 */
import { RANG_MAX } from "./variables";

/** Correspondances exactes (sensibles à la casse : `adf` et `ADF` ont tous deux existé). */
const EXACTS: Record<string, readonly string[]> = {
  // Identifiant dossier
  nbadf: ["dossier_reference"],
  adf: ["dossier_reference"],
  NBADF: ["dossier_reference"],
  ADF: ["dossier_reference"],
  // Entreprise
  entreprise: ["entreprise_nom"],
  Entrepriseclient: ["entreprise_nom"],
  Nom_de_l_entreprise: ["entreprise_nom"],
  nomcom: ["entreprise_nom_commercial"],
  adresseentreprise: ["entreprise_adresse"],
  siret: ["entreprise_siret"],
  SIRET_de_l_entreprise: ["entreprise_siret"],
  prerepresentant: ["entreprise_representant_civilite", "entreprise_representant_prenom"],
  nomrepresentant: ["entreprise_representant_nom"],
  Nom_representant_entreprise: ["entreprise_representant_nom"],
  Prenom_representant_entreprise: ["entreprise_representant_prenom"],
  TEL: ["entreprise_representant_telephone"],
  // Stagiaires
  nomstagiaire: ["stagiaire_1_nom"],
  nomstagaire: ["stagiaire_1_nom"],
  NOMSTAGAIRE: ["stagiaire_1_nom"],
  listingstagiaire: ["formation_liste_stagiaires"],
  liste_stagiaires: ["formation_liste_stagiaires"],
  // Formateur
  nomformateur: ["formateur_prenom", "formateur_nom"],
  Formateur: ["formateur_prenom", "formateur_nom"],
  NOMFORM: ["formateur_prenom", "formateur_nom"],
  FOR: ["formateur_prenom", "formateur_nom"],
  emailFOR: ["formateur_email"],
  TelFOR: ["formateur_telephone"],
  EntrepriseFormateur: ["formateur_entreprise_nom"],
  AdresseFormateur: ["formateur_entreprise_adresse"],
  siretFormateur: ["formateur_entreprise_siret"],
  NDAFormateur: ["formateur_nda_numero"],
  NDAregion: ["formateur_dreets_region"],
  couthoraire: ["formateur_cout_horaire"],
  totalrecette: ["formateur_montant_total"],
  // Formation
  titre: ["formation_titre"],
  titreform: ["formation_titre"],
  Titreformation: ["formation_titre"],
  TITREFOR: ["formation_titre"],
  titreformation: ["formation_titre"],
  Titre_de_la_Formation: ["formation_titre"],
  objectifs: ["formation_objectifs"],
  objectifspédagogique: ["formation_objectifs"],
  Objectif_Pedagogique_de_la_Formation: ["formation_objectifs"],
  niveau: ["formation_niveau"],
  prerecquis: ["formation_prerequis"],
  horairetot: ["formation_duree_heures_total"],
  heuretotal: ["formation_duree_heures_total"],
  NBH: ["formation_duree_heures_total"],
  nbheure: ["formation_duree_heures_total"],
  Duree_totale_en_heures: ["formation_duree_heures_total"],
  jours: ["formation_duree_jours"],
  Nombre_de_jour_de_Formation: ["formation_duree_jours"],
  heurepres: ["formation_duree_heures_presentiel"],
  heurepresentiel: ["formation_duree_heures_presentiel"],
  nbdistanciel: ["formation_duree_heures_distanciel"],
  format: ["formation_modalite"],
  lieuformation: ["formation_lieu_nom"],
  L_entreprise_dans_laquelle_a_lieu_la_formation: ["formation_lieu_nom"],
  adresseformation: ["formation_lieu_adresse"],
  Adresse_lieu_formation: ["formation_lieu_adresse"],
  adresseFOR: ["formation_lieu_adresse"],
  adresse_de_l_entreprise_dans_laquelle_a_lieu_la_formation: ["formation_lieu_adresse"],
  siretformation: ["formation_lieu_siret"],
  lienform: ["formation_lien_visio"],
  datedeb: ["formation_date_debut"],
  datedebut: ["formation_date_debut"],
  DAT: ["formation_date_debut"],
  DATE: ["formation_date_debut"],
  Date_de_demarrage: ["formation_date_debut"],
  datefin: ["formation_date_fin"],
  DATEFIN: ["formation_date_fin"],
  Date_de_fin: ["formation_date_fin"],
  OPCO: ["formation_opco"],
  opco: ["formation_opco"],
  subrogation: ["formation_clause_subrogation"],
  // Séances — formes irrégulières de la première séance
  Hsess1: ["session_1_heure_debut"],
  hsess1fin: ["session_1_heure_fin"],
  // Signature
  lieusignature: ["signature_lieu"],
  Lieu_de_la_Convention: ["signature_lieu"],
  datesignature: ["signature_date"],
  Date_de_la_Convention: ["signature_date"],
  // Financier
  prixunitaire: ["formation_prix_unitaire_ht"],
  nbstagaire: ["formation_nb_stagiaires"],
  prixtotal: ["formation_prix_total_ht"],
  prixpresentiel: ["formation_prix_presentiel_ht"],
  nbfc: ["facture_of_numero"],
  // Évaluations
  datepreeval: ["recueil_date"],
};

/**
 * Anciens noms AMBIGUS : une seule variable source servait à deux usages (bug du gabarit d'origine).
 * La migration automatique refuse de choisir ; un humain tranche.
 */
export const ALIAS_AMBIGUS: Record<string, readonly string[]> = {
  prixun: ["facture_of_prix_unitaire_ht", "facture_of_montant_ht"],
};

const ORDINAUX: Record<string, number> = { "1ere": 1, "2eme": 2, "3eme": 3, "4eme": 4 };

/** Correspondances à rang variable : `nomapp3` → `stagiaire_3_nom`, `Date_Session_12` → `session_12_date`. */
const MOTIFS: ReadonlyArray<{
  re: RegExp;
  cible: (rang: number) => string;
  groupe: "stagiaire" | "session";
}> = [
  { re: /^nomapp(\d+)$/, cible: (n) => `stagiaire_${n}_nom`, groupe: "stagiaire" },
  { re: /^Prenom_et_Nom_de_l_apprenant_(\d+)$/, cible: (n) => `stagiaire_${n}_nom`, groupe: "stagiaire" },
  { re: /^positionapp(\d+)$/, cible: (n) => `stagiaire_${n}_poste`, groupe: "stagiaire" },
  { re: /^stagiaireposte(\d+)$/, cible: (n) => `stagiaire_${n}_poste`, groupe: "stagiaire" },
  { re: /^Date_Session_(\d+)$/, cible: (n) => `session_${n}_date`, groupe: "session" },
  { re: /^Heure_debut_Session_(\d+)$/i, cible: (n) => `session_${n}_heure_debut`, groupe: "session" },
  { re: /^Heure_fin_Session_(\d+)$/i, cible: (n) => `session_${n}_heure_fin`, groupe: "session" },
];

const MOTIFS_ORDINAUX: ReadonlyArray<{ re: RegExp; cible: (rang: number) => string }> = [
  { re: /^Date_(1ere|2eme|3eme|4eme)_Session$/i, cible: (n) => `session_${n}_date` },
  { re: /^Heure_debut_(1ere|2eme|3eme|4eme)_session$/i, cible: (n) => `session_${n}_heure_debut` },
  { re: /^Heure_fin_(1ere|2eme|3eme|4eme)_session$/i, cible: (n) => `session_${n}_heure_fin` },
];

export type ResolutionAlias =
  | { statut: "resolu"; cibles: readonly string[] }
  | { statut: "ambigu"; candidats: readonly string[] }
  | { statut: "inconnu" };

/** Résout un ancien nom de variable. Ne devine jamais : un nom inconnu reste inconnu. */
export function resoudreAlias(ancien: string): ResolutionAlias {
  const nom = ancien.trim(); // `{{format }}` : espace finale rencontrée dans les sources
  const ambigu = ALIAS_AMBIGUS[nom];
  if (ambigu) return { statut: "ambigu", candidats: ambigu };

  const exact = EXACTS[nom];
  if (exact) return { statut: "resolu", cibles: exact };

  for (const { re, cible, groupe } of MOTIFS) {
    const m = re.exec(nom);
    if (m) {
      const rang = Number(m[1]);
      if (rang >= 1 && rang <= RANG_MAX[groupe]) return { statut: "resolu", cibles: [cible(rang)] };
      return { statut: "inconnu" };
    }
  }
  for (const { re, cible } of MOTIFS_ORDINAUX) {
    const m = re.exec(nom);
    if (m) {
      const rang = ORDINAUX[m[1]!.toLowerCase()];
      if (rang) return { statut: "resolu", cibles: [cible(rang)] };
    }
  }
  return { statut: "inconnu" };
}

/** Toutes les cibles d'alias exacts — utilisé par les tests pour vérifier qu'aucun alias ne pointe dans le vide. */
export function ciblesDesAliasExacts(): string[] {
  return [...new Set([...Object.values(EXACTS).flat(), ...Object.values(ALIAS_AMBIGUS).flat()])];
}
