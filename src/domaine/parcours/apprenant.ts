/**
 * Parcours de l'apprenant, section par section — cahier des charges oral du 23/09/2026.
 *
 * L'espace de l'apprenant « évolue avec le temps » : chaque étape du dossier ouvre une nouvelle section.
 *  1. Étape préliminaire : recueil des besoins et test de positionnement.
 *  2. Constitution du dossier et validation par l'équipe administrative de l'organisme.
 *  3. Demande de financement : convention (à signer), planning et programme (transmis), pré-dossier ;
 *     l'apprenant affirme ensuite avoir déposé sa demande auprès de son financeur.
 *  4. Accord de financement : section produite automatiquement une fois la demande déclarée ;
 *     l'accord peut être déposé par l'apprenant, le formateur ou l'organisme (RG-06).
 *  5. Réalisation de la formation : convocation, émargement, évaluation des acquis, attestation.
 *
 * Fonction pure : elle ne DÉCIDE rien (le pipeline décide) ; elle traduit l'état du dossier en sections
 * lisibles, avec une couleur d'état par section. Le serveur l'appelle, l'écran l'affiche tel quel.
 */
import type { PieceDuDossier } from "../pieces/statut";
import { aAtteint, type SousStatut } from "../pipeline/statuts";
import type { CodePiece } from "../referentiel/pieces";

/**
 * - `a_venir` : l'étape n'est pas encore ouverte (grisée) ;
 * - `a_faire` : l'étape attend une action de l'apprenant (couleur d'attente) ;
 * - `en_attente` : l'apprenant a fait sa part, l'organisme ou le financeur a la main ;
 * - `termine` : étape close (la section change de couleur) ;
 * - `refuse` : financement refusé, dossier archivé.
 */
export type EtatSection = "a_venir" | "a_faire" | "en_attente" | "termine" | "refuse";

export type CleSection = "preliminaire" | "constitution" | "financement" | "accord" | "realisation";

export interface Section {
  cle: CleSection;
  titre: string;
  etat: EtatSection;
  /** Phrase courte, écrite pour l'apprenant : ce qu'il doit faire, ou ce qui se passe. */
  message: string;
  /** Pièces affichées dans la section, dans l'ordre. */
  pieces: readonly CodePiece[];
}

export interface EntreeParcours {
  sous_statut: SousStatut;
  /** Pièces du dossier, DÉJÀ filtrées pour cet apprenant (collectives + ses pièces individuelles). */
  pieces: readonly PieceDuDossier[];
  /** Questionnaires préliminaires renseignés par cet apprenant. */
  recueil_renseigne: boolean;
  positionnement_renseigne: boolean;
  /** Un test de positionnement est-il prévu pour cette formation ? */
  positionnement_prevu: boolean;
}

const PIECES_FINANCEMENT: readonly CodePiece[] = ["PRE", "02-AVT", "03-AVT", "PRG"];
const PIECES_REALISATION: readonly CodePiece[] = ["05-AVT", "06-PDT", "07-FIN", "09-FIN"];

const valide = (pieces: readonly PieceDuDossier[], code: CodePiece) => {
  const concernees = pieces.filter((p) => p.code === code);
  return concernees.length > 0 && concernees.every((p) => p.statut === "valide");
};

