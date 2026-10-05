/**
 * Port « courrier ». TOUT e-mail automatique est d'abord journalisé en base (traçabilité exigée en
 * section 9 du cahier des charges), puis, selon la configuration, réellement expédié.
 *
 * Version 7 (23/09/2026) : la configuration SMTP est LUE À CHAQUE ENVOI, par organisme (réglages enregistrés dans
 * l'application), avec repli sur la configuration `.env` du serveur. Sans configuration, rien ne part : on relit les
 * messages dans la boîte d'envoi, et l'écran « Organisme → E-mails » explique quoi renseigner.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { BaseDeDonnees } from "../bd/connexion";
import { courrier } from "../bd/schema";
import { nouvelId } from "./divers";
import type { Archive } from "./archive";

export interface PieceJointe {
  nom: string;
  chemin: string;
}

export interface Message {
  of_id: string;
  dossier_id?: string | null;
  formateur_id?: string | null;
  type: string;
  destinataire: string;
  sujet: string;
  corps_html: string;
  pieces_jointes?: PieceJointe[];
}

export type StatutEnvoi = "journalise" | "envoye" | "echec";

export interface Expedition {
  transport: Transporter;
  expediteur: string;
}

export interface Courrier {
  envoyer(message: Message): Promise<{ id: string; statut: StatutEnvoi; erreur: string }>;
}

/** Résout l'expédition à utiliser pour un organisme (réglages en base, puis `.env`) ; `null` = boîte locale. */
export type ResolveurExpedition = (of_id: string) => Promise<Expedition | null>;

export class CourrierJournalise implements Courrier {
  private readonly resoudre: ResolveurExpedition;

  constructor(
    private readonly bd: BaseDeDonnees,
    private readonly archive: Archive,
    expedition: Expedition | ResolveurExpedition | null = null,
  ) {
    this.resoudre = typeof expedition === "function" ? expedition : async () => expedition;
  }

  async envoyer(message: Message): Promise<{ id: string; statut: StatutEnvoi; erreur: string }> {
    const id = nouvelId();
    let statut: StatutEnvoi = "journalise";
    let erreur = "";

    let expedition: Expedition | null = null;
    try {
      expedition = await this.resoudre(message.of_id);
    } catch (e) {
      statut = "echec";
      erreur = `Configuration d'envoi illisible : ${(e as Error).message}`;
    }

    if (expedition) {
      try {
        const attachments = await Promise.all(
          (message.pieces_jointes ?? []).map(async (pj) => ({
            filename: pj.nom,
            content: await this.archive.lire(pj.chemin),
          })),
        );
        await expedition.transport.sendMail({
          from: expedition.expediteur,
          to: message.destinataire,
          subject: message.sujet,
          html: message.corps_html,
          attachments,
        });
        statut = "envoye";
      } catch (e) {
        // Un e-mail qui échoue ne doit jamais faire échouer l'action métier : on trace et on continue.
        statut = "echec";
        erreur = expliquerErreurSmtp(e);
      }
    }

    await this.bd.insert(courrier).values({
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
    return { id, statut, erreur };
  }
}

/** Traduit les erreurs SMTP les plus courantes en conseil actionnable. Le message brut est conservé à la suite. */
export function expliquerErreurSmtp(e: unknown): string {
  const brut = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string; responseCode?: number })?.code ?? "";
  const reponse = (e as { responseCode?: number })?.responseCode ?? 0;
  if (
    reponse === 535 ||
    /invalid login|authentication failed|username and password not accepted/i.test(brut)
  ) {
    return `Identifiants refusés par le serveur SMTP. Avec Gmail / Google Workspace, utilisez un « mot de passe d'application » (compte Google → Sécurité → Validation en deux étapes → Mots de passe des applications), pas votre mot de passe habituel. Détail : ${brut}`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return `Serveur SMTP introuvable : vérifiez le nom d'hôte. Détail : ${brut}`;
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ESOCKET")
    return `Connexion au serveur SMTP impossible : vérifiez le port (465 = TLS direct, 587 = STARTTLS) et l'option « connexion sécurisée ». Détail : ${brut}`;
  if (/self signed|certificate/i.test(brut))
    return `Certificat TLS refusé par le serveur SMTP. Détail : ${brut}`;
  if (reponse === 550 || /recipient|address rejected/i.test(brut))
    return `Adresse refusée par le serveur SMTP (destinataire ou expéditeur). Vérifiez l'adresse d'expédition. Détail : ${brut}`;
  return brut;
}

export function creerTransportSmtp(url: string): Transporter {
  return nodemailer.createTransport(url);
}

export function creerTransportDepuisReglages(c: {
  hote: string;
  port: number;
  securise: boolean;
  utilisateur: string;
  mot_de_passe: string;
}): Transporter {
  return nodemailer.createTransport({
    host: c.hote,
    port: c.port,
    secure: c.securise,
    auth: c.utilisateur ? { user: c.utilisateur, pass: c.mot_de_passe } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}
