/**
 * Formulaires de l'apprenant en page interactive (version 7, 23/09/2026) — demande du porteur de projet :
 * « l'apprenant a accès à une version PDF ou une page ; il clique et hop, page interactive avec son nom, sa formation,
 * le nom du formulaire ; il répond, signe, validé, et ça se charge automatiquement dans les dossiers correspondants ».
 *
 * Cinq formulaires : recueil des besoins (00-AVT), test de positionnement (01-AVT), évaluation des acquis (07-FIN),
 * satisfaction à chaud (08-FIN), satisfaction à froid (12-APR). Pour chacun :
 *  - ENVOI : automatique au bon moment du dossier (création → recueil + positionnement ; formation terminée → acquis +
 *    à chaud ; J+90 → à froid), et « Envoyer / Renvoyer » à tout moment par le formateur. L'e-mail porte un lien
 *    personnel (45 jours) et un document d'invitation (PDF avec QR code) ;
 *  - PAGE : sans compte ; réponses, brouillon reprenable, date, lieu, signature tracée, consentement ;
 *  - VALIDATION : les réponses sont enregistrées, la pièce est rendue AVEC la signature de l'apprenant, archivée dans
 *    « Retour » avec son certificat, et passe à « Validé » : elle apparaît aussitôt dans le dossier, l'espace de
 *    l'apprenant et le coffre-fort administratif du parcours. Le PDF part à l'apprenant et au formateur.
 *
 * Le jeton n'est jamais stocké en clair (empreinte SHA-256). Le corrigé d'un QCM ne quitte jamais le serveur.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import QRCode from "qrcode";
import { sansCorrige } from "@/domaine/formulaires/qcm";
import { echapperHtml as e } from "@/domaine/gabarits/moteur";
import { estTerminal, type SousStatut } from "@/domaine/pipeline/statuts";
import { definitionPiece } from "@/domaine/referentiel/pieces";
import { certificatHtml, validerDemandeSignature, type PreuveSignature } from "@/domaine/signature/preuve";
import { dossierFormation, formateur, formulaireApprenant, pieceDossier, signature, stagiaire, utilisateur } from "../bd/schema";
import { cheminPiece, nomSur } from "../ports/archive";
import { dateIso, jetonAleatoire, nouvelId, sha256 } from "../ports/divers";
import { accederAuDossier, stagiairesDuDossier, type LigneDossier } from "./agregat";
import { normaliserEmail } from "./auth";
import { courriels } from "./courriels";
import { CONFIG_EVALUATIONS, controlerReponses, enregistrerReponses, formulaireDe, questionnaireDe, questionnaireOuvert, TYPES_EVALUATION, type TypeEvaluation } from "./evaluations";
import { archiverRendu, nomFichierPiece, rendrePiece, synchroniserPieces, trouverPiece } from "./generation";
import { lireOrganisme } from "./organisme";
import { marquerValidee } from "./retours";
import { ErreurMetier, interdit, introuvable, invalide, journaliser, type Acteur, type Services } from "./socle";

export type TypeFormulaire = TypeEvaluation;
export const DUREE_LIEN_FORMULAIRE_MS = 45 * 24 * 3600 * 1000;
export const DELAI_RELANCE_JOURS = 7;
export const DELAI_FROID_JOURS = 90;

type Ligne = typeof formulaireApprenant.$inferSelect;
type LigneStagiaire = typeof stagiaire.$inferSelect;

const lienDe = (s: Services, jeton: string) => `${s.appUrl}/formulaire/${jeton}`;
const dateFrLongue = (d: Date) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(d);

/** Quand chaque formulaire part automatiquement (affiché au formateur pour qu'il sache ce qui se passe). */
export const MOMENTS: Record<TypeFormulaire, string> = {
  recueil: "à la création du dossier",
  positionnement: "à la création du dossier",
  acquis: "quand la formation est déclarée terminée",
  satisfaction_chaud: "quand la formation est déclarée terminée",
  satisfaction_froid: "90 jours après la fin de la formation",
};

async function dossierSysteme(s: Services, dossierId: string): Promise<LigneDossier> {
  const [d] = await s.bd.select().from(dossierFormation).where(eq(dossierFormation.id, dossierId));
  if (!d) throw introuvable("Dossier");
  return d;
}

