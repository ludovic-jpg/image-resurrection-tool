/**
 * Statut des pièces — RG-03 : binaire, « En attente de retour » ou « Validé ».
 *
 * Décision D2 : il existe UNE ligne par pièce et par dossier (ou par stagiaire pour une pièce
 * individuelle). L'espace de communication, le détail du dossier et la carte du pipeline lisent
 * cette même ligne : la « synchronisation » exigée par F-COM-08 / F-OF-04 est vraie par construction.
 */
import { aAtteint, type SousStatut } from "../pipeline/statuts";
import { NOMENCLATURE, definitionPiece, estIndividuelle, type CodePiece, type Espace, type PieceDef, type Role } from "../referentiel/pieces";

export type StatutPiece = "en_attente" | "valide";

export const LIBELLE_STATUT: Record<StatutPiece, string> = {
  en_attente: "En attente de retour",
  valide: "Validé",
};

/** Une pièce concrète d'un dossier. `stagiaire_id` est renseigné pour les pièces individuelles. */
export interface PieceDuDossier {
  code: CodePiece;
  stagiaire_id: string | null;
  statut: StatutPiece;
}

export interface CleDePiece {
  code: CodePiece;
  stagiaire_id: string | null;
}

/**
 * Pièces qui doivent exister pour un dossier arrivé à un sous-statut donné.
 * Le justificatif de refus n'est attendu que sur un dossier… refusé.
 */
export function piecesAttendues(sousStatut: SousStatut, stagiaireIds: readonly string[]): CleDePiece[] {
  const sortie: CleDePiece[] = [];
  for (const def of NOMENCLATURE) {
    if (def.code === "REF") continue; // créé à la demande, lors du dépôt du justificatif
    if (!aAtteint(sousStatut, def.disponibleDes)) continue;
    if (estIndividuelle(def.code)) for (const id of stagiaireIds) sortie.push({ code: def.code, stagiaire_id: id });
    else sortie.push({ code: def.code, stagiaire_id: null });
  }
  return sortie;
}

/** Ce rôle peut-il, par son retour (signature ou dépôt), faire passer la pièce à « Validé » ? */
export function peutValider(code: CodePiece, role: Role): boolean {
  const def = definitionPiece(code);
  return def.suiviStatut && def.valideePar.includes(role);
}

/**
 * Cloisonnement de lecture. L'apprenant ne voit que son espace, et, pour les pièces individuelles,
 * que les siennes. Il ne voit jamais l'ODM ni les factures (section 6.4.2 du cahier des charges).
 */
export function peutVoir(piece: CleDePiece, acteur: { role: Role; stagiaire_id?: string | null }): boolean {
  if (acteur.role === "admin" || acteur.role === "formateur") return true;
  const def = definitionPiece(piece.code);
  if (def.espace !== "apprenant") return false;
  return piece.stagiaire_id === null || piece.stagiaire_id === acteur.stagiaire_id;
}

/** Le dossier est « complet » quand toutes les pièces requises sont validées (étape D). */
export function piecesManquantesPourCompletude(pieces: readonly PieceDuDossier[], stagiaireIds: readonly string[]): CleDePiece[] {
  const manquantes: CleDePiece[] = [];
  for (const def of NOMENCLATURE.filter((d) => d.requisePourCompletude)) {
    const cibles: Array<string | null> = estIndividuelle(def.code) ? [...stagiaireIds] : [null];
    for (const stagiaire_id of cibles) {
      const piece = pieces.find((p) => p.code === def.code && p.stagiaire_id === stagiaire_id);
      if (piece?.statut !== "valide") manquantes.push({ code: def.code, stagiaire_id });
    }
  }
  return manquantes;
}

/** Pièces d'un espace, dans l'ordre du cahier des charges, avec leur statut courant. */
export function vueEspace(
  espace: Espace,
  pieces: readonly PieceDuDossier[],
  acteur: { role: Role; stagiaire_id?: string | null },
): Array<{ def: PieceDef; piece: PieceDuDossier }> {
  const ordre = new Map(NOMENCLATURE.map((d, i) => [d.code, i]));
  return pieces
    .filter((p) => definitionPiece(p.code).espace === espace && peutVoir(p, acteur))
    .sort((a, b) => ordre.get(a.code)! - ordre.get(b.code)!)
    .map((piece) => ({ def: definitionPiece(piece.code), piece }));
}
