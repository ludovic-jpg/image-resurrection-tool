/**
 * Exécution des transitions du pipeline. Le noyau DÉCIDE (`transiter`), ce service EXÉCUTE :
 * il persiste le nouveau sous-statut, réalise les effets déclarés, et journalise le tout.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { formaterDate } from "@/domaine/dossier/formats";
import { libelleSousStatut } from "@/domaine/pipeline/statuts";
import { REGLES, transiter, type Acteur as ActeurPipeline, type Action, type Effet } from "@/domaine/pipeline/transitions";
import { definitionPiece, type CodePiece } from "@/domaine/referentiel/pieces";
import { compteur, dossierFormation, entrepriseCliente, factureFormateur, factureOf, formateur, pieceDossier, utilisateur } from "../bd/schema";
import { dateIso, nouvelId } from "../ports/divers";
import { accederAuDossier, chargerContextePipeline, seancesDuDossier, stagiairesDuDossier, type LigneDossier } from "./agregat";
import { courriels } from "./courriels";
import { genererPiece, genererPieces, synchroniserPieces } from "./generation";
import { inviterApprenant } from "./invitations";
import { envoyerFormulairesAutomatiques } from "./formulaires-apprenant";
import { champsOfManquants, lireOrganisme } from "./organisme";
import { ErreurMetier, invalide, journaliser, type Acteur, type Services } from "./socle";

/** Numérotation continue par organisme et par année : `ADF-2026-0001`, `FA-2026-0001`… */
export async function numeroSuivant(s: Services, of_id: string, prefixe: string): Promise<string> {
  const annee = s.horloge.maintenant().getUTCFullYear();
  const cle = `${prefixe}-${annee}`;
  const [ligne] = await s.bd
    .insert(compteur)
    .values({ of_id, cle, valeur: 1 })
    .onConflictDoUpdate({ target: [compteur.of_id, compteur.cle], set: { valeur: sql`${compteur.valeur} + 1` } })
    .returning({ valeur: compteur.valeur });
  return `${cle}-${String(ligne!.valeur).padStart(4, "0")}`;
}

/** Ce qui doit être renseigné avant de demander la validation — complète la garde RG-02 du noyau. */
export async function manquesAvantSoumission(s: Services, d: LigneDossier): Promise<string[]> {
  const manques: string[] = [];
  const [ent] = await s.bd.select().from(entrepriseCliente).where(eq(entrepriseCliente.id, d.entreprise_id));
  const seances = await seancesDuDossier(s, d.id);
  if (!d.formation_titre) manques.push("Intitulé de la formation");
  if (!d.formation_objectifs) manques.push("Objectifs de la formation");
  // La convention renvoie au « programme détaillé en annexe » : sans lui, la pièce PRG serait vide.
  if (!d.formation_programme) manques.push("Programme détaillé de la formation (annexe de la convention)");
  if (!d.formation_date_debut || !d.formation_date_fin) manques.push("Dates de début et de fin");
  else if (d.formation_date_fin < d.formation_date_debut) manques.push("La date de fin précède la date de début");
  if (!d.formation_duree_heures_total) manques.push("Durée totale en heures");
  if (d.formation_prix_unitaire_ht === null) manques.push("Prix unitaire HT");
  if (seances.length === 0) manques.push("Au moins une séance au planning");
  if (d.formation_modalite !== "distanciel" && !d.formation_lieu_adresse) manques.push("Adresse du lieu de formation");
  if (d.formation_modalite !== "presentiel" && !d.formation_lien_visio) manques.push("Lien de connexion à distance");
  if (!d.signature_lieu) manques.push("Lieu de signature de la convention");
  if (!ent?.entreprise_siret) manques.push("SIRET de l'entreprise");
  if (!ent?.entreprise_representant_nom) manques.push("Nom du représentant de l'entreprise");
  // Sans cette adresse, l'e-mail automatique à l'entreprise (F-DOS-06) ne peut pas partir.
  if (!ent?.entreprise_representant_email) manques.push("E-mail du représentant de l'entreprise");
  return manques;
}

