/**
 * Invitation d'un apprenant à se POSITIONNER sur un parcours, avant tout dossier — « Modification 1 » du 23/09/2026 :
 * « le formateur invite un apprenant à se positionner sur un parcours ; cela envoie un mail automatique avec accès à
 * la page dédiée à son positionnement (nom, e-mail) ; il répond au recueil des besoins et au test de positionnement
 * associé à la formation ; il tape ses réponses, date, signe par dessin ; transformé en PDF ; si complet, tout le monde
 * peut télécharger le PDF ».
 *
 * Choix : l'apprenant n'a PAS besoin de créer un compte (le lien personnel suffit) — moins de friction, plus de
 * réponses. Il peut enregistrer et reprendre plus tard (brouillon côté serveur, donc sur n'importe quel appareil).
 * Le test et les questions du recueil sont FIGÉS à l'envoi. À la création d'un dossier pour ce même apprenant et ce
 * même parcours, les réponses signées sont reprises (RG-02 : recueil et positionnement joints au dossier).
 */
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { FORMULAIRES, validerReponses, type FormulaireDef } from "@/domaine/formulaires/definitions";
import { corriger, sansCorrige, type Questionnaire } from "@/domaine/formulaires/qcm";
import { echapperHtml as e } from "@/domaine/gabarits/moteur";
import { validerDemandeSignature } from "@/domaine/signature/preuve";
import { entrepriseCliente, formateur, modeleOutil, positionnement, stagiaire } from "../bd/schema";
import { nomSur } from "../ports/archive";
import { dateIso, jetonAleatoire, nouvelId, sha256 } from "../ports/divers";
import { stagiairesDuDossier, type LigneDossier } from "./agregat";
import { courriels } from "./courriels";
import { enregistrerReponses } from "./evaluations";
import { lireFormation } from "./formations";
import { lireOrganisme } from "./organisme";
import { lireStagiaire } from "./repertoire";
import { ErreurMetier, exigerFormateurValide, interdit, introuvable, invalide, journaliser, type Acteur, type Services } from "./socle";

export const DUREE_LIEN_POSITIONNEMENT_MS = 30 * 24 * 3600 * 1000;
type Ligne = typeof positionnement.$inferSelect;

const lienDe = (s: Services, jeton: string) => `${s.appUrl}/positionnement/${jeton}`;

/** Le recueil = les questions fixes de l'organisme (00-AVT) + celles ajoutées par le formateur. */
function formulaireRecueil(supplementaires: string[]): FormulaireDef {
  const base = FORMULAIRES["00-AVT"];
  return { ...base, champs: [...base.champs, ...supplementaires.map((libelle, i) => ({ id: `supp_${i + 1}`, libelle, type: "texte_long" as const }))] };
}

async function modele(s: Services, formateur_id: string, formation_id: string, type: "positionnement" | "recueil") {
  const modeles = await s.bd
    .select()
    .from(modeleOutil)
    .where(and(eq(modeleOutil.formateur_id, formateur_id), eq(modeleOutil.type, type), isNull(modeleOutil.archive_le)))
    .orderBy(desc(modeleOutil.cree_le));
  return modeles.find((m) => m.formation_id === formation_id) ?? modeles.find((m) => m.formation_id === null) ?? null;
}

const SchemaInvitation = z.object({
  stagiaire_id: z.string().min(1, "Choisissez l'apprenant."),
  formation_id: z.string().min(1, "Choisissez le parcours de formation."),
  message: z.string().trim().max(1000).default(""),
});