/**
 * Compte « apprenant » rattaché à la fiche (créé sans e-mail s'il manque) : il porte la signature et la validation de
 * la pièce (`retour_par`). Si l'adresse est celle d'un formateur ou d'un administrateur, la pièce est validée sans compte.
 */
async function compteApprenant(s: Services, d: LigneDossier, st: LigneStagiaire): Promise<string | null> {
  if (st.utilisateur_id) return st.utilisateur_id;
  if (!st.stagiaire_email) return null;
  const email = normaliserEmail(st.stagiaire_email);
  const [existant] = await s.bd.select().from(utilisateur).where(eq(utilisateur.email, email));
  if (existant && existant.role !== "apprenant") return null;
  const id = existant?.id ?? nouvelId();
  if (!existant) await s.bd.insert(utilisateur).values({ id, of_id: d.of_id, email, role: "apprenant", prenom: st.stagiaire_prenom, nom: st.stagiaire_nom, cree_le: s.horloge.maintenant() });
  await s.bd.update(stagiaire).set({ utilisateur_id: id }).where(eq(stagiaire.id, st.id));
  return id;
}

// ——— Envoi ———

/**
 * Envoie (ou renvoie) un formulaire à un apprenant du dossier. Un nouveau lien remplace l'ancien.
 * `acteur` : le formateur ou l'organisme (bouton), ou « systeme » (envoi automatique).
 */
export async function envoyerFormulaire(s: Services, acteur: Acteur | "systeme", dossierId: string, stagiaireId: string, type: TypeFormulaire, options: { message?: string; relance?: boolean } = {}) {
  if (acteur !== "systeme" && acteur.role === "apprenant") throw interdit();
  const d = acteur === "systeme" ? await dossierSysteme(s, dossierId) : await accederAuDossier(s, acteur, dossierId);
  const config = CONFIG_EVALUATIONS[type];
  if (estTerminal(d.sous_statut as SousStatut)) throw new ErreurMetier("conflit", "Ce dossier est archivé.");
  if (!questionnaireOuvert(d, type)) throw new ErreurMetier("conflit", `« ${config.libelle} » n'est pas encore ouvert à cette étape du dossier (il s'ouvre ${MOMENTS[type]}).`);
  const st = (await stagiairesDuDossier(s, d.id)).find((l) => l.st.id === stagiaireId)?.st;
  if (!st) throw invalide("Ce stagiaire n'est pas inscrit à ce dossier.");
  if (!st.stagiaire_email) throw invalide(`La fiche de ${st.stagiaire_prenom} ${st.stagiaire_nom} n'a pas d'adresse e-mail : ajoutez-la pour lui envoyer son formulaire.`);
  if ((type === "positionnement" || type === "acquis") && !questionnaireDe(d, type)) {
    throw new ErreurMetier("conflit", `Aucun ${config.libelle.toLowerCase()} n'est rattaché à ce dossier : générez-le avec l'IA depuis la fiche formation, puis recréez le dossier.`);
  }
  await synchroniserPieces(s, d);
  const piece = await trouverPiece(s, d.id, config.code, st.id);
  if (piece?.statut === "valide") throw new ErreurMetier("conflit", `« ${config.libelle} » de ${st.stagiaire_prenom} ${st.stagiaire_nom} est déjà validé.`);

  const maintenant = s.horloge.maintenant();
  const jeton = jetonAleatoire();
  const expire_le = new Date(maintenant.getTime() + DUREE_LIEN_FORMULAIRE_MS);
  const [existant] = await s.bd.select().from(formulaireApprenant).where(and(eq(formulaireApprenant.dossier_id, d.id), eq(formulaireApprenant.stagiaire_id, st.id), eq(formulaireApprenant.type, type)));
  const id = existant?.id ?? nouvelId();
  if (existant) {
    await s.bd.update(formulaireApprenant).set({ jeton_hash: sha256(jeton), statut: existant.statut === "complet" ? "complet" : existant.brouillon ? "en_cours" : "envoye", envois: existant.envois + 1, envoye_le: maintenant, expire_le }).where(eq(formulaireApprenant.id, id));
  } else {
    await s.bd.insert(formulaireApprenant).values({ id, of_id: d.of_id, dossier_id: d.id, stagiaire_id: st.id, type, jeton_hash: sha256(jeton), envois: 1, envoye_le: maintenant, expire_le, cree_le: maintenant });
  }

  const of = await lireOrganisme(s, d.of_id);
  const [form] = await s.bd.select().from(formateur).where(eq(formateur.id, d.formateur_id));
  const lien = lienDe(s, jeton);
  const invitation = await documentInvitation(s, { of_nom: of.of_nom, couleur: of.couleur, apprenant: `${st.stagiaire_prenom} ${st.stagiaire_nom}`, formation: d.formation_titre, libelle: config.libelle, lien, expire: dateFrLongue(expire_le), formateur: `${form?.formateur_prenom ?? ""} ${form?.formateur_nom ?? ""}`.trim() });
  const pdf = await s.pdf.convertir(invitation);
  const nomDoc = `${nomSur(`Invitation ${config.libelle} - ${st.stagiaire_prenom} ${st.stagiaire_nom}`)}.${pdf ? "pdf" : "html"}`;
  const chemin = await s.archive.ecrire(cheminPiece(d.of_id, d.dossier_reference, "Pièces de départ", nomDoc), pdf ?? invitation);
  await s.bd.update(formulaireApprenant).set({ chemin_invitation: chemin }).where(eq(formulaireApprenant.id, id));

  const c = courriels.formulaireApprenant({ of_nom: of.of_nom, prenom: st.stagiaire_prenom, formateur: `${form?.formateur_prenom ?? ""} ${form?.formateur_nom ?? ""}`.trim(), formation: d.formation_titre, libelle: config.libelle, message: options.message ?? "", lien, expire: dateFrLongue(expire_le), relance: options.relance === true });
  const envoi = await s.courrier.envoyer({ of_id: d.of_id, dossier_id: d.id, type: `formulaire_${type}`, destinataire: st.stagiaire_email, ...c, pieces_jointes: [{ nom: nomDoc, chemin }] });
  await journaliser(s, { of_id: d.of_id, dossier_id: d.id, acteur, type: "formulaire_envoye", libelle: `${config.libelle} ${options.relance ? "relancé" : "envoyé"} à ${st.stagiaire_prenom} ${st.stagiaire_nom}${envoi.statut === "echec" ? " (échec d'envoi de l'e-mail)" : ""}`, detail: { type, statut_envoi: envoi.statut } });
  return { id, lien, statut_envoi: envoi.statut, erreur_envoi: envoi.erreur, invitation: chemin };
}

