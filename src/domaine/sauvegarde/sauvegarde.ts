/**
 * Sauvegarde de l'espace pédagogique d'un formateur — format du fichier JSON, règle PURE.
 *
 * Reprise de `src/serveur/services/sauvegarde.ts` : un fichier lisible (formations et leurs parcours, questionnaires,
 * fiches apprenants et entreprises) à conserver hors de l'application ; c'est aussi le droit à la portabilité
 * (RGPD, art. 20). Les identifiants de rattachement (organisme, formateur, compte) n'y figurent jamais.
 */

export const APPLICATION_SAUVEGARDE = "s4m-plateforme";
export const VERSION_SAUVEGARDE = 1;
export const MAX_FORMATIONS = 500;
export const MAX_OUTILS = 2000;
/** Taille maximale d'un fichier de sauvegarde accepté à l'import (octets). */
export const TAILLE_MAX_SAUVEGARDE = 10 * 1024 * 1024;

type Ligne = Record<string, unknown>;

export interface Sauvegarde {
  application: typeof APPLICATION_SAUVEGARDE;
  version: number;
  exportee_le: string;
  formateur: string;
  formations: Ligne[];
  outils: Ligne[];
  stagiaires: Ligne[];
  entreprises: Ligne[];
}

/** Copie d'une ligne sans les colonnes indiquées. */
function sans(ligne: Ligne, ...colonnes: string[]): Ligne {
  return Object.fromEntries(Object.entries(ligne).filter(([cle]) => !colonnes.includes(cle)));
}

export function construireSauvegarde(e: {
  date: Date;
  formateur: string;
  formations: readonly Ligne[];
  outils: readonly Ligne[];
  stagiaires: readonly Ligne[];
  entreprises: readonly Ligne[];
}): Sauvegarde {
  return {
    application: APPLICATION_SAUVEGARDE,
    version: VERSION_SAUVEGARDE,
    exportee_le: e.date.toISOString(),
    formateur: e.formateur,
    formations: e.formations.map((f) => sans(f, "of_id", "formateur_id")),
    outils: e.outils.map((o) => sans(o, "of_id", "formateur_id")),
    stagiaires: e.stagiaires.map((s) => sans(s, "of_id", "formateur_id", "utilisateur_id")),
    entreprises: e.entreprises.map((x) => sans(x, "of_id", "formateur_id")),
  };
}

export const nomFichierSauvegarde = (date: Date): string =>
  `sauvegarde-espace-pedagogique-${date.toISOString().slice(0, 10)}.json`;

const estLigne = (v: unknown): v is Ligne =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export type LectureSauvegarde =
  { ok: true; formations: Ligne[]; outils: Ligne[] } | { ok: false; message: string };

/** Lit un fichier de sauvegarde : le refuse avec un message lisible s'il n'est pas de la plateforme ou trop récent. */
export function lireSauvegarde(texte: string): LectureSauvegarde {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    return { ok: false, message: "Le fichier n'est pas un JSON lisible." };
  }
  if (!estLigne(brut) || brut["application"] !== APPLICATION_SAUVEGARDE)
    return { ok: false, message: "Ce fichier n'est pas une sauvegarde de la plateforme." };
  const version = brut["version"];
  if (typeof version !== "number" || !Number.isInteger(version))
    return { ok: false, message: "La version de la sauvegarde est illisible." };
  if (version > VERSION_SAUVEGARDE)
    return {
      ok: false,
      message: "Sauvegarde produite par une version plus récente de l'application.",
    };
  const { formations, outils } = brut;
  if (!Array.isArray(formations) || !formations.every(estLigne))
    return { ok: false, message: "Les formations de la sauvegarde sont illisibles." };
  if (!Array.isArray(outils) || !outils.every(estLigne))
    return { ok: false, message: "Les questionnaires de la sauvegarde sont illisibles." };
  if (formations.length > MAX_FORMATIONS)
    return {
      ok: false,
      message: `Une sauvegarde ne peut pas contenir plus de ${MAX_FORMATIONS} formations.`,
    };
  if (outils.length > MAX_OUTILS)
    return {
      ok: false,
      message: `Une sauvegarde ne peut pas contenir plus de ${MAX_OUTILS} questionnaires.`,
    };
  return { ok: true, formations, outils };
}
