/**
 * Positionnement avant dossier (« Modification 1 », 23/09/2026) — règles PURES.
 *
 * Le formateur invite un apprenant à se positionner sur un parcours ; l'apprenant répond SANS compte, par un lien
 * personnel (jeton aléatoire dont seule l'empreinte SHA-256 est stockée) : recueil des besoins + test de positionnement
 * du parcours, date, signature tracée. Aucun import de React, Supabase, réseau ou `node:` ici.
 *
 * Portage de `src/serveur/services/positionnements.ts` : mêmes règles, mêmes messages.
 */
import { FORMULAIRES, validerReponses, type FormulaireDef } from "../formulaires/definitions";
import type { Questionnaire } from "../formulaires/qcm";
import { validerDemandeSignature } from "../signature/preuve";

/** Un lien reste valable 30 jours (la relance en émet un nouveau). */
export const DUREE_LIEN_POSITIONNEMENT_MS = 30 * 24 * 3600 * 1000;
/** Nombre maximal de questions ajoutées par le formateur au recueil. */
export const MAX_QUESTIONS_RECUEIL = 10;

export const MESSAGE_LIEN_INVALIDE = "Lien de positionnement introuvable.";
export const MESSAGE_LIEN_EXPIRE =
  "Ce lien a expiré. Demandez à votre formateur de vous en renvoyer un.";
export const MESSAGE_DEJA_SIGNE = "Ce positionnement est déjà signé.";
export const MESSAGE_PDF_INDISPONIBLE =
  "Le PDF est disponible une fois le positionnement complété et signé.";

/** Le recueil = les questions fixes de l'organisme (00-AVT) + celles ajoutées par le formateur. */
export function formulaireRecueil(supplementaires: readonly string[]): FormulaireDef {
  const base = FORMULAIRES["00-AVT"];
  return {
    ...base,
    champs: [
      ...base.champs,
      ...supplementaires.map((libelle, i) => ({
        id: `supp_${i + 1}`,
        libelle,
        type: "texte_long" as const,
      })),
    ],
  };
}

/** Les questions supplémentaires d'un modèle de recueil : texte non vide, 10 au plus. */
export function questionsSupplementaires(contenu: unknown): string[] {
  const brut = (contenu as { questions_supplementaires?: unknown } | null)
    ?.questions_supplementaires;
  if (!Array.isArray(brut)) return [];
  return brut
    .filter((q): q is string => typeof q === "string" && q.trim() !== "")
    .slice(0, MAX_QUESTIONS_RECUEIL);
}

export type EtatLien = "valide" | "invalide" | "expire";

/**
 * Le lien d'un positionnement est-il utilisable ? Inconnu ou archivé = « invalide » (rien n'est révélé). Un
 * positionnement complet reste consultable (et son PDF téléchargeable) même après l'échéance du lien.
 */
export function etatDuLien(
  p: { statut: string; archive_le: string | null; expire_le: string } | null,
  maintenant: Date,
): EtatLien {
  if (!p || p.archive_le) return "invalide";
  if (p.statut !== "complet" && new Date(p.expire_le).getTime() <= maintenant.getTime())
    return "expire";
  return "valide";
}

