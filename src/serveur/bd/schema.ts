/**
 * Schéma PostgreSQL (Drizzle). Même SQL en local (PGlite embarqué) et en production (serveur PostgreSQL).
 *
 * Conventions :
 *  - les colonnes qui portent une donnée du dictionnaire ont le NOM DE LA VARIABLE harmonisée ;
 *  - toute table racine porte `of_id` : la plateforme est multi-organismes, l'étanchéité se joue là ;
 *  - groupes répétables = tables enfants (`stagiaire_dossier`, `seance`), jamais de colonnes numérotées ;
 *  - montants en centimes (integer), dates en texte ISO `AAAA-MM-JJ`, horodatages en `timestamptz`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const creeLe = () => timestamp("cree_le", { withTimezone: true }).notNull().defaultNow();
const t = (nom: string) => text(nom).notNull().default("");

export const organismeFormation = pgTable("organisme_formation", {
  id: id(),
  of_nom: t("of_nom"),
  of_forme_juridique: t("of_forme_juridique"),
  of_adresse: t("of_adresse"),
  of_siret: t("of_siret"),
  of_nda_numero: t("of_nda_numero"),
  of_dreets_region: t("of_dreets_region"),
  of_qualiopi_numero: t("of_qualiopi_numero"),
  of_certification_complementaire_numero: t("of_certification_complementaire_numero"),
  of_representant_civilite: t("of_representant_civilite"),
  of_representant_prenom: t("of_representant_prenom"),
  of_representant_nom: t("of_representant_nom"),
  of_email_pedagogie: t("of_email_pedagogie"),
  of_email_comptabilite: t("of_email_comptabilite"),
  of_tribunal_competent: t("of_tribunal_competent"),
  of_iban: t("of_iban"),
  of_bic: t("of_bic"),
  of_banque_nom: t("of_banque_nom"),
  of_tva_intracom: t("of_tva_intracom"),
  of_telephone: t("of_telephone"),
  formation_clause_subrogation: t("formation_clause_subrogation"),
  portage_commission_pourcentage: real("portage_commission_pourcentage").notNull().default(25),
  tva_pourcentage: real("tva_pourcentage").notNull().default(0),
  delai_paiement_jours: integer("delai_paiement_jours").notNull().default(30),
  /** Durée de conservation légale des dossiers archivés, en années (point ouvert n° 9 : paramétrable). */
  conservation_annees: integer("conservation_annees").notNull().default(10),
  couleur: text("couleur").notNull().default("#1d6a45"),
  /** Tracé de signature du représentant légal, apposé sur les pièces émises par l'organisme. */
  signature_representant_png: t("signature_representant_png"),
  cree_le: creeLe(),
});

export const utilisateur = pgTable(
  "utilisateur",
  {
    id: id(),
    of_id: text("of_id")
      .notNull()
      .references(() => organismeFormation.id),
    email: text("email").notNull(),
    mot_de_passe_hash: t("mot_de_passe_hash"),
    role: text("role", { enum: ["admin", "formateur", "apprenant"] }).notNull(),
    prenom: t("prenom"),
    nom: t("nom"),
    actif: boolean("actif").notNull().default(true),
    cree_le: creeLe(),
    supprime_le: timestamp("supprime_le", { withTimezone: true }),
  },
  (x) => [uniqueIndex("utilisateur_email_unique").on(sql`lower(${x.email})`)],
);

export const sessionUtilisateur = pgTable("session_utilisateur", {
  /** Empreinte SHA-256 du jeton : le jeton lui-même n'est jamais stocké. */
  jeton_hash: text("jeton_hash").primaryKey(),
  utilisateur_id: text("utilisateur_id")
    .notNull()
    .references(() => utilisateur.id, { onDelete: "cascade" }),
  expire_le: timestamp("expire_le", { withTimezone: true }).notNull(),
  cree_le: creeLe(),
});

export const invitation = pgTable("invitation", {
  jeton_hash: text("jeton_hash").primaryKey(),
  utilisateur_id: text("utilisateur_id")
    .notNull()
    .references(() => utilisateur.id, { onDelete: "cascade" }),
  expire_le: timestamp("expire_le", { withTimezone: true }).notNull(),
  utilisee_le: timestamp("utilisee_le", { withTimezone: true }),
  cree_le: creeLe(),
});

