/**
 * Retour des pièces — le cœur des deux espaces de communication (F-COM-06 à 08, F-OF-03/04, F-ARCH-04/05).
 *
 * Deux façons de retourner une pièce, avec le même résultat :
 *  (a) la signer en ligne ;  (b) la télécharger, la signer hors ligne, puis déposer le fichier.
 * Dans les deux cas : le document est classé dans « Retour », la pièce passe à « Validé », et le pipeline
 * réagit (accord de financement, complétude du dossier). Rien n'est « synchronisé » : tout le monde lit la même ligne.
 */
import { and, eq } from "drizzle-orm";
import { dureeSeanceHeures } from "@/domaine/dossier/formats";
import { peutValider, peutVoir } from "@/domaine/pieces/statut";
import { estTerminal, type SousStatut } from "@/domaine/pipeline/statuts";
import { definitionPiece, estCodePiece, type CodePiece } from "@/domaine/referentiel/pieces";
import { certificatHtml, validerDemandeSignature, type PreuveSignature } from "@/domaine/signature/preuve";
import { emargement, pieceDossier, seance, signature } from "../bd/schema";
import { cheminPiece } from "../ports/archive";
import { nouvelId, sha256 } from "../ports/divers";
import { accederAuDossier, stagiairesDuDossier, type LigneDossier } from "./agregat";
import { extensionDe, typeMimeDe, validerFichier, type FichierDepose } from "./fichiers";
import { archiverRendu, genererPiece, nomFichierPiece, rendrePiece, trouverPiece, type LignePiece } from "./generation";
import { executerAction } from "./pipeline";
import { ErreurMetier, interdit, introuvable, invalide, journaliser, type Acteur, type Services } from "./socle";

async function chargerPiece(s: Services, acteur: Acteur, pieceId: string): Promise<{ d: LigneDossier; piece: LignePiece }> {
  const [piece] = await s.bd.select().from(pieceDossier).where(eq(pieceDossier.id, pieceId));
  if (!piece) throw introuvable("Pièce");
  const d = await accederAuDossier(s, acteur, piece.dossier_id);
  if (!peutVoir({ code: piece.code as CodePiece, stagiaire_id: piece.stagiaire_id }, acteur)) throw introuvable("Pièce");
  return { d, piece };
}

function exigerDossierOuvert(d: LigneDossier): void {
  if (estTerminal(d.sous_statut as SousStatut)) throw new ErreurMetier("conflit", "Ce dossier est archivé : il n'est plus modifiable.");
}

async function nomDuStagiaire(s: Services, d: LigneDossier, stagiaireId: string | null): Promise<string | null> {
  if (!stagiaireId) return null;
  const st = (await stagiairesDuDossier(s, d.id)).find((l) => l.st.id === stagiaireId)?.st;
  return st ? `${st.stagiaire_prenom} ${st.stagiaire_nom}` : null;
}

/** Réactions du pipeline à la validation d'une pièce. */
async function apresValidation(s: Services, d: LigneDossier, code: CodePiece): Promise<void> {
  const statut = d.sous_statut as SousStatut;
  // RG-06 : le dépôt de l'Accord, par n'importe quel acteur, fait avancer le dossier et déclenche l'ODM.
  if (code === "ACC" && (statut === "dossier_valide" || statut === "dossier_depose")) await executerAction(s, "systeme", d.id, "enregistrer_accord");
  // Étape D : le dossier bascule seul de « incomplet » à « complet » quand la dernière pièce requise revient.
  if (statut === "fin_dossier_incomplet" || statut === "fin_dossier_complet") await executerAction(s, "systeme", d.id, "reevaluer_completude");
}

