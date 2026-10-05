/**
 * Retour des pièces — le cœur des deux espaces de communication (F-COM-06 à 08, F-OF-03/04, F-ARCH-04/05).
 *
 * Port de `src/serveur/services/retours.ts` et `evaluations.ts` sur le client « service » de Supabase. Deux façons de
 * retourner une pièce, avec le même résultat : (a) la signer en ligne ; (b) la télécharger, la signer hors ligne, puis
 * déposer le fichier. Dans les deux cas : le document est classé dans « Retour », la pièce passe à « Validé », et le
 * pipeline réagit (accord de financement, complétude) par le point de branchement `./pieces-pipeline.server`.
 *
 * Signature : l'horodatage, l'IP et l'empreinte SHA-256 sont calculés ICI, côté serveur. L'empreinte de la signature
 * scelle le document TEL QU'IL EST PRÉSENTÉ au signataire (HTML rendu avant apposition) ; l'empreinte du retour scelle
 * le fichier archivé, que « vérifier l'intégrité » relit et recompare.
 *
 * Règles pures : `@/domaine/pieces/retours` et `@/domaine/formulaires/evaluations`. Ici : base, archive, journal.
 */
import { cheminPiece } from "@/domaine/archive/chemins";
import { typeMimeDe, extensionDe } from "@/domaine/fichiers/regles";
import {
  CONFIG_EVALUATIONS,
  controlerReponses,
  questionnaireOuvert,
  type TypeEvaluation,
} from "@/domaine/formulaires/evaluations";
import {
  SOUS_STATUTS_EMARGEMENT,
  aUnApercu,
  ciblesEmargement,
  controlePieceExterne,
  erreurFichierPiece,
  libelleValidation,
  nomFichierPiece,
  reactionApresValidation,
  refusDepot,
  refusDossierFerme,
  refusEmargementFerme,
  refusRegeneration,
  refusSignature,
  type ModeRetour,
  type Refus,
} from "@/domaine/pieces/retours";
import { definitionPiece, type CodePiece } from "@/domaine/referentiel/pieces";
import {
  certificatHtml,
  validerDemandeSignature,
  type PreuveSignature,
} from "@/domaine/signature/preuve";
import type { Acteur } from "./acteur.server";
import { ouvrirArchive } from "./archive.server";
import type { BdService } from "./bd.server";
import { ErreurMetier, interdit, introuvable, invalide, leverSiErreurBd } from "./erreurs.server";
import { empreintesEgales, sha256Hex } from "./hacheur.server";
import { journaliser } from "./journal.server";
import {
  accederAuDossier,
  archiverRendu,
  chargerPiece,
  creerPiece,
  donnees,
  genererPiece,
  nomDuStagiaire,
  rendrePiece,
  stagiairesDuDossier,
  synchroniserPieces,
  trouverPiece,
  type LigneDossier,
  type LignePiece,
} from "./pieces-donnees.server";
import { reagirAuPipeline } from "./pieces-pipeline.server";

/** Ce que le retour d'une pièce retient de celui qui agit (un apprenant sans compte a `utilisateur_id` vide). */
export type ActeurRetour = Pick<Acteur, "utilisateur_id" | "role" | "nom">;

/** Transforme un refus pur du noyau en erreur métier. */
export function leverRefus(r: Refus | null): void {
  if (r) throw new ErreurMetier(r.code, r.message);
}

// ——— Validation d'une pièce ———

export async function marquerValidee(
  bd: BdService,
  d: LigneDossier,
  piece: LignePiece,
  acteur: ActeurRetour,
  retour: { chemin: string; nom_fichier: string; mode: ModeRetour },
): Promise<void> {
  const archive = ouvrirArchive(bd, { ofId: d.of_id });
  const empreinte_retour = await sha256Hex(await archive.lire(retour.chemin));
  const { error } = await bd
    .from("piece_dossier")
    .update({
      statut: "valide",
      chemin_retour: retour.chemin,
      nom_fichier_retour: retour.nom_fichier,
      empreinte_retour,
      mode_retour: retour.mode,
      retour_le: new Date().toISOString(),
      retour_par: acteur.utilisateur_id || null,
    })
    .eq("id", piece.id);
  leverSiErreurBd(error, "validation de la pièce");
  const def = definitionPiece(piece.code);
  await journaliser(bd, {
    of_id: d.of_id,
    dossier_id: d.id,
    acteur,
    type: "piece_validee",
    libelle: `${def.libelle} — ${libelleValidation(retour.mode)} par ${acteur.nom}`,
    detail: { code: piece.code, stagiaire_id: piece.stagiaire_id, mode: retour.mode },
  });
  // Réactions du pipeline à la validation (accord de financement, complétude du dossier).
  const reaction = reactionApresValidation(piece.code, d.sous_statut);
  if (reaction) await reagirAuPipeline(bd, d, reaction);
}

