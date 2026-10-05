/**
 * Machine à états du pipeline — décision D3 : toute transition passe par `transiter`, qui vérifie
 * QUI agit et SI les conditions sont réunies. Aucun écran, aucune route ne modifie un sous-statut
 * autrement. Corrige la faille relevée par l'audit du 01/09/2026 (un formateur pouvait pousser son
 * propre dossier jusqu'au paiement).
 *
 * Les effets (« générer les pièces », « écrire à l'entreprise »…) sont seulement DÉCLARÉS ici ;
 * c'est le serveur qui les exécute. Le noyau reste pur et testable.
 */
import type { Role } from "../referentiel/pieces";
import { piecesManquantesPourCompletude, type PieceDuDossier } from "../pieces/statut";
import { estTerminal, type SousStatut } from "./statuts";

export type Acteur = Role | "systeme";

export type Action =
  | "soumettre_validation"
  | "renvoyer_en_brouillon"
  | "valider_dossier"
  | "declarer_depot"
  | "enregistrer_accord"
  | "enregistrer_refus"
  | "envoyer_elements_pedagogiques"
  | "demarrer_formation"
  | "terminer_formation"
  | "reevaluer_completude"
  | "demander_paiement"
  | "enregistrer_paiement"
  | "cloturer";

export type Effet =
  | "NOTIFIER_ADMIN_DEMANDE_VALIDATION"
  | "NOTIFIER_FORMATEUR_RENVOI"
  | "NOTIFIER_DEPOT_DECLARE" // le formateur et l'OF sont prévenus que la demande est partie chez le financeur
  | "GENERER_PIECES_DE_DEPART" // F-ARCH-01, RG-04
  | "EMAIL_ENTREPRISE_PIECES_FINANCEMENT" // F-DOS-06, RG-04
  | "GENERER_ET_ENVOYER_ODM" // F-OF-02, RG-06
  | "OUVRIR_COFFRE_AUX_APPRENANTS" // F-OUT-05, RG-08
  | "ARCHIVER_EN_LECTURE_SEULE" // RG-07, étape G
  | "GENERER_CONVOCATIONS"
  | "EMAIL_APPRENANTS_ELEMENTS_PEDAGOGIQUES"
  | "GENERER_PIECES_DE_REALISATION" // émargement, évaluation des acquis
  | "GENERER_PIECES_DE_FIN" // attestation, satisfaction à chaud, trame de facture formateur
  | "GENERER_FACTURE_OF"
  | "PLANIFIER_SATISFACTION_A_FROID"
  | "ENVOYER_FORMULAIRES_DE_FIN"; // version 7 : évaluation des acquis + satisfaction à chaud, page interactive signée

export interface ContexteDossier {
  sous_statut: SousStatut;
  pieces: readonly PieceDuDossier[];
  stagiaire_ids: readonly string[];
}

interface Regle {
  de: readonly SousStatut[];
  vers: SousStatut | ((c: ContexteDossier) => SousStatut);
  acteurs: readonly Acteur[];
  libelle: string;
  /** Retourne un motif de refus, ou `null` si la condition est remplie. */
  garde?: (c: ContexteDossier) => string | null;
  /** L'action exige un motif écrit (renvoi en brouillon, refus). */
  motifRequis?: boolean;
  effets: readonly Effet[];
}

const estValide = (c: ContexteDossier, code: PieceDuDossier["code"]) => {
  const concernees = c.pieces.filter((p) => p.code === code);
  return concernees.length > 0 && concernees.every((p) => p.statut === "valide");
};

const completude = (c: ContexteDossier): SousStatut =>
  piecesManquantesPourCompletude(c.pieces, c.stagiaire_ids).length === 0 ? "fin_dossier_complet" : "fin_dossier_incomplet";

