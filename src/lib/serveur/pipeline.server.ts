/**
 * Exécution des transitions du pipeline — portage de `src/serveur/services/pipeline.ts`.
 *
 * Le noyau DÉCIDE (`transiter`, dans `src/domaine/pipeline/transitions.ts` : rôle, étape, garde, motif) ; ce module
 * EXÉCUTE : il persiste le nouveau sous-statut, réalise les effets déclarés, et journalise. Il ne duplique aucune
 * règle du noyau. C'est le SEUL endroit du code qui écrit `sous_statut` (les autres lots l'appellent, ils n'écrivent
 * jamais le sous-statut eux-mêmes) :
 *
 *   executerTransition(bd, acteur, dossierId, "enregistrer_accord", …)     // « systeme » : pièce ACC déposée (lot 5)
 *   executerTransition(bd, "systeme", dossierId, "reevaluer_completude")   // pièce de fin validée (lot 5)
 *
 * Ordre : décision → contrôles propres à l'organisme → écriture conditionnée à l'ancien sous-statut (deux clics
 * simultanés ne déclenchent pas deux fois les effets) → journal → pièces attendues → effets.
 */
import { courriels } from "@/domaine/courriels/modeles";
import { formaterDate } from "@/domaine/dossier/formats";
import {
  PIECES_DE_DEPART,
  PIECES_DE_FIN,
  PIECES_DE_REALISATION,
  PIECES_ENVOYEES_A_L_ENTREPRISE,
  PIECES_TRANSMISES_EN_ANNEXE,
  colonnesDeTransition,
} from "@/domaine/pipeline/application";
import { libelleSousStatut } from "@/domaine/pipeline/statuts";
import {
  REGLES,
  transiter,
  type Acteur as ActeurPipeline,
  type Action,
  type Effet,
} from "@/domaine/pipeline/transitions";
import { champsOfManquants } from "@/domaine/referentiel/organisme";
import { definitionPiece } from "@/domaine/referentiel/pieces";
import type { Acteur } from "./acteur.server";
import type { BdService } from "./bd.server";
import { urlApplication } from "./config.server";
import { envoyerCourrier } from "./courrier.server";
import {
  accederAuDossier,
  contextePipeline,
  dossierPourSysteme,
  manquesDeSoumission,
  numeroSuivant,
  piecesDuDossier,
  stagiairesDuDossier,
  synchroniserPieces,
  type LigneDossier,
} from "./dossier.server";
import { conflit, interdit, invalide, leverSiErreurBd } from "./erreurs.server";
import { journaliser } from "./journal.server";
import { preparerLienApprenant } from "./invitations.server";
import { portsLots } from "./ports-lots.server";

export interface OptionsTransition {
  motif?: string;
  /** Pour les tests. */
  maintenant?: Date;
}