export async function executerAction(s: Services, acteur: Acteur | "systeme", dossierId: string, action: Action, options: { motif?: string } = {}): Promise<LigneDossier> {
  const d =
    acteur === "systeme"
      ? (await s.bd.select().from(dossierFormation).where(eq(dossierFormation.id, dossierId)))[0]
      : await accederAuDossier(s, acteur, dossierId);
  if (!d) throw new ErreurMetier("introuvable", "Dossier introuvable.");
  const role: ActeurPipeline = acteur === "systeme" ? "systeme" : acteur.role;

  const resultat = transiter(await chargerContextePipeline(s, d), action, role, options);
  if (!resultat.ok) throw new ErreurMetier(resultat.code === "role" ? "interdit" : "invalide", resultat.motif);

  // Contrôles qui dépendent de données hors du noyau (configuration de l'organisme, complétude de saisie).
  if (action === "soumettre_validation") {
    const manques = await manquesAvantSoumission(s, d);
    if (manques.length > 0) throw invalide("Le dossier est incomplet : il ne peut pas encore être soumis.", { manques });
  }
  if (action === "valider_dossier") {
    const manques = champsOfManquants(await lireOrganisme(s, d.of_id));
    if (manques.length > 0) throw invalide("La configuration de l'organisme est incomplète : aucune pièce ne peut être émise.", { manques });
  }

  const maintenant = s.horloge.maintenant();
  await s.bd
    .update(dossierFormation)
    .set({
      sous_statut: resultat.vers,
      maj_le: maintenant,
      ...(action === "valider_dossier" ? { valide_le: maintenant, motif_renvoi: "" } : {}),
      ...(action === "renvoyer_en_brouillon" ? { motif_renvoi: options.motif!.trim() } : {}),
      ...(action === "enregistrer_refus" ? { motif_refus: options.motif?.trim() ?? "" } : {}),
      ...(action === "terminer_formation" ? { termine_le: maintenant } : {}),
    })
    .where(eq(dossierFormation.id, d.id));
  const apres: LigneDossier = { ...d, sous_statut: resultat.vers, termine_le: action === "terminer_formation" ? maintenant : d.termine_le };

  if (resultat.vers !== resultat.de) {
    await journaliser(s, {
      of_id: d.of_id,
      dossier_id: d.id,
      acteur: acteur === "systeme" ? "systeme" : acteur,
      type: "transition",
      libelle: `${REGLES[action].libelle} — ${libelleSousStatut(resultat.de)} → ${libelleSousStatut(resultat.vers)}`,
      detail: { action, de: resultat.de, vers: resultat.vers, motif: options.motif ?? null },
    });
  }

  await synchroniserPieces(s, apres);
  const par = acteur === "systeme" ? "La plateforme" : acteur.nom;
  for (const effet of resultat.effets) await executerEffet(s, apres, effet, { ...options, par });
  return (await s.bd.select().from(dossierFormation).where(eq(dossierFormation.id, d.id)))[0]!;
}

async function adminsDe(s: Services, of_id: string) {
  return s.bd.select().from(utilisateur).where(and(eq(utilisateur.of_id, of_id), eq(utilisateur.role, "admin"), eq(utilisateur.actif, true)));
}

const nomDeFichier = (chemin: string) => chemin.split("/").pop()!;