export async function inviterAuPositionnement(s: Services, acteur: Acteur, donnees: unknown) {
  const formateur_id = exigerFormateurValide(acteur);
  const v = SchemaInvitation.parse(donnees);
  const st = await lireStagiaire(s, acteur, v.stagiaire_id);
  const f = await lireFormation(s, acteur, v.formation_id);
  if (!st.stagiaire_email) throw invalide("La fiche de l'apprenant n'a pas d'adresse e-mail : ajoutez-la pour pouvoir l'inviter.");

  // Version 7 : plus de trame automatique. Le test de positionnement se génère avec l'IA (questions de connaissances)
  // depuis la fiche formation, puis s'enregistre dans les outils ; sans test, l'invitation est refusée avec la marche à suivre.
  const test = await modele(s, formateur_id, f.id, "positionnement");
  if (!test) throw invalide("Ce parcours n'a pas encore de test de positionnement : générez-le avec l'IA depuis la fiche formation (« Générer le test de positionnement »), enregistrez-le, puis invitez l'apprenant.");
  const test_cree = false;
  const recueil = await modele(s, formateur_id, f.id, "recueil");
  const supplementaires = ((recueil?.contenu as { questions_supplementaires?: string[] } | undefined)?.questions_supplementaires ?? []).slice(0, 10);

  const jeton = jetonAleatoire();
  const id = nouvelId();
  const maintenant = s.horloge.maintenant();
  const expire_le = new Date(maintenant.getTime() + DUREE_LIEN_POSITIONNEMENT_MS);
  await s.bd.insert(positionnement).values({
    id,
    of_id: acteur.of_id,
    formateur_id,
    formation_id: f.id,
    stagiaire_id: st.id,
    jeton_hash: sha256(jeton),
    message: v.message,
    formation_titre: f.formation_titre,
    questionnaire: test.contenu,
    questions_recueil: supplementaires,
    envoye_le: maintenant,
    expire_le,
    cree_le: maintenant,
  });
  await envoyerInvitation(s, acteur, id, jeton);
  await journaliser(s, { of_id: acteur.of_id, acteur, type: "positionnement_invite", libelle: `${st.stagiaire_prenom} ${st.stagiaire_nom} invité(e) à se positionner sur « ${f.formation_titre} »` });
  return { id, lien: lienDe(s, jeton), test_cree };
}

async function envoyerInvitation(s: Services, acteur: Acteur, id: string, jeton: string) {
  const p = await lirePositionnement(s, acteur, id);
  const of = await lireOrganisme(s, acteur.of_id);
  const [form] = await s.bd.select().from(formateur).where(eq(formateur.id, p.formateur_id));
  const c = courriels.invitationPositionnement({
    of_nom: of.of_nom,
    prenom: p.stagiaire.stagiaire_prenom,
    nom: p.stagiaire.stagiaire_nom,
    email: p.stagiaire.stagiaire_email,
    formateur: `${form?.formateur_prenom ?? ""} ${form?.formateur_nom ?? ""}`.trim(),
    formation: p.formation_titre,
    message: p.message,
    lien: lienDe(s, jeton),
    expire: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(p.expire_le),
  });
  await s.courrier.envoyer({ of_id: acteur.of_id, formateur_id: p.formateur_id, type: "invitation_positionnement", destinataire: p.stagiaire.stagiaire_email, ...c });
}

/** Lecture côté formateur (le sien) ou organisme (tous les siens). */
export async function lirePositionnement(s: Services, acteur: Acteur, id: string) {
  const [ligne] = await s.bd
    .select({ p: positionnement, st: stagiaire })
    .from(positionnement)
    .innerJoin(stagiaire, eq(stagiaire.id, positionnement.stagiaire_id))
    .where(and(eq(positionnement.id, id), eq(positionnement.of_id, acteur.of_id)));
  if (!ligne) throw introuvable("Positionnement");
  if (acteur.role === "apprenant") throw interdit();
  if (acteur.role === "formateur" && ligne.p.formateur_id !== acteur.formateur_id) throw introuvable("Positionnement");
  return { ...ligne.p, stagiaire: ligne.st };
}

export async function listerPositionnements(s: Services, acteur: Acteur, filtre: { formation_id?: string; archives?: boolean } = {}) {
  if (acteur.role === "apprenant") throw interdit();
  const conditions = [eq(positionnement.of_id, acteur.of_id), filtre.archives ? isNotNull(positionnement.archive_le) : isNull(positionnement.archive_le)];
  if (acteur.role === "formateur") conditions.push(eq(positionnement.formateur_id, exigerFormateurValide(acteur)));
  if (filtre.formation_id) conditions.push(eq(positionnement.formation_id, filtre.formation_id));
  const lignes = await s.bd
    .select({ p: positionnement, st: stagiaire, ent: entrepriseCliente })
    .from(positionnement)
    .innerJoin(stagiaire, eq(stagiaire.id, positionnement.stagiaire_id))
    .leftJoin(entrepriseCliente, eq(entrepriseCliente.id, stagiaire.entreprise_id))
    .where(and(...conditions))
    .orderBy(desc(positionnement.cree_le));
  const maintenant = s.horloge.maintenant();
  return lignes.map(({ p, st, ent }) => ({
    id: p.id,
    formation_id: p.formation_id,
    formation_titre: p.formation_titre,
    stagiaire_id: st.id,
    apprenant: `${st.stagiaire_prenom} ${st.stagiaire_nom}`,
    email: st.stagiaire_email,
    entreprise: ent?.entreprise_nom ?? "",
    statut: p.statut,
    expire: p.statut !== "complet" && p.expire_le <= maintenant,
    score: p.score,
    envoye_le: p.envoye_le,
    signe_le: p.signe_le,
    pdf: Boolean(p.chemin_pdf),
    archive_le: p.archive_le,
  }));
}

