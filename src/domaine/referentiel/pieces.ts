/**
 * Nomenclature des pièces du dossier de formation.
 *
 * Les 13 pièces `NN-PHASE` viennent du référentiel Qualiopi (classeur, onglet « Nomenclature pieces »).
 * S'y ajoutent trois pièces exigées par le cahier des charges et absentes du référentiel :
 *  - `PRE` : le « Pré-dossier » de l'espace Communication avec l'Apprenant (hypothèse par défaut :
 *    synthèse Recueil des besoins + Test de positionnement, signée une fois) ;
 *  - `ACC` : l'Accord de financement, document externe émis par l'OPCO/FAF (F-COM-10, RG-06) ;
 *  - `REF` : le justificatif d'un Refus de financement (F-CRM-07, RG-07) ;
 *  - `PRG` : le Programme de formation, annexe de la convention (article 1.2 et 3 de la convention :
 *    « le programme détaillé figure en annexe ») — ajouté le 23/09/2026, voir docs/ANALYSE_23-09.md.
 */
import type { SousStatut } from "../pipeline/statuts";

export type Role = "admin" | "formateur" | "apprenant";
export type Phase = "AVT" | "PDT" | "FIN" | "APR";
export type Espace = "apprenant" | "of";

export type CodePiece =
  | "00-AVT"
  | "01-AVT"
  | "02-AVT"
  | "03-AVT"
  | "04-AVT"
  | "05-AVT"
  | "06-PDT"
  | "07-FIN"
  | "08-FIN"
  | "09-FIN"
  | "10-FIN"
  | "11-FIN"
  | "12-APR"
  | "PRE"
  | "ACC"
  | "REF"
  | "PRG";

export interface PieceDef {
  code: CodePiece;
  /** Nom de fichier sans extension : `[NN]_[PHASE]_[libellé-court]`. */
  fichier: string;
  phase: Phase;
  libelle: string;
  roleQualiopi: string;
  indicateurs: readonly number[];
  signataires: string;
  /**
   * - `generee` : produite par la plateforme à partir d'un gabarit ;
   * - `deposee` : document externe déposé par un acteur (accord, refus, facture du formateur).
   */
  mode: "generee" | "deposee";
  /** Espace de communication où la pièce apparaît ; `null` = gérée ailleurs (enquêtes, annexes internes). */
  espace: Espace | null;
  /** Numéro d'ordre affiché dans l'espace (« 2 bis » pour le planning). */
  ordre?: string;
  /**
   * `true` : la pièce porte le statut binaire « En attente de retour » / « Validé » (RG-03).
   * `false` : simple transmission, sans statut (planning — F-COM-03bis ; facture OF — information).
   */
  suiviStatut: boolean;
  /** Rôles dont le retour (signature en ligne ou dépôt du document signé) valide la pièce. */
  valideePar: readonly Role[];
  /** Sous-statut à partir duquel la pièce existe pour le dossier. */
  disponibleDes: SousStatut;
  /** La pièce doit être « Validé » pour que le dossier soit « complet » à l'étape D. */
  requisePourCompletude: boolean;
  /** Générée automatiquement à la validation du dossier par S4M, dans « Pièces de départ » (F-ARCH-01/03). */
  pieceDeDepart: boolean;
}

/**
 * Pièces individuelles : il en existe un exemplaire PAR stagiaire du dossier (convocation, émargement,
 * évaluations, attestation…). Les autres sont collectives : un exemplaire par dossier.
 */
const INDIVIDUELLES: ReadonlySet<CodePiece> = new Set<CodePiece>([
  "00-AVT",
  "01-AVT",
  "PRE",
  "05-AVT",
  "06-PDT",
  "07-FIN",
  "08-FIN",
  "09-FIN",
  "12-APR",
]);

export function estIndividuelle(code: CodePiece): boolean {
  return INDIVIDUELLES.has(code);
}

const p = (def: PieceDef): PieceDef => def;