async function executerEffet(s: Services, d: LigneDossier, effet: Effet, options: { motif?: string; par: string }): Promise<void> {
  const of = await lireOrganisme(s, d.of_id);
  const [form] = await s.bd.select().from(formateur).where(eq(formateur.id, d.formateur_id));
  const lienDossier = `${s.appUrl}/dossiers/${d.id}`;

  switch (effet) {
    case "NOTIFIER_ADMIN_DEMANDE_VALIDATION":
      for (const admin of await adminsDe(s, d.of_id)) {
        const c = courriels.demandeValidation({ of_nom: of.of_nom, formateur: `${form!.formateur_prenom} ${form!.formateur_nom}`, reference: d.dossier_reference, formation: d.formation_titre, lien: lienDossier });
        await s.courrier.envoyer({ of_id: d.of_id, dossier_id: d.id, type: "demande_validation", destinataire: admin.email, ...c });
      }
      return;

    case "NOTIFIER_FORMATEUR_RENVOI": {
      const c = courriels.renvoiEnBrouillon({ of_nom: of.of_nom, prenom: form!.formateur_prenom, reference: d.dossier_reference, motif: options.motif ?? "", lien: lienDossier });
      await s.courrier.envoyer({ of_id: d.of_id, dossier_id: d.id, type: "renvoi_brouillon", destinataire: form!.formateur_email, ...c });
      return;
    }

    case "NOTIFIER_DEPOT_DECLARE": {
      const c = courriels.depotDeclare({ of_nom: of.of_nom, prenom: form!.formateur_prenom, reference: d.dossier_reference, formation: d.formation_titre, par: options.par, lien: lienDossier });
      await s.courrier.envoyer({ of_id: d.of_id, dossier_id: d.id, type: "depot_declare", destinataire: form!.formateur_email, ...c });
      return;
    }

    case "GENERER_PIECES_DE_DEPART": {
      // F-ARCH-01/03 : toutes les pièces « de départ » de la nomenclature, dans « Pièces de départ ».
      const pieces = await genererPieces(s, d, ["00-AVT", "01-AVT", "PRE", "02-AVT", "03-AVT", "PRG"]);
      // Planning et programme sont transmis en annexe de la convention, sans statut (F-COM-03bis) : simple accusé de transmission.
      await s.bd.update(pieceDossier).set({ transmise_le: s.horloge.maintenant() }).where(and(eq(pieceDossier.dossier_id, d.id), inArray(pieceDossier.code, ["03-AVT", "PRG"])));
      await journaliser(s, { of_id: d.of_id, dossier_id: d.id, acteur: "systeme", type: "pieces_generees", libelle: `${pieces.length} pièces de départ générées et archivées` });
      return;
    }

    case "EMAIL_ENTREPRISE_PIECES_FINANCEMENT": {
      // F-DOS-06 / RG-04 : e-mail automatique au responsable de l'entreprise, avec les pièces du financement.
      const [ent] = await s.bd.select().from(entrepriseCliente).where(eq(entrepriseCliente.id, d.entreprise_id));
      const pieces = (await s.bd.select().from(pieceDossier).where(eq(pieceDossier.dossier_id, d.id))).filter((p) => ["PRE", "02-AVT", "03-AVT", "PRG"].includes(p.code) && p.chemin_depart);
      const stagiaires = (await stagiairesDuDossier(s, d.id)).map((l) => `${l.st.stagiaire_prenom} ${l.st.stagiaire_nom}`).join(", ");
      const c = courriels.piecesFinancementEntreprise({
        of_nom: of.of_nom,
        representant: `${ent!.entreprise_representant_civilite} ${ent!.entreprise_representant_nom}`.trim(),
        formation: d.formation_titre,
        stagiaires,
        reference: d.dossier_reference,
        pieces: [...new Set(pieces.map((p) => definitionPiece(p.code as CodePiece).libelle))],
      });
      await s.courrier.envoyer({
        of_id: d.of_id,
        dossier_id: d.id,
        type: "pieces_financement",
        destinataire: ent!.entreprise_representant_email,
        ...c,
        pieces_jointes: pieces.map((p) => ({ nom: nomDeFichier(p.chemin_depart!), chemin: p.chemin_depart! })),
      });
      return;
    }

    case "GENERER_ET_ENVOYER_ODM": {
      // F-OF-02 / RG-06 : l'ODM part automatiquement dès que l'accord est enregistré.
      const odm = await genererPiece(s, d, "04-AVT");
      await s.bd.update(pieceDossier).set({ transmise_le: s.horloge.maintenant() }).where(eq(pieceDossier.id, odm.id));
      const c = courriels.odmFormateur({ of_nom: of.of_nom, prenom: form!.formateur_prenom, reference: d.dossier_reference, formation: d.formation_titre, lien: lienDossier });
      await s.courrier.envoyer({ of_id: d.of_id, dossier_id: d.id, type: "odm", destinataire: form!.formateur_email, ...c, pieces_jointes: [{ nom: nomDeFichier(odm.chemin_depart!), chemin: odm.chemin_depart! }] });
      return;
    }

    case "OUVRIR_COFFRE_AUX_APPRENANTS":
      // RG-08. L'accès réel est calculé à partir du sous-statut ; ce drapeau ne sert qu'à l'affichage.
      await s.bd.update(dossierFormation).set({ coffre_ouvert: true }).where(eq(dossierFormation.id, d.id));
      await journaliser(s, { of_id: d.of_id, dossier_id: d.id, acteur: "systeme", type: "coffre_ouvert", libelle: "Coffre-fort pédagogique ouvert aux apprenants" });
      return;

    case "GENERER_CONVOCATIONS":
      await genererPieces(s, d, ["05-AVT"]);
      return;

    case "EMAIL_APPRENANTS_ELEMENTS_PEDAGOGIQUES":
      for (const { st } of await stagiairesDuDossier(s, d.id)) {
        if (!st.stagiaire_email) continue;
        const lien = st.utilisateur_id ? `${s.appUrl}/` : await inviterApprenant(s, d, st.id, { sansEmail: true });
        const [convocation] = await s.bd.select().from(pieceDossier).where(and(eq(pieceDossier.dossier_id, d.id), eq(pieceDossier.code, "05-AVT"), eq(pieceDossier.stagiaire_id, st.id)));
        const c = courriels.elementsPedagogiques({ of_nom: of.of_nom, prenom: st.stagiaire_prenom, formation: d.formation_titre, date_debut: formaterDate(d.formation_date_debut), lien });
        await s.courrier.envoyer({
          of_id: d.of_id,
          dossier_id: d.id,
          type: "elements_pedagogiques",
          destinataire: st.stagiaire_email,
          ...c,
          pieces_jointes: convocation?.chemin_depart ? [{ nom: nomDeFichier(convocation.chemin_depart), chemin: convocation.chemin_depart }] : [],
        });
      }
      return;

    case "GENERER_PIECES_DE_REALISATION":
      await genererPieces(s, d, ["06-PDT", "07-FIN"]);
      return;

    case "GENERER_PIECES_DE_FIN": {
      const [existante] = await s.bd.select().from(factureFormateur).where(eq(factureFormateur.dossier_id, d.id));
      if (!existante) {
        await s.bd.insert(factureFormateur).values({ id: nouvelId(), dossier_id: d.id, facture_formateur_numero: await numeroSuivant(s, d.of_id, "FF"), facture_formateur_date: dateIso(s.horloge.maintenant()) });
      }
      await genererPieces(s, d, ["08-FIN", "09-FIN"]);
      return;
    }

    case "GENERER_FACTURE_OF": {
      const [existante] = await s.bd.select().from(factureOf).where(eq(factureOf.dossier_id, d.id));
      if (!existante) {
        await s.bd.insert(factureOf).values({ id: nouvelId(), dossier_id: d.id, facture_of_numero: await numeroSuivant(s, d.of_id, "FA"), facture_of_date: dateIso(s.horloge.maintenant()) });
      }
      const facture = await genererPiece(s, d, "11-FIN");
      await s.bd.update(pieceDossier).set({ transmise_le: s.horloge.maintenant() }).where(eq(pieceDossier.id, facture.id));
      return;
    }

    case "ENVOYER_FORMULAIRES_DE_FIN":
      // Version 7 : chaque stagiaire reçoit son lien personnel (+ PDF avec QR code) pour répondre et signer en ligne.
      await envoyerFormulairesAutomatiques(s, d, ["acquis", "satisfaction_chaud"]);
      return;

    case "PLANIFIER_SATISFACTION_A_FROID":
      // Rien à écrire : la tâche quotidienne retrouve les dossiers terminés depuis 90 jours (voir taches.ts).
      return;

    case "ARCHIVER_EN_LECTURE_SEULE":
      await s.bd.update(dossierFormation).set({ archive_le: s.horloge.maintenant() }).where(eq(dossierFormation.id, d.id));
      return;
  }
}