export async function executerTransition(
  bd: BdService,
  acteur: Acteur | "systeme",
  dossierId: string,
  action: Action,
  options: OptionsTransition = {},
): Promise<LigneDossier> {
  const d =
    acteur === "systeme"
      ? await dossierPourSysteme(bd, dossierId)
      : await accederAuDossier(bd, acteur, dossierId);
  const role: ActeurPipeline = acteur === "systeme" ? "systeme" : acteur.role;

  // 1. Le noyau décide.
  const resultat = transiter(await contextePipeline(bd, d), action, role, { motif: options.motif });
  if (!resultat.ok)
    throw resultat.code === "role" ? interdit(resultat.motif) : invalide(resultat.motif);

  // 2. Contrôles qui dépendent de données hors du noyau (saisie du dossier, configuration de l'organisme).
  if (action === "soumettre_validation") {
    const manques = await manquesDeSoumission(bd, d);
    if (manques.length > 0)
      throw invalide("Le dossier est incomplet : il ne peut pas encore être soumis.", { manques });
  }
  if (action === "valider_dossier") {
    const { data: of, error } = await bd
      .from("organisme_formation")
      .select("*")
      .eq("id", d.of_id)
      .maybeSingle();
    leverSiErreurBd(error, "lecture de l'organisme");
    const manques = champsOfManquants((of ?? {}) as Record<string, unknown>);
    if (manques.length > 0)
      throw invalide(
        "La configuration de l'organisme est incomplète : aucune pièce ne peut être émise.",
        { manques },
      );
  }

  // 3. On écrit le nouveau sous-statut — et seulement lui, ici — en exigeant que l'ancien soit encore le bon.
  const maintenant = (options.maintenant ?? new Date()).toISOString();
  const { data: modifiees, error: errMaj } = await bd
    .from("dossier_formation")
    .update(colonnesDeTransition(action, resultat.vers, maintenant, options.motif))
    .eq("id", d.id)
    .eq("sous_statut", d.sous_statut)
    .select("id");
  leverSiErreurBd(errMaj, "écriture du sous-statut");
  if (!modifiees || modifiees.length === 0)
    throw conflit("Le dossier vient de changer d'état. Rechargez la page.");
  const apres: LigneDossier = {
    ...d,
    sous_statut: resultat.vers,
    termine_le: action === "terminer_formation" ? maintenant : d.termine_le,
  };

  if (resultat.vers !== resultat.de) {
    await journaliser(bd, {
      of_id: d.of_id,
      dossier_id: d.id,
      acteur: acteur === "systeme" ? "systeme" : acteur,
      type: "transition",
      libelle: `${REGLES[action].libelle} — ${libelleSousStatut(resultat.de)} → ${libelleSousStatut(resultat.vers)}`,
      detail: { action, de: resultat.de, vers: resultat.vers, motif: options.motif ?? null },
    });
  }

  // 4. Pièces attendues au nouveau sous-statut, puis effets.
  await synchroniserPieces(bd, apres);
  const par = acteur === "systeme" ? "La plateforme" : acteur.nom;
  for (const effet of resultat.effets)
    await executerEffet(bd, apres, effet, { motif: options.motif, par, acteur, maintenant });

  const { data: final, error: errFinal } = await bd
    .from("dossier_formation")
    .select("*")
    .eq("id", d.id)
    .maybeSingle();
  leverSiErreurBd(errFinal, "relecture du dossier");
  return (final ?? apres) as LigneDossier;
}

const nomDeFichier = (chemin: string) => chemin.split("/").pop() ?? chemin;

