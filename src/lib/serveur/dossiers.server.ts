/**
 * Opérations serveur sur les dossiers — portage de `creerDossier`, `definirStagiaires`, `inviter`,
 * `relancerApprenant` et `recreerDepuis` de `src/serveur/services/dossiers.ts`, plus le calcul des finances
 * (`calculer` du noyau) que le formateur ne peut pas faire côté client : les taux de l'organisme (commission, TVA)
 * restent réservés à l'administrateur par la RLS.
 *
 * Les règles sont celles du noyau (`src/domaine/dossier/*`, `pieces/statut`) : ce module lit, appelle, écrit.
 * Les fonctions serveur (`src/lib/dossiers.functions.ts`) ne sont que des enveloppes : acteur reconstruit, garde de rôle.
 */
import { courriels } from "@/domaine/courriels/modeles";
import type { AgregatDossier } from "@/domaine/dossier/agregat";
import { calculer } from "@/domaine/dossier/calculs";
import {
  choisirModele,
  reprisesDeLAncien,
  valeursInitialesDossier,
  type EntrepriseCreation,
  type FormationCatalogue,
} from "@/domaine/dossier/creation";
import { MESSAGE_STAGIAIRES_FIGES, stagiairesModifiables } from "@/domaine/dossier/droits";
import { documentsEnAttenteDe } from "@/domaine/dossier/lecture";
import { validerCreationDossier, validerListeStagiaires } from "@/domaine/dossier/saisie";
import type { Acteur, ActeurFormateurValide } from "./acteur.server";
import type { BdService } from "./bd.server";
import { urlApplication } from "./config.server";
import { envoyerCourrier } from "./courrier.server";
import {
  accederAuDossier,
  numeroSuivant,
  piecesDuDossier,
  stagiairesDuDossier,
  synchroniserPieces,
} from "./dossier.server";
import { conflit, introuvable, invalide, leverSiErreurBd } from "./erreurs.server";
import { preparerLienApprenant } from "./invitations.server";
import { journaliser } from "./journal.server";
import { portsLots } from "./ports-lots.server";

// ——— Création (route 88) ———

async function lireDuFormateur<T>(
  bd: BdService,
  table: string,
  id: string,
  acteur: ActeurFormateurValide,
  quoi: string,
): Promise<T> {
  const { data, error } = await bd
    .from(table)
    .select("*")
    .eq("id", id)
    .eq("formateur_id", acteur.formateur_id)
    .eq("of_id", acteur.of_id)
    .maybeSingle();
  leverSiErreurBd(error, `lecture : ${quoi}`);
  if (!data) throw introuvable(quoi);
  return data as T;
}

async function modelePour(
  bd: BdService,
  formateurId: string,
  formationId: string,
  type: "positionnement" | "acquis",
): Promise<unknown> {
  const { data, error } = await bd
    .from("modele_outil")
    .select("formation_id, contenu")
    .eq("formateur_id", formateurId)
    .eq("type", type)
    .is("archive_le", null)
    .order("cree_le", { ascending: false });
  leverSiErreurBd(error, "lecture des modèles d'outils");
  const choisi = choisirModele(
    (data ?? []) as Array<{ formation_id: string | null; contenu: unknown }>,
    formationId,
  );
  return choisi?.contenu ?? null;
}

/** Identité du dossier créé : la fonction serveur ne renvoie que cela (la ligne complète se relit sous RLS). */
export interface DossierCree {
  id: string;
  dossier_reference: string;
}

