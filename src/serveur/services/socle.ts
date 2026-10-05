/** Socle commun des services applicatifs : dépendances injectées, acteur courant, erreurs métier. */
import type { z } from "zod";
import type { BaseDeDonnees } from "../bd/connexion";
import type { Archive } from "../ports/archive";
import type { Courrier } from "../ports/courrier";
import type { ConvertisseurPdf } from "../ports/pdf";
import type { Horloge } from "../ports/divers";
import type { AssistantPedagogique } from "../ports/ia";
import type { Chiffreur } from "../ports/chiffrement";
import type { Role } from "@/domaine/referentiel/pieces";
import { evenement } from "../bd/schema";
import { nouvelId } from "../ports/divers";

export interface Services {
  bd: BaseDeDonnees;
  archive: Archive;
  courrier: Courrier;
  pdf: ConvertisseurPdf;
  horloge: Horloge;
  appUrl: string;
  /** Assistant IA par défaut du serveur (`.env`) — facultatif ; les réglages en base de l'organisme priment (voir ports/ia.ts). */
  ia?: AssistantPedagogique;
  /** Chiffrement des secrets enregistrés en base (clé d'API, mot de passe SMTP). */
  secrets: Chiffreur;
}

/** Qui agit. Construit par le serveur à partir de la session — jamais à partir du corps d'une requête. */
export interface Acteur {
  utilisateur_id: string;
  of_id: string;
  role: Role;
  /** Renseigné pour un formateur. */
  formateur_id: string | null;
  /** Le formateur peut-il instruire des dossiers ? (`false` tant que sa candidature n'est pas validée) */
  formateur_valide: boolean;
  /** Renseigné pour un apprenant. */
  stagiaire_id: string | null;
  nom: string;
  email: string;
}

export type CodeErreur = "non_authentifie" | "interdit" | "introuvable" | "invalide" | "conflit";

export class ErreurMetier extends Error {
  constructor(
    readonly code: CodeErreur,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ErreurMetier";
  }
}

export const interdit = (message = "Cette action ne vous est pas permise.") => new ErreurMetier("interdit", message);
export const introuvable = (quoi = "Élément") => new ErreurMetier("introuvable", `${quoi} introuvable.`);
export const invalide = (message: string, details?: unknown) => new ErreurMetier("invalide", message, details);

export function exigerRole(acteur: Acteur, ...roles: Role[]): void {
  if (!roles.includes(acteur.role)) throw interdit();
}

/** Un formateur dont la candidature n'est pas validée n'accède qu'à sa candidature (F-ONB-02). */
export function exigerFormateurValide(acteur: Acteur): string {
  if (acteur.role !== "formateur" || !acteur.formateur_id) throw interdit();
  if (!acteur.formateur_valide) throw interdit("Votre candidature doit être validée par l'organisme avant d'accéder à cet espace.");
  return acteur.formateur_id;
}

export async function journaliser(
  s: Services,
  entree: { of_id: string; dossier_id?: string | null; acteur: Pick<Acteur, "utilisateur_id" | "role"> | "systeme"; type: string; libelle: string; detail?: unknown },
): Promise<void> {
  await s.bd.insert(evenement).values({
    id: nouvelId(),
    of_id: entree.of_id,
    dossier_id: entree.dossier_id ?? null,
    acteur_id: entree.acteur === "systeme" ? null : entree.acteur.utilisateur_id || null,
    acteur_role: entree.acteur === "systeme" ? "systeme" : entree.acteur.role,
    type: entree.type,
    libelle: entree.libelle,
    detail: entree.detail ?? null,
    cree_le: s.horloge.maintenant(),
  });
}

/**
 * Validation d'une MISE À JOUR partielle. Piège de Zod : `schema.partial()` applique quand même les valeurs
 * par défaut des champs absents — une modification d'un seul champ effacerait tous les autres. On ne retient
 * donc que les clés réellement envoyées. (Bogue attrapé par le test du parcours complet.)
 */
export function validerPartiel<T extends z.ZodRawShape>(schema: z.ZodObject<T>, donnees: unknown): Partial<z.infer<z.ZodObject<T>>> {
  if (typeof donnees !== "object" || donnees === null) throw invalide("Données illisibles.");
  const valeurs = schema.partial().parse(donnees) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(valeurs).filter(([cle]) => cle in donnees)) as Partial<z.infer<z.ZodObject<T>>>;
}
