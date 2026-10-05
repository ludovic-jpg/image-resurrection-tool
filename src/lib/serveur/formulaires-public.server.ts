/**
 * Page publique d'un formulaire apprenant, par lien personnel — « Edge Function `public-formulaire` » (routes 14 à 17).
 *
 * AUCUN JWT : la personne qui ouvre le lien n'a pas de compte. L'authentification est le JETON : on ne stocke que
 * `sha256(jeton)` (`formulaire_apprenant.jeton_hash`) et on retrouve la ligne par ce hachage. Un jeton inconnu, remplacé
 * par un renvoi, ou expiré donne « introuvable » (jamais de détail sur l'existence d'un dossier). L'IP de l'appelant est
 * consignée dans la preuve de signature et le journal.
 *
 * La signature d'un formulaire public ne crée JAMAIS de compte (CARTE_DES_ROUTES, route 16) : si l'apprenant n'en a pas,
 * on insère au besoin une ligne `invitation` (rôle apprenant, fiche, e-mail de la fiche) et on envoie le lien ; le compte
 * naîtra au `signUp` de l'apprenant. Ce qui quitte le serveur vers l'apprenant ne contient ni corrigé de QCM, ni jeton,
 * ni donnée financière, ni coordonnées du formateur.
 *
 * Port de la partie « page publique » de `src/serveur/services/formulaires-apprenant.ts`.
 */
import { z } from "zod";
import { cheminPiece } from "@/domaine/archive/chemins";
import { courriels } from "@/domaine/courriels/modeles";
import { typeMimeDe } from "@/domaine/fichiers/regles";
import {
  CONFIG_EVALUATIONS,
  controlerReponses,
  formulaireDe,
  questionnaireDe,
  questionnaireOuvert,
  statutPagePublique,
  type TypeFormulaire,
} from "@/domaine/formulaires/evaluations";
import { sansCorrige } from "@/domaine/formulaires/qcm";
import { nomFichierPiece } from "@/domaine/pieces/retours";
import { definitionPiece } from "@/domaine/referentiel/pieces";
import {
  certificatHtml,
  validerDemandeSignature,
  type PreuveSignature,
} from "@/domaine/signature/preuve";
import { ouvrirArchive } from "./archive.server";
import type { BdService } from "./bd.server";
import { envoyerCourrier } from "./courrier.server";
import { ErreurMetier, invalide, leverSiErreurBd } from "./erreurs.server";
import { jetonAleatoire, sha256Hex } from "./hacheur.server";
import { journaliser } from "./journal.server";
import { baseLiens, lienFormulaire } from "./formulaires.server";
import {
  archiverRendu,
  donnees,
  dossierSysteme,
  lireOrganisme,
  nomDuStagiaire,
  rendrePiece,
  trouverPiece,
  type LigneDossier,
  type LigneStagiaire,
} from "./pieces-donnees.server";
import {
  enregistrerReponses,
  enregistrerSignature,
  marquerValidee,
  type ActeurRetour,
} from "./pieces-retours.server";

const DUREE_INVITATION_MS = 14 * 24 * 3600 * 1000;

interface LigneFormulaire {
  id: string;
  of_id: string;
  dossier_id: string;
  stagiaire_id: string;
  type: TypeFormulaire;
  statut: string;
  brouillon: unknown;
  expire_le: string;
  signe_le: string | null;
}

const MESSAGE_LIEN_INVALIDE =
  "Ce lien n'est plus valable. Si vous avez reçu plusieurs e-mails, ouvrez le plus récent ; sinon, demandez à votre formateur de vous renvoyer le formulaire.";
const MESSAGE_LIEN_EXPIRE =
  "Ce lien a expiré. Demandez à votre formateur de vous renvoyer le formulaire.";

/**
 * Retrouve formulaire, fiche et dossier par le jeton. Un jeton qui n'a pas la forme d'un jeton n'atteint même pas la
 * base. Un formulaire déjà signé reste lisible après l'échéance du lien (pour retélécharger le document).
 */
