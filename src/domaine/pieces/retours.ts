/**
 * Règles PURES du retour des pièces (signature en ligne, dépôt d'un fichier, émargement) — version sans base de
 * données de `src/serveur/services/retours.ts`. Chaque contrôle renvoie `null` (autorisé) ou un refus typé
 * `{ code, message }` que la couche serveur transforme en erreur métier ; les messages sont ceux de l'ancien service.
 */
import { estTerminal, type SousStatut } from "../pipeline/statuts";
import { peutValider } from "./statut";
import { definitionPiece, estCodePiece, type CodePiece, type Role } from "../referentiel/pieces";
import { nomSur } from "../archive/chemins";
import { extensionDe } from "../fichiers/regles";

export interface Refus {
  code: "interdit" | "invalide" | "conflit";
  message: string;
}

const refus = (code: Refus["code"], message: string): Refus => ({ code, message });

/** Sous-statuts où l'émargement est ouvert : la formation a démarré. */
export const SOUS_STATUTS_EMARGEMENT: readonly SousStatut[] = [
  "formation_debutee",
  "fin_dossier_incomplet",
  "fin_dossier_complet",
];

export const MESSAGE_DOSSIER_ARCHIVE = "Ce dossier est archivé : il n'est plus modifiable.";

/** Un dossier terminal (refus de financement, archivé) est en lecture seule. */
export function refusDossierFerme(sousStatut: SousStatut): Refus | null {
  return estTerminal(sousStatut) ? refus("conflit", MESSAGE_DOSSIER_ARCHIVE) : null;
}

/**
 * Nom de fichier d'une pièce : nomenclature `NN_PHASE_Libellé`, suffixée du stagiaire pour une pièce individuelle.
 * Sans extension.
 */
export function nomFichierPiece(code: CodePiece, nomStagiaire: string | null): string {
  const base = definitionPiece(code).fichier;
  return nomStagiaire ? `${base}_${nomSur(nomStagiaire).replace(/\s+/g, "-")}` : base;
}

/**
 * Signature en ligne d'une pièce : qui, sur quelle pièce, dans quel état. Ne contrôle PAS le tracé (voir
 * `validerDemandeSignature` du noyau, `domaine/signature/preuve.ts`).
 * L'apprenant signe ses pièces ; le formateur ne signe en ligne que l'ordre de mission (04-AVT) ; l'admin ne signe pas.
 */
export function refusSignature(
  code: CodePiece,
  role: Role,
  statutPiece: string,
  sousStatut: SousStatut,
): Refus | null {
  const ferme = refusDossierFerme(sousStatut);
  if (ferme) return ferme;
  if (definitionPiece(code).mode !== "generee")
    return refus("invalide", "Ce document se dépose ; il ne se signe pas en ligne.");
  if (!peutValider(code, role) || role === "admin" || (role === "formateur" && code !== "04-AVT"))
    return refus("interdit", "Ce document n'attend pas votre signature.");
  if (statutPiece === "valide") return refus("conflit", "Ce document est déjà validé.");
  return null;
}

/** Dépôt d'un fichier (pièce signée hors ligne ou document externe) : seuls les rôles qui valident la pièce. */
export function refusDepot(code: CodePiece, role: Role, sousStatut: SousStatut): Refus | null {
  const ferme = refusDossierFerme(sousStatut);
  if (ferme) return ferme;
  if (!peutValider(code, role))
    return refus("interdit", "Ce document n'attend pas de retour de votre part.");
  return null;
}

/**
 * Dépôt d'une pièce externe sur un dossier (route 99) : la pièce doit se déposer ; si elle n'existe pas encore sur le
 * dossier, seul un refus de financement peut la créer, et seulement après la validation du dossier.
 * Retourne `{ creer: true }` quand la ligne doit être créée.
 */
export function controlePieceExterne(
  code: string,
  sousStatut: SousStatut,
  pieceExiste: boolean,
): { refus: Refus } | { refus: null; creer: boolean } {
  if (!estCodePiece(code) || definitionPiece(code).mode !== "deposee")
    return { refus: refus("invalide", "Cette pièce ne se dépose pas.") };
  if (pieceExiste) return { refus: null, creer: false };
  if (code !== "REF")
    return {
      refus: refus("conflit", "Cette pièce n'est pas encore attendue à cette étape du dossier."),
    };
  if (sousStatut !== "dossier_valide" && sousStatut !== "dossier_depose")
    return {
      refus: refus(
        "conflit",
        "Un refus de financement ne s'enregistre qu'après la validation du dossier.",
      ),
    };
  return { refus: null, creer: true };
}