export function sectionsParcours(e: EntreeParcours): Section[] {
  const s = e.sous_statut;
  const refuse = s === "refus_financement";
  const valideParOf = aAtteint(s, "dossier_valide");
  const depotDeclare = aAtteint(s, "dossier_depose") || aAtteint(s, "accord_financement");
  const accordObtenu = aAtteint(s, "accord_financement");

  // 1. Étape préliminaire
  const preliminaireFait =
    e.recueil_renseigne && (e.positionnement_renseigne || !e.positionnement_prevu);
  const preliminaire: Section = {
    cle: "preliminaire",
    titre: "Étape préliminaire — vos besoins et votre niveau",
    etat: preliminaireFait || valideParOf ? "termine" : "a_faire",
    message:
      preliminaireFait || valideParOf
        ? "Merci : votre recueil des besoins et votre test de positionnement ont bien été transmis."
        : !e.recueil_renseigne
          ? "Commencez par le recueil des besoins, puis passez le test de positionnement."
          : "Il vous reste le test de positionnement.",
    pieces: [],
  };

  // 2. Constitution du dossier et validation administrative
  const constitution: Section = {
    cle: "constitution",
    titre: "Constitution du dossier et validation par l'organisme",
    etat: valideParOf
      ? "termine"
      : s === "en_cours_validation"
        ? "en_attente"
        : preliminaireFait
          ? "en_attente"
          : "a_venir",
    message: valideParOf
      ? "Votre dossier a été validé par l'équipe administrative."
      : s === "en_cours_validation"
        ? "Votre formateur a constitué le dossier : l'équipe administrative le vérifie."
        : preliminaireFait
          ? "Votre formateur finalise le dossier avant de le soumettre à l'organisme."
          : "Cette étape s'ouvrira une fois l'étape préliminaire terminée.",
    pieces: [],
  };

  // 3. Demande de financement
  const conventionSignee = valide(e.pieces, "02-AVT");
  const financement: Section = {
    cle: "financement",
    titre: "Demande de financement",
    etat: !valideParOf ? "a_venir" : depotDeclare ? "termine" : "a_faire",
    message: !valideParOf
      ? "Les documents de votre demande de financement apparaîtront ici dès la validation du dossier."
      : depotDeclare
        ? "Demande de financement déposée auprès de votre financeur."
        : conventionSignee
          ? "Documents prêts. Déposez-les sur l'espace de votre financeur (OPCO), puis confirmez ci-dessous."
          : "Téléchargez les documents, signez la convention en ligne ou redéposez-la signée, puis déposez votre demande auprès de votre financeur.",
    pieces: PIECES_FINANCEMENT.filter((code) => e.pieces.some((p) => p.code === code)),
  };

  // 4. Accord de financement — section produite automatiquement une fois la demande déclarée.
  const accordPresent = e.pieces.some((p) => p.code === "ACC");
  const accord: Section = {
    cle: "accord",
    titre: "Accord de financement",
    etat: refuse ? "refuse" : accordObtenu ? "termine" : depotDeclare ? "a_faire" : "a_venir",
    message: refuse
      ? "Le financement a été refusé : votre formateur vous recontactera."
      : accordObtenu
        ? "Accord de financement reçu : votre formation est confirmée."
        : depotDeclare
          ? "Dès que vous recevez l'accord de prise en charge, déposez-le ici (votre formateur ou l'organisme peuvent aussi le faire)."
          : "Cette section s'ouvrira quand votre demande de financement sera déposée.",
    pieces: accordPresent ? ["ACC"] : [],
  };

  // 5. Réalisation
  const realisationFinie = aAtteint(s, "fin_dossier_complet");
  const realisation: Section = {
    cle: "realisation",
    titre: "Votre formation",
    etat: refuse ? "a_venir" : !accordObtenu ? "a_venir" : realisationFinie ? "termine" : "a_faire",
    message: !accordObtenu
      ? "Convocation, émargement et évaluations apparaîtront ici après l'accord de financement."
      : realisationFinie
        ? "Formation terminée : votre attestation est disponible."
        : "Retrouvez votre convocation, signez vos présences et, en fin de formation, votre évaluation des acquis.",
    pieces: PIECES_REALISATION.filter((code) => e.pieces.some((p) => p.code === code)),
  };

  return [preliminaire, constitution, financement, accord, realisation];
}

/** La section « Accord » est-elle visible pour l'apprenant ? Elle n'apparaît qu'une fois la demande déclarée. */
export function sectionVisible(section: Section): boolean {
  if (section.cle === "accord") return section.etat !== "a_venir";
  return true;
}
