/**
 * Envoi des formulaires de l'apprenant (page interactive par lien personnel) — « Edge Function `formulaires-envoyer` »
 * de la carte des routes. Port de la partie « envoi » de `src/serveur/services/formulaires-apprenant.ts`.
 *
 * Cinq formulaires : recueil (00-AVT), positionnement (01-AVT), acquis (07-FIN), satisfaction à chaud (08-FIN) et à froid
 * (12-APR). ENVOI automatique au bon moment du dossier (création, fin de formation, J+90) et « Envoyer / Renvoyer » à
 * tout moment par le formateur ou l'organisme. L'e-mail porte un lien personnel (45 jours) et un document d'invitation
 * (QR code) archivé dans « Pièces de départ ». Le jeton n'est JAMAIS stocké en clair : on garde `sha256(jeton)`.
 *
 * `envoyerFormulairesAutomatiques` est appelé par le pipeline (lot 4) à la création du dossier et à la fin de formation ;
 * `envoyerFormulairesProgrammes` par la tâche quotidienne (J+90 et relance à J+7).
 */
import { toString as qrVersSvg } from "qrcode/lib/browser";
import { cheminPiece, nomSur } from "@/domaine/archive/chemins";
import {
  CONFIG_EVALUATIONS,
  DELAI_FROID_JOURS,
  DELAI_RELANCE_JOURS,
  DUREE_LIEN_FORMULAIRE_MS,
  MOMENTS,
  questionnaireDe,
  questionnaireOuvert,
  type TypeFormulaire,
} from "@/domaine/formulaires/evaluations";
import { documentInvitationHtml, OPTIONS_QR } from "@/domaine/formulaires/invitation";
import { estTerminal } from "@/domaine/pipeline/statuts";
import { courriels } from "@/domaine/courriels/modeles";
import type { Acteur } from "./acteur.server";
import { ouvrirArchive } from "./archive.server";
import type { BdService } from "./bd.server";
import { urlApplication } from "./config.server";
import { envoyerCourrier } from "./courrier.server";
import { ErreurMetier, indisponible, interdit, invalide, leverSiErreurBd } from "./erreurs.server";
import { jetonAleatoire, sha256Hex } from "./hacheur.server";
import { journaliser } from "./journal.server";
import {
  accederAuDossier,
  donnees,
  dossierSysteme,
  lireOrganisme,
  stagiairesDuDossier,
  synchroniserPieces,
  trouverPiece,
  type LigneDossier,
} from "./pieces-donnees.server";
import { convertirEnPdf } from "./pieces-pdf.server";

export const dateFrLongue = (d: Date): string =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).format(d);

/** Adresse publique de l'application : sans elle, le lien de l'e-mail serait relatif, donc inutilisable. */
export async function baseLiens(): Promise<string> {
  const base = await urlApplication();
  if (!base)
    throw indisponible(
      "L'adresse publique de l'application n'est pas configurée (secret APP_URL) : impossible de fabriquer le lien du formulaire.",
    );
  return base;
}

export const lienFormulaire = (base: string, jeton: string) => `${base}/formulaire/${jeton}`;

export interface ResultatEnvoiFormulaire {
  id: string;
  lien: string;
  statut_envoi: "journalise" | "envoye" | "echec";
  erreur_envoi: string;
  invitation: string;
}

/**
 * Envoie (ou renvoie) un formulaire à un apprenant du dossier. Un nouveau lien remplace l'ancien.
 * `acteur` : le formateur ou l'organisme (bouton), ou « systeme » (envoi automatique).
 */