export const formateur = pgTable("formateur", {
  id: id(),
  of_id: text("of_id")
    .notNull()
    .references(() => organismeFormation.id),
  /** Nul après la suppression du compte (RG-01) : le formateur est dissocié, ses dossiers demeurent. */
  utilisateur_id: text("utilisateur_id").references(() => utilisateur.id, { onDelete: "set null" }),
  formateur_prenom: t("formateur_prenom"),
  formateur_nom: t("formateur_nom"),
  formateur_email: t("formateur_email"),
  formateur_telephone: t("formateur_telephone"),
  formateur_entreprise_nom: t("formateur_entreprise_nom"),
  formateur_entreprise_adresse: t("formateur_entreprise_adresse"),
  formateur_entreprise_siret: t("formateur_entreprise_siret"),
  formateur_nda_numero: t("formateur_nda_numero"),
  formateur_dreets_region: t("formateur_dreets_region"),
  formateur_iban: t("formateur_iban"),
  formateur_bic: t("formateur_bic"),
  parcours: t("parcours"),
  // Profil étendu (23/09/2026, « Modification 1 ») : sert au choix des formateurs et à l'indicateur Qualiopi 21-22.
  formateur_statut_juridique: t("formateur_statut_juridique"),
  formateur_domaines: jsonb("formateur_domaines")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  formateur_zones: t("formateur_zones"),
  formateur_langues: t("formateur_langues"),
  formateur_tarif_journalier: integer("formateur_tarif_journalier"),
  formateur_bio: t("formateur_bio"),
  formateur_linkedin: t("formateur_linkedin"),
  formateur_disponibilites: t("formateur_disponibilites"),
  formateur_assurance_rc: t("formateur_assurance_rc"),
  statut_candidature: text("statut_candidature", { enum: ["brouillon", "soumise", "validee", "refusee"] })
    .notNull()
    .default("brouillon"),
  motif_decision: t("motif_decision"),
  soumise_le: timestamp("soumise_le", { withTimezone: true }),
  decidee_le: timestamp("decidee_le", { withTimezone: true }),
  anonymise_le: timestamp("anonymise_le", { withTimezone: true }),
  cree_le: creeLe(),
});