/**
 * Envoi automatique des formulaires ouverts à cette étape, à tous les stagiaires qui ne les ont jamais reçus et dont la
 * pièce n'est pas validée. Un échec pour un stagiaire n'empêche pas les autres.
 */
export async function envoyerFormulairesAutomatiques(s: Services, d: LigneDossier, types: TypeFormulaire[]): Promise<number> {
  let envoyes = 0;
  const liens = await stagiairesDuDossier(s, d.id);
  const existants = await s.bd.select().from(formulaireApprenant).where(eq(formulaireApprenant.dossier_id, d.id));
  const pieces = await s.bd.select().from(pieceDossier).where(eq(pieceDossier.dossier_id, d.id));
  for (const type of types) {
    if (!questionnaireOuvert(d, type)) continue;
    for (const { st } of liens) {
      if (!st.stagiaire_email) continue;
      if (existants.some((f) => f.stagiaire_id === st.id && f.type === type)) continue;
      if (pieces.some((p) => p.code === CONFIG_EVALUATIONS[type].code && p.stagiaire_id === st.id && p.statut === "valide")) continue;
      try {
        await envoyerFormulaire(s, "systeme", d.id, st.id, type);
        envoyes++;
      } catch (err) {
        await journaliser(s, { of_id: d.of_id, dossier_id: d.id, acteur: "systeme", type: "formulaire_non_envoye", libelle: `${CONFIG_EVALUATIONS[type].libelle} non envoyé à ${st.stagiaire_prenom} ${st.stagiaire_nom} : ${err instanceof Error ? err.message : "erreur"}` });
      }
    }
  }
  return envoyes;
}