export async function parJeton(
  bd: BdService,
  jeton: string,
  maintenant: Date = new Date(),
): Promise<{ f: LigneFormulaire; d: LigneDossier; st: LigneStagiaire }> {
  if (typeof jeton !== "string" || jeton.length < 16 || jeton.length > 200)
    throw new ErreurMetier("introuvable", MESSAGE_LIEN_INVALIDE);
  const f = donnees<LigneFormulaire | null>(
    await bd
      .from("formulaire_apprenant")
      .select("*")
      .eq("jeton_hash", await sha256Hex(jeton))
      .maybeSingle(),
    "lecture du formulaire",
  );
  // Un renvoi remplace le jeton : l'ancien lien (e-mail précédent) tombe ici.
  if (!f) throw new ErreurMetier("introuvable", MESSAGE_LIEN_INVALIDE);
  if (f.statut !== "complet" && new Date(f.expire_le).getTime() <= maintenant.getTime())
    throw new ErreurMetier("introuvable", MESSAGE_LIEN_EXPIRE);
  const st = donnees<LigneStagiaire | null>(
    await bd.from("stagiaire").select("*").eq("id", f.stagiaire_id).maybeSingle(),
    "lecture de la fiche apprenant",
  );
  if (!st) throw new ErreurMetier("introuvable", MESSAGE_LIEN_INVALIDE);
  return { f, d: await dossierSysteme(bd, f.dossier_id), st };
}

async function nomDuFormateur(bd: BdService, formateurId: string) {
  const form = donnees<{
    formateur_prenom: string;
    formateur_nom: string;
    formateur_email: string;
  } | null>(
    await bd
      .from("formateur")
      .select("formateur_prenom, formateur_nom, formateur_email")
      .eq("id", formateurId)
      .maybeSingle(),
    "lecture du formateur",
  );
  return {
    form,
    nom: `${form?.formateur_prenom ?? ""} ${form?.formateur_nom ?? ""}`.trim(),
  };
}

// ——— Route 14 : lecture ———

export async function lireFormulairePublic(bd: BdService, jeton: string) {
  const { f, d, st } = await parJeton(bd, jeton);
  const type = f.type;
  const config = CONFIG_EVALUATIONS[type];
  const of = await lireOrganisme(bd, d.of_id);
  const { nom: formateur } = await nomDuFormateur(bd, d.formateur_id);
  const piece = await trouverPiece(bd, d.id, config.code, st.id);
  const q = questionnaireDe(d, type);
  return {
    type,
    libelle: config.libelle,
    statut: statutPagePublique(f, piece?.statut === "valide"),
    ouvert: questionnaireOuvert(d.sous_statut, type),
    organisme: { nom: of.of_nom, couleur: of.couleur },
    formateur,
    formation_titre: d.formation_titre,
    dates: { debut: d.formation_date_debut, fin: d.formation_date_fin },
    apprenant: {
      prenom: st.stagiaire_prenom,
      nom: st.stagiaire_nom,
      email: st.stagiaire_email,
    },
    formulaire: formulaireDe(type),
    // Le corrigé ne quitte jamais le serveur à destination de l'apprenant.
    questionnaire: q ? sansCorrige(q) : null,
    brouillon: (f.brouillon ?? null) as {
      reponses?: Record<string, string> | Array<number | null>;
      date?: string;
      lieu?: string;
    } | null,
    signe_le: f.signe_le ? new Date(f.signe_le).toISOString() : null,
    aujourdhui: new Date().toISOString().slice(0, 10),
    pdf: Boolean(piece?.chemin_retour),
  };
}

// ——— Route 15 : brouillon ———

const ReponsesSaisies = z.union([
  z.record(z.string(), z.string().max(4000)),
  z.array(z.number().int().min(0).max(7).nullable()).max(40),
]);
const SchemaBrouillon = z.object({
  reponses: ReponsesSaisies.default({}),
  date: z.string().max(10).default(""),
  lieu: z.string().trim().max(120).default(""),
});
const SchemaSignature = z.object({
  reponses: ReponsesSaisies.default({}),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indiquez la date."),
  trace_png: z.string(),
  lieu: z.string().trim().max(120),
  consentement: z.boolean(),
});