export const NOMENCLATURE: readonly PieceDef[] = [
  p({
    code: "00-AVT",
    fichier: "00_AVT_Recueil-Besoins",
    phase: "AVT",
    libelle: "Recueil des besoins",
    roleQualiopi: "Recueil des attentes, du niveau de départ et des objectifs spécifiques.",
    indicateurs: [1, 4],
    signataires: "Apprenant",
    mode: "generee",
    espace: null,
    suiviStatut: true,
    valideePar: ["formateur", "apprenant"],
    disponibleDes: "brouillon",
    requisePourCompletude: false,
    pieceDeDepart: true,
  }),
  p({
    code: "01-AVT",
    fichier: "01_AVT_Test-Positionnement",
    phase: "AVT",
    libelle: "Test de positionnement",
    roleQualiopi: "Évaluation diagnostique initiale des prérequis.",
    indicateurs: [8],
    signataires: "Apprenant",
    mode: "generee",
    espace: null,
    suiviStatut: true,
    valideePar: ["formateur", "apprenant"],
    disponibleDes: "brouillon",
    requisePourCompletude: false,
    pieceDeDepart: true,
  }),
  p({
    code: "PRE",
    fichier: "00b_AVT_Pre-Dossier",
    phase: "AVT",
    libelle: "Pré-dossier",
    roleQualiopi: "Synthèse du recueil des besoins et du test de positionnement, validée par l'apprenant.",
    indicateurs: [1, 4, 8],
    signataires: "Apprenant",
    mode: "generee",
    espace: "apprenant",
    ordre: "1",
    suiviStatut: true,
    valideePar: ["apprenant"],
    disponibleDes: "dossier_valide",
    requisePourCompletude: true,
    pieceDeDepart: true,
  }),
  p({
    code: "02-AVT",
    fichier: "02_AVT_Convention-Formation",
    phase: "AVT",
    libelle: "Convention de formation",
    roleQualiopi: "Contrat juridique entre l'OF et l'entreprise commanditaire.",
    indicateurs: [9, 16],
    signataires: "Représentant légal OF + représentant entreprise",
    mode: "generee",
    espace: "apprenant",
    ordre: "2",
    suiviStatut: true,
    valideePar: ["apprenant"],
    disponibleDes: "dossier_valide",
    requisePourCompletude: true,
    pieceDeDepart: true,
  }),
  p({
    code: "03-AVT",
    fichier: "03_AVT_Planning",
    phase: "AVT",
    libelle: "Planning",
    roleQualiopi: "Calendrier des séances, transmis en annexe de la convention.",
    indicateurs: [],
    signataires: "—",
    mode: "generee",
    espace: "apprenant",
    ordre: "2 bis",
    suiviStatut: false,
    valideePar: [],
    disponibleDes: "dossier_valide",
    requisePourCompletude: false,
    pieceDeDepart: true,
  }),
  p({
    code: "PRG",
    fichier: "03a_AVT_Programme-Formation",
    phase: "AVT",
    libelle: "Programme de formation",
    roleQualiopi:
      "Programme détaillé de l'action, annexé à la convention : objectifs, public, prérequis, contenu, modalités.",
    indicateurs: [1, 5],
    signataires: "—",
    mode: "generee",
    espace: "apprenant",
    ordre: "2 ter",
    // Comme le planning : pièce transmise en annexe de la convention, sans statut de signature (F-COM-03bis).
    suiviStatut: false,
    valideePar: [],
    disponibleDes: "dossier_valide",
    requisePourCompletude: false,
    pieceDeDepart: true,
  }),
  p({
    code: "ACC",
    fichier: "03b_AVT_Accord-Financement",
    phase: "AVT",
    libelle: "Accord de financement",
    roleQualiopi: "Accord de prise en charge émis par le financeur (document externe).",
    indicateurs: [],
    signataires: "Financeur (OPCO / FAF)",
    mode: "deposee",
    espace: "apprenant",
    ordre: "3",
    suiviStatut: true,
    // Dépôt possible par tout acteur du dossier (F-COM-10, RG-06).
    valideePar: ["admin", "formateur", "apprenant"],
    disponibleDes: "dossier_valide",
    requisePourCompletude: true,
    pieceDeDepart: false,
  }),
  p({
    code: "REF",
    fichier: "03c_AVT_Refus-Financement",
    phase: "AVT",
    libelle: "Refus de financement",
    roleQualiopi: "Justificatif du refus de prise en charge, conservé avec le dossier archivé.",
    indicateurs: [],
    signataires: "Financeur (OPCO / FAF)",
    mode: "deposee",
    espace: null,
    suiviStatut: true,
    valideePar: ["admin", "formateur"],
    disponibleDes: "dossier_valide",
    requisePourCompletude: false,
    pieceDeDepart: false,
  }),
  p({
    code: "04-AVT",
    fichier: "04_AVT_Ordre-Mission-Formateur",
    phase: "AVT",
    libelle: "Ordre de mission / sous-traitance formateur",
    roleQualiopi: "Contrat de sous-traitance du formateur indépendant et charte déontologique.",
    indicateurs: [21, 27],
    signataires: "Représentant OF + formateur",
    mode: "generee",
    espace: "of",
    ordre: "1",
    suiviStatut: true,
    valideePar: ["formateur"],
    disponibleDes: "accord_financement",
    requisePourCompletude: true,
    pieceDeDepart: false,
  }),
  p({
    code: "05-AVT",
    fichier: "05_AVT_Convocation",
    phase: "AVT",
    libelle: "Convocation",
    roleQualiopi: "Informe le stagiaire du lieu, des dates, des accès et des prérequis techniques.",
    indicateurs: [9],
    signataires: "Apprenant (accusé de réception)",
    mode: "generee",
    espace: "apprenant",
    ordre: "4",
    suiviStatut: true,
    valideePar: ["apprenant"],
    disponibleDes: "accord_financement",
    requisePourCompletude: true,
    pieceDeDepart: false,
  }),
  p({
    code: "06-PDT",
    fichier: "06_PDT_Emargement",
    phase: "PDT",
    libelle: "Feuille d'émargement",
    roleQualiopi: "Preuve matérielle de réalisation des heures de formation.",
    indicateurs: [17],
    signataires: "Apprenant(s) + formateur",
    mode: "generee",
    espace: "apprenant",
    ordre: "5",
    suiviStatut: true,
    // Le formateur cosigne cette pièce : il peut aussi déposer la feuille papier signée en salle.
    valideePar: ["apprenant", "formateur"],
    disponibleDes: "formation_debutee",
    requisePourCompletude: true,
    pieceDeDepart: false,
  }),
  p({
    code: "07-FIN",
    fichier: "07_FIN_Evaluation-Acquis",
    phase: "FIN",
    libelle: "Évaluation des acquis",
    roleQualiopi: "Validation des compétences acquises.",
    indicateurs: [11],
    signataires: "Apprenant",
    mode: "generee",
    espace: "apprenant",
    ordre: "6",
    suiviStatut: true,
    valideePar: ["apprenant"],
    disponibleDes: "formation_debutee",
    requisePourCompletude: true,
    pieceDeDepart: false,
  }),
  p({
    code: "08-FIN",
    fichier: "08_FIN_Satisfaction-Chaud",
    phase: "FIN",
    libelle: "Satisfaction à chaud",
    roleQualiopi: "Évaluation à chaud des conditions de formation, de la pédagogie et du formateur.",
    indicateurs: [30],
    signataires: "Apprenant",
    mode: "generee",
    espace: null,
    suiviStatut: true,
    valideePar: ["apprenant"],
    disponibleDes: "fin_dossier_incomplet",
    requisePourCompletude: false,
    pieceDeDepart: false,
  }),
  p({
    code: "09-FIN",
    fichier: "09_FIN_Attestation-Formation",
    phase: "FIN",
    libelle: "Attestation de réalisation",
    roleQualiopi: "Atteste de la durée réalisée et du niveau d'atteinte des objectifs.",
    indicateurs: [11],
    signataires: "Représentant légal OF",
    mode: "generee",
    espace: "apprenant",
    ordre: "7",
    suiviStatut: true,
    valideePar: ["apprenant"],
    disponibleDes: "fin_dossier_incomplet",
    requisePourCompletude: true,
    pieceDeDepart: false,
  }),
  p({
    code: "10-FIN",
    fichier: "10_FIN_Facture-Formateur",
    phase: "FIN",
    libelle: "Facture formateur",
    roleQualiopi: "Facture du formateur vers l'OF, nette de la commission de portage.",
    indicateurs: [],
    signataires: "Formateur",
    mode: "deposee",
    espace: "of",
    ordre: "2",
    suiviStatut: true,
    valideePar: ["formateur"],
    disponibleDes: "fin_dossier_incomplet",
    requisePourCompletude: false,
    pieceDeDepart: false,
  }),
  p({
    code: "11-FIN",
    fichier: "11_FIN_Facture-OF",
    phase: "FIN",
    libelle: "Facture OF",
    roleQualiopi: "Facture de l'OF vers le financeur (OPCO, FAF ou entreprise).",
    indicateurs: [],
    signataires: "Référent qualité OF",
    mode: "generee",
    espace: "of",
    ordre: "3",
    // Hypothèse par défaut (point ouvert n° 4) : simple consultation par le formateur.
    suiviStatut: false,
    valideePar: [],
    disponibleDes: "demande_paiement",
    requisePourCompletude: false,
    pieceDeDepart: false,
  }),
  p({
    code: "12-APR",
    fichier: "12_APR_Satisfaction-Froid",
    phase: "APR",
    libelle: "Satisfaction à froid",
    roleQualiopi: "Évaluation de l'impact à moyen terme, trois mois après la formation.",
    indicateurs: [30],
    signataires: "Apprenant et/ou entreprise",
    mode: "generee",
    espace: null,
    suiviStatut: true,
    valideePar: ["apprenant"],
    disponibleDes: "fin_dossier_complet",
    requisePourCompletude: false,
    pieceDeDepart: false,
  }),
];

const PAR_CODE = new Map(NOMENCLATURE.map((d) => [d.code, d]));

export function definitionPiece(code: CodePiece): PieceDef {
  const def = PAR_CODE.get(code);
  if (!def) throw new Error(`Pièce inconnue : ${code}`);
  return def;
}

export function estCodePiece(code: string): code is CodePiece {
  return PAR_CODE.has(code as CodePiece);
}

/** Pièces d'un espace de communication, dans l'ordre d'affichage du cahier des charges. */
export function piecesDeLEspace(espace: Espace): PieceDef[] {
  return NOMENCLATURE.filter((d) => d.espace === espace);
}

/** Les 13 pièces du référentiel Qualiopi, hors ajouts du cahier des charges. */
export function piecesDuReferentiel(): PieceDef[] {
  return NOMENCLATURE.filter((d) => /^\d{2}-/.test(d.code));
}