/** (b) Dépôt d'un fichier : pièce signée hors ligne, ou document externe (accord, refus, facture du formateur). */
export async function deposerRetour(
  bd: BdService,
  acteur: Acteur,
  pieceId: string,
  fichier: { nom: string; contenu: Uint8Array },
): Promise<LignePiece> {
  const { d, piece } = await chargerPiece(bd, acteur, pieceId);
  leverRefus(refusDepot(piece.code, acteur.role, d.sous_statut));
  const message = erreurFichierPiece({ nom: fichier.nom, taille: fichier.contenu.length });
  if (message) throw invalide(message);

  const base = nomFichierPiece(piece.code, await nomDuStagiaire(bd, d.id, piece.stagiaire_id));
  const nom = `${base}_retour.${extensionDe(fichier.nom)}`;
  const chemin = await ouvrirArchive(bd, { ofId: d.of_id }).ecrire(
    cheminPiece(d.of_id, d.dossier_reference, "Retour", nom),
    fichier.contenu,
    typeMimeDe(nom),
  );
  await marquerValidee(bd, d, piece, acteur, { chemin, nom_fichier: fichier.nom, mode: "depot" });
  return (await trouverPiece(bd, d.id, piece.code, piece.stagiaire_id))!;
}

/** Dépôt d'une pièce externe qui n'existe pas encore sur le dossier (accord ou refus de financement). Route 99. */
export async function deposerPieceExterne(
  bd: BdService,
  acteur: Acteur,
  dossierId: string,
  code: string,
  fichier: { nom: string; contenu: Uint8Array },
): Promise<LignePiece> {
  // Le code est contrôlé AVANT toute lecture : une pièce qui ne se dépose pas n'a pas à révéler le dossier.
  const preliminaire = controlePieceExterne(code, "dossier_valide", true);
  if (preliminaire.refus)
    throw new ErreurMetier(preliminaire.refus.code, preliminaire.refus.message);
  const codePiece = code as CodePiece;
  const d = await accederAuDossier(bd, acteur, dossierId);
  let piece = await trouverPiece(bd, d.id, codePiece, null);
  const controle = controlePieceExterne(code, d.sous_statut, piece !== null);
  if (controle.refus) throw new ErreurMetier(controle.refus.code, controle.refus.message);
  if (!piece) piece = await creerPiece(bd, d.id, codePiece, null);
  return deposerRetour(bd, acteur, piece.id, fichier);
}

// ——— Signature en ligne ———

/** (a) Signature en ligne : tracé manuscrit + lieu + horodatage serveur + empreinte du document présenté. */
export async function signerPiece(
  bd: BdService,
  acteur: Acteur,
  pieceId: string,
  demande: { trace_png: string; lieu: string; consentement: boolean },
  adresseIp = "",
): Promise<LignePiece> {
  const { d, piece } = await chargerPiece(bd, acteur, pieceId);
  const code = piece.code;
  const def = definitionPiece(code);
  leverRefus(refusSignature(code, acteur.role, piece.statut, d.sous_statut));
  const erreurs = validerDemandeSignature(demande);
  if (erreurs.length > 0) throw invalide(erreurs[0]!, { erreurs });

  // L'empreinte scelle le document TEL QU'IL EST PRÉSENTÉ au signataire, avant apposition de sa signature.
  const avant = await rendrePiece(bd, d, piece);
  const horodatage = new Date();
  const preuve: PreuveSignature = {
    signataire_nom: acteur.nom,
    signataire_role: acteur.role,
    signataire_email: acteur.email,
    trace_png: demande.trace_png,
    lieu: demande.lieu.trim(),
    horodatage: horodatage.toISOString(),
    empreinte_document: await sha256Hex(avant.html),
    adresse_ip: adresseIp,
  };
  await enregistrerSignature(bd, piece, acteur.role, acteur.utilisateur_id || null, preuve);

  const apres = await rendrePiece(bd, d, piece);
  const base = nomFichierPiece(code, await nomDuStagiaire(bd, d.id, piece.stagiaire_id));
  const { chemin } = await archiverRendu(bd, d, "Retour", `${base}_signe`, apres.html);
  await ouvrirArchive(bd, { ofId: d.of_id }).ecrire(
    cheminPiece(d.of_id, d.dossier_reference, "Retour", `${base}_certificat-signature.html`),
    certificatHtml(preuve, {
      code,
      libelle: def.libelle,
      dossier_reference: d.dossier_reference,
    }),
    "text/html; charset=utf-8",
  );
  await marquerValidee(bd, d, piece, acteur, {
    chemin,
    nom_fichier: chemin.split("/").pop()!,
    mode: "signature",
  });
  return (await trouverPiece(bd, d.id, code, piece.stagiaire_id))!;
}