const messagesZod = (e: z.ZodError): string[] => [...new Set(e.issues.map((i) => i.message))];

/** « Enregistrer et reprendre plus tard » : rien n'est perdu, même en changeant d'appareil. */
export async function enregistrerBrouillonPublic(bd: BdService, jeton: string, corps: unknown) {
  const { f } = await parJeton(bd, jeton);
  if (f.statut === "complet") throw new ErreurMetier("conflit", "Ce formulaire est déjà signé.");
  const lu = SchemaBrouillon.safeParse(corps);
  if (!lu.success)
    throw invalide("Le brouillon est illisible.", { erreurs: messagesZod(lu.error) });
  // Le filtre sur le statut évite d'écraser un formulaire signé entre-temps.
  const { data, error } = await bd
    .from("formulaire_apprenant")
    .update({ brouillon: lu.data, statut: "en_cours" })
    .eq("id", f.id)
    .neq("statut", "complet")
    .select("id");
  leverSiErreurBd(error, "enregistrement du brouillon");
  if (!(data as unknown[] | null)?.length)
    throw new ErreurMetier("conflit", "Ce formulaire est déjà signé.");
  return { enregistre_le: new Date().toISOString() };
}

// ——— Route 16 : réponses + signature ———

/**
 * Répond ET signe : réponses enregistrées, pièce rendue avec la signature, archivée avec son certificat, validée. La
 * pièce validée apparaît immédiatement dans le dossier, l'espace de l'apprenant et le coffre-fort du parcours.
 * Horodatage, IP et empreinte sont calculés ICI ; rien de ce que fournit le navigateur ne les détermine.
 */
