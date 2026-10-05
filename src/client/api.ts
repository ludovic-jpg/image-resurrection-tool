/**
 * Client de l'API. Les types viennent DIRECTEMENT des services du serveur (imports de types, effacés à la
 * compilation) : si une réponse change de forme côté serveur, l'interface ne compile plus. Aucune génération de code.
 */
import type { lireDossier, listerDossiers } from "@/serveur/services/dossiers";
import type { lireMaCandidature, listerCandidatures, lireCandidature } from "@/serveur/services/candidatures";
import type {
  listerFormations,
  listerOutils,
  listerCoffre,
  coffresDeLApprenant,
} from "@/serveur/services/formations";
import type { listerEntreprises, listerStagiaires } from "@/serveur/services/repertoire";
import type { lireQuestionnaire } from "@/serveur/services/evaluations";
import type { etatEmargement, verifierIntegritePiece } from "@/serveur/services/retours";
import type { lireBpf } from "@/serveur/services/bpf";
import type { apercuSuppression } from "@/serveur/services/rgpd";
import type { lireOrganisme } from "@/serveur/services/organisme";
import type { Acteur } from "@/serveur/services/socle";
import type { listerCoffresParcours, lireCoffreParcours } from "@/serveur/services/coffre";
import type { listerPositionnements, lirePositionnementPublic } from "@/serveur/services/positionnements";
import type { archivesEtCorbeille } from "@/serveur/services/sauvegarde";
import type { vueReglages, envoyerCourrielDeTest } from "@/serveur/services/reglages";
import type {
  etatFormulaires,
  lireFormulairePublic,
  envoyerFormulaire,
  listerFormulaires,
} from "@/serveur/services/formulaires-apprenant";
import type { proposerParcours, analyserEnjeux, etatIa } from "@/serveur/services/pedagogie-ia";
import type { DossierEnjeux } from "@/domaine/pedagogie/enjeux";
import type { courrier } from "@/serveur/bd/schema";
import { aiguiller, erreurInconnue } from "./aiguilleur";

/** Ce que devient un type une fois passé par JSON : les dates sont des chaînes. */
export type Json<T> = T extends Date
  ? string
  : T extends Buffer
    ? never
    : T extends ReadonlyArray<infer U>
      ? Json<U>[]
      : T extends object
        ? { [K in keyof T]: Json<T[K]> }
        : T;
type Reponse<F extends (...a: never[]) => unknown> = Json<Awaited<ReturnType<F>>>;

export type Dossier = Reponse<typeof lireDossier>;
export type Piece = Dossier["pieces"][number];
export type ListeDossiers = Reponse<typeof listerDossiers>;
export type CarteDossier = ListeDossiers["dossiers"][number];
export type Candidature = Reponse<typeof lireMaCandidature>;
export type CandidatureAdmin = Reponse<typeof lireCandidature>;
export type LigneCandidature = Reponse<typeof listerCandidatures>[number];
export type Formation = Reponse<typeof listerFormations>[number];
export type Outil = Reponse<typeof listerOutils>[number];
export type FichierCoffre = Reponse<typeof listerCoffre>[number];
export type CoffreApprenant = Reponse<typeof coffresDeLApprenant>[number];
export type Entreprise = Reponse<typeof listerEntreprises>[number];
export type Stagiaire = Reponse<typeof listerStagiaires>[number];
export type QuestionnaireVue = Reponse<typeof lireQuestionnaire>;
export type SeanceEmargement = Reponse<typeof etatEmargement>[number];
export type Integrite = Reponse<typeof verifierIntegritePiece>;
export type VueBpf = Reponse<typeof lireBpf>;
export type ApercuSuppression = Reponse<typeof apercuSuppression>;
export type Organisme = Reponse<typeof lireOrganisme>;
export type Courrier = Json<typeof courrier.$inferSelect>;
export type CarteCoffre = Reponse<typeof listerCoffresParcours>[number];
export type VueCoffre = Reponse<typeof lireCoffreParcours>;
export type LignePositionnement = Reponse<typeof listerPositionnements>[number];
export type PositionnementPublic = Reponse<typeof lirePositionnementPublic>;
export type Archives = Reponse<typeof archivesEtCorbeille>;
// ——— Version 7 ———
export type Reglages = Reponse<typeof vueReglages>;
export type ResultatTestCourriel = Reponse<typeof envoyerCourrielDeTest>;
export type EtatFormulaire = Reponse<typeof etatFormulaires>[number];
export type FormulairePublic = Reponse<typeof lireFormulairePublic>;
export type ResultatEnvoiFormulaire = Reponse<typeof envoyerFormulaire>;
export type LigneFormulaire = Reponse<typeof listerFormulaires>[number];
export type PropositionParcours = Reponse<typeof proposerParcours>;
export type ResultatEnjeux = Reponse<typeof analyserEnjeux>;
export type EtatIa = Reponse<typeof etatIa>;
export type { DossierEnjeux };
export type Moi = { acteur: Json<Acteur> | null; organisme?: { nom: string; couleur: string } };

export { ErreurApi } from "./erreur";
import { ErreurApi } from "./erreur";

/**
 * Point d'entrée unique des écrans. Il ne parle plus à un serveur Node : il aiguille chaque appel
 * « MÉTHODE /chemin » vers son gestionnaire (Supabase client + RLS, fonction SQL ou fonction serveur).
 * Une route non encore portée répond 501 : la carte `lovable/CARTE_DES_ROUTES.md` dit à quel lot elle appartient.
 */
async function appel<T>(methode: string, chemin: string, corps?: unknown): Promise<T> {
  try {
    return (await aiguiller(methode, chemin, corps)) as T;
  } catch (e) {
    if (e instanceof ErreurApi) {
      if (
        e.statut === 401 &&
        !chemin.startsWith("/auth/") &&
        typeof location !== "undefined" &&
        !location.pathname.startsWith("/connexion")
      ) {
        location.assign(`/connexion?retour=${encodeURIComponent(location.pathname)}`);
      }
      throw e;
    }
    throw erreurInconnue(e);
  }
}

export const api = {
  get: <T>(chemin: string) => appel<T>("GET", chemin),
  post: <T>(chemin: string, corps: unknown = {}) => appel<T>("POST", chemin, corps),
  patch: <T>(chemin: string, corps: unknown) => appel<T>("PATCH", chemin, corps),
  put: <T>(chemin: string, corps: unknown) => appel<T>("PUT", chemin, corps),
  suppr: <T>(chemin: string) => appel<T>("DELETE", chemin),
  /** Envoi d'un fichier, avec d'éventuels champs texte d'accompagnement. */
  fichier: <T>(chemin: string, fichier: File, champs: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("fichier", fichier);
    for (const [k, v] of Object.entries(champs)) form.set(k, v);
    return appel<T>("POST", chemin, form);
  },
};

// ——— Formats d'affichage (l'interface ne recalcule rien : elle met en forme) ———
export const euros = (centimes: number | null | undefined) =>
  centimes === null || centimes === undefined
    ? "—"
    : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(centimes / 100);
export const dateFr = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
export const dateLongue = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(d);
};
export const instantFr = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat("fr-FR", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
};
export const octets = (n: number) =>
  n < 1024
    ? `${n} o`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} Ko`
      : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
export const heuresFr = (h: number | null | undefined) =>
  h === null || h === undefined ? "—" : `${String(h).replace(".", ",")} h`;
