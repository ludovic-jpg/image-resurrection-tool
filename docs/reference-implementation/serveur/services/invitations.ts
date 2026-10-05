/** Invitation de l'apprenant à son espace personnel (F-COM-04, F-COM-05). */
import { eq, sql } from "drizzle-orm";
import { formateur, stagiaire, utilisateur } from "../bd/schema";
import { nouvelId } from "../ports/divers";
import type { LigneDossier } from "./agregat";
import { creerInvitation, normaliserEmail } from "./auth";
import { courriels } from "./courriels";
import { lireOrganisme } from "./organisme";
import { ErreurMetier, introuvable, invalide, type Services } from "./socle";

/**
 * Crée au besoin le compte « apprenant » rattaché à la fiche, génère un lien d'invitation à usage unique
 * et l'envoie par e-mail. Retourne le lien (utile au formateur pour un envoi direct, F-COM-09).
 */
export async function inviterApprenant(s: Services, d: LigneDossier, stagiaireId: string, options: { sansEmail?: boolean } = {}): Promise<string> {
  const [st] = await s.bd.select().from(stagiaire).where(eq(stagiaire.id, stagiaireId));
  if (!st || st.of_id !== d.of_id) throw introuvable("Fiche apprenant");
  if (!st.stagiaire_email) throw invalide("La fiche de l'apprenant ne comporte pas d'adresse e-mail.");
  const email = normaliserEmail(st.stagiaire_email);

  let utilisateur_id = st.utilisateur_id;
  if (!utilisateur_id) {
    const [existant] = await s.bd.select().from(utilisateur).where(sql`lower(${utilisateur.email}) = ${email}`);
    if (existant && existant.role !== "apprenant") {
      throw new ErreurMetier("conflit", "Cette adresse e-mail est déjà utilisée par un compte formateur ou administrateur.");
    }
    utilisateur_id = existant?.id ?? nouvelId();
    if (!existant) {
      await s.bd.insert(utilisateur).values({ id: utilisateur_id, of_id: d.of_id, email, role: "apprenant", prenom: st.stagiaire_prenom, nom: st.stagiaire_nom, cree_le: s.horloge.maintenant() });
    }
    await s.bd.update(stagiaire).set({ utilisateur_id }).where(eq(stagiaire.id, st.id));
  }

  const lien = await creerInvitation(s, utilisateur_id);
  if (!options.sansEmail) {
    const of = await lireOrganisme(s, d.of_id);
    const [form] = await s.bd.select().from(formateur).where(eq(formateur.id, d.formateur_id));
    const c = courriels.invitationApprenant({ of_nom: of.of_nom, prenom: st.stagiaire_prenom, formateur: `${form!.formateur_prenom} ${form!.formateur_nom}`, formation: d.formation_titre, lien });
    await s.courrier.envoyer({ of_id: d.of_id, dossier_id: d.id, type: "invitation_apprenant", destinataire: email, ...c });
  }
  return lien;
}