export async function envoyerFormulaire(
  bd: BdService,
  acteur: Acteur | "systeme",
  dossierId: string,
  stagiaireId: string,
  type: TypeFormulaire,
  options: { message?: string; relance?: boolean } = {},
): Promise<ResultatEnvoiFormulaire> {
  if (acteur !== "systeme" && acteur.role === "apprenant") throw interdit();
  const d =
    acteur === "systeme"
      ? await dossierSysteme(bd, dossierId)
      : await accederAuDossier(bd, acteur, dossierId);
  const config = CONFIG_EVALUATIONS[type];
  if (estTerminal(d.sous_statut)) throw new ErreurMetier("conflit", "Ce dossier est archivé.");
  if (!questionnaireOuvert(d.sous_statut, type))
    throw new ErreurMetier(
      "conflit",
      `« ${config.libelle} » n'est pas encore ouvert à cette étape du dossier (il s'ouvre ${MOMENTS[type]}).`,
    );
  const st = (await stagiairesDuDossier(bd, d.id)).find((l) => l.st.id === stagiaireId)?.st;
  if (!st) throw invalide("Ce stagiaire n'est pas inscrit à ce dossier.");
  if (!st.stagiaire_email)
    throw invalide(
      `La fiche de ${st.stagiaire_prenom} ${st.stagiaire_nom} n'a pas d'adresse e-mail : ajoutez-la pour lui envoyer son formulaire.`,
    );
  if ((type === "positionnement" || type === "acquis") && !questionnaireDe(d, type))
    throw new ErreurMetier(
      "conflit",
      `Aucun ${config.libelle.toLowerCase()} n'est rattaché à ce dossier : générez-le avec l'IA depuis la fiche formation, puis recréez le dossier.`,
    );
  await synchroniserPieces(bd, d);
  const piece = await trouverPiece(bd, d.id, config.code, st.id);
  if (piece?.statut === "valide")
    throw new ErreurMetier(
      "conflit",
      `« ${config.libelle} » de ${st.stagiaire_prenom} ${st.stagiaire_nom} est déjà validé.`,
    );

  const base = await baseLiens();
  const maintenant = new Date();
  const jeton = jetonAleatoire();
  const jeton_hash = await sha256Hex(jeton);
  const expire = new Date(maintenant.getTime() + DUREE_LIEN_FORMULAIRE_MS);
  const existant = donnees<{
    id: string;
    statut: string;
    brouillon: unknown;
    envois: number;
  } | null>(
    await bd
      .from("formulaire_apprenant")
      .select("id, statut, brouillon, envois")
      .eq("dossier_id", d.id)
      .eq("stagiaire_id", st.id)
      .eq("type", type)
      .maybeSingle(),
    "lecture du formulaire",
  );
  let id: string;
  if (existant) {
    id = existant.id;
    const { error } = await bd
      .from("formulaire_apprenant")
      .update({
        jeton_hash,
        statut:
          existant.statut === "complet" ? "complet" : existant.brouillon ? "en_cours" : "envoye",
        envois: existant.envois + 1,
        envoye_le: maintenant.toISOString(),
        expire_le: expire.toISOString(),
      })
      .eq("id", id);
    leverSiErreurBd(error, "renouvellement du lien");
  } else {
    const { data, error } = await bd
      .from("formulaire_apprenant")
      .insert({
        of_id: d.of_id,
        dossier_id: d.id,
        stagiaire_id: st.id,
        type,
        jeton_hash,
        envois: 1,
        envoye_le: maintenant.toISOString(),
        expire_le: expire.toISOString(),
      })
      .select("id")
      .single();
    leverSiErreurBd(error, "création du formulaire");
    id = (data as { id: string }).id;
  }

  const of = await lireOrganisme(bd, d.of_id);
  const form = donnees<{ formateur_prenom: string; formateur_nom: string } | null>(
    await bd
      .from("formateur")
      .select("formateur_prenom, formateur_nom")
      .eq("id", d.formateur_id)
      .maybeSingle(),
    "lecture du formateur",
  );
  const nomFormateur = `${form?.formateur_prenom ?? ""} ${form?.formateur_nom ?? ""}`.trim();
  const lien = lienFormulaire(base, jeton);
  const invitation = documentInvitationHtml(
    {
      of_nom: of.of_nom,
      couleur: of.couleur,
      apprenant: `${st.stagiaire_prenom} ${st.stagiaire_nom}`,
      formation: d.formation_titre,
      libelle: config.libelle,
      lien,
      expire: dateFrLongue(expire),
      formateur: nomFormateur,
    },
    await qrVersSvg(lien, { ...OPTIONS_QR, color: { ...OPTIONS_QR.color } }),
  );
  const pdf = await convertirEnPdf(invitation);
  const nomDoc = `${nomSur(`Invitation ${config.libelle} - ${st.stagiaire_prenom} ${st.stagiaire_nom}`)}.${pdf ? "pdf" : "html"}`;
  const chemin = await ouvrirArchive(bd, { ofId: d.of_id }).ecrire(
    cheminPiece(d.of_id, d.dossier_reference, "Pièces de départ", nomDoc),
    pdf ?? invitation,
    pdf ? "application/pdf" : "text/html; charset=utf-8",
  );
  const { error: errChemin } = await bd
    .from("formulaire_apprenant")
    .update({ chemin_invitation: chemin })
    .eq("id", id);
  leverSiErreurBd(errChemin, "enregistrement du document d'invitation");

  const c = courriels.formulaireApprenant({
    of_nom: of.of_nom,
    prenom: st.stagiaire_prenom,
    formateur: nomFormateur,
    formation: d.formation_titre,
    libelle: config.libelle,
    message: options.message ?? "",
    lien,
    expire: dateFrLongue(expire),
    relance: options.relance === true,
  });
  const envoi = await envoyerCourrier(bd, {
    of_id: d.of_id,
    dossier_id: d.id,
    type: `formulaire_${type}`,
    destinataire: st.stagiaire_email,
    ...c,
    pieces_jointes: [{ nom: nomDoc, chemin }],
  });
  await journaliser(bd, {
    of_id: d.of_id,
    dossier_id: d.id,
    acteur,
    type: "formulaire_envoye",
    libelle: `${config.libelle} ${options.relance ? "relancé" : "envoyé"} à ${st.stagiaire_prenom} ${st.stagiaire_nom}${envoi.statut === "echec" ? " (échec d'envoi de l'e-mail)" : ""}`,
    detail: { type, statut_envoi: envoi.statut },
  });
  return { id, lien, statut_envoi: envoi.statut, erreur_envoi: envoi.erreur, invitation: chemin };
}