export const pieceFormateur = pgTable("piece_formateur", {
  id: id(),
  formateur_id: text("formateur_id")
    .notNull()
    .references(() => formateur.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  nom_fichier: text("nom_fichier").notNull(),
  chemin: text("chemin").notNull(),
  taille: integer("taille").notNull(),
  /** Date de fin de validité (attestation URSSAF, RC Pro…) : l'écran signale les pièces à renouveler. */
  expire_le: t("expire_le"),
  cree_le: creeLe(),
});

export const entrepriseCliente = pgTable("entreprise_cliente", {
  id: id(),
  of_id: text("of_id")
    .notNull()
    .references(() => organismeFormation.id),
  formateur_id: text("formateur_id")
    .notNull()
    .references(() => formateur.id),
  entreprise_nom: t("entreprise_nom"),
  entreprise_nom_commercial: t("entreprise_nom_commercial"),
  entreprise_adresse: t("entreprise_adresse"),
  entreprise_siret: t("entreprise_siret"),
  entreprise_representant_civilite: t("entreprise_representant_civilite"),
  entreprise_representant_prenom: t("entreprise_representant_prenom"),
  entreprise_representant_nom: t("entreprise_representant_nom"),
  entreprise_representant_telephone: t("entreprise_representant_telephone"),
  entreprise_representant_email: t("entreprise_representant_email"),
  /** Opérateur de compétences habituel : pré-remplit le financeur des dossiers. */
  entreprise_opco: t("entreprise_opco"),
  cree_le: creeLe(),
  archive_le: timestamp("archive_le", { withTimezone: true }),
});

export const stagiaire = pgTable("stagiaire", {
  id: id(),
  of_id: text("of_id")
    .notNull()
    .references(() => organismeFormation.id),
  formateur_id: text("formateur_id")
    .notNull()
    .references(() => formateur.id),
  entreprise_id: text("entreprise_id").references(() => entrepriseCliente.id),
  /** Compte de l'espace Apprenant, créé à la première invitation (F-COM-04, F-COM-05). */
  utilisateur_id: text("utilisateur_id").references(() => utilisateur.id, { onDelete: "set null" }),
  stagiaire_prenom: t("stagiaire_prenom"),
  stagiaire_nom: t("stagiaire_nom"),
  stagiaire_email: t("stagiaire_email"),
  stagiaire_telephone: t("stagiaire_telephone"),
  stagiaire_poste: t("stagiaire_poste"),
  stagiaire_situation_handicap: t("stagiaire_situation_handicap"),
  cree_le: creeLe(),
  archive_le: timestamp("archive_le", { withTimezone: true }),
});

export const formation = pgTable("formation", {
  id: id(),
  of_id: text("of_id")
    .notNull()
    .references(() => organismeFormation.id),
  formateur_id: text("formateur_id")
    .notNull()
    .references(() => formateur.id),
  formation_titre: t("formation_titre"),
  formation_objectifs: t("formation_objectifs"),
  formation_niveau: t("formation_niveau"),
  formation_prerequis: t("formation_prerequis"),
  formation_duree_heures_total: real("formation_duree_heures_total"),
  formation_duree_jours: real("formation_duree_jours"),
  formation_modalite: text("formation_modalite", { enum: ["presentiel", "distanciel", "mixte"] })
    .notNull()
    .default("presentiel"),
  formation_prix_unitaire_ht: integer("formation_prix_unitaire_ht"),
  programme: t("programme"),
  public_vise: t("public_vise"),
  // ——— Ajouts du 23/09/2026 (« Modification 1 ») : parcours en modules et champs de convention ———
  formation_nb_modules: integer("formation_nb_modules"),
  /** Parcours découpé en modules (voir domaine/pedagogie/parcours.ts). */
  formation_modules: jsonb("formation_modules")
    .notNull()
    .default(sql`'[]'::jsonb`),
  formation_duree_heures_presentiel: real("formation_duree_heures_presentiel"),
  formation_duree_heures_distanciel: real("formation_duree_heures_distanciel"),
  formation_prix_groupe_ht: integer("formation_prix_groupe_ht"),
  formation_effectif_min: integer("formation_effectif_min"),
  formation_effectif_max: integer("formation_effectif_max"),
  formation_lieu_nom: t("formation_lieu_nom"),
  formation_lieu_adresse: t("formation_lieu_adresse"),
  formation_lieu_siret: t("formation_lieu_siret"),
  formation_lien_visio: t("formation_lien_visio"),
  mode_financement: text("mode_financement", { enum: ["opco", "faf", "entreprise", "fonds_propres"] })
    .notNull()
    .default("opco"),
  formation_opco: t("formation_opco"),
  formateur_cout_horaire: integer("formateur_cout_horaire"),
  formation_domaine: t("formation_domaine"),
  formation_moyens_pedagogiques: t("formation_moyens_pedagogiques"),
  formation_modalites_evaluation: t("formation_modalites_evaluation"),
  formation_modalites_sanction: t("formation_modalites_sanction"),
  formation_accessibilite: t("formation_accessibilite"),
  formation_delai_acces: t("formation_delai_acces"),
  // ——— Version 7 (23/09/2026) : dossier d'enjeux issu de la recherche web de l'IA, réutilisé par tous les générateurs ———
  dossier_enjeux: jsonb("dossier_enjeux"),
  enjeux_le: timestamp("enjeux_le", { withTimezone: true }),
  archivee: boolean("archivee").notNull().default(false),
  archivee_le: timestamp("archivee_le", { withTimezone: true }),
  cree_le: creeLe(),
  maj_le: timestamp("maj_le", { withTimezone: true }).notNull().defaultNow(),
});

export const modeleOutil = pgTable("modele_outil", {
  id: id(),
  of_id: text("of_id")
    .notNull()
    .references(() => organismeFormation.id),
  formateur_id: text("formateur_id")
    .notNull()
    .references(() => formateur.id),
  formation_id: text("formation_id").references(() => formation.id, { onDelete: "set null" }),
  type: text("type", { enum: ["recueil", "positionnement", "acquis"] }).notNull(),
  titre: t("titre"),
  contenu: jsonb("contenu").notNull(),
  cree_le: creeLe(),
  maj_le: timestamp("maj_le", { withTimezone: true }).notNull().defaultNow(),
  /** Archivé (corbeille) : masqué des listes, restaurable. */
  archive_le: timestamp("archive_le", { withTimezone: true }),
});

export const coffreFichier = pgTable("coffre_fichier", {
  id: id(),
  of_id: text("of_id")
    .notNull()
    .references(() => organismeFormation.id),
  formateur_id: text("formateur_id")
    .notNull()
    .references(() => formateur.id),
  /** Le coffre-fort est rattaché à la FORMATION, pas au formateur (F-OUT-04). */
  formation_id: text("formation_id")
    .notNull()
    .references(() => formation.id, { onDelete: "cascade" }),
  nom_fichier: text("nom_fichier").notNull(),
  chemin: text("chemin").notNull(),
  taille: integer("taille").notNull(),
  type_mime: t("type_mime"),
  /** Seuls les éléments marqués « partageable » sont ouverts à l'apprenant (hypothèse, point ouvert n° 5). */
  partageable: boolean("partageable").notNull().default(true),
  /** Rubrique du coffre-fort : support, exercice, évaluation, ressource, administratif… */
  categorie: text("categorie").notNull().default("support"),
  /** « depot » (chargé par le formateur) ou « genere » (produit par l'application : supports PPTX, programme…). */
  origine: text("origine").notNull().default("depot"),
  description: t("description"),
  /** Corbeille : un fichier supprimé reste restaurable jusqu'à sa purge définitive. */
  supprime_le: timestamp("supprime_le", { withTimezone: true }),
  cree_le: creeLe(),
});

export const dossierFormation = pgTable(
  "dossier_formation",
  {
    id: id(),
    of_id: text("of_id")
      .notNull()
      .references(() => organismeFormation.id),
    dossier_reference: text("dossier_reference").notNull(),
    formateur_id: text("formateur_id")
      .notNull()
      .references(() => formateur.id),
    entreprise_id: text("entreprise_id")
      .notNull()
      .references(() => entrepriseCliente.id),
    formation_id: text("formation_id").references(() => formation.id, { onDelete: "set null" }),
    sous_statut: text("sous_statut").notNull().default("brouillon"),
    mode_financement: text("mode_financement", { enum: ["opco", "faf", "entreprise", "fonds_propres"] })
      .notNull()
      .default("opco"),
    // Instantané de la formation au moment du dossier : modifier le catalogue ne réécrit pas l'histoire.
    formation_titre: t("formation_titre"),
    formation_objectifs: t("formation_objectifs"),
    formation_objectifs_atteints: t("formation_objectifs_atteints"),
    formation_niveau: t("formation_niveau"),
    formation_prerequis: t("formation_prerequis"),
    formation_public_vise: t("formation_public_vise"),
    formation_programme: t("formation_programme"),
    formation_duree_heures_total: real("formation_duree_heures_total"),
    formation_duree_jours: real("formation_duree_jours"),
    formation_duree_heures_presentiel: real("formation_duree_heures_presentiel"),
    formation_duree_heures_distanciel: real("formation_duree_heures_distanciel"),
    formation_modalite: text("formation_modalite", { enum: ["presentiel", "distanciel", "mixte"] })
      .notNull()
      .default("presentiel"),
    formation_lieu_nom: t("formation_lieu_nom"),
    formation_lieu_adresse: t("formation_lieu_adresse"),
    formation_lieu_siret: t("formation_lieu_siret"),
    formation_lien_visio: t("formation_lien_visio"),
    formation_date_debut: t("formation_date_debut"),
    formation_date_fin: t("formation_date_fin"),
    formation_opco: t("formation_opco"),
    formation_prix_unitaire_ht: integer("formation_prix_unitaire_ht"),
    formation_prix_presentiel_ht: integer("formation_prix_presentiel_ht"),
    formateur_cout_horaire: integer("formateur_cout_horaire"),
    signature_lieu: t("signature_lieu"),
    questionnaire_positionnement: jsonb("questionnaire_positionnement"),
    questionnaire_acquis: jsonb("questionnaire_acquis"),
    motif_renvoi: t("motif_renvoi"),
    motif_refus: t("motif_refus"),
    coffre_ouvert: boolean("coffre_ouvert").notNull().default(false),
    cree_le: creeLe(),
    maj_le: timestamp("maj_le", { withTimezone: true }).notNull().defaultNow(),
    valide_le: timestamp("valide_le", { withTimezone: true }),
    termine_le: timestamp("termine_le", { withTimezone: true }),
    archive_le: timestamp("archive_le", { withTimezone: true }),
  },
  (x) => [
    uniqueIndex("dossier_reference_unique").on(x.of_id, x.dossier_reference),
    index("dossier_formateur_idx").on(x.formateur_id),
  ],
);

export const stagiaireDossier = pgTable(
  "stagiaire_dossier",
  {
    id: id(),
    dossier_id: text("dossier_id")
      .notNull()
      .references(() => dossierFormation.id, { onDelete: "cascade" }),
    stagiaire_id: text("stagiaire_id")
      .notNull()
      .references(() => stagiaire.id),
    poste_occupe: t("poste_occupe"),
    statut_assiduite: t("statut_assiduite"),
    rang: integer("rang").notNull().default(1),
  },
  (x) => [uniqueIndex("stagiaire_dossier_unique").on(x.dossier_id, x.stagiaire_id)],
);

export const seance = pgTable("seance", {
  id: id(),
  dossier_id: text("dossier_id")
    .notNull()
    .references(() => dossierFormation.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  heure_debut: text("heure_debut").notNull(),
  heure_fin: text("heure_fin").notNull(),
});

export const emargement = pgTable(
  "emargement",
  {
    id: id(),
    seance_id: text("seance_id")
      .notNull()
      .references(() => seance.id, { onDelete: "cascade" }),
    stagiaire_id: text("stagiaire_id")
      .notNull()
      .references(() => stagiaire.id),
    signataire: text("signataire", { enum: ["stagiaire", "formateur"] }).notNull(),
    trace_png: text("trace_png").notNull(),
    horodatage: timestamp("horodatage", { withTimezone: true }).notNull().defaultNow(),
  },
  (x) => [uniqueIndex("emargement_unique").on(x.seance_id, x.stagiaire_id, x.signataire)],
);

export const evaluation = pgTable(
  "evaluation",
  {
    id: id(),
    dossier_id: text("dossier_id")
      .notNull()
      .references(() => dossierFormation.id, { onDelete: "cascade" }),
    stagiaire_id: text("stagiaire_id")
      .notNull()
      .references(() => stagiaire.id),
    type: text("type", {
      enum: ["recueil", "positionnement", "acquis", "satisfaction_chaud", "satisfaction_froid"],
    }).notNull(),
    date: text("date").notNull(),
    reponses: jsonb("reponses").notNull(),
    score: real("score"),
    ajustement: t("ajustement"),
    saisie_par: text("saisie_par"),
    cree_le: creeLe(),
  },
  (x) => [uniqueIndex("evaluation_unique").on(x.dossier_id, x.stagiaire_id, x.type)],
);

/** D2 — LA ligne de vérité d'une pièce. Espaces de communication, dossier et pipeline la lisent tous. */
export const pieceDossier = pgTable(
  "piece_dossier",
  {
    id: id(),
    dossier_id: text("dossier_id")
      .notNull()
      .references(() => dossierFormation.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    stagiaire_id: text("stagiaire_id").references(() => stagiaire.id),
    statut: text("statut", { enum: ["en_attente", "valide"] })
      .notNull()
      .default("en_attente"),
    /** Document généré (archive « Pièces de départ ») et son empreinte SHA-256. */
    chemin_depart: text("chemin_depart"),
    empreinte_depart: text("empreinte_depart"),
    genere_le: timestamp("genere_le", { withTimezone: true }),
    /** Document retourné (archive « Retour ») : signé en ligne, ou déposé après signature hors ligne. */
    chemin_retour: text("chemin_retour"),
    nom_fichier_retour: text("nom_fichier_retour"),
    /** Empreinte SHA-256 du document retourné, tel qu'archivé : permet de prouver qu'il n'a pas été altéré depuis. */
    empreinte_retour: text("empreinte_retour"),
    mode_retour: text("mode_retour", { enum: ["signature", "depot", "formulaire"] }),
    retour_le: timestamp("retour_le", { withTimezone: true }),
    retour_par: text("retour_par").references(() => utilisateur.id, { onDelete: "set null" }),
    transmise_le: timestamp("transmise_le", { withTimezone: true }),
  },
  (x) => [uniqueIndex("piece_dossier_unique").on(x.dossier_id, x.code, sql`coalesce(${x.stagiaire_id}, '')`)],
);

export const signature = pgTable("signature", {
  id: id(),
  piece_id: text("piece_id")
    .notNull()
    .references(() => pieceDossier.id, { onDelete: "cascade" }),
  utilisateur_id: text("utilisateur_id").references(() => utilisateur.id, { onDelete: "set null" }),
  signataire_nom: text("signataire_nom").notNull(),
  signataire_role: text("signataire_role").notNull(),
  signataire_email: text("signataire_email").notNull(),
  zone: text("zone").notNull(),
  trace_png: text("trace_png").notNull(),
  lieu: text("lieu").notNull(),
  horodatage: timestamp("horodatage", { withTimezone: true }).notNull(),
  empreinte_document: text("empreinte_document").notNull(),
  adresse_ip: t("adresse_ip"),
});

export const factureOf = pgTable("facture_of", {
  id: id(),
  dossier_id: text("dossier_id")
    .notNull()
    .unique()
    .references(() => dossierFormation.id, { onDelete: "cascade" }),
  facture_of_numero: text("facture_of_numero").notNull(),
  facture_of_date: text("facture_of_date").notNull(),
  facture_of_code_client: t("facture_of_code_client"),
  facture_of_numero_adherent: t("facture_of_numero_adherent"),
  facture_of_acompte: integer("facture_of_acompte"),
});

export const factureFormateur = pgTable("facture_formateur", {
  id: id(),
  dossier_id: text("dossier_id")
    .notNull()
    .unique()
    .references(() => dossierFormation.id, { onDelete: "cascade" }),
  facture_formateur_numero: text("facture_formateur_numero").notNull(),
  facture_formateur_date: text("facture_formateur_date").notNull(),
});

/** Journal d'historique : qui a fait quoi, quand. Jamais modifié, jamais purgé avec un compte. */
export const evenement = pgTable(
  "evenement",
  {
    id: id(),
    of_id: text("of_id")
      .notNull()
      .references(() => organismeFormation.id),
    dossier_id: text("dossier_id").references(() => dossierFormation.id, { onDelete: "cascade" }),
    acteur_id: text("acteur_id"),
    acteur_role: text("acteur_role").notNull(),
    type: text("type").notNull(),
    libelle: text("libelle").notNull(),
    detail: jsonb("detail"),
    cree_le: creeLe(),
  },
  (x) => [index("evenement_dossier_idx").on(x.dossier_id)],
);

/** Journal des e-mails automatiques (traçabilité exigée en section 9 du cahier des charges). */
export const courrier = pgTable("courrier", {
  id: id(),
  of_id: text("of_id")
    .notNull()
    .references(() => organismeFormation.id),
  dossier_id: text("dossier_id").references(() => dossierFormation.id, { onDelete: "cascade" }),
  /** Courriels hors dossier (invitation au positionnement…) : rattachés au formateur pour sa boîte d'envoi. */
  formateur_id: text("formateur_id"),
  type: text("type").notNull(),
  destinataire: text("destinataire").notNull(),
  sujet: text("sujet").notNull(),
  corps_html: text("corps_html").notNull(),
  pieces_jointes: jsonb("pieces_jointes")
    .notNull()
    .default(sql`'[]'::jsonb`),
  statut: text("statut", { enum: ["journalise", "envoye", "echec"] })
    .notNull()
    .default("journalise"),
  erreur: t("erreur"),
  cree_le: creeLe(),
});

/** Compteurs de numérotation (références de dossier, numéros de facture), par organisme. */
export const compteur = pgTable(
  "compteur",
  {
    of_id: text("of_id")
      .notNull()
      .references(() => organismeFormation.id),
    cle: text("cle").notNull(),
    valeur: integer("valeur").notNull().default(0),
  },
  (x) => [uniqueIndex("compteur_unique").on(x.of_id, x.cle)],
);

/**
 * Versions successives d'un objet pédagogique (formation, outil) : chaque enregistrement garde l'état précédent,
 * que le formateur peut consulter et restaurer (« faire réapparaître »). Traçabilité des évolutions de programme.
 */
export const versionObjet = pgTable(
  "version_objet",
  {
    id: id(),
    of_id: text("of_id")
      .notNull()
      .references(() => organismeFormation.id),
    type: text("type", { enum: ["formation", "outil"] }).notNull(),
    objet_id: text("objet_id").notNull(),
    libelle: t("libelle"),
    snapshot: jsonb("snapshot").notNull(),
    auteur_id: text("auteur_id"),
    cree_le: creeLe(),
  },
  (x) => [index("version_objet_idx").on(x.type, x.objet_id)],
);

/**
 * Invitation d'un apprenant à se positionner sur un parcours, AVANT tout dossier (« Modification 1 ») :
 * e-mail automatique, page dédiée par lien à usage personnel, recueil des besoins + test de positionnement,
 * date, signature tracée, PDF archivé et téléchargeable par l'apprenant, le formateur et l'organisme.
 */
export const positionnement = pgTable(
  "positionnement",
  {
    id: id(),
    of_id: text("of_id")
      .notNull()
      .references(() => organismeFormation.id),
    formateur_id: text("formateur_id")
      .notNull()
      .references(() => formateur.id),
    formation_id: text("formation_id").references(() => formation.id, { onDelete: "set null" }),
    stagiaire_id: text("stagiaire_id")
      .notNull()
      .references(() => stagiaire.id),
    /** Empreinte SHA-256 du jeton du lien : le jeton lui-même n'est jamais stocké. */
    jeton_hash: text("jeton_hash").notNull().unique(),
    statut: text("statut", { enum: ["envoye", "en_cours", "complet"] })
      .notNull()
      .default("envoye"),
    message: t("message"),
    // Instantanés pris à l'envoi : modifier le catalogue ensuite ne change pas ce que l'apprenant a reçu.
    formation_titre: t("formation_titre"),
    questionnaire: jsonb("questionnaire"),
    questions_recueil: jsonb("questions_recueil")
      .notNull()
      .default(sql`'[]'::jsonb`),
    brouillon: jsonb("brouillon"),
    recueil: jsonb("recueil"),
    reponses: jsonb("reponses"),
    score: real("score"),
    date_reponse: t("date_reponse"),
    signature_png: t("signature_png"),
    signature_lieu: t("signature_lieu"),
    signe_le: timestamp("signe_le", { withTimezone: true }),
    chemin_pdf: text("chemin_pdf"),
    empreinte_pdf: text("empreinte_pdf"),
    envoye_le: timestamp("envoye_le", { withTimezone: true }),
    expire_le: timestamp("expire_le", { withTimezone: true }).notNull(),
    archive_le: timestamp("archive_le", { withTimezone: true }),
    cree_le: creeLe(),
  },
  (x) => [index("positionnement_formateur_idx").on(x.formateur_id)],
);

// ——— Version 7 (23/09/2026) ———

/**
 * Réglages de l'organisme modifiables depuis l'application (IA, e-mails SMTP) : une ligne par clé.
 * Les valeurs secrètes (clé d'API, mot de passe SMTP) sont chiffrées avant écriture (ports/chiffrement.ts).
 */
export const reglage = pgTable(
  "reglage",
  {
    id: id(),
    of_id: text("of_id")
      .notNull()
      .references(() => organismeFormation.id),
    cle: text("cle").notNull(),
    valeur: t("valeur"),
    secret: boolean("secret").notNull().default(false),
    maj_le: timestamp("maj_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (x) => [uniqueIndex("reglage_of_cle_idx").on(x.of_id, x.cle)],
);

/**
 * Formulaire envoyé à un apprenant d'un dossier (recueil, positionnement, acquis, satisfaction à chaud, à froid) :
 * lien personnel + PDF d'invitation (QR code) → page interactive → réponses, date, signature → pièce validée.
 * Une ligne par (dossier, stagiaire, type) ; un renvoi renouvelle le jeton.
 */
export const formulaireApprenant = pgTable(
  "formulaire_apprenant",
  {
    id: id(),
    of_id: text("of_id")
      .notNull()
      .references(() => organismeFormation.id),
    dossier_id: text("dossier_id")
      .notNull()
      .references(() => dossierFormation.id, { onDelete: "cascade" }),
    stagiaire_id: text("stagiaire_id")
      .notNull()
      .references(() => stagiaire.id),
    type: text("type", {
      enum: ["recueil", "positionnement", "acquis", "satisfaction_chaud", "satisfaction_froid"],
    }).notNull(),
    jeton_hash: text("jeton_hash").notNull().unique(),
    statut: text("statut", { enum: ["envoye", "en_cours", "complet"] })
      .notNull()
      .default("envoye"),
    brouillon: jsonb("brouillon"),
    envois: integer("envois").notNull().default(0),
    envoye_le: timestamp("envoye_le", { withTimezone: true }),
    expire_le: timestamp("expire_le", { withTimezone: true }).notNull(),
    signe_le: timestamp("signe_le", { withTimezone: true }),
    /** Document d'invitation (PDF avec QR code, ou HTML sans Chromium), archivé pour renvoi. */
    chemin_invitation: text("chemin_invitation"),
    cree_le: creeLe(),
  },
  (x) => [uniqueIndex("formulaire_apprenant_cle_idx").on(x.dossier_id, x.stagiaire_id, x.type)],
);