export async function marquerValidee(s: Services, d: LigneDossier, piece: LignePiece, acteur: Acteur, retour: { chemin: string; nom_fichier: string; mode: "signature" | "depot" | "formulaire" }): Promise<void> {
  const empreinte_retour = sha256(await s.archive.lire(retour.chemin));
  await s.bd
    .update(pieceDossier)
    .set({ statut: "valide", chemin_retour: retour.chemin, nom_fichier_retour: retour.nom_fichier, empreinte_retour, mode_retour: retour.mode, retour_le: s.horloge.maintenant(), retour_par: acteur.utilisateur_id || null })
    .where(eq(pieceDossier.id, piece.id));
  const def = definitionPiece(piece.code as CodePiece);
  await journaliser(s, {
    of_id: d.of_id,
    dossier_id: d.id,
    acteur,
    type: "piece_validee",
    libelle: `${def.libelle} — ${retour.mode === "signature" ? "signée en ligne" : retour.mode === "formulaire" ? "renseignée en ligne" : "document déposé"} par ${acteur.nom}`,
    detail: { code: piece.code, stagiaire_id: piece.stagiaire_id, mode: retour.mode },
  });
  await apresValidation(s, d, piece.code as CodePiece);
}

/** (b) Dépôt d'un fichier : pièce signée hors ligne, ou document externe (accord, refus, facture du formateur). */
export async function deposerRetour(s: Services, acteur: Acteur, pieceId: string, fichier: FichierDepose): Promise<LignePiece> {
  const { d, piece } = await chargerPiece(s, acteur, pieceId);
  exigerDossierOuvert(d);
  const code = piece.code as CodePiece;
  if (!peutValider(code, acteur.role)) throw interdit("Ce document n'attend pas de retour de votre part.");
  validerFichier(fichier, "piece");

  const base = nomFichierPiece(code, await nomDuStagiaire(s, d, piece.stagiaire_id));
  const nom = `${base}_retour.${extensionDe(fichier.nom)}`;
  const chemin = await s.archive.ecrire(cheminPiece(d.of_id, d.dossier_reference, "Retour", nom), fichier.contenu);
  await marquerValidee(s, d, piece, acteur, { chemin, nom_fichier: fichier.nom, mode: "depot" });
  return (await trouverPiece(s, d.id, code, piece.stagiaire_id))!;
}

/** Dépôt d'une pièce externe qui n'existe pas encore sur le dossier (accord ou refus de financement). */
export async function deposerPieceExterne(s: Services, acteur: Acteur, dossierId: string, code: string, fichier: FichierDepose): Promise<LignePiece> {
  if (!estCodePiece(code) || definitionPiece(code).mode !== "deposee") throw invalide("Cette pièce ne se dépose pas.");
  const d = await accederAuDossier(s, acteur, dossierId);
  let piece = await trouverPiece(s, d.id, code, null);
  if (!piece) {
    if (code !== "REF") throw new ErreurMetier("conflit", "Cette pièce n'est pas encore attendue à cette étape du dossier.");
    if (!["dossier_valide", "dossier_depose"].includes(d.sous_statut)) throw new ErreurMetier("conflit", "Un refus de financement ne s'enregistre qu'après la validation du dossier.");
    await s.bd.insert(pieceDossier).values({ id: nouvelId(), dossier_id: d.id, code, stagiaire_id: null });
    piece = (await trouverPiece(s, d.id, code, null))!;
  }
  return deposerRetour(s, acteur, piece.id, fichier);
}