export const REGLES: Record<Action, Regle> = {
  soumettre_validation: {
    de: ["brouillon"],
    vers: "en_cours_validation",
    acteurs: ["formateur"],
    libelle: "Demander la validation à l'organisme",
    // RG-02 / F-DOS-04 : recueil des besoins ET test de positionnement joints, pour chaque stagiaire.
    garde: (c) => {
      if (c.stagiaire_ids.length === 0) return "Le dossier ne compte aucun apprenant.";
      if (!estValide(c, "00-AVT")) return "Le recueil des besoins doit être joint pour chaque apprenant (RG-02).";
      if (!estValide(c, "01-AVT")) return "Le test de positionnement doit être joint pour chaque apprenant (RG-02).";
      return null;
    },
    effets: ["NOTIFIER_ADMIN_DEMANDE_VALIDATION"],
  },
  renvoyer_en_brouillon: {
    de: ["en_cours_validation"],
    vers: "brouillon",
    acteurs: ["admin"],
    libelle: "Renvoyer au formateur pour correction",
    motifRequis: true,
    effets: ["NOTIFIER_FORMATEUR_RENVOI"],
  },
  valider_dossier: {
    de: ["en_cours_validation"],
    vers: "dossier_valide",
    acteurs: ["admin"],
    libelle: "Valider le dossier",
    effets: ["GENERER_PIECES_DE_DEPART", "EMAIL_ENTREPRISE_PIECES_FINANCEMENT"],
  },
  declarer_depot: {
    de: ["dossier_valide"],
    vers: "dossier_depose",
    // Cahier des charges oral du 23/09/2026 : c'est d'abord l'apprenant qui, depuis son espace, affirme avoir
    // déposé la demande auprès de son financeur. Le formateur et l'OF gardent la main (dépôt fait par l'entreprise).
    acteurs: ["apprenant", "formateur", "admin"],
    libelle: "Déclarer la demande de financement déposée auprès du financeur",
    // On ne dépose pas une demande de financement sans convention signée.
    garde: (c) => (estValide(c, "02-AVT") ? null : "La convention de formation doit être signée avant de déclarer la demande déposée."),
    effets: ["NOTIFIER_DEPOT_DECLARE"],
  },
  enregistrer_accord: {
    de: ["dossier_valide", "dossier_depose"],
    vers: "accord_financement",
    // Déclenchée par le système au dépôt de la pièce « Accord », quel que soit le déposant (RG-06).
    acteurs: ["systeme"],
    libelle: "Enregistrer l'accord de financement",
    garde: (c) => (estValide(c, "ACC") ? null : "L'accord de financement doit être déposé sur le dossier."),
    effets: ["GENERER_ET_ENVOYER_ODM", "OUVRIR_COFFRE_AUX_APPRENANTS"],
  },
  enregistrer_refus: {
    de: ["dossier_valide", "dossier_depose"],
    vers: "refus_financement",
    acteurs: ["formateur", "admin"],
    libelle: "Enregistrer un refus de financement",
    garde: (c) => (estValide(c, "REF") ? null : "Le justificatif du refus de financement doit être déposé."),
    effets: ["ARCHIVER_EN_LECTURE_SEULE"],
  },
  envoyer_elements_pedagogiques: {
    de: ["accord_financement"],
    vers: "envoi_elements_pedagogiques",
    acteurs: ["formateur", "admin"],
    libelle: "Envoyer les éléments pédagogiques à l'apprenant",
    effets: ["GENERER_CONVOCATIONS", "EMAIL_APPRENANTS_ELEMENTS_PEDAGOGIQUES"],
  },
  demarrer_formation: {
    de: ["envoi_elements_pedagogiques"],
    vers: "formation_debutee",
    acteurs: ["formateur", "admin"],
    libelle: "Démarrer la formation",
    effets: ["GENERER_PIECES_DE_REALISATION"],
  },
  terminer_formation: {
    de: ["formation_debutee"],
    vers: completude,
    acteurs: ["formateur", "admin"],
    libelle: "Déclarer la formation terminée",
    effets: ["GENERER_PIECES_DE_FIN", "ENVOYER_FORMULAIRES_DE_FIN", "PLANIFIER_SATISFACTION_A_FROID"],
  },
  reevaluer_completude: {
    de: ["fin_dossier_incomplet", "fin_dossier_complet"],
    vers: completude,
    acteurs: ["systeme"],
    libelle: "Réévaluer la complétude du dossier",
    effets: [],
  },
  demander_paiement: {
    de: ["fin_dossier_complet"],
    vers: "demande_paiement",
    acteurs: ["admin"],
    libelle: "Émettre la demande de paiement",
    effets: ["GENERER_FACTURE_OF"],
  },
  enregistrer_paiement: {
    de: ["demande_paiement"],
    vers: "paiement_receptionne",
    acteurs: ["admin"],
    libelle: "Enregistrer le paiement reçu",
    effets: [],
  },
  cloturer: {
    de: ["paiement_receptionne"],
    vers: "archive",
    acteurs: ["admin"],
    libelle: "Déclarer le formateur payé et archiver",
    garde: (c) => (estValide(c, "10-FIN") ? null : "La facture du formateur doit être déposée avant l'archivage."),
    effets: ["ARCHIVER_EN_LECTURE_SEULE"],
  },
};

export type ResultatTransition =
  | { ok: true; de: SousStatut; vers: SousStatut; effets: readonly Effet[] }
  | { ok: false; code: "statut" | "role" | "garde" | "motif" | "terminal"; motif: string };

export function transiter(c: ContexteDossier, action: Action, acteur: Acteur, options: { motif?: string } = {}): ResultatTransition {
  const regle = REGLES[action];
  if (estTerminal(c.sous_statut)) {
    return { ok: false, code: "terminal", motif: "Ce dossier est archivé : il n'est plus modifiable." };
  }
  if (!regle.de.includes(c.sous_statut)) {
    return { ok: false, code: "statut", motif: `« ${regle.libelle} » n'est pas possible à cette étape du dossier.` };
  }
  if (!regle.acteurs.includes(acteur)) {
    return { ok: false, code: "role", motif: `« ${regle.libelle} » ne relève pas de votre rôle.` };
  }
  if (regle.motifRequis && !options.motif?.trim()) {
    return { ok: false, code: "motif", motif: "Un motif écrit est obligatoire pour cette action." };
  }
  const refus = regle.garde?.(c) ?? null;
  if (refus) return { ok: false, code: "garde", motif: refus };

  const vers = typeof regle.vers === "function" ? regle.vers(c) : regle.vers;
  // Une réévaluation qui ne change rien n'a aucun effet.
  return { ok: true, de: c.sous_statut, vers, effets: vers === c.sous_statut ? [] : regle.effets };
}

/** Actions que cet acteur peut proposer maintenant — alimente les boutons de l'interface. */
export function actionsPossibles(c: ContexteDossier, acteur: Acteur): Array<{ action: Action; libelle: string; bloqueePar: string | null; motifRequis: boolean }> {
  if (estTerminal(c.sous_statut)) return [];
  return (Object.entries(REGLES) as Array<[Action, Regle]>)
    .filter(([, r]) => r.de.includes(c.sous_statut) && r.acteurs.includes(acteur))
    .map(([action, r]) => ({ action, libelle: r.libelle, bloqueePar: r.garde?.(c) ?? null, motifRequis: r.motifRequis === true }));
}