/**
 * Enregistre la preuve de signature d'une zone. Une signature antérieure de la même zone (reprise après un échec
 * partiel, nouvelle tentative) est remplacée : la pièce n'a jamais deux preuves pour une même zone.
 */
export async function enregistrerSignature(
  bd: BdService,
  piece: LignePiece,
  zone: string,
  utilisateurId: string | null,
  preuve: PreuveSignature,
): Promise<void> {
  const { error: errSuppr } = await bd
    .from("signature")
    .delete()
    .eq("piece_id", piece.id)
    .eq("zone", zone);
  leverSiErreurBd(errSuppr, "remplacement de la signature");
  const { error } = await bd.from("signature").insert({
    piece_id: piece.id,
    utilisateur_id: utilisateurId,
    zone,
    signataire_nom: preuve.signataire_nom,
    signataire_role: preuve.signataire_role,
    signataire_email: preuve.signataire_email,
    trace_png: preuve.trace_png,
    lieu: preuve.lieu,
    horodatage: preuve.horodatage,
    empreinte_document: preuve.empreinte_document,
    adresse_ip: preuve.adresse_ip ?? "",
  });
  leverSiErreurBd(error, "enregistrement de la signature");
}

export interface ResultatIntegrite {
  retournee: boolean;
  integre: boolean | null;
  preuve: Omit<PreuveSignature, "trace_png"> | null;
}

/**
 * Contrôle d'intégrité d'une pièce retournée : l'empreinte du fichier archivé est recalculée et comparée à celle
 * scellée au moment du retour. Un document modifié après coup est détecté. Le tracé n'est jamais renvoyé.
 */
export async function verifierIntegritePiece(
  bd: BdService,
  acteur: Acteur,
  pieceId: string,
): Promise<ResultatIntegrite> {
  const { d, piece } = await chargerPiece(bd, acteur, pieceId);
  if (!piece.chemin_retour || !piece.empreinte_retour)
    return { retournee: false, integre: null, preuve: null };
  const archive = ouvrirArchive(bd, { ofId: d.of_id });
  const integre =
    (await archive.existe(piece.chemin_retour)) &&
    empreintesEgales(
      await sha256Hex(await archive.lire(piece.chemin_retour)),
      piece.empreinte_retour,
    );
  const sig = donnees<Array<Record<string, unknown>>>(
    await bd
      .from("signature")
      .select("*")
      .eq("piece_id", piece.id)
      .order("horodatage", { ascending: true }),
    "lecture de la signature",
  )?.[0];
  if (!sig) return { retournee: true, integre, preuve: null };
  const { trace_png: _trace, ...reste } = sig;
  return {
    retournee: true,
    integre,
    preuve: {
      ...reste,
      horodatage: new Date(String(sig["horodatage"])).toISOString(),
    } as unknown as ResultatIntegrite["preuve"],
  };
}

// ——— Lecture : aperçu, téléchargement, régénération, trame ———

/** Aperçu HTML courant d'une pièce (à l'écran, à l'impression, avant signature). Route 108. */
export async function apercuPiece(bd: BdService, acteur: Acteur, pieceId: string): Promise<string> {
  const { d, piece } = await chargerPiece(bd, acteur, pieceId);
  if (!aUnApercu(piece.code)) throw introuvable("Aperçu");
  return (await rendrePiece(bd, d, piece)).html;
}