/** (a) Signature en ligne : tracé manuscrit + lieu + horodatage serveur + empreinte du document présenté. */
export async function signerPiece(s: Services, acteur: Acteur, pieceId: string, demande: { trace_png: string; lieu: string; consentement: boolean }, adresseIp = ""): Promise<LignePiece> {
  const { d, piece } = await chargerPiece(s, acteur, pieceId);
  exigerDossierOuvert(d);
  const code = piece.code as CodePiece;
  const def = definitionPiece(code);
  if (def.mode !== "generee") throw invalide("Ce document se dépose ; il ne se signe pas en ligne.");
  if (!peutValider(code, acteur.role) || acteur.role === "admin" || (acteur.role === "formateur" && code !== "04-AVT")) throw interdit("Ce document n'attend pas votre signature.");
  if (piece.statut === "valide") throw new ErreurMetier("conflit", "Ce document est déjà validé.");
  const erreurs = validerDemandeSignature(demande);
  if (erreurs.length > 0) throw invalide(erreurs[0]!, { erreurs });

  // L'empreinte scelle le document TEL QU'IL EST PRÉSENTÉ au signataire, avant apposition de sa signature.
  const avant = await rendrePiece(s, d, piece);
  const horodatage = s.horloge.maintenant();
  const preuve: PreuveSignature = {
    signataire_nom: acteur.nom,
    signataire_role: acteur.role,
    signataire_email: acteur.email,
    trace_png: demande.trace_png,
    lieu: demande.lieu.trim(),
    horodatage: horodatage.toISOString(),
    empreinte_document: sha256(avant.html),
    adresse_ip: adresseIp,
  };
  await s.bd.insert(signature).values({ id: nouvelId(), piece_id: piece.id, utilisateur_id: acteur.utilisateur_id, zone: acteur.role, ...preuve, adresse_ip: adresseIp, horodatage });

  const apres = await rendrePiece(s, d, piece);
  const base = nomFichierPiece(code, await nomDuStagiaire(s, d, piece.stagiaire_id));
  const { chemin } = await archiverRendu(s, d, "Retour", `${base}_signe`, apres.html);
  await s.archive.ecrire(cheminPiece(d.of_id, d.dossier_reference, "Retour", `${base}_certificat-signature.html`), certificatHtml(preuve, { code, libelle: def.libelle, dossier_reference: d.dossier_reference }));
  await marquerValidee(s, d, piece, acteur, { chemin, nom_fichier: chemin.split("/").pop()!, mode: "signature" });
  return (await trouverPiece(s, d.id, code, piece.stagiaire_id))!;
}

/**
 * Contrôle d'intégrité d'une pièce retournée : l'empreinte du fichier archivé est recalculée et comparée à
 * celle scellée au moment du retour. Un document modifié après coup est détecté.
 */
export async function verifierIntegritePiece(s: Services, acteur: Acteur, pieceId: string): Promise<{ retournee: boolean; integre: boolean | null; preuve: Omit<PreuveSignature, "trace_png"> | null }> {
  const { piece } = await chargerPiece(s, acteur, pieceId);
  if (!piece.chemin_retour || !piece.empreinte_retour) return { retournee: false, integre: null, preuve: null };
  const integre = (await s.archive.existe(piece.chemin_retour)) && sha256(await s.archive.lire(piece.chemin_retour)) === piece.empreinte_retour;
  const [sig] = await s.bd.select().from(signature).where(eq(signature.piece_id, piece.id));
  if (!sig) return { retournee: true, integre, preuve: null };
  const { trace_png: _t, ...reste } = sig;
  return { retournee: true, integre, preuve: { ...reste, signataire_role: sig.signataire_role as PreuveSignature["signataire_role"], horodatage: sig.horodatage.toISOString() } };
}

/** Aperçu HTML courant d'une pièce (à l'écran, à l'impression, avant signature). */
export async function apercuPiece(s: Services, acteur: Acteur, pieceId: string): Promise<string> {
  const { d, piece } = await chargerPiece(s, acteur, pieceId);
  if (definitionPiece(piece.code as CodePiece).mode !== "generee" && piece.code !== "10-FIN") throw introuvable("Aperçu");
  return (await rendrePiece(s, d, piece)).html;
}

/** F-COM-09 / F-CRM-04 : téléchargement d'une pièce, dans sa version de départ ou retournée. */
export async function telechargerPiece(s: Services, acteur: Acteur, pieceId: string, version: "depart" | "retour"): Promise<{ nom: string; type_mime: string; contenu: Buffer }> {
  const { d, piece } = await chargerPiece(s, acteur, pieceId);
  let chemin = version === "retour" ? piece.chemin_retour : piece.chemin_depart;
  if (!chemin && version === "depart" && definitionPiece(piece.code as CodePiece).mode === "generee") {
    chemin = (await genererPiece(s, d, piece.code as CodePiece, piece.stagiaire_id)).chemin_depart;
  }
  if (!chemin) throw introuvable("Document");
  const nom = chemin.split("/").pop()!;
  return { nom, type_mime: typeMimeDe(nom), contenu: await s.archive.lire(chemin) };
}

