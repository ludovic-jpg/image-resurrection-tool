/**
 * Menu principal — cahier des charges oral du 23/09/2026 : « un premier menu avec trois espaces :
 * espace pédagogique, espace apprenant et espace formation ».
 *
 * Module sans React : la structure du menu est une donnée, testée (`navigation.test.ts`) ; le cadre et la
 * page d'accueil l'affichent. Ajouter un écran = ajouter une ligne ici, au bon espace.
 */
export type CleIcone =
  | "formations"
  | "outils"
  | "apprenants"
  | "convention"
  | "dossiers"
  | "bpf"
  | "courriers"
  | "candidatures"
  | "organisme"
  | "coffre"
  | "positionnement"
  | "profil"
  | "archives";

export interface LienNav {
  vers: string;
  libelle: string;
  icone: CleIcone;
  /** Actif seulement sur l'adresse exacte (et non sur ses sous-pages). */
  exact?: boolean;
  aide?: string;
}

export type CleEspace = "pedagogique" | "apprenant" | "formation" | "administration";

export interface Espace {
  cle: CleEspace;
  titre: string;
  description: string;
  liens: LienNav[];
}

/** Les trois espaces du formateur, dans l'ordre du cahier des charges. */
export const ESPACES_FORMATEUR: readonly Espace[] = [
  {
    cle: "pedagogique",
    titre: "Espace pédagogique",
    description:
      "Vos formations, leurs programmes et supports, vos questionnaires. L'assistant IA se documente sur chaque sujet et vous propose des brouillons : vous restez l'auteur.",
    liens: [
      {
        vers: "/formations",
        libelle: "Mes formations",
        icone: "formations",
        aide: "Enjeux, parcours, tests et supports, coffre-fort",
      },
      {
        vers: "/outils",
        libelle: "Outils pédagogiques",
        icone: "outils",
        aide: "Recueil des besoins, positionnement, évaluation des acquis",
      },
      {
        vers: "/coffres",
        libelle: "Coffre-fort pédagogique",
        icone: "coffre",
        aide: "Par parcours : supports, tests, pièces administratives",
      },
    ],
  },
  {
    cle: "apprenant",
    titre: "Espace apprenant",
    description:
      "Vos apprenants et leurs entreprises. Chaque apprenant invité suit son parcours dans son propre espace.",
    liens: [
      {
        vers: "/repertoire",
        libelle: "Apprenants et entreprises",
        icone: "apprenants",
        aide: "Fiches réutilisables d'un dossier à l'autre",
      },
      {
        vers: "/positionnements",
        libelle: "Positionnements",
        icone: "positionnement",
        aide: "Inviter un apprenant : recueil, test, signature",
      },
    ],
  },
  {
    cle: "formation",
    titre: "Espace formation",
    description:
      "Le générateur de conventions et le suivi de vos dossiers, de la création au paiement.",
    liens: [
      {
        vers: "/dossiers/nouveau",
        libelle: "Générateur de conventions",
        icone: "convention",
        exact: true,
        aide: "Apprenant, entreprise, formation, modalité, financement",
      },
      {
        vers: "/dossiers",
        libelle: "Mes dossiers",
        icone: "dossiers",
        exact: true,
        aide: "Pipeline en sept étapes",
      },
      { vers: "/bpf", libelle: "BPF", icone: "bpf" },
      { vers: "/courriers", libelle: "Boîte d'envoi", icone: "courriers" },
    ],
  },
];

const ESPACES_ADMIN: readonly Espace[] = [
  {
    cle: "formation",
    titre: "Espace formation",
    description: "Tous les dossiers de l'organisme, leur validation et leur suivi.",
    liens: [
      { vers: "/tableau-de-bord", libelle: "Tous les dossiers", icone: "dossiers", exact: true },
      { vers: "/coffres", libelle: "Coffres-forts pédagogiques", icone: "coffre" },
      { vers: "/positionnements", libelle: "Positionnements", icone: "positionnement" },
      { vers: "/bpf", libelle: "BPF", icone: "bpf" },
      { vers: "/courriers", libelle: "Boîte d'envoi", icone: "courriers" },
    ],
  },
  {
    cle: "administration",
    titre: "Administration",
    description:
      "Candidatures des formateurs ; identité de l'organisme, assistant IA et envoi des e-mails.",
    liens: [
      { vers: "/admin/candidatures", libelle: "Candidatures", icone: "candidatures" },
      {
        vers: "/admin/organisme",
        libelle: "Organisme",
        icone: "organisme",
        aide: "Identité, assistant IA, e-mails",
      },
    ],
  },
];

/** Liens personnels du formateur validé, sous les trois espaces (« Modification 1 » : profil, archives). */
export const LIENS_PERSONNELS_FORMATEUR: readonly LienNav[] = [
  { vers: "/profil", libelle: "Mon profil et candidature", icone: "profil" },
  { vers: "/archives", libelle: "Archives et sauvegarde", icone: "archives" },
];

/** Menu affiché dans le rail latéral : une entrée « Accueil » éventuelle, les espaces, puis les liens personnels. */
export function navigationPour(
  role: string,
  formateurValide: boolean,
): { accueil: LienNav | null; espaces: readonly Espace[]; personnels: readonly LienNav[] } {
  if (role === "admin") return { accueil: null, espaces: ESPACES_ADMIN, personnels: [] };
  if (role === "formateur") {
    if (!formateurValide)
      return {
        accueil: null,
        espaces: [
          {
            cle: "formation",
            titre: "Candidature",
            description: "",
            liens: [{ vers: "/candidature", libelle: "Ma candidature", icone: "candidatures" }],
          },
        ],
        personnels: [],
      };
    return {
      accueil: { vers: "/tableau-de-bord", libelle: "Accueil", icone: "dossiers", exact: true },
      espaces: ESPACES_FORMATEUR,
      personnels: LIENS_PERSONNELS_FORMATEUR,
    };
  }
  return {
    accueil: null,
    espaces: [
      {
        cle: "apprenant",
        titre: "Mon espace",
        description: "",
        liens: [
          { vers: "/tableau-de-bord", libelle: "Mes formations", icone: "formations", exact: true },
        ],
      },
    ],
    personnels: [],
  };
}
