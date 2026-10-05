/**
 * Réglages de l'organisme modifiables dans l'application (assistant IA, envoi des e-mails) — règles PURES.
 *
 * Reprise de `reglages.ts` de l'ancien serveur : catalogue des clés, valeurs par défaut, modèles d'IA proposés,
 * préréglages de messagerie et validation d'une mise à jour. Les secrets (clé d'API, mot de passe SMTP) sont
 * chiffrés avant d'être écrits (`src/lib/serveur/chiffrement.server.ts`) et ne reviennent jamais à l'interface.
 */

export const CLES_SECRETES = ["ia_cle", "smtp_mot_de_passe"] as const;

export interface Reglages {
  ia_cle: string;
  ia_modele: string;
  ia_workspace: string;
  ia_recherche_web: "oui" | "non";
  ia_active: "oui" | "non";
  smtp_hote: string;
  smtp_port: string;
  smtp_securise: "oui" | "non";
  smtp_utilisateur: string;
  smtp_mot_de_passe: string;
  courrier_expediteur: string;
  courrier_actif: "oui" | "non";
}
export type CleReglage = keyof Reglages;

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

/** Modèles proposés dans la liste déroulante (identifiants de l'API). */
export const MODELES_IA = [
  { valeur: "claude-sonnet-5-5", libelle: "Claude Sonnet 5.5 — recommandé (qualité / coût)" },
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

/** Valeur à envoyer pour EFFACER un secret (un secret vide signifie « laisser inchangé »). */
export const EFFACER_SECRET = "-";

type Regle =
  { genre: "texte"; max: number; sansEspaces: boolean } | { genre: "oui_non" } | { genre: "port" };
const REGLES: Record<CleReglage, Regle> = {
  ia_cle: { genre: "texte", max: 400, sansEspaces: true },
  ia_modele: { genre: "texte", max: 100, sansEspaces: true },
  ia_workspace: { genre: "texte", max: 100, sansEspaces: true },
  ia_recherche_web: { genre: "oui_non" },
  ia_active: { genre: "oui_non" },
  smtp_hote: { genre: "texte", max: 200, sansEspaces: true },
  smtp_port: { genre: "port" },
  smtp_securise: { genre: "oui_non" },
  smtp_utilisateur: { genre: "texte", max: 200, sansEspaces: true },
  // Un mot de passe peut légitimement commencer ou finir par une espace : jamais rogné.
  smtp_mot_de_passe: { genre: "texte", max: 400, sansEspaces: false },
  courrier_expediteur: { genre: "texte", max: 200, sansEspaces: true },
  courrier_actif: { genre: "oui_non" },
};

export type ResultatReglages =
  { ok: true; valeurs: Partial<Reglages> } | { ok: false; champs: Record<string, string> };

/** Valide une mise à jour partielle : seules les clés connues ET présentes sont retenues. */
export function validerReglages(donnees: unknown): ResultatReglages {
  if (typeof donnees !== "object" || donnees === null || Array.isArray(donnees))
    return { ok: false, champs: { _: "Données illisibles." } };
  const brut = donnees as Record<string, unknown>;
  const valeurs: Record<string, string> = {};
  const champs: Record<string, string> = {};
  for (const cle of Object.keys(REGLES) as CleReglage[]) {
    if (!(cle in brut)) continue;
    const regle = REGLES[cle];
    const v = brut[cle];
    if (typeof v !== "string") {
      champs[cle] = "Valeur invalide.";
      continue;
    }
    if (regle.genre === "oui_non") {
      if (v !== "oui" && v !== "non") champs[cle] = "Choisissez « oui » ou « non ».";
      else valeurs[cle] = v;
    } else if (regle.genre === "port") {
      const t = v.trim();
      if (!/^\d{0,5}$/.test(t)) champs[cle] = "Port invalide.";
      else valeurs[cle] = t;
    } else {
      const t = regle.sansEspaces ? v.trim() : v;
      if (t.length > regle.max) champs[cle] = `Trop long (${regle.max} caractères au maximum).`;
      else valeurs[cle] = t;
    }
  }
  return Object.keys(champs).length > 0
    ? { ok: false, champs }
    : { ok: true, valeurs: valeurs as Partial<Reglages> };
}

export const estSecret = (cle: string): boolean =>
  (CLES_SECRETES as readonly string[]).includes(cle);

export interface EcritureReglage {
  cle: CleReglage;
  secret: boolean;
  /** Valeur en clair à écrire (un secret sera chiffré par l'appelant). Vide + `secret` = effacement. */
  clair: string;
}

/**
 * Transforme une mise à jour validée en écritures : un secret vide est IGNORÉ (« laisser inchangé »), un secret égal
 * à « - » devient un effacement (valeur vide), les autres clés sont écrites telles quelles.
 */
export function ecrituresReglages(valeurs: Partial<Reglages>): EcritureReglage[] {
  const sortie: EcritureReglage[] = [];
  for (const [cle, brut] of Object.entries(valeurs) as Array<[CleReglage, string | undefined]>) {
    if (brut === undefined) continue;
    const secret = estSecret(cle);
    if (secret && brut === "") continue;
    sortie.push({ cle, secret, clair: secret && brut === EFFACER_SECRET ? "" : brut });
  }
  return sortie;
}