/**
 * Tâche quotidienne : satisfaction à froid à J+90 après la fin de la formation, et UNE relance à J+7 des formulaires
 * restés sans réponse. Idempotente (une ligne par formulaire, compteur d'envois).
 */
export async function envoyerFormulairesProgrammes(s: Services): Promise<number> {
  const maintenant = s.horloge.maintenant();
  let envois = 0;
  const seuilFroid = dateIso(new Date(maintenant.getTime() - DELAI_FROID_JOURS * 24 * 3600 * 1000));
  const termines = await s.bd.select().from(dossierFormation).where(inArray(dossierFormation.sous_statut, ["fin_dossier_complet", "demande_paiement", "paiement_receptionne"]));
  for (const d of termines.filter((x) => x.formation_date_fin && x.formation_date_fin <= seuilFroid)) {
    envois += await envoyerFormulairesAutomatiques(s, d, ["satisfaction_froid"]);
  }
  const seuilRelance = new Date(maintenant.getTime() - DELAI_RELANCE_JOURS * 24 * 3600 * 1000);
  const enAttente = await s.bd.select().from(formulaireApprenant).where(and(inArray(formulaireApprenant.statut, ["envoye", "en_cours"]), eq(formulaireApprenant.envois, 1)));
  for (const f of enAttente.filter((x) => x.envoye_le && x.envoye_le <= seuilRelance && x.expire_le > maintenant)) {
    try {
      await envoyerFormulaire(s, "systeme", f.dossier_id, f.stagiaire_id, f.type as TypeFormulaire, { relance: true });
      envois++;
    } catch {
      // Pièce validée entre-temps, dossier archivé… : rien à relancer.
    }
  }
  return envois;
}

/** Ancien nom, conservé pour la tâche de fond et les tests : satisfaction à froid à J+90. */
export const envoyerSatisfactionsAFroid = async (s: Services): Promise<number> => {
  const maintenant = s.horloge.maintenant();
  const seuil = dateIso(new Date(maintenant.getTime() - DELAI_FROID_JOURS * 24 * 3600 * 1000));
  const termines = await s.bd.select().from(dossierFormation).where(inArray(dossierFormation.sous_statut, ["fin_dossier_complet", "demande_paiement", "paiement_receptionne"]));
  let n = 0;
  for (const d of termines.filter((x) => x.formation_date_fin && x.formation_date_fin <= seuil)) n += await envoyerFormulairesAutomatiques(s, d, ["satisfaction_froid"]);
  return n;
};

// ——— Suivi côté formateur / organisme ———

/** État des formulaires d'un dossier : pour chaque stagiaire et chaque type, envoyé quand, combien de fois, répondu. */
export async function etatFormulaires(s: Services, acteur: Acteur, dossierId: string) {
  const d = await accederAuDossier(s, acteur, dossierId);
  const lignes = await s.bd.select().from(formulaireApprenant).where(eq(formulaireApprenant.dossier_id, d.id));
  const pieces = await s.bd.select().from(pieceDossier).where(eq(pieceDossier.dossier_id, d.id));
  const liens = await stagiairesDuDossier(s, d.id);
  const maintenant = s.horloge.maintenant();
  return liens
    .filter((l) => acteur.role !== "apprenant" || l.st.id === acteur.stagiaire_id)
    .flatMap(({ st }) =>
      TYPES_EVALUATION.map((type) => {
        const f = lignes.find((x) => x.stagiaire_id === st.id && x.type === type);
        const piece = pieces.find((p) => p.code === CONFIG_EVALUATIONS[type].code && p.stagiaire_id === st.id);
        return {
          stagiaire_id: st.id,
          type,
          libelle: CONFIG_EVALUATIONS[type].libelle,
          code: CONFIG_EVALUATIONS[type].code,
          moment: MOMENTS[type],
          ouvert: questionnaireOuvert(d, type),
          envoye_le: f?.envoye_le ?? null,
          envois: f?.envois ?? 0,
          statut: piece?.statut === "valide" ? ("valide" as const) : f ? (f.statut === "complet" ? ("valide" as const) : f.statut === "en_cours" ? ("en_cours" as const) : f.expire_le <= maintenant ? ("expire" as const) : ("envoye" as const)) : ("non_envoye" as const),
          signe_le: f?.signe_le ?? null,
          piece_id: piece?.id ?? null,
          invitation: Boolean(f?.chemin_invitation),
        };
      }),
    );
}

