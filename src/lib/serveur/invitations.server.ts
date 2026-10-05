/**
 * Invitation de l'apprenant à son espace personnel (F-COM-04, F-COM-05) — portage de `inviterApprenant`.
 *
 * Différence voulue avec l'ancien serveur : on NE CRÉE NI utilisateur Auth NI profil. Le compte naît quand
 * l'apprenant s'inscrit lui-même avec le lien (`signUp` + déclencheur SQL, route 6). Ce module écrit seulement une
 * ligne `invitation` (on ne stocke que `sha256(jeton)`, jamais le jeton), valable 14 jours, et envoie le lien.
 */
import { courriels } from "@/domaine/courriels/modeles";
import { normaliserEmail } from "@/domaine/compte/regles";
import type { BdService } from "./bd.server";
import { urlApplication } from "./config.server";
import { envoyerCourrier } from "./courrier.server";
import type { LigneDossier, StagiaireDuDossier } from "./dossier.server";
import { conflit, introuvable, invalide, leverSiErreurBd } from "./erreurs.server";
import { jetonAleatoire, sha256Hex } from "./hacheur.server";

export const VALIDITE_INVITATION_JOURS = 14;

export interface LienApprenant {
  lien: string;
  /** `true` : l'apprenant a déjà un compte, aucun lien d'inscription n'a été créé (le lien mène à la connexion). */
  compte_existant: boolean;
  /** `true` : un e-mail d'invitation est parti (ou a été consigné). */
  courrier_envoye: boolean;
}

export async function preparerLienApprenant(
  bd: BdService,
  d: LigneDossier,
  stagiaire: StagiaireDuDossier["st"],
  options: { sansEmail?: boolean; maintenant?: Date } = {},
): Promise<LienApprenant> {
  if (!stagiaire || stagiaire.of_id !== d.of_id) throw introuvable("Fiche apprenant");
  if (!stagiaire.stagiaire_email)
    throw invalide("La fiche de l'apprenant ne comporte pas d'adresse e-mail.");
  const email = normaliserEmail(stagiaire.stagiaire_email);
  const base = await urlApplication();

  // Un compte existe déjà (fiche reliée, ou profil de cette adresse) : inutile d'inviter, on renvoie vers la connexion.
  const { data: profils, error } = await bd
    .from("utilisateur")
    .select("id, role")
    .ilike("email", email.replace(/[\\%_]/g, "\\$&")); // « _ » et « % » sont des jokers de ilike
  leverSiErreurBd(error, "recherche du compte");
  const profil = ((profils ?? []) as Array<{ id: string; role: string }>)[0];
  if (profil && profil.role !== "apprenant")
    throw conflit(
      "Cette adresse e-mail est déjà utilisée par un compte formateur ou administrateur.",
    );
  if (profil || stagiaire.utilisateur_id)
    return { lien: `${base}/`, compte_existant: true, courrier_envoye: false };

  const jeton = jetonAleatoire();
  const maintenant = options.maintenant ?? new Date();
  // Une seule invitation valable par apprenant : les précédentes, non utilisées, sont retirées.
  const { error: errNettoyage } = await bd
    .from("invitation")
    .delete()
    .eq("stagiaire_id", stagiaire.id)
    .is("utilisee_le", null);
  leverSiErreurBd(errNettoyage, "remplacement de l'invitation");
  const { error: errInsertion } = await bd.from("invitation").insert({
    jeton_hash: await sha256Hex(jeton),
    of_id: d.of_id,
    email,
    role: "apprenant",
    prenom: stagiaire.stagiaire_prenom,
    nom: stagiaire.stagiaire_nom,
    stagiaire_id: stagiaire.id,
    expire_le: new Date(
      maintenant.getTime() + VALIDITE_INVITATION_JOURS * 86_400_000,
    ).toISOString(),
  });
  leverSiErreurBd(errInsertion, "création de l'invitation");
  const lien = `${base}/invitation/${jeton}`;

  if (options.sansEmail) return { lien, compte_existant: false, courrier_envoye: false };
  const [{ data: of }, { data: form }] = await Promise.all([
    bd.from("organisme_formation").select("of_nom").eq("id", d.of_id).maybeSingle(),
    bd
      .from("formateur")
      .select("formateur_prenom, formateur_nom")
      .eq("id", d.formateur_id)
      .maybeSingle(),
  ]);
  const c = courriels.invitationApprenant({
    of_nom: (of as { of_nom?: string } | null)?.of_nom ?? "",
    prenom: stagiaire.stagiaire_prenom,
    formateur: form
      ? `${(form as { formateur_prenom: string }).formateur_prenom} ${(form as { formateur_nom: string }).formateur_nom}`
      : "",
    formation: d.formation_titre,
    lien,
  });
  await envoyerCourrier(bd, {
    of_id: d.of_id,
    dossier_id: d.id,
    type: "invitation_apprenant",
    destinataire: email,
    ...c,
  });
  return { lien, compte_existant: false, courrier_envoye: true };
}
