/**
 * Réglages de l'organisme modifiables DANS l'application (version 7, 23/09/2026) : assistant IA et envoi des e-mails.
 *
 * Jusqu'ici, activer l'IA ou le SMTP exigeait d'éditer le fichier `.env` et de redémarrer. Désormais l'administrateur
 * de l'organisme les renseigne dans « Organisme » ; les valeurs de `.env` restent des valeurs PAR DÉFAUT.
 * Les secrets (clé d'API, mot de passe SMTP) sont chiffrés en base et ne sont jamais renvoyés à l'interface :
 * elle sait seulement s'ils sont définis.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { echapperHtml as e } from "@/domaine/gabarits/moteur";
import { reglage } from "../bd/schema";
import { nouvelId } from "../ports/divers";
import { exigerRole, journaliser, type Acteur, type Services } from "./socle";

export const CLES_SECRETES = ["ia_cle", "smtp_mot_de_passe"] as const;

export const SchemaReglages = z
  .object({
    ia_cle: z.string().trim().max(400),
    ia_modele: z.string().trim().max(100),
    ia_workspace: z.string().trim().max(100),
    ia_recherche_web: z.enum(["oui", "non"]),
    ia_active: z.enum(["oui", "non"]),
    smtp_hote: z.string().trim().max(200),
    smtp_port: z
      .string()
      .trim()
      .regex(/^\d{0,5}$/, "Port invalide."),
    smtp_securise: z.enum(["oui", "non"]),
    smtp_utilisateur: z.string().trim().max(200),
    smtp_mot_de_passe: z.string().max(400),
    courrier_expediteur: z.string().trim().max(200),
    courrier_actif: z.enum(["oui", "non"]),
  })
  .partial();

export type Reglages = Required<z.infer<typeof SchemaReglages>>;

export const REGLAGES_DEFAUT: Reglages = {
  ia_cle: "",
  ia_modele: "",
  ia_workspace: "",
  ia_recherche_web: "oui",
  ia_active: "oui",
  smtp_hote: "",
  smtp_port: "",
  smtp_securise: "non",
  smtp_utilisateur: "",
  smtp_mot_de_passe: "",
  courrier_expediteur: "",
  courrier_actif: "non",
};

/** Modèles proposés dans la liste déroulante (identifiants de l'API ; voir platform.claude.com/docs). */
export const MODELES_IA = [
  { valeur: "claude-sonnet-5", libelle: "Claude Sonnet 5 — recommandé (qualité / coût)" },
  { valeur: "claude-opus-5-5", libelle: "Claude Opus 5.5 — le plus fin, deux fois plus coûteux" },
  { valeur: "claude-haiku-4-5-20251001", libelle: "Claude Haiku 4.5 — rapide et économique" },
] as const;

/** Préréglages SMTP proposés d'un clic. Gmail / Google Workspace exige un « mot de passe d'application ». */
export const PREREGLAGES_SMTP = {
  gmail: { smtp_hote: "smtp.gmail.com", smtp_port: "465", smtp_securise: "oui" as const },
  brevo: { smtp_hote: "smtp-relay.brevo.com", smtp_port: "587", smtp_securise: "non" as const },
  ovh: { smtp_hote: "ssl0.ovh.net", smtp_port: "465", smtp_securise: "oui" as const },
  ionos: { smtp_hote: "smtp.ionos.fr", smtp_port: "465", smtp_securise: "oui" as const },
};

/** Tous les réglages d'un organisme, secrets DÉCHIFFRÉS : usage interne (serveur) seulement. */
export async function lireReglages(s: Services, of_id: string): Promise<Reglages> {
  const lignes = await s.bd.select().from(reglage).where(eq(reglage.of_id, of_id));
  const sortie: Reglages = { ...REGLAGES_DEFAUT };
  for (const l of lignes) {
    if (!(l.cle in sortie)) continue;
    let valeur = l.valeur;
    if (l.secret) {
      try {
        valeur = s.secrets.dechiffrer(l.valeur);
      } catch {
        valeur = ""; // clé de chiffrement changée : le secret est perdu, il faudra le ressaisir
      }
    }
    (sortie as Record<string, string>)[l.cle] = valeur;
  }
  return sortie;
}