export async function telechargerInvitation(s: Services, acteur: Acteur, dossierId: string, stagiaireId: string, type: TypeFormulaire) {
  const d = await accederAuDossier(s, acteur, dossierId);
  const [f] = await s.bd.select().from(formulaireApprenant).where(and(eq(formulaireApprenant.dossier_id, d.id), eq(formulaireApprenant.stagiaire_id, stagiaireId), eq(formulaireApprenant.type, type)));
  if (!f?.chemin_invitation) throw introuvable("Document d'invitation");
  const nom = f.chemin_invitation.split("/").pop()!;
  return { nom, contenu: await s.archive.lire(f.chemin_invitation), type_mime: nom.endsWith(".pdf") ? "application/pdf" : "text/html; charset=utf-8" };
}

// ——— Côté apprenant : page publique, par le lien personnel ———

async function parJeton(s: Services, jeton: string): Promise<{ f: Ligne; d: LigneDossier; st: LigneStagiaire }> {
  const [ligne] = await s.bd
    .select({ f: formulaireApprenant, st: stagiaire })
    .from(formulaireApprenant)
    .innerJoin(stagiaire, eq(stagiaire.id, formulaireApprenant.stagiaire_id))
    .where(eq(formulaireApprenant.jeton_hash, sha256(jeton)));
  // Un renvoi remplace le jeton : l'ancien lien (e-mail précédent) tombe ici.
  if (!ligne) throw new ErreurMetier("introuvable", "Ce lien n'est plus valable. Si vous avez reçu plusieurs e-mails, ouvrez le plus récent ; sinon, demandez à votre formateur de vous renvoyer le formulaire.");
  if (ligne.f.statut !== "complet" && ligne.f.expire_le <= s.horloge.maintenant()) throw new ErreurMetier("introuvable", "Ce lien a expiré. Demandez à votre formateur de vous renvoyer le formulaire.");
  const d = await dossierSysteme(s, ligne.f.dossier_id);
  return { f: ligne.f, d, st: ligne.st };
}

export async function lireFormulairePublic(s: Services, jeton: string) {
  const { f, d, st } = await parJeton(s, jeton);
  const type = f.type as TypeFormulaire;
  const config = CONFIG_EVALUATIONS[type];
  const of = await lireOrganisme(s, d.of_id);
  const [form] = await s.bd.select().from(formateur).where(eq(formateur.id, d.formateur_id));
  const piece = await trouverPiece(s, d.id, config.code, st.id);
  const q = questionnaireDe(d, type);
  const complet = f.statut === "complet" || piece?.statut === "valide";
  return {
    type,
    libelle: config.libelle,
    statut: complet ? ("complet" as const) : f.statut === "en_cours" ? ("en_cours" as const) : ("envoye" as const),
    ouvert: questionnaireOuvert(d, type),
    organisme: { nom: of.of_nom, couleur: of.couleur },
    formateur: `${form?.formateur_prenom ?? ""} ${form?.formateur_nom ?? ""}`.trim(),
    formation_titre: d.formation_titre,
    dates: { debut: d.formation_date_debut, fin: d.formation_date_fin },
    apprenant: { prenom: st.stagiaire_prenom, nom: st.stagiaire_nom, email: st.stagiaire_email },
    formulaire: formulaireDe(type),
    // Le corrigé ne quitte jamais le serveur à destination de l'apprenant.
    questionnaire: q ? sansCorrige(q) : null,
    brouillon: (f.brouillon ?? null) as { reponses?: unknown; date?: string; lieu?: string } | null,
    signe_le: f.signe_le,
    aujourdhui: dateIso(s.horloge.maintenant()),
    pdf: Boolean(piece?.chemin_retour),
  };
}

const SchemaBrouillon = z.object({
  reponses: z.union([z.record(z.string(), z.string().max(4000)), z.array(z.number().int().min(0).max(7).nullable()).max(40)]).default({}),
  date: z.string().max(10).default(""),
  lieu: z.string().trim().max(120).default(""),
});