/** Relance : un NOUVEAU lien part (l'ancien cesse de fonctionner), la validité repart pour 30 jours. */
export async function relancerPositionnement(s: Services, acteur: Acteur, id: string) {
  const p = await lirePositionnement(s, acteur, id);
  if (acteur.role !== "formateur") throw interdit("La relance est faite par le formateur.");
  if (p.statut === "complet") throw new ErreurMetier("conflit", "Ce positionnement est déjà complet.");
  const jeton = jetonAleatoire();
  const maintenant = s.horloge.maintenant();
  await s.bd.update(positionnement).set({ jeton_hash: sha256(jeton), expire_le: new Date(maintenant.getTime() + DUREE_LIEN_POSITIONNEMENT_MS), envoye_le: maintenant }).where(eq(positionnement.id, id));
  await envoyerInvitation(s, acteur, id, jeton);
  return { lien: lienDe(s, jeton) };
}

export async function archiverPositionnement(s: Services, acteur: Acteur, id: string, archiver: boolean) {
  await lirePositionnement(s, acteur, id);
  if (acteur.role !== "formateur") throw interdit();
  await s.bd.update(positionnement).set({ archive_le: archiver ? s.horloge.maintenant() : null }).where(eq(positionnement.id, id));
}

export async function telechargerPdfPositionnement(s: Services, acteur: Acteur, id: string) {
  const p = await lirePositionnement(s, acteur, id);
  return fichierPdf(s, p);
}

async function fichierPdf(s: Services, p: Ligne & { stagiaire: typeof stagiaire.$inferSelect }) {
  if (!p.chemin_pdf) throw new ErreurMetier("conflit", "Le PDF est disponible une fois le positionnement complété et signé.");
  const nom = p.chemin_pdf.split("/").pop()!;
  return { nom, contenu: await s.archive.lire(p.chemin_pdf), type_mime: nom.endsWith(".pdf") ? "application/pdf" : "text/html; charset=utf-8" };
}

// ——— Côté apprenant : page publique, par le lien personnel ———

async function parJeton(s: Services, jeton: string) {
  const [ligne] = await s.bd
    .select({ p: positionnement, st: stagiaire })
    .from(positionnement)
    .innerJoin(stagiaire, eq(stagiaire.id, positionnement.stagiaire_id))
    .where(eq(positionnement.jeton_hash, sha256(jeton)));
  if (!ligne || ligne.p.archive_le) throw introuvable("Lien de positionnement");
  // Un positionnement complet reste consultable (et son PDF téléchargeable) même après l'échéance du lien.
  if (ligne.p.statut !== "complet" && ligne.p.expire_le <= s.horloge.maintenant()) {
    throw new ErreurMetier("introuvable", "Ce lien a expiré. Demandez à votre formateur de vous en renvoyer un.");
  }
  return { ...ligne.p, stagiaire: ligne.st };
}

export async function lirePositionnementPublic(s: Services, jeton: string) {
  const p = await parJeton(s, jeton);
  const of = await lireOrganisme(s, p.of_id);
  const [form] = await s.bd.select().from(formateur).where(eq(formateur.id, p.formateur_id));
  const q = p.questionnaire as Questionnaire | null;
  return {
    statut: p.statut,
    organisme: { nom: of.of_nom, couleur: of.couleur },
    formateur: `${form?.formateur_prenom ?? ""} ${form?.formateur_nom ?? ""}`.trim(),
    formation_titre: p.formation_titre,
    message: p.message,
    apprenant: { prenom: p.stagiaire.stagiaire_prenom, nom: p.stagiaire.stagiaire_nom, email: p.stagiaire.stagiaire_email },
    recueil: formulaireRecueil(p.questions_recueil as string[]),
    // Le corrigé ne quitte jamais le serveur à destination de l'apprenant.
    questionnaire: q ? sansCorrige(q) : null,
    brouillon: (p.brouillon ?? null) as { recueil?: Record<string, string>; reponses?: Array<number | null>; date?: string } | null,
    reponses_signees: p.statut === "complet" ? { recueil: p.recueil, reponses: p.reponses, date: p.date_reponse, lieu: p.signature_lieu, signe_le: p.signe_le } : null,
    aujourdhui: dateIso(s.horloge.maintenant()),
    pdf: Boolean(p.chemin_pdf),
  };
}

