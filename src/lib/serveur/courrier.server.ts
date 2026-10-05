/**
 * Envoi des e-mails — équivalent du port `Courrier` de `src/serveur/ports/courrier.ts`.
 *
 * TOUT e-mail automatique est enregistré dans la table `courrier` (traçabilité exigée en section 9 du cahier des
 * charges), puis, si la configuration le permet, réellement expédié par l'API HTTP de Resend (pas de SMTP : Cloudflare
 * Workers n'ouvre pas de socket TCP sortant).
 *
 *   • `RESEND_API_KEY` absente  → RIEN ne part ; le courrier est enregistré avec le statut `journalise`
 *                                 (mode « boîte locale » d'avant). L'application fonctionne normalement.
 *   • réglage `courrier_actif` explicitement « non » pour l'organisme → idem (l'administrateur a coupé l'envoi).
 *   • aucune adresse d'expédition (réglage `courrier_expediteur` de l'organisme, sinon `COURRIER_EXPEDITEUR`)
 *                                 → statut `echec` avec un message qui dit quoi renseigner.
 *   • l'API refuse ou ne répond pas → statut `echec` + cause en français. Un e-mail qui échoue ne fait JAMAIS échouer
 *                                 l'action métier : on trace et on rend la main.
 * Les pièces jointes sont relues dans l'archive (`pieces_jointes: [{ nom, chemin }]`, chemins sous `<of_id>/`).
 */
import type { BdService } from "./bd.server";
import { ouvrirArchive, type Archive } from "./archive.server";
import { variable } from "./config.server";

export interface PieceJointe {
  nom: string;
  chemin: string;
}

export interface MessageCourrier {
  of_id: string;
  dossier_id?: string | null;
  formateur_id?: string | null;
  /** Code court du type de message (ex. `candidature_decision`, `test_smtp`), affiché dans la boîte d'envoi. */
  type: string;
  destinataire: string;
  sujet: string;
  corps_html: string;
  pieces_jointes?: PieceJointe[];
}

export type StatutEnvoi = "journalise" | "envoye" | "echec";

export interface ResultatEnvoi {
  /** Identifiant de la ligne créée dans `courrier`. */
  id: string;
  statut: StatutEnvoi;
  /** Cause de l'échec, en français (vide sinon). Aussi enregistrée dans `courrier.erreur`. */
  erreur: string;
  /** Pourquoi rien n'est parti quand le statut est `journalise` (non enregistré). */
  info: string;
}

export interface OptionsEnvoi {
  /** Pour les tests. Défaut : `fetch` global. */
  fetch?: typeof fetch;
  /** Pour les tests. Défaut : archive de l'organisme du message. */
  archive?: Archive;
}

const URL_RESEND = "https://api.resend.com/emails";
const DELAI_MS = 15_000;

export const INFO_CLE_ABSENTE =
  "L'envoi réel n'est pas configuré sur le serveur (secret RESEND_API_KEY absent) : le message est seulement consigné dans la boîte d'envoi.";
export const INFO_ENVOI_COUPE =
  "L'envoi réel est désactivé dans les réglages de l'organisme : le message est seulement consigné dans la boîte d'envoi.";
export const ERREUR_SANS_EXPEDITEUR =
  "Aucune adresse d'expédition : renseignez « Adresse d'expédition » dans Organisme → E-mails (domaine vérifié chez Resend), ou définissez le secret COURRIER_EXPEDITEUR.";

/** L'envoi réel est-il possible côté serveur ? (clé Resend définie) */
export const envoiReelConfigure = (): boolean => variable("RESEND_API_KEY") !== undefined;

async function reglagesCourrier(bd: BdService, ofId: string): Promise<Record<string, string>> {
  const { data, error } = await bd
    .from("reglage")
    .select("cle, valeur")
    .eq("of_id", ofId)
    .in("cle", ["courrier_actif", "courrier_expediteur"]);
  if (error) {
    console.error("[courrier] lecture des réglages impossible", error);
    return {};
  }
  return Object.fromEntries(
    ((data ?? []) as Array<{ cle: string; valeur: string }>).map((l) => [l.cle, l.valeur]),
  );
}