/** Date du jour (AAAA-MM-JJ) à Paris. */
export function dateIsoParis(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// ——— Brouillon et signature : validation des entrées de la page publique ———

export interface Brouillon {
  recueil: Record<string, string>;
  reponses: Array<number | null>;
  date: string;
}

const MAX_CHAMPS_RECUEIL = 40;
const MAX_REPONSES = 40;

function objetSimple(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Contrôle la forme d'un brouillon (ou des réponses d'une signature). Renvoie la valeur propre, ou un message. */
export function validerBrouillon(
  donnees: unknown,
): { ok: true; valeur: Brouillon } | { ok: false; message: string } {
  const d = objetSimple(donnees);
  const recueilBrut = d["recueil"] === undefined ? {} : d["recueil"];
  if (!recueilBrut || typeof recueilBrut !== "object" || Array.isArray(recueilBrut))
    return { ok: false, message: "Les réponses du recueil sont illisibles." };
  const entrees = Object.entries(recueilBrut as Record<string, unknown>);
  if (entrees.length > MAX_CHAMPS_RECUEIL)
    return { ok: false, message: "Les réponses du recueil sont trop nombreuses." };
  const recueil: Record<string, string> = {};
  for (const [cle, valeur] of entrees) {
    if (cle.length > 60 || typeof valeur !== "string")
      return { ok: false, message: "Les réponses du recueil sont illisibles." };
    if (valeur.length > 4000)
      return {
        ok: false,
        message: "Une réponse du recueil est trop longue (4 000 caractères au plus).",
      };
    recueil[cle] = valeur;
  }
  const reponsesBrutes = d["reponses"] === undefined ? [] : d["reponses"];
  if (!Array.isArray(reponsesBrutes) || reponsesBrutes.length > MAX_REPONSES)
    return { ok: false, message: "Les réponses du test sont illisibles." };
  const reponses: Array<number | null> = [];
  for (const r of reponsesBrutes) {
    if (r === null) reponses.push(null);
    else if (typeof r === "number" && Number.isInteger(r) && r >= 0 && r <= 7) reponses.push(r);
    else return { ok: false, message: "Les réponses du test sont illisibles." };
  }
  const date = d["date"] === undefined ? "" : d["date"];
  if (typeof date !== "string" || date.length > 10)
    return { ok: false, message: "La date est illisible." };
  return { ok: true, valeur: { recueil, reponses, date } };
}

export interface DemandeSignature extends Brouillon {
  trace_png: string;
  lieu: string;
  consentement: boolean;
}

/** AAAA-MM-JJ qui désigne un vrai jour du calendrier. */
export function estDateIso(texte: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === texte;
}

/**
 * Contrôle complet d'une signature : recueil, test (toutes les questions répondues, dans les bornes), date,
 * tracé, lieu, consentement. Renvoie la demande propre, ou la liste des erreurs en français.
 */
export function validerSignature(
  donnees: unknown,
  def: FormulaireDef,
  questionnaire: Questionnaire | null,
):
  | { ok: true; valeur: DemandeSignature }
  | { ok: false; erreurs: string[]; champs: Record<string, string> } {
  const b = validerBrouillon(donnees);
  if (!b.ok) return { ok: false, erreurs: [b.message], champs: {} };
  const d = objetSimple(donnees);
  const trace_png = typeof d["trace_png"] === "string" ? d["trace_png"] : "";
  const lieu = typeof d["lieu"] === "string" ? d["lieu"].trim() : "";
  const consentement = d["consentement"] === true;
  const { recueil, reponses, date } = b.valeur;

  const champs = validerReponses(def, recueil);
  const erreurs: string[] = Object.entries(champs).map(
    ([cle, msg]) => `Recueil — ${def.champs.find((c) => c.id === cle)?.libelle ?? cle} : ${msg}`,
  );
  if (questionnaire) {
    if (
      reponses.length !== questionnaire.questions.length ||
      reponses.some(
        (r, i) => r === null || r >= (questionnaire.questions[i]?.propositions.length ?? 0),
      )
    )
      erreurs.push("Test de positionnement : répondez à toutes les questions.");
  }
  if (!estDateIso(date)) erreurs.push("Indiquez la date.");
  erreurs.push(...validerDemandeSignature({ trace_png, lieu, consentement }));
  if (erreurs.length > 0) return { ok: false, erreurs, champs };
  return { ok: true, valeur: { recueil, reponses, date, trace_png, lieu, consentement } };
}

// ——— Reprise dans un dossier ———

/** Égalité profonde indépendante de l'ordre des clés (deux lectures d'un même `jsonb` doivent être égales). */
export function egalProfond(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => egalProfond(x, b[i]));
  const ca = Object.keys(a as object);
  const cb = Object.keys(b as object);
  return (
    ca.length === cb.length &&
    ca.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        egalProfond((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}

export interface PositionnementSigne {
  id: string;
  stagiaire_id: string;
  questionnaire: unknown;
  recueil: unknown;
  reponses: unknown;
  score: number | null;
  signe_le: string | null;
}

export interface ElementReprise {
  positionnement_id: string;
  stagiaire_id: string;
  /** Réponses du recueil SANS les questions ajoutées par le formateur (`supp_*`) : celles-ci n'existent pas au dossier. */
  recueil: Record<string, string>;
  /** Le test n'est repris QUE si le questionnaire du dossier est exactement celui auquel l'apprenant a répondu. */
  reprendre_test: boolean;
  reponses: Array<number | null> | null;
  /** Date (AAAA-MM-JJ) de la signature, pour la mention « Repris du positionnement signé le … ». */
  signe_le: string;
}

/**
 * Décide, pour chaque stagiaire inscrit au dossier, ce qui se reprend de son positionnement signé (le plus récent).
 * Ne fait correspondre JAMAIS des réponses à un autre questionnaire : test différent ⇒ `reprendre_test: false`.
 */
export function planReprise(
  signes: readonly PositionnementSigne[],
  stagiaireIds: readonly string[],
  questionnaireDuDossier: unknown,
): ElementReprise[] {
  const plan: ElementReprise[] = [];
  for (const stagiaireId of stagiaireIds) {
    const candidats = signes
      .filter((p) => p.stagiaire_id === stagiaireId)
      .sort((a, b) => (b.signe_le ?? "").localeCompare(a.signe_le ?? ""));
    const p = candidats[0];
    if (!p) continue;
    const recueil = Object.fromEntries(
      Object.entries(objetSimple(p.recueil)).filter(
        (e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("supp_"),
      ),
    );
    const identique =
      p.questionnaire !== null &&
      p.questionnaire !== undefined &&
      questionnaireDuDossier !== null &&
      questionnaireDuDossier !== undefined &&
      egalProfond(p.questionnaire, questionnaireDuDossier);
    plan.push({
      positionnement_id: p.id,
      stagiaire_id: stagiaireId,
      recueil,
      reprendre_test: identique && Array.isArray(p.reponses),
      reponses:
        identique && Array.isArray(p.reponses) ? (p.reponses as Array<number | null>) : null,
      signe_le: (p.signe_le ?? "").slice(0, 10),
    });
  }
  return plan;
}