const SchemaBrouillon = z.object({
  recueil: z.record(z.string(), z.string().max(4000)).default({}),
  reponses: z.array(z.number().int().min(0).max(7).nullable()).max(40).default([]),
  date: z.string().max(10).default(""),
});

/** « Enregistrer et reprendre plus tard » : rien n'est perdu, même en changeant d'appareil. */
export async function enregistrerBrouillonPublic(s: Services, jeton: string, donnees: unknown) {
  const p = await parJeton(s, jeton);
  if (p.statut === "complet") throw new ErreurMetier("conflit", "Ce positionnement est déjà signé.");
  const brouillon = SchemaBrouillon.parse(donnees);
  await s.bd.update(positionnement).set({ brouillon, statut: "en_cours" }).where(eq(positionnement.id, p.id));
  return { enregistre_le: s.horloge.maintenant() };
}

const SchemaSignature = SchemaBrouillon.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indiquez la date."),
  trace_png: z.string(),
  lieu: z.string().trim().max(120),
  consentement: z.boolean(),
});

export async function signerPositionnementPublic(s: Services, jeton: string, donnees: unknown, adresseIp = "") {
  const p = await parJeton(s, jeton);
  if (p.statut === "complet") throw new ErreurMetier("conflit", "Ce positionnement est déjà signé.");
  const v = SchemaSignature.parse(donnees);

  const def = formulaireRecueil(p.questions_recueil as string[]);
  const erreursRecueil = validerReponses(def, v.recueil);
  const q = p.questionnaire as Questionnaire | null;
  const erreurs: string[] = Object.entries(erreursRecueil).map(([cle, msg]) => `Recueil — ${def.champs.find((c) => c.id === cle)?.libelle ?? cle} : ${msg}`);
  if (q) {
    if (v.reponses.length !== q.questions.length || v.reponses.some((r, i) => r === null || r >= q.questions[i]!.propositions.length)) erreurs.push("Test de positionnement : répondez à toutes les questions.");
  }
  erreurs.push(...validerDemandeSignature({ trace_png: v.trace_png, lieu: v.lieu, consentement: v.consentement }));
  if (erreurs.length > 0) throw invalide("Le positionnement est incomplet.", { erreurs, champs: erreursRecueil });

  const score = q ? corriger(q, v.reponses).score : null;
  const maintenant = s.horloge.maintenant();
  const of = await lireOrganisme(s, p.of_id);
  const [ent] = p.stagiaire.entreprise_id ? await s.bd.select().from(entrepriseCliente).where(eq(entrepriseCliente.id, p.stagiaire.entreprise_id)) : [];
  const empreinteReponses = sha256(JSON.stringify({ recueil: v.recueil, reponses: v.reponses, date: v.date }));
  const html = documentPositionnement({
    of_nom: of.of_nom,
    couleur: of.couleur,
    formation: p.formation_titre,
    apprenant: `${p.stagiaire.stagiaire_prenom} ${p.stagiaire.stagiaire_nom}`,
    email: p.stagiaire.stagiaire_email,
    entreprise: ent?.entreprise_nom ?? "",
    def,
    recueil: v.recueil,
    questionnaire: q,
    reponses: v.reponses,
    score,
    date: v.date,
    lieu: v.lieu,
    signe_le: maintenant,
    trace_png: v.trace_png,
    empreinte: empreinteReponses,
    reference: p.id,
  });
  const pdf = await s.pdf.convertir(html);
  const base = `${p.of_id}/positionnements/${p.id}/${nomSur(`Positionnement ${p.stagiaire.stagiaire_prenom} ${p.stagiaire.stagiaire_nom} - ${p.formation_titre}`).slice(0, 120)}`;
  const chemin = await s.archive.ecrire(`${base}.${pdf ? "pdf" : "html"}`, pdf ?? html);
  await s.bd
    .update(positionnement)
    .set({ statut: "complet", recueil: v.recueil, reponses: v.reponses, score, date_reponse: v.date, signature_png: v.trace_png, signature_lieu: v.lieu, signe_le: maintenant, chemin_pdf: chemin, empreinte_pdf: sha256(pdf ?? html), brouillon: null })
    .where(eq(positionnement.id, p.id));
  await journaliser(s, { of_id: p.of_id, acteur: "systeme", type: "positionnement_signe", libelle: `Positionnement signé par ${p.stagiaire.stagiaire_prenom} ${p.stagiaire.stagiaire_nom} (« ${p.formation_titre} »)`, detail: { positionnement_id: p.id, adresse_ip: adresseIp, empreinte: empreinteReponses } });

  const [form] = await s.bd.select().from(formateur).where(eq(formateur.id, p.formateur_id));
  const pj = [{ nom: chemin.split("/").pop()!, chemin }];
  if (form?.formateur_email) {
    const c = courriels.positionnementComplet({ of_nom: of.of_nom, prenom: form.formateur_prenom, apprenant: `${p.stagiaire.stagiaire_prenom} ${p.stagiaire.stagiaire_nom}`, formation: p.formation_titre, score: score === null ? "—" : `${score} / 100`, lien: `${s.appUrl}/positionnements` });
    await s.courrier.envoyer({ of_id: p.of_id, formateur_id: p.formateur_id, type: "positionnement_complet", destinataire: form.formateur_email, ...c, pieces_jointes: pj });
  }
  const conf = courriels.positionnementConfirmation({ of_nom: of.of_nom, prenom: p.stagiaire.stagiaire_prenom, formation: p.formation_titre, lien: lienDe(s, jeton) });
  await s.courrier.envoyer({ of_id: p.of_id, formateur_id: p.formateur_id, type: "positionnement_confirmation", destinataire: p.stagiaire.stagiaire_email, ...conf, pieces_jointes: pj });
  return { statut: "complet" as const };
}