/**
 * F-COM-09 / F-CRM-04 : lien de téléchargement temporaire (60 s) d'une pièce, dans sa version de départ ou retournée.
 * Si la version de départ n'existe pas encore pour une pièce générée, elle est produite à la demande. Route 109.
 */
export async function telechargerPiece(
  bd: BdService,
  acteur: Acteur,
  pieceId: string,
  version: "depart" | "retour",
): Promise<{ url: string; nom: string; type_mime: string }> {
  const { d, piece } = await chargerPiece(bd, acteur, pieceId);
  let chemin = version === "retour" ? piece.chemin_retour : piece.chemin_depart;
  if (!chemin && version === "depart" && definitionPiece(piece.code).mode === "generee")
    chemin = (await genererPiece(bd, d, piece.code, piece.stagiaire_id)).chemin_depart;
  if (!chemin) throw introuvable("Document");
  const nom = chemin.split("/").pop()!;
  const url = await ouvrirArchive(bd, { ofId: d.of_id }).urlSignee(chemin, 60, nom);
  return { url, nom, type_mime: typeMimeDe(nom) };
}

/** Le formateur (ou l'admin) régénère une pièce non encore validée, après correction des données. Route 113. */
export async function regenererPiece(
  bd: BdService,
  acteur: Acteur,
  pieceId: string,
): Promise<LignePiece> {
  if (acteur.role === "apprenant") throw interdit();
  const { d, piece } = await chargerPiece(bd, acteur, pieceId);
  leverRefus(refusRegeneration(acteur.role, piece.statut, d.sous_statut));
  return genererPiece(bd, d, piece.code, piece.stagiaire_id);
}

/** Trame de facture pré-remplie proposée au formateur (pièce 10-FIN : il dépose ensuite SA facture). Route 105. */
export async function trameFactureFormateur(
  bd: BdService,
  acteur: Acteur,
  dossierId: string,
): Promise<string> {
  if (acteur.role === "apprenant") throw interdit();
  const d = await accederAuDossier(bd, acteur, dossierId);
  const piece = await trouverPiece(bd, d.id, "10-FIN", null);
  if (!piece)
    throw new ErreurMetier(
      "conflit",
      "La trame de facture est disponible une fois la formation terminée.",
    );
  return (await rendrePiece(bd, d, piece)).html;
}

// ——— Émargement électronique, séance par séance (route 114) ———

export async function emarger(
  bd: BdService,
  acteur: Acteur,
  seanceId: string,
  demande: { trace_png: string; stagiaire_id?: string },
): Promise<void> {
  const se = donnees<{ id: string; dossier_id: string; date: string } | null>(
    await bd.from("seance").select("*").eq("id", seanceId).maybeSingle(),
    "lecture de la séance",
  );
  if (!se) throw introuvable("Séance");
  const d = await accederAuDossier(bd, acteur, se.dossier_id);
  leverRefus(refusEmargementFerme(d.sous_statut));
  const erreurs = validerDemandeSignature({
    trace_png: demande.trace_png,
    lieu: "séance",
    consentement: true,
  });
  if (erreurs.length > 0) throw invalide(erreurs[0]!);

  const inscrits = (await stagiairesDuDossier(bd, d.id)).map((l) => l.st.id);
  const cible = ciblesEmargement(acteur, inscrits, demande.stagiaire_id);
  if (!cible.ok) throw new ErreurMetier(cible.refus.code, cible.refus.message);

  // Horodatage posé par le serveur ; un pointage déjà enregistré pour (séance, stagiaire, signataire) est conservé.
  const horodatage = new Date().toISOString();
  const { error } = await bd.from("emargement").upsert(
    cible.cibles.map((stagiaire_id) => ({
      seance_id: seanceId,
      stagiaire_id,
      signataire: cible.signataire,
      trace_png: demande.trace_png,
      horodatage,
    })),
    { onConflict: "seance_id,stagiaire_id,signataire", ignoreDuplicates: true },
  );
  leverSiErreurBd(error, "enregistrement de l'émargement");
  await journaliser(bd, {
    of_id: d.of_id,
    dossier_id: d.id,
    acteur,
    type: "emargement",
    libelle: `Émargement de la séance du ${se.date} par ${acteur.nom}`,
    detail: { seance_id: seanceId, signataire: cible.signataire },
  });
}