export async function creerLeDossier(
  bd: BdService,
  acteur: ActeurFormateurValide,
  brut: unknown,
): Promise<DossierCree> {
  const v = validerCreationDossier(brut);
  if (!v.ok) throw invalide(v.message, { champs: v.champs });
  const c = v.valeurs;

  // Chaque lecture vérifie au passage que la fiche appartient bien à CE formateur (cloisonnement).
  const entreprise = await lireDuFormateur<EntrepriseCreation>(
    bd,
    "entreprise_cliente",
    c.entreprise_id,
    acteur,
    "Entreprise",
  );
  const formation = await lireDuFormateur<FormationCatalogue>(
    bd,
    "formation",
    c.formation_id,
    acteur,
    "Formation",
  );
  const stagiaires = [];
  for (const id of c.stagiaire_ids)
    stagiaires.push(
      await lireDuFormateur<{ id: string; stagiaire_poste: string }>(
        bd,
        "stagiaire",
        id,
        acteur,
        "Fiche apprenant",
      ),
    );

  const id = crypto.randomUUID();
  const { error } = await bd.from("dossier_formation").insert({
    id,
    of_id: acteur.of_id,
    dossier_reference: await numeroSuivant(bd, acteur.of_id, "ADF"),
    formateur_id: acteur.formateur_id,
    ...valeursInitialesDossier({
      formation,
      entreprise,
      modalite: c.formation_modalite,
      financement: c.mode_financement,
    }),
    questionnaire_positionnement: await modelePour(
      bd,
      acteur.formateur_id,
      formation.id,
      "positionnement",
    ),
    questionnaire_acquis: await modelePour(bd, acteur.formateur_id, formation.id, "acquis"),
  });
  leverSiErreurBd(error, "création du dossier");

  const { error: errLiens } = await bd.from("stagiaire_dossier").insert(
    stagiaires.map((st, i) => ({
      dossier_id: id,
      stagiaire_id: st.id,
      poste_occupe: st.stagiaire_poste,
      rang: i + 1,
    })),
  );
  if (errLiens) {
    // Pas de dossier sans apprenants : on retire ce qu'on vient de créer (les lignes liées partent en cascade).
    await bd.from("dossier_formation").delete().eq("id", id);
    leverSiErreurBd(errLiens, "inscription des apprenants au dossier");
  }

  const d = await accederAuDossier(bd, acteur, id);
  await synchroniserPieces(bd, d);
  await journaliser(bd, {
    of_id: acteur.of_id,
    dossier_id: id,
    acteur,
    type: "dossier_cree",
    libelle: `Dossier ${d.dossier_reference} créé`,
  });

  // Le dossier existe : un incident sur ces deux mécanismes (autres lots) ne doit pas le faire passer pour un échec.
  const ports = portsLots();
  try {
    // « Modification 1 » : un positionnement déjà signé sur ce parcours est repris (recueil + test).
    await ports.reprendrePositionnements(bd, acteur, d);
    // Version 7 : ce qui n'est pas repris part aussitôt à l'apprenant en page interactive.
    await ports.envoyerFormulaires(bd, d, ["recueil", "positionnement"]);
  } catch (e) {
    console.error("[dossiers] reprise des positionnements / envoi des formulaires", e);
  }
  return { id, dossier_reference: d.dossier_reference };
}

// ——— Apprenants du dossier (route 93) ———

export async function definirStagiairesDuDossier(
  bd: BdService,
  acteur: ActeurFormateurValide,
  dossierId: string,
  brut: unknown,
): Promise<{ dossier_id: string }> {
  const d = await accederAuDossier(bd, acteur, dossierId);
  if (!stagiairesModifiables(acteur.role, d.sous_statut)) throw conflit(MESSAGE_STAGIAIRES_FIGES);
  const v = validerListeStagiaires(brut);
  if (!v.ok) throw invalide(v.message, { champs: v.champs });
  const ids = v.valeurs;

  const fiches = [];
  for (const id of ids)
    fiches.push(
      await lireDuFormateur<{ id: string; stagiaire_poste: string }>(
        bd,
        "stagiaire",
        id,
        acteur,
        "Fiche apprenant",
      ),
    );
  const actuels = await stagiairesDuDossier(bd, d.id);
  const retires = actuels.filter((l) => !ids.includes(l.st.id)).map((l) => l.st.id);
  if (retires.length > 0) {
    const { error } = await bd
      .from("piece_dossier")
      .delete()
      .eq("dossier_id", d.id)
      .in("stagiaire_id", retires);
    leverSiErreurBd(error, "retrait des pièces des apprenants retirés");
    const { error: errLiens } = await bd
      .from("stagiaire_dossier")
      .delete()
      .eq("dossier_id", d.id)
      .in("stagiaire_id", retires);
    leverSiErreurBd(errLiens, "retrait des apprenants");
  }
  for (const [i, st] of fiches.entries()) {
    const rang = i + 1;
    if (actuels.some((l) => l.st.id === st.id)) {
      const { error } = await bd
        .from("stagiaire_dossier")
        .update({ rang })
        .eq("dossier_id", d.id)
        .eq("stagiaire_id", st.id);
      leverSiErreurBd(error, "classement des apprenants");
    } else {
      const { error } = await bd.from("stagiaire_dossier").insert({
        dossier_id: d.id,
        stagiaire_id: st.id,
        poste_occupe: st.stagiaire_poste,
        rang,
      });
      leverSiErreurBd(error, "ajout d'un apprenant");
    }
  }
  await synchroniserPieces(bd, d);
  return { dossier_id: d.id };
}

// ——— Invitation et relance de l'apprenant (routes 96 et 97) ———

export async function inviterLApprenant(
  bd: BdService,
  acteur: Acteur,
  dossierId: string,
  stagiaireId: string,
): Promise<{ lien: string }> {
  const d = await accederAuDossier(bd, acteur, dossierId);
  const inscrit = (await stagiairesDuDossier(bd, d.id)).find((l) => l.st.id === stagiaireId);
  if (!inscrit) throw invalide("Ce stagiaire n'est pas inscrit à ce dossier.");
  const { lien } = await preparerLienApprenant(bd, d, inscrit.st);
  await journaliser(bd, {
    of_id: d.of_id,
    dossier_id: d.id,
    acteur,
    type: "invitation",
    libelle: "Invitation envoyée à l'apprenant",
    detail: { stagiaire_id: stagiaireId },
  });
  return { lien };
}

