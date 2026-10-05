/**
 * Listes de valeurs proposées en MENUS DÉROULANTS (« Modification 1 » du 23/09/2026 : « quand tu peux, fais des
 * entrées à menu déroulant »). Module pur, partagé par le serveur (validation) et l'interface (affichage).
 *
 * Une liste déroulante évite les fautes de frappe, rend les données comparables (BPF, statistiques Qualiopi)
 * et accélère la saisie. Quand une valeur hors liste reste légitime (un OPCO rare, un domaine précis),
 * l'interface propose « Autre… » et un champ libre : la liste guide, elle n'enferme pas.
 */

export const NIVEAUX = [
  "Initiation",
  "Débutant",
  "Intermédiaire",
  "Avancé",
  "Perfectionnement",
  "Expert",
  "Tous niveaux",
] as const;

export const MODALITES = [
  { valeur: "presentiel", libelle: "Présentiel" },
  { valeur: "distanciel", libelle: "Distanciel" },
  { valeur: "mixte", libelle: "Mixte (présentiel et distanciel)" },
] as const;

export const MODES_FINANCEMENT = [
  { valeur: "opco", libelle: "OPCO (plan de développement des compétences)" },
  { valeur: "faf", libelle: "FAF (travailleur indépendant)" },
  { valeur: "entreprise", libelle: "Entreprise (fonds propres de l'employeur)" },
  { valeur: "fonds_propres", libelle: "Particulier / fonds propres" },
] as const;

/** Les 11 opérateurs de compétences agréés, les principaux FAF, et les autres financeurs courants. */
export const FINANCEURS = [
  "AFDAS",
  "AKTO",
  "ATLAS",
  "Constructys",
  "OCAPIAT",
  "OPCO 2i",
  "OPCO Commerce",
  "OPCO EP (Entreprises de proximité)",
  "OPCO Mobilités",
  "OPCO Santé",
  "Uniformation",
  "AGEFICE",
  "FAFCEA",
  "FIF PL",
  "FAF PM",
  "France Travail",
  "Région",
  "Transitions Pro",
] as const;

export const CIVILITES = ["M.", "Mme"] as const;

export const REGIONS_DREETS = [
  "Auvergne-Rhône-Alpes",
  "Bourgogne-Franche-Comté",
  "Bretagne",
  "Centre-Val de Loire",
  "Corse",
  "Grand Est",
  "Hauts-de-France",
  "Île-de-France",
  "Normandie",
  "Nouvelle-Aquitaine",
  "Occitanie",
  "Pays de la Loire",
  "Provence-Alpes-Côte d'Azur",
  "Guadeloupe",
  "Guyane",
  "La Réunion",
  "Martinique",
  "Mayotte",
] as const;

export const STATUTS_JURIDIQUES = [
  "Entreprise individuelle / micro-entreprise",
  "EURL",
  "SASU",
  "SARL",
  "SAS",
  "Portage salarial",
  "Salarié d'un organisme",
  "Autre",
] as const;

/** Domaines de formation (inspirés des grandes familles NSF), pour le profil formateur et le catalogue. */
export const DOMAINES = [
  "Bureautique et outils numériques",
  "Informatique et développement",
  "Management et leadership",
  "Commercial, vente et prospection",
  "Marketing et communication",
  "Ressources humaines",
  "Comptabilité, gestion et finance",
  "Langues étrangères",
  "Qualité, hygiène, sécurité, environnement",
  "Industrie et technique",
  "Ferroviaire et transport",
  "Logistique",
  "Santé et social",
  "Développement personnel et efficacité professionnelle",
  "Formation de formateurs et pédagogie",
  "Juridique et réglementaire",
  "Bâtiment et travaux publics",
  "Autre",
] as const;

export const SITUATIONS_HANDICAP = [
  "Non",
  "Oui — aménagement à prévoir",
  "Oui — aucun aménagement nécessaire",
  "Ne souhaite pas le préciser",
] as const;

/** Rubriques du coffre-fort pédagogique : partie pédagogique d'un côté, partie administrative de l'autre. */
export const CATEGORIES_COFFRE = [
  { valeur: "support", libelle: "Support de cours", partie: "pedagogique" },
  { valeur: "exercice", libelle: "Exercice / cas pratique", partie: "pedagogique" },
  { valeur: "evaluation", libelle: "Test et évaluation", partie: "pedagogique" },
  { valeur: "ressource", libelle: "Ressource complémentaire", partie: "pedagogique" },
  { valeur: "video", libelle: "Vidéo / audio", partie: "pedagogique" },
  { valeur: "administratif", libelle: "Document administratif", partie: "administratif" },
  { valeur: "qualite", libelle: "Document qualité (livret d'accueil, règlement…)", partie: "administratif" },
] as const;

export type CategorieCoffre = (typeof CATEGORIES_COFFRE)[number]["valeur"];
export const CODES_CATEGORIES = CATEGORIES_COFFRE.map((c) => c.valeur) as [
  CategorieCoffre,
  ...CategorieCoffre[],
];

export const NOMBRES_MODULES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const NOMBRES_QUESTIONS = [5, 8, 10, 12, 15, 20] as const;

export const DELAIS_ACCES = [
  "Sous 48 heures",
  "Sous 1 semaine",
  "Sous 2 semaines",
  "Sous 1 mois",
  "Selon le calendrier des sessions",
  "Délai de prise en charge du financeur (4 à 6 semaines)",
] as const;

export const MODALITES_SANCTION = [
  "Attestation de fin de formation",
  "Attestation de compétences",
  "Certificat de réalisation",
  "Certification RNCP / RS (passage de l'épreuve)",
] as const;

export const libelleModeFinancement = (v: string): string =>
  MODES_FINANCEMENT.find((m) => m.valeur === v)?.libelle ?? v;
export const libelleCategorie = (v: string): string =>
  CATEGORIES_COFFRE.find((c) => c.valeur === v)?.libelle ?? v;
