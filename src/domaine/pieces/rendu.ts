/**
 * Rendu d'une pièce de dossier : agrégat + données de la pièce → HTML, par le moteur de gabarits pur.
 *
 * C'est la partie PURE de `rendrePiece` de l'ancien `src/serveur/services/generation.ts` : le chargement des données
 * (base, archive) reste dans `src/lib/serveur/pieces-donnees.server.ts`, et le TEXTE des gabarits est injecté par
 * l'appelant (aucune lecture de fichier ici — voir `src/lib/serveur/pieces-gabarits.server.ts`). Le rendu d'un gabarit
 * ne doit jamais changer : `rendu.test.ts` le compare, octet pour octet, à celui du service Node d'origine.
 */
import type { AgregatDossier } from "../dossier/agregat";
import { resoudreVariables } from "../dossier/resolution";
import { FORMULAIRES, type Reponses } from "../formulaires/definitions";
import type { Questionnaire } from "../formulaires/qcm";
import { echapperHtml, rendreGabarit, type ResultatRendu, type Zone } from "../gabarits/moteur";
import {
  zoneGrilleNotes,
  zoneQcm,
  zoneReponses,
  zoneSynthesePositionnement,
} from "../gabarits/zones";
import { estIndividuelle, type CodePiece } from "../referentiel/pieces";
import { blocSignatureHtml, horodatageLisible, type PreuveSignature } from "../signature/preuve";

/** Couleur d'accent par défaut de l'organisme (la même que la colonne `organisme_formation.couleur`). */
export const COULEUR_PAR_DEFAUT = "#1d6a45";

/** Fragments partagés d'un gabarit : `styles` est la feuille de style SANS la variable de couleur. */
export interface Fragments {
  styles: string;
  entete: string;
  pied: string;
}

/** Fragments prêts à insérer : la couleur de l'organisme est posée en tête de la feuille de style. */
export function inclusionsDe(fragments: Fragments, couleurOf?: string): Record<string, string> {
  const couleur = couleurOf && /^#[0-9a-fA-F]{6}$/.test(couleurOf) ? couleurOf : COULEUR_PAR_DEFAUT;
  return {
    styles: `:root{--of-couleur:${couleur}}\n${fragments.styles}`,
    entete: fragments.entete,
    pied: fragments.pied,
  };
}

export interface DonneesRendu {
  code: CodePiece;
  agregat: AgregatDossier;
  /** Renseigné pour une pièce individuelle. */
  stagiaireId: string | null;
  organisme: { of_nom: string; couleur?: string; signature_representant_png?: string };
  /** Signatures en ligne de la pièce (une par zone : « apprenant », « formateur »). */
  signatures: Array<PreuveSignature & { zone: string }>;
  /** Réponses enregistrées du stagiaire, par type d'évaluation. */
  reponses: Partial<Record<string, Reponses | Array<number | null>>>;
  questionnaires: { positionnement: Questionnaire | null; acquis: Questionnaire | null };
  /** Séances dans l'ordre du planning. */
  seances: Array<{ id: string }>;
  /** Pointages d'émargement du stagiaire (pièce 06-PDT). */
  pointages: Array<{
    seance_id: string;
    signataire: string;
    trace_png: string;
    horodatage: string;
  }>;
}

/** Les zones `<!-- zone:… -->` d'une pièce : signatures, réponses de formulaire, QCM, grilles, émargement. */
export function zonesDePiece(d: DonneesRendu): Record<string, Zone> {
  const preuve = (zone: string): PreuveSignature | null => {
    const sig = d.signatures.find((x) => x.zone === zone);
    return sig ?? null;
  };
  const reponsesDe = (type: string) => d.reponses[type];
  const caseEmargement =
    (signataire: "stagiaire" | "formateur"): Zone =>
    (rangs) => {
      const se = d.seances[(rangs.session ?? 0) - 1];
      const p = se && d.pointages.find((x) => x.seance_id === se.id && x.signataire === signataire);
      return p
        ? `<img src="${p.trace_png}" alt="Signature"><small>${horodatageLisible(p.horodatage)}</small>`
        : "";
    };
  const of = d.organisme;
  return {
    logo_of: () => "",
    // L'organisme signe ses propres pièces par le tracé enregistré de son représentant légal.
    signature_of: () =>
      of.signature_representant_png
        ? `<img src="${of.signature_representant_png}" alt="Signature de l'organisme"><div class="preuve">Pour ${echapperHtml(of.of_nom)}</div>`
        : "",
    signature_apprenant: () => blocSignatureHtml(preuve("apprenant")),
    signature_formateur: () => blocSignatureHtml(preuve("formateur")),
    reponses_recueil: () =>
      zoneReponses(FORMULAIRES["00-AVT"], reponsesDe("recueil") as Reponses | undefined),
    questions_positionnement: () =>
      zoneQcm(
        d.questionnaires.positionnement,
        reponsesDe("positionnement") as Array<number | null> | undefined,
      ),
    synthese_positionnement: () =>
      zoneSynthesePositionnement(
        d.questionnaires.positionnement,
        reponsesDe("positionnement") as Array<number | null> | undefined,
      ),
    questions_acquis: () =>
      zoneQcm(d.questionnaires.acquis, reponsesDe("acquis") as Array<number | null> | undefined),
    grille_satisfaction_chaud: () =>
      zoneGrilleNotes(
        FORMULAIRES["08-FIN"],
        reponsesDe("satisfaction_chaud") as Reponses | undefined,
      ),
    grille_satisfaction_froid: () =>
      zoneGrilleNotes(
        FORMULAIRES["12-APR"],
        reponsesDe("satisfaction_froid") as Reponses | undefined,
      ),
    emargement_stagiaire: caseEmargement("stagiaire"),
    emargement_formateur: caseEmargement("formateur"),
  };
}

/** Rend le HTML courant d'une pièce, signatures et réponses comprises : ce que voit — et signe — l'utilisateur. */
export function rendrePieceHtml(
  gabarit: string,
  fragments: Fragments,
  d: DonneesRendu,
): ResultatRendu {
  const variables = resoudreVariables(
    d.agregat,
    estIndividuelle(d.code) && d.stagiaireId ? { stagiaireId: d.stagiaireId } : {},
  );
  return rendreGabarit(gabarit, {
    variables,
    zones: zonesDePiece(d),
    inclusions: inclusionsDe(fragments, d.organisme.couleur),
  });
}
