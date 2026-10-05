/** Configuration lue dans l'environnement (fichier `.env`), validée une fois au démarrage. */
import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().default("./donnees/base"),
  ARCHIVE_DIR: z.string().default("./donnees/archive"),
  /** Première ouverture d'une base vide : `demonstration` (jeu fictif) ou `vide` (un organisme à configurer + un admin). */
  AMORCE: z.enum(["demonstration", "vide"]).default("demonstration"),
  ADMIN_EMAIL: z.string().default(""),
  ADMIN_MOT_DE_PASSE: z.string().default(""),
  /** Vide = déduite : le serveur lui-même s'il sert l'interface compilée, sinon le serveur de développement Vite. */
  APP_URL: z.union([z.literal(""), z.string().url()]).default(""),
  COURRIER_MODE: z.enum(["boite-locale", "smtp"]).default("boite-locale"),
  COURRIER_EXPEDITEUR: z.string().default(""),
  SMTP_URL: z.string().default(""),
  CHROMIUM_PATH: z.string().default(""),
  /** Assistant IA de l'espace pédagogique (facultatif) : les deux doivent être renseignés pour l'activer. */
  ANTHROPIC_API_KEY: z.string().default(""),
  IA_MODELE: z.string().default("claude-sonnet-5"),
  /** Identifiant de workspace Anthropic (obligatoire si la clé n'est pas rattachée à un workspace). */
  IA_WORKSPACE_ID: z.string().default(""),
  /** Clé de chiffrement des secrets enregistrés en base (32 octets en hexadécimal) ; vide = fichier `.cle-secrets` créé à côté de la base. */
  CLE_SECRETS: z.string().default(""),
  /** « oui » : assistant IA FACTICE (réponses fictives marquées [démonstration]), pour essayer et tester sans clé. Jamais en production. */
  IA_FACTICE: z.enum(["oui", "non"]).default("non"),
  /** « oui » : l'IA peut mener une recherche web avant de rédiger parcours et supports (coût supplémentaire). */
  IA_RECHERCHE_WEB: z.enum(["oui", "non"]).default("oui"),
  /**
   * Compte formateur « pilote », créé (ou vérifié) à CHAQUE démarrage, même sur une base existante.
   * Demande du 23/09/2026. Vider COMPTE_PILOTE_EMAIL pour ne pas le créer.
   */
  COMPTE_PILOTE_EMAIL: z.string().default("ludoalbisser@gmail.com"),
  COMPTE_PILOTE_MOT_DE_PASSE: z.string().default("1234ludo"),
  COMPTE_PILOTE_PRENOM: z.string().default("Ludovic"),
  COMPTE_PILOTE_NOM: z.string().default("Albisser"),
});

export type Config = z.infer<typeof Schema>;

export function lireConfig(env: Record<string, string | undefined> = process.env): Config {
  const config = Schema.parse(env);
  if (config.AMORCE === "vide" && (!config.ADMIN_EMAIL || config.ADMIN_MOT_DE_PASSE.length < 10)) {
    throw new Error("AMORCE=vide exige ADMIN_EMAIL et ADMIN_MOT_DE_PASSE (10 caractères au moins) pour créer le premier administrateur.");
  }
  return config;
}