/** Le formateur (ou l'admin) régénère une pièce non encore validée, après correction des données. */
export async function regenererPiece(s: Services, acteur: Acteur, pieceId: string): Promise<LignePiece> {
  if (acteur.role === "apprenant") throw interdit();
  const { d, piece } = await chargerPiece(s, acteur, pieceId);
  exigerDossierOuvert(d);
  if (piece.statut === "valide") throw new ErreurMetier("conflit", "Une pièce validée ne se régénère pas : elle fait foi.");
  return genererPiece(s, d, piece.code as CodePiece, piece.stagiaire_id);
}

/** Trame de facture pré-remplie proposée au formateur (pièce 10-FIN : il dépose ensuite SA facture). */
export async function trameFactureFormateur(s: Services, acteur: Acteur, dossierId: string): Promise<string> {
  if (acteur.role === "apprenant") throw interdit();
  const d = await accederAuDossier(s, acteur, dossierId);
  const piece = await trouverPiece(s, d.id, "10-FIN", null);
  if (!piece) throw new ErreurMetier("conflit", "La trame de facture est disponible une fois la formation terminée.");
  return (await rendrePiece(s, d, piece)).html;
}

// ——— Émargement électronique, séance par séance ———

export async function emarger(s: Services, acteur: Acteur, seanceId: string, demande: { trace_png: string; stagiaire_id?: string }): Promise<void> {
  const [se] = await s.bd.select().from(seance).where(eq(seance.id, seanceId));
  if (!se) throw introuvable("Séance");
  const d = await accederAuDossier(s, acteur, se.dossier_id);
  exigerDossierOuvert(d);
  if (!["formation_debutee", "fin_dossier_incomplet", "fin_dossier_complet"].includes(d.sous_statut)) {
    throw new ErreurMetier("conflit", "L'émargement n'est ouvert qu'une fois la formation démarrée.");
  }
  const erreurs = validerDemandeSignature({ trace_png: demande.trace_png, lieu: "séance", consentement: true });
  if (erreurs.length > 0) throw invalide(erreurs[0]!);

  const inscrits = (await stagiairesDuDossier(s, d.id)).map((l) => l.st.id);
  let cibles: string[];
  let signataire: "stagiaire" | "formateur";
  if (acteur.role === "apprenant") {
    if (!acteur.stagiaire_id || !inscrits.includes(acteur.stagiaire_id)) throw interdit();
    cibles = [acteur.stagiaire_id];
    signataire = "stagiaire";
  } else if (acteur.role === "formateur") {
    // Le formateur contresigne pour un stagiaire donné, ou pour toute la séance.
    cibles = demande.stagiaire_id ? [demande.stagiaire_id] : inscrits;
    if (cibles.some((c) => !inscrits.includes(c))) throw invalide("Ce stagiaire n'est pas inscrit à ce dossier.");
    signataire = "formateur";
  } else throw interdit("L'émargement est signé par le stagiaire et par le formateur.");

  for (const stagiaire_id of cibles) {
    await s.bd
      .insert(emargement)
      .values({ id: nouvelId(), seance_id: seanceId, stagiaire_id, signataire, trace_png: demande.trace_png, horodatage: s.horloge.maintenant() })
      .onConflictDoNothing();
  }
  await journaliser(s, { of_id: d.of_id, dossier_id: d.id, acteur, type: "emargement", libelle: `Émargement de la séance du ${se.date} par ${acteur.nom}`, detail: { seance_id: seanceId, signataire } });
}

export async function etatEmargement(s: Services, acteur: Acteur, dossierId: string) {
  const d = await accederAuDossier(s, acteur, dossierId);
  const seances = await s.bd.select().from(seance).where(eq(seance.dossier_id, d.id)).orderBy(seance.date, seance.heure_debut);
  const pointages = seances.length ? await s.bd.select({ e: emargement }).from(emargement).innerJoin(seance, and(eq(seance.id, emargement.seance_id), eq(seance.dossier_id, d.id))) : [];
  const visibles = pointages.map((p) => p.e).filter((e) => acteur.role !== "apprenant" || e.stagiaire_id === acteur.stagiaire_id);
  return seances.map((se) => ({
    ...se,
    duree_heures: dureeSeanceHeures(se.heure_debut, se.heure_fin),
    signatures: visibles.filter((e) => e.seance_id === se.id).map((e) => ({ stagiaire_id: e.stagiaire_id, signataire: e.signataire, horodatage: e.horodatage })),
  }));
}
