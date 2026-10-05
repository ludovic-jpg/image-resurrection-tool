/**
 * Dictionnaire des variables harmonisées du dossier de formation.
 *
 * Source : `docs/sources/TableauVariablesQualiopi.xlsx` (onglet « Dictionnaire variables »)
 * et la skill `conventions-s4m`. Ce fichier est LE contrat de nommage de toute l'application :
 * un gabarit, un formulaire ou une colonne qui porte une de ces données utilise ce nom, et aucun autre.
 *
 * Règles d'or (rappel) :
 *  1. une seule syntaxe de balise : `{{variable}}` ;
 *  2. `snake_case`, sans accent, sans espace, sans majuscule, préfixé par entité ;
 *  3. aucune donnée réelle en dur dans un gabarit ;
 *  4. un concept = une variable ;
 *  5. groupes répétables (`stagiaire_N_*`, `session_N_*`) : numérotés dans le gabarit seulement ;
 *  6. un champ calculé n'est jamais saisi.
 */

/** D'où vient la valeur — décide qui peut la saisir, et si elle peut l'être. */
export type OrigineVariable =
  | "systeme" // généré par la plateforme (référence, numérotation)
  | "config_of" // configuration du compte de l'organisme — jamais saisie par dossier
  | "saisie" // saisie par le formateur ou l'OF à l'ouverture du dossier
  | "profil_formateur" // profil du formateur
  | "declaratif_stagiaire" // déclaré par l'apprenant
  | "calcule"; // calculé — jamais saisissable

export type TypeVariable =
  | "texte"
  | "texte_long"
  | "nombre"
  | "montant"
  | "pourcentage"
  | "date"
  | "heure"
  | "url"
  | "liste";

export type GroupeRepetable = "stagiaire" | "session";

export interface VariableDef {
  /** Nom harmonisé. Pour un groupe répétable, le rang est noté `N` : `stagiaire_N_nom`. */
  nom: string;
  categorie: string;
  type: TypeVariable;
  origine: OrigineVariable;
  /** Renseigné si la variable appartient à un groupe répétable. */
  repetable?: GroupeRepetable;
  /** Codes des pièces qui utilisent la variable (informatif, issu du classeur). */
  pieces?: string;
  /**
   * `true` si la variable n'existait pas dans le classeur d'origine et a été ajoutée pour couvrir
   * une exigence du cahier des charges (tracé au DEV_LOG).
   */
  ajout?: boolean;
}

/** Bornes des groupes répétables dans les gabarits (contrainte du moteur de fusion). */
export const RANG_MAX: Record<GroupeRepetable, number> = { stagiaire: 8, session: 20 };

const C = {
  dossier: "01 · Identifiant dossier",
  of: "02 · Organisme de formation",
  entreprise: "03 · Entreprise cliente",
  stagiaire: "04 · Stagiaire",
  formateur: "05 · Formateur",
  formation: "06 · Formation",
  planning: "07 · Planning",
  signature: "08 · Signature",
  devis: "09 · Financier — convention",
  factureFormateur: "10 · Financier — facture formateur",
  factureOf: "11 · Financier — facture OF",
  evaluations: "12 · Évaluations",
} as const;

const v = (
  nom: string,
  categorie: string,
  type: TypeVariable,
  origine: OrigineVariable,
  extra: Partial<VariableDef> = {},
): VariableDef => ({ nom, categorie, type, origine, ...extra });

