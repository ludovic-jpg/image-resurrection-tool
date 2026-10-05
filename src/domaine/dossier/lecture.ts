/**
 * Vue d'un dossier pour un acteur — parties pures de `lireDossier` de l'ancien `src/serveur/services/dossiers.ts` :
 * ce que CET acteur peut faire d'une pièce (`peut_signer`, `peut_deposer`), heures réalisées, état des
 * questionnaires, ce qu'on réclame à l'apprenant lors d'une relance. Aucune règle n'est réécrite : tout vient du
 * noyau (`pieces/statut`, `referentiel/pieces`).
 */
import {
  LIBELLE_STATUT,
  peutValider,
  type PieceDuDossier,
  type StatutPiece,
} from "../pieces/statut";
import { estTerminal, type SousStatut } from "../pipeline/statuts";
import { definitionPiece, type CodePiece, type Role } from "../referentiel/pieces";
import { dureeSeanceHeures } from "./formats";

export interface LignePieceBrute {
  id: string;
  code: string;
  stagiaire_id: string | null;
  statut: StatutPiece;
  mode_retour: "depot" | "signature" | "formulaire" | null;
  retour_le: string | null;
  genere_le: string | null;
  transmise_le: string | null;
  chemin_retour: string | null;
}

/** Pièces dont la signature en ligne est refusée à l'apprenant (enquêtes et questionnaires internes). */
const NON_SIGNABLES_PAR_APPRENANT: readonly string[] = ["00-AVT", "01-AVT", "08-FIN", "12-APR"];

export function vuePiece(p: LignePieceBrute, role: Role, dossierOuvert: boolean) {
  const def = definitionPiece(p.code as CodePiece);
  const peutRetourner = dossierOuvert && p.statut !== "valide" && peutValider(def.code, role);
  return {
    id: p.id,
    code: def.code,
    libelle: def.libelle,
    espace: def.espace,
    ordre: def.ordre ?? null,
    phase: def.phase,
    stagiaire_id: p.stagiaire_id,
    suivi: def.suiviStatut,
    statut: def.suiviStatut ? p.statut : null,
    libelle_statut: def.suiviStatut
      ? LIBELLE_STATUT[p.statut]
      : p.transmise_le
        ? "Transmis"
        : "À transmettre",
    mode: def.mode,
    disponible: def.mode === "generee" || p.chemin_retour !== null,
    a_un_retour: p.chemin_retour !== null,
    mode_retour: p.mode_retour,
    retour_le: p.retour_le,
    genere_le: p.genere_le,
    transmise_le: p.transmise_le,
    // Ce que CET acteur peut faire maintenant — l'interface n'a rien à deviner.
    // Signature en ligne : l'apprenant signe ses pièces ; le formateur ne signe que SON ordre de mission
    // (il peut en revanche DÉPOSER la feuille d'émargement papier signée en salle).
    peut_signer:
      peutRetourner &&
      def.mode === "generee" &&
      (role === "apprenant"
        ? !NON_SIGNABLES_PAR_APPRENANT.includes(def.code)
        : role === "formateur" && def.code === "04-AVT"),
    peut_deposer: peutRetourner,
  };
}

export const dossierOuvert = (statut: SousStatut): boolean => !estTerminal(statut);

/** Les cinq questionnaires en ligne, avec la pièce qui porte leur état. */
export const QUESTIONNAIRES = [
  { type: "recueil", code: "00-AVT" },
  { type: "positionnement", code: "01-AVT" },
  { type: "acquis", code: "07-FIN" },
  { type: "satisfaction_chaud", code: "08-FIN" },
  { type: "satisfaction_froid", code: "12-APR" },
] as const;

/**
 * Heures réellement suivies par stagiaire. Émargement électronique : somme des séances signées par le stagiaire.
 * Si la feuille a été retournée sur papier (dépôt d'un fichier), on retient la durée prévue — hypothèse tracée.
 */
export function heuresRealisees(a: {
  stagiaire_ids: readonly string[];
  seances: ReadonlyArray<{ id: string; heure_debut: string; heure_fin: string }>;
  emargements: ReadonlyArray<{ seance_id: string; stagiaire_id: string; signataire: string }>;
  /** Pièces 06-PDT du dossier. */
  feuilles: ReadonlyArray<{
    stagiaire_id: string | null;
    statut: string;
    mode_retour: string | null;
  }>;
  duree_totale: number | null;
}): Record<string, number> {
  const sortie: Record<string, number> = {};
  for (const id of a.stagiaire_ids) {
    const parSignature = a.emargements
      .filter((e) => e.stagiaire_id === id && e.signataire === "stagiaire")
      .reduce((total, e) => {
        const se = a.seances.find((x) => x.id === e.seance_id);
        return se ? total + dureeSeanceHeures(se.heure_debut, se.heure_fin) : total;
      }, 0);
    const feuille = a.feuilles.find((f) => f.stagiaire_id === id);
    const surPapier = feuille?.statut === "valide" && feuille.mode_retour === "depot";
    sortie[id] =
      parSignature > 0
        ? Math.round(parSignature * 100) / 100
        : surPapier
          ? (a.duree_totale ?? 0)
          : 0;
  }
  return sortie;
}

/** Libellés des documents qu'on attend encore de l'apprenant (relance F-CRM-06). Vide = relance inutile. */
export function documentsEnAttenteDe(
  pieces: ReadonlyArray<Pick<PieceDuDossier, "code" | "stagiaire_id" | "statut">>,
  stagiaireId: string,
): string[] {
  return pieces
    .filter(
      (p) =>
        p.statut === "en_attente" && (p.stagiaire_id === null || p.stagiaire_id === stagiaireId),
    )
    .map((p) => definitionPiece(p.code))
    .filter((def) => def.suiviStatut && def.valideePar.includes("apprenant") && def.code !== "ACC")
    .map((def) => def.libelle);
}