/** Régénération (formateur ou admin) d'une pièce non encore validée. */
export function refusRegeneration(
  role: Role,
  statutPiece: string,
  sousStatut: SousStatut,
): Refus | null {
  if (role === "apprenant") return refus("interdit", "Cette action ne vous est pas permise.");
  const ferme = refusDossierFerme(sousStatut);
  if (ferme) return ferme;
  if (statutPiece === "valide")
    return refus("conflit", "Une pièce validée ne se régénère pas : elle fait foi.");
  return null;
}

/** L'aperçu HTML existe pour les pièces générées et pour la trame de facture du formateur (10-FIN). */
export const aUnApercu = (code: CodePiece): boolean =>
  definitionPiece(code).mode === "generee" || code === "10-FIN";

/**
 * Réaction du pipeline à la validation d'une pièce :
 *  - RG-06 : le dépôt de l'Accord (par n'importe quel acteur) fait avancer le dossier et déclenche l'ODM ;
 *  - étape D : le dossier bascule seul de « incomplet » à « complet » quand la dernière pièce requise revient.
 */
export type ActionSysteme = "enregistrer_accord" | "reevaluer_completude";
export function reactionApresValidation(
  code: CodePiece,
  sousStatut: SousStatut,
): ActionSysteme | null {
  if (code === "ACC" && (sousStatut === "dossier_valide" || sousStatut === "dossier_depose"))
    return "enregistrer_accord";
  if (sousStatut === "fin_dossier_incomplet" || sousStatut === "fin_dossier_complet")
    return "reevaluer_completude";
  return null;
}

export type ModeRetour = "signature" | "depot" | "formulaire";

export function libelleValidation(mode: ModeRetour): string {
  return mode === "signature"
    ? "signée en ligne"
    : mode === "formulaire"
      ? "renseignée en ligne"
      : "document déposé";
}

// ——— Fichiers déposés ———

export const TAILLE_MAX_PIECE = 15 * 1024 * 1024;
export const EXTENSIONS_PIECE = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "doc",
  "docx",
  "odt",
  "xls",
  "xlsx",
  "ods",
  "csv",
  "txt",
] as const;

/** Message d'erreur lisible, ou `null` si le fichier est accepté comme retour d'une pièce de dossier. */
export function erreurFichierPiece(f: { nom: string; taille: number }): string | null {
  if (f.taille === 0) return "Le fichier est vide.";
  if (f.taille > TAILLE_MAX_PIECE)
    return `Le fichier dépasse la taille maximale de ${Math.round(TAILLE_MAX_PIECE / 1024 / 1024)} Mo.`;
  if (!(EXTENSIONS_PIECE as readonly string[]).includes(extensionDe(f.nom)))
    return `Type de fichier non accepté. Formats admis : ${EXTENSIONS_PIECE.join(", ")}.`;
  return null;
}

// ——— Émargement ———

export type CiblesEmargement =
  | { ok: true; cibles: string[]; signataire: "stagiaire" | "formateur" }
  | { ok: false; refus: Refus };

/**
 * Qui émarge, et pour qui. L'apprenant émarge pour lui-même (il doit être inscrit) ; le formateur contresigne pour un
 * stagiaire donné ou pour toute la séance ; l'admin n'émarge pas.
 */
export function ciblesEmargement(
  acteur: { role: Role; stagiaire_id: string | null },
  inscrits: readonly string[],
  stagiaireDemande?: string,
): CiblesEmargement {
  if (acteur.role === "apprenant") {
    if (!acteur.stagiaire_id || !inscrits.includes(acteur.stagiaire_id))
      return {
        ok: false,
        refus: refus("interdit", "Cette action ne vous est pas permise."),
      };
    return { ok: true, cibles: [acteur.stagiaire_id], signataire: "stagiaire" };
  }
  if (acteur.role === "formateur") {
    const cibles = stagiaireDemande ? [stagiaireDemande] : [...inscrits];
    if (cibles.some((c) => !inscrits.includes(c)))
      return {
        ok: false,
        refus: refus("invalide", "Ce stagiaire n'est pas inscrit à ce dossier."),
      };
    return { ok: true, cibles, signataire: "formateur" };
  }
  return {
    ok: false,
    refus: refus("interdit", "L'émargement est signé par le stagiaire et par le formateur."),
  };
}

/** L'émargement n'est ouvert qu'une fois la formation démarrée (et jamais sur un dossier fermé). */
export function refusEmargementFerme(sousStatut: SousStatut): Refus | null {
  const ferme = refusDossierFerme(sousStatut);
  if (ferme) return ferme;
  if (!SOUS_STATUTS_EMARGEMENT.includes(sousStatut))
    return refus("conflit", "L'émargement n'est ouvert qu'une fois la formation démarrée.");
  return null;
}