/**
 * Envoi automatique des formulaires ouverts à cette étape, à tous les stagiaires qui ne les ont jamais reçus et dont la
 * pièce n'est pas validée. Un échec pour un stagiaire n'empêche pas les autres.
 */
export async function envoyerFormulairesAutomatiques(
  bd: BdService,
  d: LigneDossier,
  types: TypeFormulaire[],
): Promise<number> {
  let envoyes = 0;
  const liens = await stagiairesDuDossier(bd, d.id);
  const existants =
    donnees<Array<{ stagiaire_id: string; type: string }>>(
      await bd.from("formulaire_apprenant").select("stagiaire_id, type").eq("dossier_id", d.id),
      "lecture des formulaires",
    ) ?? [];
  const pieces =
    donnees<Array<{ code: string; stagiaire_id: string | null; statut: string }>>(
      await bd.from("piece_dossier").select("code, stagiaire_id, statut").eq("dossier_id", d.id),
      "lecture des pièces",
    ) ?? [];
  for (const type of types) {
    if (!questionnaireOuvert(d.sous_statut, type)) continue;
    for (const { st } of liens) {
      if (!st.stagiaire_email) continue;
      if (existants.some((f) => f.stagiaire_id === st.id && f.type === type)) continue;
      if (
        pieces.some(
          (p) =>
            p.code === CONFIG_EVALUATIONS[type].code &&
            p.stagiaire_id === st.id &&
            p.statut === "valide",
        )
      )
        continue;
      try {
        await envoyerFormulaire(bd, "systeme", d.id, st.id, type);
        envoyes++;
      } catch (err) {
        await journaliser(bd, {
          of_id: d.of_id,
          dossier_id: d.id,
          acteur: "systeme",
          type: "formulaire_non_envoye",
          libelle: `${CONFIG_EVALUATIONS[type].libelle} non envoyé à ${st.stagiaire_prenom} ${st.stagiaire_nom} : ${err instanceof ErreurMetier ? err.message : "erreur"}`,
        });
      }
    }
  }
  return envoyes;
}

/**
 * Tâche quotidienne : satisfaction à froid à J+90 après la fin de la formation, et UNE relance à J+7 des formulaires
 * restés sans réponse. Idempotente (une ligne par formulaire, compteur d'envois).
 */
export async function envoyerFormulairesProgrammes(
  bd: BdService,
  maintenant: Date = new Date(),
): Promise<number> {
  let envois = 0;
  const seuilFroid = new Date(maintenant.getTime() - DELAI_FROID_JOURS * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const termines =
    donnees<LigneDossier[]>(
      await bd
        .from("dossier_formation")
        .select("*")
        .in("sous_statut", ["fin_dossier_complet", "demande_paiement", "paiement_receptionne"]),
      "lecture des dossiers terminés",
    ) ?? [];
  for (const d of termines.filter(
    (x) => x.formation_date_fin && x.formation_date_fin <= seuilFroid,
  ))
    envois += await envoyerFormulairesAutomatiques(bd, d, ["satisfaction_froid"]);

  const seuilRelance = new Date(maintenant.getTime() - DELAI_RELANCE_JOURS * 24 * 3600 * 1000);
  const enAttente =
    donnees<
      Array<{
        dossier_id: string;
        stagiaire_id: string;
        type: string;
        envoye_le: string | null;
        expire_le: string;
      }>
    >(
      await bd
        .from("formulaire_apprenant")
        .select("dossier_id, stagiaire_id, type, envoye_le, expire_le")
        .in("statut", ["envoye", "en_cours"])
        .eq("envois", 1),
      "lecture des formulaires en attente",
    ) ?? [];
  for (const f of enAttente.filter(
    (x) =>
      x.envoye_le && new Date(x.envoye_le) <= seuilRelance && new Date(x.expire_le) > maintenant,
  )) {
    try {
      await envoyerFormulaire(
        bd,
        "systeme",
        f.dossier_id,
        f.stagiaire_id,
        f.type as TypeFormulaire,
        {
          relance: true,
        },
      );
      envois++;
    } catch {
      // Pièce validée entre-temps, dossier archivé… : rien à relancer.
    }
  }
  return envois;
}