export async function signerFormulairePublic(
  bd: BdService,
  jeton: string,
  corps: unknown,
  adresseIp = "",
) {
  const { f, d, st } = await parJeton(bd, jeton);
  const type = f.type;
  const config = CONFIG_EVALUATIONS[type];
  if (f.statut === "complet") throw new ErreurMetier("conflit", "Ce formulaire est déjà signé.");
  if (!questionnaireOuvert(d.sous_statut, type))
    throw new ErreurMetier(
      "conflit",
      "Ce formulaire n'est plus ouvert : le dossier a changé d'étape.",
    );
  const lu = SchemaSignature.safeParse(corps);
  if (!lu.success)
    throw invalide("Le formulaire est incomplet.", { erreurs: messagesZod(lu.error) });
  const v = lu.data;

  // Contrôles AVANT toute écriture : réponses complètes, puis signature recevable.
  const erreurs: string[] = [];
  let erreursChamps: Record<string, string> = {};
  const controle = controlerReponses(d, type, v.reponses);
  if (!controle.ok) {
    if (Object.keys(controle.erreurs).length > 0) {
      erreursChamps = controle.erreurs;
      const def = formulaireDe(type);
      for (const [cle, msg] of Object.entries(controle.erreurs))
        erreurs.push(`${def?.champs.find((c) => c.id === cle)?.libelle ?? cle} : ${msg}`);
    } else erreurs.push(controle.message);
  }
  erreurs.push(
    ...validerDemandeSignature({
      trace_png: v.trace_png,
      lieu: v.lieu,
      consentement: v.consentement,
    }),
  );
  if (erreurs.length > 0)
    throw invalide("Le formulaire est incomplet.", { erreurs, champs: erreursChamps });

  // Un apprenant sans compte signe quand même : `utilisateur_id` reste vide (aucun compte n'est créé ici).
  const acteur: ActeurRetour = {
    utilisateur_id: st.utilisateur_id ?? "",
    role: "apprenant",
    nom: `${st.stagiaire_prenom} ${st.stagiaire_nom}`,
  };

  // 1. Réponses (sans valider la pièce : c'est la signature qui la valide, ci-dessous).
  const { piece } = await enregistrerReponses(
    bd,
    d,
    st.id,
    type,
    { reponses: v.reponses },
    { utilisateur_id: st.utilisateur_id ?? null, acteur, validerPiece: false },
  );
  if (!piece)
    throw new ErreurMetier(
      "conflit",
      "La pièce correspondante n'existe pas encore sur ce dossier.",
    );

  // 2. Signature : empreinte du document TEL QUE PRÉSENTÉ (réponses comprises), puis rendu signé + certificat.
  const avant = await rendrePiece(bd, d, piece);
  const horodatage = new Date();
  const preuve: PreuveSignature = {
    signataire_nom: acteur.nom,
    signataire_role: "apprenant",
    signataire_email: st.stagiaire_email,
    trace_png: v.trace_png,
    lieu: v.lieu.trim(),
    horodatage: horodatage.toISOString(),
    empreinte_document: await sha256Hex(avant.html),
    adresse_ip: adresseIp,
  };
  await enregistrerSignature(bd, piece, "apprenant", st.utilisateur_id ?? null, preuve);
  const apres = await rendrePiece(bd, d, piece);
  const base = nomFichierPiece(config.code, acteur.nom);
  const { chemin } = await archiverRendu(bd, d, "Retour", `${base}_signe`, apres.html);
  await ouvrirArchive(bd, { ofId: d.of_id }).ecrire(
    cheminPiece(d.of_id, d.dossier_reference, "Retour", `${base}_certificat-signature.html`),
    certificatHtml(preuve, {
      code: config.code,
      libelle: definitionPiece(config.code).libelle,
      dossier_reference: d.dossier_reference,
    }),
    "text/html; charset=utf-8",
  );

  // 3. Validation : la pièce passe à « Validé » — dossier, espace apprenant et coffre-fort la voient aussitôt.
  await marquerValidee(bd, d, piece, acteur, {
    chemin,
    nom_fichier: chemin.split("/").pop()!,
    mode: "signature",
  });
  const { error } = await bd
    .from("formulaire_apprenant")
    .update({ statut: "complet", signe_le: horodatage.toISOString(), brouillon: null })
    .eq("id", f.id);
  leverSiErreurBd(error, "clôture du formulaire");
  await journaliser(bd, {
    of_id: d.of_id,
    dossier_id: d.id,
    acteur: "systeme",
    type: "formulaire_signe",
    libelle: `${config.libelle} répondu et signé par ${acteur.nom} (page interactive)`,
    detail: { type, adresse_ip: adresseIp, empreinte: preuve.empreinte_document },
  });

  // 4. Le document signé part à l'apprenant et au formateur ; un échec d'e-mail ne défait rien.
  const of = await lireOrganisme(bd, d.of_id);
  const { form, nom: nomFormateur } = await nomDuFormateur(bd, d.formateur_id);
  const base_ = await baseLiens();
  const pj = [{ nom: chemin.split("/").pop()!, chemin }];
  const conf = courriels.formulaireConfirmation({
    of_nom: of.of_nom,
    prenom: st.stagiaire_prenom,
    formation: d.formation_titre,
    libelle: config.libelle,
    lien: lienFormulaire(base_, jeton),
  });
  await envoyerCourrier(bd, {
    of_id: d.of_id,
    dossier_id: d.id,
    type: `formulaire_${type}_confirmation`,
    destinataire: st.stagiaire_email,
    ...conf,
    pieces_jointes: pj,
  });
  if (form?.formateur_email) {
    const n = courriels.formulaireRecu({
      of_nom: of.of_nom,
      prenom: form.formateur_prenom,
      apprenant: acteur.nom,
      formation: d.formation_titre,
      libelle: config.libelle,
      reference: d.dossier_reference,
      lien: `${base_}/dossiers/${d.id}`,
    });
    await envoyerCourrier(bd, {
      of_id: d.of_id,
      dossier_id: d.id,
      type: `formulaire_${type}_recu`,
      destinataire: form.formateur_email,
      ...n,
      pieces_jointes: pj,
    });
  }

  // 5. Pas de compte ? Une invitation (lien d'inscription), jamais un compte créé à sa place.
  await inviterSiSansCompte(bd, d, st, of.of_nom, nomFormateur, base_);
  return { statut: "complet" as const };
}