/** « Enregistrer et reprendre plus tard » : rien n'est perdu, même en changeant d'appareil. */
export async function enregistrerBrouillonPublic(s: Services, jeton: string, donnees: unknown) {
  const { f } = await parJeton(s, jeton);
  if (f.statut === "complet") throw new ErreurMetier("conflit", "Ce formulaire est déjà signé.");
  const brouillon = SchemaBrouillon.parse(donnees);
  await s.bd.update(formulaireApprenant).set({ brouillon, statut: "en_cours" }).where(eq(formulaireApprenant.id, f.id));
  return { enregistre_le: s.horloge.maintenant() };
}

const SchemaSignature = SchemaBrouillon.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indiquez la date."),
  trace_png: z.string(),
  lieu: z.string().trim().max(120),
  consentement: z.boolean(),
});

/**
 * Répond ET signe : réponses enregistrées, pièce rendue avec la signature, archivée avec son certificat, validée.
 * La pièce validée apparaît immédiatement dans le dossier, l'espace de l'apprenant et le coffre-fort du parcours.
 */
export async function signerFormulairePublic(s: Services, jeton: string, donnees: unknown, adresseIp = "") {
  const { f, d, st } = await parJeton(s, jeton);
  const type = f.type as TypeFormulaire;
  const config = CONFIG_EVALUATIONS[type];
  if (f.statut === "complet") throw new ErreurMetier("conflit", "Ce formulaire est déjà signé.");
  if (!questionnaireOuvert(d, type)) throw new ErreurMetier("conflit", "Ce formulaire n'est plus ouvert : le dossier a changé d'étape.");
  const v = SchemaSignature.parse(donnees);

  // Contrôles AVANT toute écriture : réponses complètes, puis signature recevable.
  const erreurs: string[] = [];
  let erreursChamps: Record<string, string> = {};
  try {
    controlerReponses(d, type, v.reponses);
  } catch (err) {
    if (err instanceof ErreurMetier) {
      erreurs.push(err.message);
      const det = (err.details as { erreurs?: Record<string, string> } | undefined)?.erreurs;
      if (det && !Array.isArray(det)) {
        erreursChamps = det;
        const def = formulaireDe(type);
        erreurs.length = 0;
        for (const [cle, msg] of Object.entries(det)) erreurs.push(`${def?.champs.find((c) => c.id === cle)?.libelle ?? cle} : ${msg}`);
      }
    } else throw err;
  }
  erreurs.push(...validerDemandeSignature({ trace_png: v.trace_png, lieu: v.lieu, consentement: v.consentement }));
  if (erreurs.length > 0) throw invalide("Le formulaire est incomplet.", { erreurs, champs: erreursChamps });

  const utilisateur_id = await compteApprenant(s, d, st);
  const acteur: Acteur = { utilisateur_id: utilisateur_id ?? "", of_id: d.of_id, role: "apprenant", formateur_id: null, formateur_valide: false, stagiaire_id: st.id, nom: `${st.stagiaire_prenom} ${st.stagiaire_nom}`, email: st.stagiaire_email };

  // 1. Réponses (sans valider la pièce : c'est la signature qui la valide, ci-dessous).
  const { piece } = await enregistrerReponses(s, d, st.id, type, { reponses: v.reponses }, { utilisateur_id, acteur, validerPiece: false });
  if (!piece) throw new ErreurMetier("conflit", "La pièce correspondante n'existe pas encore sur ce dossier.");

  // 2. Signature : empreinte du document TEL QUE PRÉSENTÉ (réponses comprises), puis rendu signé + certificat.
  const avant = await rendrePiece(s, d, piece);
  const horodatage = s.horloge.maintenant();
  const preuve: PreuveSignature = { signataire_nom: acteur.nom, signataire_role: "apprenant", signataire_email: st.stagiaire_email, trace_png: v.trace_png, lieu: v.lieu.trim(), horodatage: horodatage.toISOString(), empreinte_document: sha256(avant.html), adresse_ip: adresseIp };
  await s.bd.delete(signature).where(and(eq(signature.piece_id, piece.id), eq(signature.zone, "apprenant")));
  await s.bd.insert(signature).values({ id: nouvelId(), piece_id: piece.id, utilisateur_id, zone: "apprenant", ...preuve, adresse_ip: adresseIp, horodatage });
  const apres = await rendrePiece(s, d, piece);
  const base = nomFichierPiece(config.code, acteur.nom);
  const { chemin } = await archiverRendu(s, d, "Retour", `${base}_signe`, apres.html);
  await s.archive.ecrire(cheminPiece(d.of_id, d.dossier_reference, "Retour", `${base}_certificat-signature.html`), certificatHtml(preuve, { code: config.code, libelle: definitionPiece(config.code).libelle, dossier_reference: d.dossier_reference }));

  // 3. Validation : la pièce passe à « Validé » — dossier, espace apprenant et coffre-fort la voient aussitôt.
  await marquerValidee(s, d, piece, acteur, { chemin, nom_fichier: chemin.split("/").pop()!, mode: "signature" });
  await s.bd.update(formulaireApprenant).set({ statut: "complet", signe_le: horodatage, brouillon: null }).where(eq(formulaireApprenant.id, f.id));
  await journaliser(s, { of_id: d.of_id, dossier_id: d.id, acteur: "systeme", type: "formulaire_signe", libelle: `${config.libelle} répondu et signé par ${acteur.nom} (page interactive)`, detail: { type, adresse_ip: adresseIp, empreinte: preuve.empreinte_document } });

  // 4. Le document signé part à l'apprenant et au formateur.
  const of = await lireOrganisme(s, d.of_id);
  const [form] = await s.bd.select().from(formateur).where(eq(formateur.id, d.formateur_id));
  const pj = [{ nom: chemin.split("/").pop()!, chemin }];
  const conf = courriels.formulaireConfirmation({ of_nom: of.of_nom, prenom: st.stagiaire_prenom, formation: d.formation_titre, libelle: config.libelle, lien: lienDe(s, jeton) });
  await s.courrier.envoyer({ of_id: d.of_id, dossier_id: d.id, type: `formulaire_${type}_confirmation`, destinataire: st.stagiaire_email, ...conf, pieces_jointes: pj });
  if (form?.formateur_email) {
    const n = courriels.formulaireRecu({ of_nom: of.of_nom, prenom: form.formateur_prenom, apprenant: acteur.nom, formation: d.formation_titre, libelle: config.libelle, reference: d.dossier_reference, lien: `${s.appUrl}/dossiers/${d.id}` });
    await s.courrier.envoyer({ of_id: d.of_id, dossier_id: d.id, type: `formulaire_${type}_recu`, destinataire: form.formateur_email, ...n, pieces_jointes: pj });
  }
  return { statut: "complet" as const };
}