/** Vue pour l'interface d'administration : les secrets sont remplacés par un indicateur « défini ». */
export async function vueReglages(s: Services, acteur: Acteur) {
  exigerRole(acteur, "admin");
  const r = await lireReglages(s, acteur.of_id);
  const { ia_cle, smtp_mot_de_passe, ...visibles } = r;
  return {
    ...visibles,
    ia_cle_definie: Boolean(ia_cle),
    smtp_mot_de_passe_defini: Boolean(smtp_mot_de_passe),
    ia_defaut_serveur: Boolean(s.ia?.disponible),
    modeles: MODELES_IA,
    prereglages: PREREGLAGES_SMTP,
  };
}

/**
 * Enregistre les réglages envoyés. Un secret vide n'est PAS pris en compte (« laisser inchangé ») ; pour effacer un
 * secret, envoyer la valeur « - ».
 */
export async function enregistrerReglages(s: Services, acteur: Acteur, donnees: unknown) {
  exigerRole(acteur, "admin");
  const v = SchemaReglages.parse(donnees);
  const maintenant = s.horloge.maintenant();
  const modifiees: string[] = [];
  for (const [cle, brut] of Object.entries(v) as Array<[keyof Reglages, string | undefined]>) {
    if (brut === undefined) continue;
    const secret = (CLES_SECRETES as readonly string[]).includes(cle);
    if (secret && brut === "") continue;
    const valeur = secret ? (brut === "-" ? "" : s.secrets.chiffrer(brut)) : brut;
    await s.bd
      .insert(reglage)
      .values({ id: nouvelId(), of_id: acteur.of_id, cle, valeur, secret, maj_le: maintenant })
      .onConflictDoUpdate({
        target: [reglage.of_id, reglage.cle],
        set: { valeur, secret, maj_le: maintenant },
      });
    modifiees.push(cle);
  }
  await journaliser(s, {
    of_id: acteur.of_id,
    acteur,
    type: "reglages_modifies",
    libelle: "Réglages de l'organisme modifiés",
    detail: { cles: modifiees },
  });
  return vueReglages(s, acteur);
}

export interface ConfigSmtp {
  hote: string;
  port: number;
  securise: boolean;
  utilisateur: string;
  mot_de_passe: string;
  expediteur: string;
}

/** Configuration SMTP effective d'un organisme (réglages en base), ou `null` si l'envoi réel n'est pas activé. */
export async function configSmtp(s: Services, of_id: string): Promise<ConfigSmtp | null> {
  const r = await lireReglages(s, of_id);
  if (r.courrier_actif !== "oui" || !r.smtp_hote) return null;
  return {
    hote: r.smtp_hote,
    port: Number(r.smtp_port) || (r.smtp_securise === "oui" ? 465 : 587),
    securise: r.smtp_securise === "oui",
    utilisateur: r.smtp_utilisateur,
    mot_de_passe: r.smtp_mot_de_passe,
    expediteur: r.courrier_expediteur || r.smtp_utilisateur,
  };
}

/** Configuration IA effective d'un organisme : réglages en base, sinon rien (le service pédagogique reprend `.env`). */
export async function configIa(
  s: Services,
  of_id: string,
): Promise<{ cle: string; modele: string; workspace: string; rechercheWeb: boolean } | null> {
  const r = await lireReglages(s, of_id);
  if (r.ia_active !== "oui") return { cle: "", modele: "", workspace: "", rechercheWeb: false };
  if (!r.ia_cle) return null;
  return {
    cle: r.ia_cle,
    modele: r.ia_modele,
    workspace: r.ia_workspace,
    rechercheWeb: r.ia_recherche_web === "oui",
  };
}

/**
 * E-mail de test : part à l'adresse de l'administrateur connecté, avec la configuration enregistrée. Le résultat
 * (envoyé / journalisé seulement / échec + cause) est renvoyé en clair pour corriger les réglages.
 */
export async function envoyerCourrielDeTest(s: Services, acteur: Acteur) {
  exigerRole(acteur, "admin");
  const r = await s.courrier.envoyer({
    of_id: acteur.of_id,
    type: "test_smtp",
    destinataire: acteur.email,
    sujet: "Test d'envoi — plateforme de formation",
    corps_html: `<p>Bonjour ${e(acteur.nom)},</p><p>Si vous lisez ce message, l'envoi des e-mails depuis votre plateforme fonctionne.</p><p>Envoyé le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" }).format(s.horloge.maintenant())}.</p>`,
  });
  const [ligne] = await s.bd
    .select()
    .from(reglage)
    .where(and(eq(reglage.of_id, acteur.of_id), eq(reglage.cle, "courrier_actif")));
  return { ...r, actif: ligne?.valeur === "oui", destinataire: acteur.email };
}