export async function telechargerPdfPublic(s: Services, jeton: string) {
  return fichierPdf(s, await parJeton(s, jeton));
}

// ——— Reprise dans un dossier ———

/**
 * À la création d'un dossier : pour chaque stagiaire qui a déjà signé son positionnement sur CE parcours, ses réponses
 * sont reprises dans le dossier (recueil 00-AVT et test 01-AVT validés), à condition que le test du dossier soit
 * exactement celui auquel il a répondu. Sinon, rien n'est repris : on ne fait jamais correspondre des réponses à un
 * autre questionnaire. Retourne le nombre de stagiaires dont le positionnement a été repris.
 */
export async function reprendrePositionnements(s: Services, acteur: Acteur, d: LigneDossier): Promise<number> {
  if (!d.formation_id || acteur.role !== "formateur") return 0;
  const inscrits = await stagiairesDuDossier(s, d.id);
  if (inscrits.length === 0) return 0;
  const signes = await s.bd
    .select()
    .from(positionnement)
    .where(and(eq(positionnement.formation_id, d.formation_id), eq(positionnement.statut, "complet"), inArray(positionnement.stagiaire_id, inscrits.map((l) => l.st.id))))
    .orderBy(desc(positionnement.signe_le));
  let repris = 0;
  for (const { st } of inscrits) {
    const p = signes.find((x) => x.stagiaire_id === st.id);
    if (!p) continue;
    try {
      const recueil = Object.fromEntries(Object.entries((p.recueil ?? {}) as Record<string, string>).filter(([k]) => !k.startsWith("supp_")));
      // La pièce est validée AU NOM DE L'APPRENANT (c'est lui qui a signé), pas du formateur qui crée le dossier.
      const signataire: Acteur = { utilisateur_id: st.utilisateur_id ?? "", of_id: d.of_id, role: "apprenant", formateur_id: null, formateur_valide: false, stagiaire_id: st.id, nom: `${st.stagiaire_prenom} ${st.stagiaire_nom}`, email: st.stagiaire_email };
      const par = { utilisateur_id: st.utilisateur_id, acteur: signataire, validerPiece: true };
      await enregistrerReponses(s, d, st.id, "recueil", { reponses: recueil }, par);
      if (p.questionnaire && JSON.stringify(p.questionnaire) === JSON.stringify(d.questionnaire_positionnement)) {
        await enregistrerReponses(s, d, st.id, "positionnement", { reponses: p.reponses, ajustement: `Repris du positionnement signé le ${dateIso(p.signe_le!)}.` }, par);
      }
      repris++;
      await journaliser(s, { of_id: d.of_id, dossier_id: d.id, acteur, type: "positionnement_repris", libelle: `Positionnement signé de ${st.stagiaire_prenom} ${st.stagiaire_nom} repris dans le dossier` });
    } catch {
      // Reprise au mieux : un écart (questionnaire modifié, pièce déjà validée) laisse la saisie au formateur.
    }
  }
  return repris;
}