async function executerEffet(
  bd: BdService,
  d: LigneDossier,
  effet: Effet,
  options: { motif?: string; par: string; acteur: Acteur | "systeme"; maintenant: string },
): Promise<void> {
  const [{ data: of }, { data: form }] = await Promise.all([
    bd.from("organisme_formation").select("of_nom").eq("id", d.of_id).maybeSingle(),
    bd.from("formateur").select("*").eq("id", d.formateur_id).maybeSingle(),
  ]);
  const ofNom = (of as { of_nom?: string } | null)?.of_nom ?? "";
  const f = (form ?? {}) as Record<string, string>;
  const base = await urlApplication();
  const lienDossier = `${base}/dossiers/${d.id}`;
  const ports = portsLots();
  const courrier = (type: string, destinataire: string, c: { sujet: string; corps_html: string }) =>
    envoyerCourrier(bd, {
      of_id: d.of_id,
      dossier_id: d.id,
      type,
      destinataire,
      ...c,
    });
  const marquerTransmise = async (ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await bd
      .from("piece_dossier")
      .update({ transmise_le: options.maintenant })
      .in("id", ids);
    leverSiErreurBd(error, "marquage des pièces transmises");
  };

  switch (effet) {
    case "NOTIFIER_ADMIN_DEMANDE_VALIDATION": {
      const { data: admins, error } = await bd
        .from("utilisateur")
        .select("email")
        .eq("of_id", d.of_id)
        .eq("role", "admin")
        .eq("actif", true)
        .is("supprime_le", null);
      leverSiErreurBd(error, "lecture des administrateurs");
      for (const admin of (admins ?? []) as Array<{ email: string }>)
        await courrier(
          "demande_validation",
          admin.email,
          courriels.demandeValidation({
            of_nom: ofNom,
            formateur: `${f["formateur_prenom"] ?? ""} ${f["formateur_nom"] ?? ""}`.trim(),
            reference: d.dossier_reference,
            formation: d.formation_titre,
            lien: lienDossier,
          }),
        );
      return;
    }

    case "NOTIFIER_FORMATEUR_RENVOI":
      await courrier(
        "renvoi_brouillon",
        f["formateur_email"] ?? "",
        courriels.renvoiEnBrouillon({
          of_nom: ofNom,
          prenom: f["formateur_prenom"] ?? "",
          reference: d.dossier_reference,
          motif: options.motif ?? "",
          lien: lienDossier,
        }),
      );
      return;

    case "NOTIFIER_DEPOT_DECLARE":
      await courrier(
        "depot_declare",
        f["formateur_email"] ?? "",
        courriels.depotDeclare({
          of_nom: ofNom,
          prenom: f["formateur_prenom"] ?? "",
          reference: d.dossier_reference,
          formation: d.formation_titre,
          par: options.par,
          lien: lienDossier,
        }),
      );
      return;

    case "GENERER_PIECES_DE_DEPART": {
      // F-ARCH-01/03 : toutes les pièces « de départ » de la nomenclature, dans « Pièces de départ ».
      const pieces = await ports.genererPieces(bd, d, PIECES_DE_DEPART);
      // Planning et programme sont transmis en annexe de la convention, sans statut : simple accusé de transmission.
      await marquerTransmise(
        pieces.filter((p) => PIECES_TRANSMISES_EN_ANNEXE.includes(p.code)).map((p) => p.id),
      );
      await journaliser(bd, {
        of_id: d.of_id,
        dossier_id: d.id,
        acteur: "systeme",
        type: "pieces_generees",
        libelle: `${pieces.length} pièces de départ générées et archivées`,
      });
      return;
    }

    case "EMAIL_ENTREPRISE_PIECES_FINANCEMENT": {
      // F-DOS-06 / RG-04 : e-mail automatique au responsable de l'entreprise, avec les pièces du financement.
      const { data: ent, error } = await bd
        .from("entreprise_cliente")
        .select("*")
        .eq("id", d.entreprise_id)
        .maybeSingle();
      leverSiErreurBd(error, "lecture de l'entreprise");
      if (!ent?.entreprise_representant_email) {
        await journaliser(bd, {
          of_id: d.of_id,
          dossier_id: d.id,
          acteur: "systeme",
          type: "courrier_non_envoye",
          libelle:
            "E-mail des pièces de financement non envoyé : l'entreprise n'a pas d'adresse e-mail.",
        });
        return;
      }
      const pieces = (await piecesDuDossier(bd, d.id)).filter(
        (p) => PIECES_ENVOYEES_A_L_ENTREPRISE.includes(p.code) && p.chemin_depart,
      );
      const stagiaires = (await stagiairesDuDossier(bd, d.id))
        .map((l) => `${l.st.stagiaire_prenom} ${l.st.stagiaire_nom}`)
        .join(", ");
      await envoyerCourrier(bd, {
        of_id: d.of_id,
        dossier_id: d.id,
        type: "pieces_financement",
        destinataire: ent.entreprise_representant_email,
        ...courriels.piecesFinancementEntreprise({
          of_nom: ofNom,
          representant:
            `${ent.entreprise_representant_civilite ?? ""} ${ent.entreprise_representant_nom ?? ""}`.trim(),
          formation: d.formation_titre,
          stagiaires,
          reference: d.dossier_reference,
          pieces: [...new Set(pieces.map((p) => definitionPiece(p.code).libelle))],
        }),
        pieces_jointes: pieces.map((p) => ({
          nom: nomDeFichier(p.chemin_depart!),
          chemin: p.chemin_depart!,
        })),
      });
      return;
    }

    case "GENERER_ET_ENVOYER_ODM": {
      // F-OF-02 / RG-06 : l'ODM part automatiquement dès que l'accord est enregistré.
      const [odm] = await ports.genererPieces(bd, d, ["04-AVT"]);
      if (odm) await marquerTransmise([odm.id]);
      await envoyerCourrier(bd, {
        of_id: d.of_id,
        dossier_id: d.id,
        type: "odm",
        destinataire: f["formateur_email"] ?? "",
        ...courriels.odmFormateur({
          of_nom: ofNom,
          prenom: f["formateur_prenom"] ?? "",
          reference: d.dossier_reference,
          formation: d.formation_titre,
          lien: lienDossier,
        }),
        pieces_jointes: odm?.chemin_depart
          ? [{ nom: nomDeFichier(odm.chemin_depart), chemin: odm.chemin_depart }]
          : [],
      });
      return;
    }

    case "OUVRIR_COFFRE_AUX_APPRENANTS": {
      // RG-08. L'accès réel est calculé à partir du sous-statut ; ce drapeau ne sert qu'à l'affichage.
      const { error } = await bd
        .from("dossier_formation")
        .update({ coffre_ouvert: true })
        .eq("id", d.id);
      leverSiErreurBd(error, "ouverture du coffre");
      await journaliser(bd, {
        of_id: d.of_id,
        dossier_id: d.id,
        acteur: "systeme",
        type: "coffre_ouvert",
        libelle: "Coffre-fort pédagogique ouvert aux apprenants",
      });
      return;
    }

    case "GENERER_CONVOCATIONS":
      await ports.genererPieces(bd, d, ["05-AVT"]);
      return;

    case "EMAIL_APPRENANTS_ELEMENTS_PEDAGOGIQUES": {
      const convocations = (await piecesDuDossier(bd, d.id)).filter((p) => p.code === "05-AVT");
      for (const { st } of await stagiairesDuDossier(bd, d.id)) {
        if (!st.stagiaire_email) continue;
        const { lien } = await preparerLienApprenant(bd, d, st, { sansEmail: true });
        const convocation = convocations.find((p) => p.stagiaire_id === st.id);
        await envoyerCourrier(bd, {
          of_id: d.of_id,
          dossier_id: d.id,
          type: "elements_pedagogiques",
          destinataire: st.stagiaire_email,
          ...courriels.elementsPedagogiques({
            of_nom: ofNom,
            prenom: st.stagiaire_prenom,
            formation: d.formation_titre,
            date_debut: formaterDate(d.formation_date_debut),
            lien,
          }),
          pieces_jointes: convocation?.chemin_depart
            ? [{ nom: nomDeFichier(convocation.chemin_depart), chemin: convocation.chemin_depart }]
            : [],
        });
      }
      return;
    }

    case "GENERER_PIECES_DE_REALISATION":
      await ports.genererPieces(bd, d, PIECES_DE_REALISATION);
      return;

    case "GENERER_PIECES_DE_FIN": {
      await creerFactureSiAbsente(bd, d, "facture_formateur", "FF", options.maintenant);
      await ports.genererPieces(bd, d, PIECES_DE_FIN);
      return;
    }

    case "GENERER_FACTURE_OF": {
      await creerFactureSiAbsente(bd, d, "facture_of", "FA", options.maintenant);
      const [facture] = await ports.genererPieces(bd, d, ["11-FIN"]);
      if (facture) await marquerTransmise([facture.id]);
      return;
    }

    case "ENVOYER_FORMULAIRES_DE_FIN":
      // Version 7 : chaque stagiaire reçoit son lien personnel (+ PDF avec QR code) pour répondre et signer en ligne.
      await ports.envoyerFormulaires(bd, d, ["acquis", "satisfaction_chaud"]);
      return;

    case "PLANIFIER_SATISFACTION_A_FROID":
      // Rien à écrire : la tâche quotidienne retrouve les dossiers terminés depuis 90 jours (lot 8).
      return;

    case "ARCHIVER_EN_LECTURE_SEULE": {
      const { error } = await bd
        .from("dossier_formation")
        .update({ archive_le: options.maintenant })
        .eq("id", d.id);
      leverSiErreurBd(error, "archivage du dossier");
      return;
    }
  }
}