// ——— Questionnaires renseignés en ligne ———

/**
 * Cœur de l'enregistrement des réponses, sans contrôle de rôle : utilisé par l'apprenant connecté (route 107) et par
 * la page publique du formulaire (lien personnel). Valide la pièce si `validerPiece`.
 */
export async function enregistrerReponses(
  bd: BdService,
  d: LigneDossier,
  stagiaireId: string,
  type: TypeEvaluation,
  saisie: { reponses: unknown; ajustement?: string },
  par: { utilisateur_id: string | null; acteur: ActeurRetour | "systeme"; validerPiece: boolean },
): Promise<{ score: number | null; piece: LignePiece | null }> {
  const config = CONFIG_EVALUATIONS[type];
  leverRefus(refusDossierFerme(d.sous_statut));
  if (!questionnaireOuvert(d.sous_statut, type))
    throw new ErreurMetier(
      "conflit",
      "Ce questionnaire n'est pas encore ouvert à cette étape du dossier.",
    );
  if (!(await stagiairesDuDossier(bd, d.id)).some((l) => l.st.id === stagiaireId))
    throw invalide("Ce stagiaire n'est pas inscrit à ce dossier.");
  const controle = controlerReponses(d, type, saisie.reponses);
  if (!controle.ok)
    throw new ErreurMetier(
      controle.code,
      controle.message,
      Object.keys(controle.erreurs).length ? { erreurs: controle.erreurs } : null,
    );

  await synchroniserPieces(bd, d);
  const piece = await trouverPiece(bd, d.id, config.code, stagiaireId);
  // Une pièce déjà validée fait foi : on ne réécrit pas les réponses qui la fondent.
  if (piece?.statut === "valide")
    throw new ErreurMetier(
      "conflit",
      "Ce questionnaire est déjà validé : il ne peut plus être modifié.",
    );

  const { error } = await bd.from("evaluation").upsert(
    {
      dossier_id: d.id,
      stagiaire_id: stagiaireId,
      type,
      date: new Date().toISOString().slice(0, 10),
      reponses: controle.reponses,
      score: controle.score,
      ajustement: saisie.ajustement?.trim() ?? "",
      saisie_par: par.utilisateur_id,
    },
    { onConflict: "dossier_id,stagiaire_id,type" },
  );
  leverSiErreurBd(error, "enregistrement des réponses");

  if (piece && par.validerPiece && par.acteur !== "systeme") {
    const { html } = await rendrePiece(bd, d, piece);
    const nom = (await nomDuStagiaire(bd, d.id, stagiaireId)) ?? "";
    const { chemin } = await archiverRendu(
      bd,
      d,
      "Retour",
      `${nomFichierPiece(config.code, nom)}_renseigne`,
      html,
    );
    await marquerValidee(bd, d, piece, par.acteur, {
      chemin,
      nom_fichier: chemin.split("/").pop()!,
      mode: "formulaire",
    });
  }
  return { score: controle.score, piece };
}

/** Enregistrement par un utilisateur connecté : l'apprenant, pour lui-même. Route 107. */
export async function enregistrerEvaluation(
  bd: BdService,
  acteur: Acteur,
  dossierId: string,
  type: TypeEvaluation,
  saisie: { reponses: unknown; ajustement?: string },
): Promise<{ score: number | null }> {
  const d = await accederAuDossier(bd, acteur, dossierId);
  if (acteur.role === "admin")
    throw interdit("Les questionnaires sont renseignés par l'apprenant lui-même.");
  if (acteur.role === "formateur")
    throw interdit(
      "Ce questionnaire est renseigné par l'apprenant lui-même : envoyez-lui son formulaire (bouton « Envoyer »).",
    );
  if (!acteur.stagiaire_id) throw interdit();
  const { score } = await enregistrerReponses(bd, d, acteur.stagiaire_id, type, saisie, {
    utilisateur_id: acteur.utilisateur_id,
    acteur,
    validerPiece: CONFIG_EVALUATIONS[type].valideLaPiece,
  });
  return { score };
}

export { SOUS_STATUTS_EMARGEMENT };