// ——— Le PDF ———

function documentPositionnement(o: {
  of_nom: string;
  couleur: string;
  formation: string;
  apprenant: string;
  email: string;
  entreprise: string;
  def: FormulaireDef;
  recueil: Record<string, string>;
  questionnaire: Questionnaire | null;
  reponses: Array<number | null>;
  score: number | null;
  date: string;
  lieu: string;
  signe_le: Date;
  trace_png: string;
  empreinte: string;
  reference: string;
}): string {
  const couleur = /^#[0-9a-f]{6}$/i.test(o.couleur) ? o.couleur : "#1d6a45";
  const dateFr = (iso: string) => iso.split("-").reverse().join("/");
  const recueil = o.def.champs.map((c, i) => `<tr><th>${i + 1}. ${e(c.libelle)}</th><td>${e(o.recueil[c.id] ?? "—").replace(/\n/g, "<br>")}</td></tr>`).join("");
  const test = o.questionnaire
    ? o.questionnaire.questions.map((q, i) => `<tr><th>${i + 1}. ${e(q.enonce)}</th><td>${e(q.propositions[o.reponses[i] ?? -1] ?? "—")}</td></tr>`).join("")
    : "";
  const horodatage = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "medium", timeZone: "Europe/Paris" }).format(o.signe_le);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Positionnement — ${e(o.apprenant)}</title><style>
@page{size:A4;margin:16mm 15mm}body{font-family:Inter,"Segoe UI",Arial,sans-serif;font-size:10.5pt;line-height:1.45;color:#1f2a24;margin:0}
.of{font-weight:700;color:${couleur};letter-spacing:.02em}h1{font-size:18pt;margin:6pt 0 2pt}h2{font-size:12.5pt;margin:16pt 0 6pt;padding-bottom:3pt;border-bottom:1.5pt solid ${couleur}}
table{border-collapse:collapse;width:100%}td,th{border:.6pt solid #c9cfc9;padding:5pt 7pt;vertical-align:top;text-align:left}th{background:#f4f6f3;width:48%;font-weight:600}
.score{font-size:12pt;font-weight:700;color:${couleur}}.sig img{max-height:70pt}.pied{margin-top:16pt;font-size:8pt;color:#5b6472}
</style></head><body>
<div class="of">${e(o.of_nom)}</div><h1>Positionnement avant formation</h1><p>${e(o.formation)}</p>
<table><tr><th>Apprenant</th><td>${e(o.apprenant)}</td></tr><tr><th>Adresse e-mail</th><td>${e(o.email)}</td></tr>${o.entreprise ? `<tr><th>Entreprise</th><td>${e(o.entreprise)}</td></tr>` : ""}<tr><th>Date du positionnement</th><td>${e(dateFr(o.date))}</td></tr></table>
<h2>A. Recueil des besoins</h2><table>${recueil}</table>
${o.questionnaire ? `<h2>B. Test de positionnement — ${e(o.questionnaire.titre)}</h2><table>${test}</table><p class="score">Score de positionnement : ${o.score ?? "—"} / 100</p>` : ""}
<h2>Signature</h2><table><tr><th>Signé électroniquement par ${e(o.apprenant)}<br>à ${e(o.lieu)}, le ${e(horodatage)}</th><td class="sig"><img src="${o.trace_png}" alt="Signature"></td></tr></table>
<p class="pied">Référence ${e(o.reference)} · Empreinte SHA-256 des réponses : ${e(o.empreinte)}. Signature électronique simple (tracé, horodatage serveur, empreinte). Indicateur Qualiopi n° 8 (positionnement à l'entrée) et n° 4 (analyse du besoin).</p>
</body></html>`;
}

/** Pour le coffre-fort : positionnements d'un parcours, sans données de réponse. */
export async function positionnementsDuParcours(s: Services, acteur: Acteur, formationId: string) {
  return (await listerPositionnements(s, acteur, { formation_id: formationId })).map(({ id, apprenant, entreprise, statut, score, signe_le, pdf, expire }) => ({ id, apprenant, entreprise, statut, score, signe_le, pdf, expire }));
}