/**
 * Si l'apprenant n'a pas de compte et qu'aucune invitation valide n'existe pour sa fiche, insère une ligne `invitation`
 * (rôle apprenant, fiche, e-mail de la fiche, 14 jours) et envoie le lien `/invitation/<jeton>`. Le compte ne naît qu'au
 * `signUp` de l'apprenant (le trigger de la base vérifie le hachage, l'expiration et l'égalité de l'e-mail).
 * Ne lève jamais : la signature est déjà enregistrée.
 */
export async function inviterSiSansCompte(
  bd: BdService,
  d: LigneDossier,
  st: LigneStagiaire,
  ofNom: string,
  nomFormateur: string,
  base: string,
): Promise<"invitation_envoyee" | "deja_un_compte" | "deja_invite" | "sans_adresse" | "echec"> {
  try {
    if (st.utilisateur_id) return "deja_un_compte";
    const email = st.stagiaire_email.trim().toLowerCase();
    if (!email) return "sans_adresse";
    const enCours =
      donnees<Array<{ jeton_hash: string }>>(
        await bd
          .from("invitation")
          .select("jeton_hash")
          .eq("stagiaire_id", st.id)
          .is("utilisee_le", null)
          .gt("expire_le", new Date().toISOString()),
        "lecture des invitations",
      ) ?? [];
    if (enCours.length > 0) return "deja_invite";
    const compte = donnees<Array<{ id: string }>>(
      await bd
        .from("utilisateur")
        .select("id")
        .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
        .limit(1),
      "lecture des comptes",
    );
    if (compte?.length) return "deja_un_compte";

    const jeton = jetonAleatoire();
    const { error } = await bd.from("invitation").insert({
      jeton_hash: await sha256Hex(jeton),
      of_id: d.of_id,
      email,
      role: "apprenant",
      prenom: st.stagiaire_prenom,
      nom: st.stagiaire_nom,
      stagiaire_id: st.id,
      expire_le: new Date(Date.now() + DUREE_INVITATION_MS).toISOString(),
    });
    leverSiErreurBd(error, "création de l'invitation");
    const c = courriels.invitationApprenant({
      of_nom: ofNom,
      prenom: st.stagiaire_prenom,
      formateur: nomFormateur,
      formation: d.formation_titre,
      lien: `${base}/invitation/${jeton}`,
    });
    await envoyerCourrier(bd, {
      of_id: d.of_id,
      dossier_id: d.id,
      type: "invitation_apprenant",
      destinataire: email,
      ...c,
    });
    await journaliser(bd, {
      of_id: d.of_id,
      dossier_id: d.id,
      acteur: "systeme",
      type: "invitation_apprenant",
      libelle: `Invitation à créer son compte envoyée à ${st.stagiaire_prenom} ${st.stagiaire_nom}`,
    });
    return "invitation_envoyee";
  } catch (e) {
    console.error("[formulaire public] invitation impossible", e);
    return "echec";
  }
}

// ——— Route 17 : document signé ———

/** Le document signé, pour l'apprenant, par son lien (même après l'échéance du lien) : un lien temporaire de 60 s. */
export async function telechargerPdfPublic(
  bd: BdService,
  jeton: string,
): Promise<{ url: string; nom: string; type_mime: string }> {
  const { f, d, st } = await parJeton(bd, jeton);
  const piece = await trouverPiece(bd, d.id, CONFIG_EVALUATIONS[f.type].code, st.id);
  if (!piece?.chemin_retour)
    throw new ErreurMetier("conflit", "Le document est disponible une fois le formulaire signé.");
  const nom = piece.chemin_retour.split("/").pop()!;
  return {
    url: await ouvrirArchive(bd, { ofId: d.of_id }).urlSignee(piece.chemin_retour, 60, nom),
    nom,
    type_mime: typeMimeDe(nom),
  };
}

export { nomDuStagiaire };