/** Le document signé, pour l'apprenant, par son lien (même après l'échéance du lien). */
export async function telechargerPdfPublic(s: Services, jeton: string) {
  const { f, d, st } = await parJeton(s, jeton);
  const piece = await trouverPiece(s, d.id, CONFIG_EVALUATIONS[f.type as TypeFormulaire].code, st.id);
  if (!piece?.chemin_retour) throw new ErreurMetier("conflit", "Le document est disponible une fois le formulaire signé.");
  const nom = piece.chemin_retour.split("/").pop()!;
  return { nom, contenu: await s.archive.lire(piece.chemin_retour), type_mime: nom.endsWith(".pdf") ? "application/pdf" : "text/html; charset=utf-8" };
}

// ——— Document d'invitation (PDF avec QR code) ———

async function documentInvitation(s: Services, o: { of_nom: string; couleur: string; apprenant: string; formation: string; libelle: string; lien: string; expire: string; formateur: string }): Promise<string> {
  const couleur = /^#[0-9a-f]{6}$/i.test(o.couleur) ? o.couleur : "#1d6a45";
  const qr = await QRCode.toString(o.lien, { type: "svg", margin: 1, width: 220, color: { dark: "#1f2a24", light: "#ffffff" } });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${e(o.libelle)} — ${e(o.apprenant)}</title><style>
@page{size:A4;margin:18mm 16mm}body{font-family:Inter,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1f2a24;margin:0}
.of{font-weight:700;color:${couleur};letter-spacing:.02em;font-size:12pt}h1{font-size:22pt;margin:14pt 0 4pt;color:${couleur}}h2{font-size:13pt;margin:18pt 0 6pt}
table{border-collapse:collapse;width:100%;margin-top:8pt}td,th{border:.6pt solid #c9cfc9;padding:6pt 8pt;vertical-align:top;text-align:left}th{background:#f4f6f3;width:34%;font-weight:600}
.qr{display:flex;gap:18pt;align-items:center;margin:14pt 0;padding:12pt;border:1.2pt solid ${couleur};border-radius:6pt}.qr svg{width:150pt;height:150pt;flex:0 0 auto}
.btn{display:inline-block;background:${couleur};color:#fff;text-decoration:none;padding:9pt 16pt;border-radius:5pt;font-weight:600}.lien{word-break:break-all;font-size:9pt;color:#5b6472}
ol{padding-left:16pt}.pied{margin-top:20pt;font-size:8.5pt;color:#5b6472}
</style></head><body>
<div class="of">${e(o.of_nom)}</div>
<h1>${e(o.libelle)}</h1>
<p>Bonjour ${e(o.apprenant)},</p>
<p>Votre formateur${o.formateur ? `, ${e(o.formateur)},` : ""} vous invite à renseigner et signer en ligne le formulaire « <strong>${e(o.libelle)}</strong> » de la formation <strong>${e(o.formation)}</strong>.</p>
<table><tr><th>Apprenant</th><td>${e(o.apprenant)}</td></tr><tr><th>Formation</th><td>${e(o.formation)}</td></tr><tr><th>Formulaire</th><td>${e(o.libelle)}</td></tr><tr><th>Lien valable jusqu'au</th><td>${e(o.expire)}</td></tr></table>
<div class="qr">${qr}<div><p><strong>Scannez ce code avec votre téléphone</strong>, ou cliquez sur le bouton :</p><p><a class="btn" href="${e(o.lien)}">Ouvrir mon formulaire</a></p><p class="lien">${e(o.lien)}</p></div></div>
<h2>Comment ça se passe</h2>
<ol><li>La page s'ouvre à votre nom, sans compte à créer : vos informations sont déjà renseignées.</li><li>Vous répondez aux questions (vous pouvez enregistrer et reprendre plus tard, sur n'importe quel appareil).</li><li>Vous indiquez la date et le lieu, puis vous signez avec le doigt ou la souris.</li><li>C'est validé : le document signé vous est envoyé par e-mail et rejoint automatiquement votre dossier de formation.</li></ol>
<p class="pied">Ce lien est personnel : ne le transmettez pas. Signature électronique simple (tracé, horodatage serveur, empreinte SHA-256). Document généré par la plateforme de ${e(o.of_nom)}.</p>
</body></html>`;
}

/** Pour la boîte d'envoi : les formulaires d'un organisme (filtrés par formateur), sans données de réponse. */
export async function listerFormulaires(s: Services, acteur: Acteur, filtre: { dossier_id?: string } = {}) {
  if (acteur.role === "apprenant") throw interdit();
  const lignes = await s.bd
    .select({ f: formulaireApprenant, st: stagiaire, d: dossierFormation })
    .from(formulaireApprenant)
    .innerJoin(stagiaire, eq(stagiaire.id, formulaireApprenant.stagiaire_id))
    .innerJoin(dossierFormation, eq(dossierFormation.id, formulaireApprenant.dossier_id))
    .where(and(eq(formulaireApprenant.of_id, acteur.of_id), ...(filtre.dossier_id ? [eq(formulaireApprenant.dossier_id, filtre.dossier_id)] : [])))
    .orderBy(desc(formulaireApprenant.envoye_le));
  return lignes
    .filter(({ d }) => acteur.role !== "formateur" || d.formateur_id === acteur.formateur_id)
    .map(({ f, st, d }) => ({ id: f.id, dossier_id: d.id, dossier_reference: d.dossier_reference, formation_titre: d.formation_titre, apprenant: `${st.stagiaire_prenom} ${st.stagiaire_nom}`, type: f.type, libelle: CONFIG_EVALUATIONS[f.type as TypeFormulaire].libelle, statut: f.statut, envois: f.envois, envoye_le: f.envoye_le, signe_le: f.signe_le }));
}
