/**
 * Lot 7 — aides communes aux gestionnaires de l'espace pédagogique (IA, supports, ZIP). Aucune route ici.
 *
 * Rappel de la règle du lot : une proposition de l'IA est un BROUILLON. Les gestionnaires la renvoient telle quelle à
 * l'écran ; rien n'est enregistré sans le geste du formateur (sauf, sur son geste, le dossier d'enjeux et le PPTX).
 */
import { analyserEnjeux } from "@/lib/pedagogie-ia.functions";
import { appelerServeur, exigerActeur, introuvable } from "../appel-serveur";
import { bd } from "../bd";
import { ErreurApi } from "../erreur";

export const MESSAGE_FORMATEUR = "Cette action est réservée aux formateurs.";

/**
 * Exige un formateur dont la candidature est validée (403 français sinon), AVANT toute lecture : un candidat ne voit de
 * toute façon aucune formation (RLS) et recevrait un « introuvable » trompeur. Le serveur refait la même vérification.
 */
export async function exigerFormateurValideClient(): Promise<void> {
  const acteur = await exigerActeur(["formateur"], MESSAGE_FORMATEUR);
  if (!acteur.formateur_valide)
    throw new ErreurApi(
      "Votre candidature doit être validée par l'organisme avant d'accéder à cet espace.",
      403,
      "interdit",
      null,
    );
}

export interface FormationLue {
  id: string;
  formation_modules: unknown;
  dossier_enjeux: unknown;
}

/** La formation, lue sous RLS : « introuvable » si elle n'est pas celle du formateur. */
export async function lireFormationVisible(id: string): Promise<FormationLue> {
  if (!id) throw introuvable("Formation");
  const { data, error } = await bd
    .from("formation")
    .select("id, formation_modules, dossier_enjeux")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw introuvable("Formation");
  return data as FormationLue;
}

/**
 * « L'assistant constituera d'abord le dossier d'enjeux » (annonce de l'écran) : si la formation n'en a pas, on lance la
 * route 61 — enregistrement, historique et journal compris — avant le QCM ou le plan de support. Le serveur de ces
 * deux routes ne l'enregistre jamais de lui-même. Si le dossier existe déjà, aucun appel n'est fait.
 */
export async function assurerDossierEnjeux(formation: FormationLue): Promise<void> {
  if (formation.dossier_enjeux) return;
  await appelerServeur(() => analyserEnjeux({ data: { formation_id: formation.id } }));
}