export async function relancerLApprenant(
  bd: BdService,
  acteur: Acteur,
  dossierId: string,
  stagiaireId: string,
): Promise<{ pieces: string[] }> {
  const d = await accederAuDossier(bd, acteur, dossierId);
  const inscrit = (await stagiairesDuDossier(bd, d.id)).find((l) => l.st.id === stagiaireId);
  if (!inscrit) throw invalide("Ce stagiaire n'est pas inscrit à ce dossier.");
  if (!inscrit.st.stagiaire_email)
    throw invalide("La fiche de l'apprenant ne comporte pas d'adresse e-mail.");

  const enAttente = documentsEnAttenteDe(await piecesDuDossier(bd, d.id), stagiaireId);
  if (enAttente.length === 0)
    throw conflit("Cet apprenant n'a aucun document en attente : la relance est inutile.");

  const { data: of } = await bd
    .from("organisme_formation")
    .select("of_nom")
    .eq("id", d.of_id)
    .maybeSingle();
  // Compte existant : lien vers la connexion ; sinon une invitation d'inscription, sans second e-mail.
  const { lien } = await preparerLienApprenant(bd, d, inscrit.st, { sansEmail: true });
  await envoyerCourrier(bd, {
    of_id: d.of_id,
    dossier_id: d.id,
    type: "relance_apprenant",
    destinataire: inscrit.st.stagiaire_email,
    ...courriels.relanceApprenant({
      of_nom: (of as { of_nom?: string } | null)?.of_nom ?? "",
      prenom: inscrit.st.stagiaire_prenom,
      formation: d.formation_titre,
      pieces: enAttente,
      lien,
    }),
  });
  await journaliser(bd, {
    of_id: d.of_id,
    dossier_id: d.id,
    acteur,
    type: "relance",
    libelle: `Relance envoyée à ${inscrit.st.stagiaire_prenom} ${inscrit.st.stagiaire_nom}`,
    detail: { pieces: enAttente },
  });
  return { pieces: enAttente };
}

// ——— Recréation après refus (route 98) ———

/** F-DOS-07 / RG-07 : repartir d'un dossier refusé pour en créer un NOUVEAU, sans lien de contrainte avec l'ancien. */
export async function recreerDepuisLeDossier(
  bd: BdService,
  acteur: ActeurFormateurValide,
  dossierId: string,
): Promise<DossierCree> {
  const source = await accederAuDossier(bd, acteur, dossierId);
  if (!source.formation_id)
    throw conflit("La formation d'origine n'existe plus dans votre catalogue.");
  const liens = await stagiairesDuDossier(bd, source.id);
  const nouveau = await creerLeDossier(bd, acteur, {
    stagiaire_ids: liens.map((l) => l.st.id),
    entreprise_id: source.entreprise_id,
    formation_id: source.formation_id,
    formation_modalite: source.formation_modalite,
    mode_financement: source.mode_financement,
  });
  const { error } = await bd
    .from("dossier_formation")
    .update(reprisesDeLAncien(source))
    .eq("id", nouveau.id);
  leverSiErreurBd(error, "reprise des informations du dossier refusé");
  return nouveau;
}

// ——— Finances (lecture, interne seulement) ———

/** `calculer()` du noyau sur le dossier : prix, commission, TVA, net formateur. Admin et formateur du dossier. */
export async function financesDuDossier(bd: BdService, acteur: Acteur, dossierId: string) {
  const d = await accederAuDossier(bd, acteur, dossierId);
  const [{ data: of, error: errOf }, liens, { data: facture, error: errFacture }] =
    await Promise.all([
      bd
        .from("organisme_formation")
        .select("portage_commission_pourcentage, tva_pourcentage, delai_paiement_jours")
        .eq("id", d.of_id)
        .maybeSingle(),
      stagiairesDuDossier(bd, d.id),
      bd.from("facture_of").select("facture_of_acompte").eq("dossier_id", d.id).maybeSingle(),
    ]);
  leverSiErreurBd(errOf, "lecture de l'organisme");
  leverSiErreurBd(errFacture, "lecture de la facture");
  if (!of) throw introuvable("Organisme");
  // `calculer` ne lit que ces champs de l'agrégat : on ne charge pas le reste.
  return calculer({
    organisme: of,
    formation: d,
    stagiaires: liens.map((l) => l.st),
    facture_of: facture ?? null,
  } as unknown as AgregatDossier);
}
