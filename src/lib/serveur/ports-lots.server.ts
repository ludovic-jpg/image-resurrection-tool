/**
 * Points de branchement entre le lot 4 (dossiers, pipeline) et les lots qui l'accompagnent.
 *
 * Certains effets du pipeline demandent un travail qui appartient à un autre lot :
 *   • rendre et archiver une pièce (gabarit → HTML → empreinte)       → lot 5 (`pieces-generer`) ;
 *   • envoyer les formulaires en ligne (jeton, QR code, e-mail)        → lot 5 (`formulaires-envoyer`) ;
 *   • reprendre un positionnement déjà signé dans un nouveau dossier   → lot 6 (`positionnements`).
 *
 * Le lot 4 n'écrit PAS ces mécanismes : il les appelle à travers ce registre. Tant qu'un lot n'a pas branché le sien,
 * le comportement par défaut est volontairement prudent :
 *   • `genererPieces` : crée les lignes `piece_dossier` attendues (elles apparaissent bien dans le dossier) et NE rend
 *     aucun fichier — `chemin_depart` reste vide. La route de téléchargement des pièces (109) génère à la demande
 *     quand `chemin_depart` est absent (repli prévu par la carte) ;
 *   • `envoyerFormulaires` et `reprendrePositionnements` : ne font rien (renvoient 0).
 *
 * Le lot qui livre le mécanisme appelle `brancherPortsLots({ … })` au chargement de son module serveur.
 */
import type { TypeEvaluation } from "@/domaine/dossier/evaluations";
import type { Acteur } from "./acteur.server";
import type { BdService } from "./bd.server";
import { piecesDuDossier, stagiairesDuDossier, synchroniserPieces } from "./dossier.server";
import type { LigneDossier, LignePieceServeur } from "./dossier.server";
import type { CodePiece } from "@/domaine/referentiel/pieces";
import { estIndividuelle } from "@/domaine/referentiel/pieces";

export interface PortsLots {
  /** Rend, archive et scelle les pièces demandées (individuelles : une par apprenant). Renvoie les lignes à jour. */
  genererPieces(
    bd: BdService,
    dossier: LigneDossier,
    codes: readonly CodePiece[],
  ): Promise<LignePieceServeur[]>;
  /** Envoie aux apprenants les formulaires ouverts à cette étape. Renvoie le nombre d'envois. */
  envoyerFormulaires(
    bd: BdService,
    dossier: LigneDossier,
    types: readonly TypeEvaluation[],
  ): Promise<number>;
  /** Reprend dans le dossier les positionnements signés avant sa création. Renvoie le nombre d'apprenants repris. */
  reprendrePositionnements(bd: BdService, acteur: Acteur, dossier: LigneDossier): Promise<number>;
}

const parDefaut: PortsLots = {
  async genererPieces(bd, dossier, codes) {
    await synchroniserPieces(bd, dossier);
    const liens = await stagiairesDuDossier(bd, dossier.id);
    const pieces = await piecesDuDossier(bd, dossier.id);
    return pieces.filter(
      (p) =>
        codes.includes(p.code) &&
        (!estIndividuelle(p.code) || liens.some((l) => l.st.id === p.stagiaire_id)),
    );
  },
  async envoyerFormulaires() {
    return 0;
  },
  async reprendrePositionnements() {
    return 0;
  },
};

let courants: PortsLots = parDefaut;

export const portsLots = (): PortsLots => courants;

/** Branche tout ou partie des mécanismes d'un autre lot. Appelé une fois, au chargement du module serveur du lot. */
export function brancherPortsLots(ports: Partial<PortsLots>): void {
  courants = { ...courants, ...ports };
}

/** Pour les tests : retour au comportement par défaut. */
export function reinitialiserPortsLots(): void {
  courants = parDefaut;
}