/** Facture de l'OF (`FA-AAAA-NNNN`) ou du formateur (`FF-AAAA-NNNN`) : créée une seule fois par dossier. */
async function creerFactureSiAbsente(
  bd: BdService,
  d: LigneDossier,
  table: "facture_of" | "facture_formateur",
  prefixe: "FA" | "FF",
  maintenant: string,
): Promise<void> {
  const { data: existante, error } = await bd
    .from(table)
    .select("id")
    .eq("dossier_id", d.id)
    .maybeSingle();
  leverSiErreurBd(error, "lecture de la facture");
  if (existante) return;
  const numero = await numeroSuivant(bd, d.of_id, prefixe, new Date(maintenant));
  const date = maintenant.slice(0, 10);
  const { error: errInsertion } =
    table === "facture_of"
      ? await bd
          .from(table)
          .insert({ dossier_id: d.id, facture_of_numero: numero, facture_of_date: date })
      : await bd.from(table).insert({
          dossier_id: d.id,
          facture_formateur_numero: numero,
          facture_formateur_date: date,
        });
  // Doublon : une autre exécution vient de créer la facture, c'est tout ce qu'on voulait.
  if (errInsertion && errInsertion.code !== "23505")
    leverSiErreurBd(errInsertion, "création de la facture");
}