export const DICTIONNAIRE: readonly VariableDef[] = [
  // 01 · Identifiant dossier
  v("dossier_reference", C.dossier, "texte", "systeme", { pieces: "toutes" }),

  // 02 · Organisme de formation (tenant) — configuration du compte, jamais une constante
  v("of_nom", C.of, "texte", "config_of"),
  v("of_forme_juridique", C.of, "texte", "config_of"),
  v("of_adresse", C.of, "texte_long", "config_of"),
  v("of_siret", C.of, "texte", "config_of"),
  v("of_nda_numero", C.of, "texte", "config_of"),
  v("of_dreets_region", C.of, "texte", "config_of"),
  v("of_qualiopi_numero", C.of, "texte", "config_of"),
  v("of_certification_complementaire_numero", C.of, "texte", "config_of"),
  v("of_representant_civilite", C.of, "texte", "config_of"),
  v("of_representant_prenom", C.of, "texte", "config_of"),
  v("of_representant_nom", C.of, "texte", "config_of"),
  v("of_email_pedagogie", C.of, "texte", "config_of"),
  v("of_email_comptabilite", C.of, "texte", "config_of"),
  v("of_tribunal_competent", C.of, "texte", "config_of"),
  v("of_iban", C.of, "texte", "config_of"),
  v("of_bic", C.of, "texte", "config_of"),
  v("of_banque_nom", C.of, "texte", "config_of"),
  v("of_tva_intracom", C.of, "texte", "config_of"),
  v("of_telephone", C.of, "texte", "config_of"),

  // 03 · Entreprise cliente
  v("entreprise_nom", C.entreprise, "texte", "saisie"),
  v("entreprise_nom_commercial", C.entreprise, "texte", "saisie"),
  v("entreprise_adresse", C.entreprise, "texte_long", "saisie"),
  v("entreprise_siret", C.entreprise, "texte", "saisie"),
  v("entreprise_representant_civilite", C.entreprise, "texte", "saisie"),
  v("entreprise_representant_prenom", C.entreprise, "texte", "saisie"),
  v("entreprise_representant_nom", C.entreprise, "texte", "saisie"),
  v("entreprise_representant_telephone", C.entreprise, "texte", "saisie"),
  // Ajout : sans adresse e-mail, l'envoi automatique à l'entreprise (F-DOS-06) est impossible.
  v("entreprise_representant_email", C.entreprise, "texte", "saisie", { ajout: true }),

  // 04 · Stagiaire (répétable 1..8)
  v("stagiaire_N_nom", C.stagiaire, "texte", "saisie", { repetable: "stagiaire" }),
  v("stagiaire_N_poste", C.stagiaire, "texte", "saisie", { repetable: "stagiaire" }),
  v("stagiaire_N_situation_handicap", C.stagiaire, "texte", "declaratif_stagiaire", {
    repetable: "stagiaire",
  }),
  // Ajout : l'invitation de l'apprenant (F-COM-05) exige son adresse e-mail.
  v("stagiaire_N_email", C.stagiaire, "texte", "saisie", { repetable: "stagiaire", ajout: true }),
  v("formation_liste_stagiaires", C.stagiaire, "texte_long", "calcule"),

  // 05 · Formateur — prénom et nom toujours scindés
  v("formateur_prenom", C.formateur, "texte", "profil_formateur"),
  v("formateur_nom", C.formateur, "texte", "profil_formateur"),
  v("formateur_email", C.formateur, "texte", "profil_formateur"),
  v("formateur_telephone", C.formateur, "texte", "profil_formateur"),
  v("formateur_entreprise_nom", C.formateur, "texte", "profil_formateur"),
  v("formateur_entreprise_adresse", C.formateur, "texte_long", "profil_formateur"),
  v("formateur_entreprise_siret", C.formateur, "texte", "profil_formateur"),
  v("formateur_nda_numero", C.formateur, "texte", "profil_formateur"),
  v("formateur_dreets_region", C.formateur, "texte", "profil_formateur"),
  v("formateur_cout_horaire", C.formateur, "montant", "saisie"),
  v("formateur_montant_total", C.formateur, "montant", "calcule"),
  v("formateur_iban", C.formateur, "texte", "profil_formateur"),
  v("formateur_bic", C.formateur, "texte", "profil_formateur"),

  // 06 · Formation (action)
  v("formation_titre", C.formation, "texte", "saisie", { pieces: "toutes" }),
  v("formation_objectifs", C.formation, "texte_long", "saisie"),
  v("formation_objectifs_atteints", C.formation, "texte_long", "saisie"),
  v("formation_niveau", C.formation, "texte", "saisie"),
  v("formation_prerequis", C.formation, "texte_long", "saisie"),
  v("formation_public_vise", C.formation, "texte_long", "saisie", { ajout: true }),
  v("formation_programme", C.formation, "texte_long", "saisie", { ajout: true }),
  v("formation_duree_heures_total", C.formation, "nombre", "saisie"),
  v("formation_duree_jours", C.formation, "nombre", "saisie"),
  v("formation_duree_heures_presentiel", C.formation, "nombre", "saisie"),
  v("formation_duree_heures_distanciel", C.formation, "nombre", "saisie"),
  v("formation_modalite", C.formation, "liste", "saisie"),
  v("formation_lieu_nom", C.formation, "texte", "saisie"),
  v("formation_lieu_adresse", C.formation, "texte_long", "saisie"),
  v("formation_lieu_siret", C.formation, "texte", "saisie"),
  v("formation_lien_visio", C.formation, "url", "saisie"),
  v("formation_date_debut", C.formation, "date", "saisie"),
  v("formation_date_fin", C.formation, "date", "saisie"),
  v("formation_opco", C.formation, "texte", "saisie"),
  v("formation_clause_subrogation", C.formation, "texte_long", "config_of"),

  // 07 · Planning / séances (répétable 1..20)
  v("session_N_date", C.planning, "date", "saisie", { repetable: "session" }),
  v("session_N_heure_debut", C.planning, "heure", "saisie", { repetable: "session" }),
  v("session_N_heure_fin", C.planning, "heure", "saisie", { repetable: "session" }),

  // 08 · Signature
  v("signature_lieu", C.signature, "texte", "saisie"),
  v("signature_date", C.signature, "date", "systeme"),

  // 09 · Financier — devis / convention
  v("formation_prix_unitaire_ht", C.devis, "montant", "saisie"),
  v("formation_nb_stagiaires", C.devis, "nombre", "calcule"),
  v("formation_prix_total_ht", C.devis, "montant", "calcule"),
  v("formation_prix_presentiel_ht", C.devis, "montant", "saisie"),

  // 10 · Financier — facture formateur (10-FIN)
  v("facture_formateur_numero", C.factureFormateur, "texte", "systeme"),
  v("facture_formateur_date", C.factureFormateur, "date", "systeme"),
  v("facture_formateur_date_echeance", C.factureFormateur, "date", "systeme"),
  v("portage_commission_pourcentage", C.factureFormateur, "pourcentage", "config_of"),
  // Ajouts : la pièce 10-FIN affiche le détail du calcul « montant total moins commission de portage ».
  v("portage_commission_montant", C.factureFormateur, "montant", "calcule", { ajout: true }),
  v("facture_formateur_net_a_payer", C.factureFormateur, "montant", "calcule", { ajout: true }),

  // 11 · Financier — facture OF (11-FIN)
  v("facture_of_numero", C.factureOf, "texte", "systeme"),
  v("facture_of_date", C.factureOf, "date", "systeme"),
  v("facture_of_date_echeance", C.factureOf, "date", "systeme"),
  v("facture_of_code_client", C.factureOf, "texte", "saisie"),
  v("facture_of_prix_unitaire_ht", C.factureOf, "montant", "saisie"),
  v("facture_of_montant_ht", C.factureOf, "montant", "calcule"),
  v("facture_of_montant_tva", C.factureOf, "montant", "calcule"),
  v("facture_of_montant_ttc", C.factureOf, "montant", "calcule"),
  v("facture_of_acompte", C.factureOf, "montant", "saisie"),
  v("facture_of_solde_du", C.factureOf, "montant", "calcule"),
  v("facture_of_numero_adherent", C.factureOf, "texte", "saisie"),

  // 12 · Évaluations
  v("recueil_date", C.evaluations, "date", "saisie"),
  v("positionnement_date", C.evaluations, "date", "saisie"),
  v("positionnement_ajustement", C.evaluations, "texte_long", "saisie"),
  v("evaluation_acquis_date", C.evaluations, "date", "saisie"),
  v("evaluation_acquis_score", C.evaluations, "nombre", "saisie"),
  v("evaluation_acquis_niveau_atteinte", C.evaluations, "texte", "saisie"),
  v("satisfaction_froid_date", C.evaluations, "date", "declaratif_stagiaire"),
  // Ajouts : l'attestation (09-FIN) atteste de la durée RÉALISÉE, calculée depuis l'émargement.
  v("attestation_heures_realisees", C.evaluations, "nombre", "calcule", { ajout: true }),
  v("attestation_date", C.evaluations, "date", "systeme", { ajout: true }),
];