function enBase64(octets: Uint8Array): string {
  let s = "";
  for (let i = 0; i < octets.length; i += 0x8000)
    s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Traduit les refus les plus courants de l'API Resend en conseil actionnable ; le message brut suit. */
export function expliquerErreurResend(statutHttp: number, corps: string): string {
  let brut = corps.trim();
  try {
    const j = JSON.parse(corps) as { message?: string };
    if (j.message) brut = j.message;
  } catch {
    /* corps non JSON : on garde le texte */
  }
  const detail = brut ? ` Détail : ${brut.slice(0, 300)}` : "";
  if (statutHttp === 401 || /api key/i.test(brut))
    return `La clé d'envoi (RESEND_API_KEY) est refusée par Resend : vérifiez-la.${detail}`;
  if (statutHttp === 403 && /domain|verif/i.test(brut))
    return `Le domaine de l'adresse d'expédition n'est pas vérifié chez Resend : validez-le dans le tableau de bord Resend, ou changez d'adresse d'expédition.${detail}`;
  if (statutHttp === 422)
    return `Resend refuse le message (adresse d'expédition ou de destination invalide ?).${detail}`;
  if (statutHttp === 429)
    return `Trop d'envois en peu de temps : Resend demande de patienter.${detail}`;
  return `Resend a répondu ${statutHttp}.${detail}`;
}

async function expedier(
  bd: BdService,
  message: MessageCourrier,
  expediteur: string,
  cleApi: string,
  options: OptionsEnvoi,
): Promise<{ statut: StatutEnvoi; erreur: string }> {
  const appeler = options.fetch ?? fetch;
  try {
    const pieces = message.pieces_jointes ?? [];
    const archive = pieces.length
      ? (options.archive ?? ouvrirArchive(bd, { ofId: message.of_id }))
      : null;
    const attachments = archive
      ? await Promise.all(
          pieces.map(async (p) => ({
            filename: p.nom,
            content: enBase64(await archive.lire(p.chemin)),
          })),
        )
      : [];
    const controle = new AbortController();
    const minuterie = setTimeout(() => controle.abort(), DELAI_MS);
    try {
      const reponse = await appeler(URL_RESEND, {
        method: "POST",
        headers: { Authorization: `Bearer ${cleApi}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: expediteur,
          to: [message.destinataire],
          subject: message.sujet,
          html: message.corps_html,
          ...(attachments.length ? { attachments } : {}),
        }),
        signal: controle.signal,
      });
      if (reponse.ok) return { statut: "envoye", erreur: "" };
      return {
        statut: "echec",
        erreur: expliquerErreurResend(reponse.status, await reponse.text()),
      };
    } finally {
      clearTimeout(minuterie);
    }
  } catch (e) {
    const brut = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && e.name === "AbortError")
      return {
        statut: "echec",
        erreur: "Resend n'a pas répondu à temps. Réessayez avec « Renvoyer ».",
      };
    return { statut: "echec", erreur: `Envoi impossible : ${brut}` };
  }
}

/**
 * Envoie (si possible) puis enregistre un e-mail. Ne lève pas d'exception pour un échec d'envoi ; renvoie le statut.
 */
export async function envoyerCourrier(
  bd: BdService,
  message: MessageCourrier,
  options: OptionsEnvoi = {},
): Promise<ResultatEnvoi> {
  const id = crypto.randomUUID();
  let statut: StatutEnvoi = "journalise";
  let erreur = "";
  let info = "";

  const cleApi = variable("RESEND_API_KEY");
  if (!cleApi) {
    info = INFO_CLE_ABSENTE;
  } else {
    const reglages = await reglagesCourrier(bd, message.of_id);
    if (reglages["courrier_actif"] === "non") {
      info = INFO_ENVOI_COUPE;
    } else {
      const expediteur = reglages["courrier_expediteur"] || variable("COURRIER_EXPEDITEUR");
      if (!expediteur) {
        statut = "echec";
        erreur = ERREUR_SANS_EXPEDITEUR;
      } else {
        ({ statut, erreur } = await expedier(bd, message, expediteur, cleApi, options));
      }
    }
  }

  const { error } = await bd.from("courrier").insert({
    id,
    of_id: message.of_id,
    dossier_id: message.dossier_id ?? null,
    formateur_id: message.formateur_id ?? null,
    type: message.type,
    destinataire: message.destinataire,
    sujet: message.sujet,
    corps_html: message.corps_html,
    pieces_jointes: message.pieces_jointes ?? [],
    statut,
    erreur,
  });
  // Un journal de courrier qui ne s'écrit pas ne doit pas défaire l'action métier déjà faite : on trace la panne.
  if (error) console.error("[courrier] enregistrement impossible", error);
  return { id, statut, erreur, info };
}