const PREFIXES_AUTORISES = [
  "dossier_",
  "of_",
  "entreprise_",
  "stagiaire_",
  "formateur_",
  "formation_",
  "session_",
  "signature_",
  "facture_of_",
  "facture_formateur_",
  "portage_",
  "recueil_",
  "positionnement_",
  "evaluation_acquis_",
  "satisfaction_froid_",
  "attestation_",
] as const;

/** Vérifie qu'un nom respecte la règle d'or n° 2. Retourne la liste des manquements (vide = conforme). */
export function validerNomVariable(nom: string): string[] {
  const erreurs: string[] = [];
  if (!/^[a-z][a-zN0-9_]*$/.test(nom)) {
    erreurs.push("doit être en snake_case, sans accent, sans espace, sans majuscule");
  }
  if (nom.includes("__") || nom.endsWith("_")) erreurs.push("tiret bas doublé ou final");
  if (!PREFIXES_AUTORISES.some((p) => nom.startsWith(p))) erreurs.push("préfixe d'entité inconnu");
  return erreurs;
}

const PAR_NOM = new Map(DICTIONNAIRE.map((d) => [d.nom, d]));

/**
 * Ramène un nom concret de gabarit à son nom de dictionnaire :
 * `stagiaire_3_nom` → `stagiaire_N_nom`, `session_12_date` → `session_N_date`.
 * Retourne `null` si le rang sort des bornes du groupe.
 */
export function nomCanonique(nom: string): string | null {
  const m = /^(stagiaire|session)_(\d+)_(.+)$/.exec(nom);
  if (!m) return nom;
  const groupe = m[1] as GroupeRepetable;
  const rang = Number(m[2]);
  if (rang < 1 || rang > RANG_MAX[groupe]) return null;
  return `${groupe}_N_${m[3]}`;
}

/** La variable (éventuellement numérotée) existe-t-elle dans le dictionnaire ? */
export function trouverVariable(nom: string): VariableDef | undefined {
  const canonique = nomCanonique(nom);
  return canonique ? PAR_NOM.get(canonique) : undefined;
}

export function estVariableConnue(nom: string): boolean {
  return trouverVariable(nom) !== undefined;
}

/** Un champ calculé ne peut jamais être saisi (règle d'or n° 6). */
export function estSaisissable(nom: string): boolean {
  const def = trouverVariable(nom);
  return def !== undefined && def.origine !== "calcule" && def.origine !== "systeme";
}
