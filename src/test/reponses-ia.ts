/**
 * Réponses d'IA SIMULÉES pour les tests du lot 7 : aucune n'a jamais été produite par un vrai appel. Elles ont la forme
 * que la plateforme valide (`src/domaine/pedagogie/propositions.ts`) et la forme d'une réponse de l'API Messages.
 */
import { vi } from "vitest";

export const ENJEUX_SIMULES = {
  resume:
    "Résumé simulé du sujet : ce texte fictif est assez long pour passer la validation du dossier d'enjeux.",
  enjeux: ["Enjeu simulé 1", "Enjeu simulé 2", "Enjeu simulé 3"],
  cadre: ["Texte de référence simulé", "Norme simulée"],
  notions_cles: ["Notion A", "Notion B", "Notion C", "Notion D"],
  erreurs_frequentes: ["Erreur 1", "Erreur 2"],
  pratiques_actuelles: ["Pratique 1"],
  public_vise: "Public simulé.",
  prerequis: "Aucun prérequis simulé.",
  glossaire: [{ terme: "Terme", definition: "Définition simulée." }],
  sources: [{ titre: "Source simulée", url: "https://example.org/simulee" }],
};

export const qcmSimule = (n: number) => ({
  titre: "Test simulé",
  questions: Array.from({ length: n }, (_, i) => ({
    enonce: `Question simulée ${i + 1} ?`,
    propositions: ["Proposition A", "Proposition B", "Proposition C", "Proposition D"],
    bonne_reponse: i % 4,
  })),
});

export const PROGRAMME_SIMULE = {
  objectifs: ["Identifier les enjeux", "Appliquer la méthode", "Évaluer ses résultats"],
  programme: "Programme simulé : séquence 1, séquence 2, séquence 3.",
};

export const parcoursSimule = (n: number) => ({
  objectifs: ["Identifier les enjeux", "Appliquer la méthode", "Évaluer ses résultats"],
  public_vise: "Public visé simulé.",
  prerequis: "Aucun prérequis.",
  modules: Array.from({ length: n }, (_, i) => ({
    titre: `Module simulé ${i + 1}`,
    objectifs: [`Objectif ${i + 1}.1`, `Objectif ${i + 1}.2`],
    contenus: ["Contenu A", "Contenu B", "Contenu C"],
    methodes: "Apports courts, atelier.",
    mise_en_pratique: "Atelier de 45 minutes.",
    evaluation: "Quiz de fin de module.",
  })),
});

const TYPES_DIAPOS = [
  "titre",
  "objectifs",
  "sommaire",
  "amorce",
  "notion",
  "notion",
  "schema",
  "exemple",
  "point_etape",
  "notion",
  "notion",
  "exemple",
  "schema",
  "pratique",
  "pratique",
  "debriefing",
  "vigilance",
  "notion",
  "synthese",
  "quiz",
];
export const diaposSimulees = () =>
  TYPES_DIAPOS.map((type, i) => ({
    type,
    titre: `Diapositive simulée ${i + 1}`,
    points: ["Point 1", "Point 2", "Point 3"],
    visuel: "Schéma simulé",
    notes: "Notes simulées du formateur.",
  }));

/** Corps d'une réponse de l'API Messages dont le texte est l'objet JSON donné. */
export const reponseApi = (objet: unknown, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(objet) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 200 },
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

/**
 * Remplace le `fetch` global par un faux « réseau IA » qui répond selon la consigne reçue. Renvoie le simulacre pour
 * compter et inspecter les appels : `appels` contient `{ url, entetes, corps }`.
 */
export function simulerReseauIa(repondre?: (consigne: string, demande: string) => unknown) {
  const appels: Array<{
    url: string;
    entetes: Record<string, string>;
    corps: Record<string, any>;
  }> = [];
  const faux = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const corps = JSON.parse(String(init?.body ?? "{}"));
    appels.push({
      url: String(url),
      entetes: Object.fromEntries(new Headers(init?.headers).entries()),
      corps,
    });
    const demande = String(corps.messages?.at(-1)?.content ?? "");
    const consigne = String(corps.system?.[0]?.text ?? "");
    if (repondre) {
      const r = repondre(consigne, demande);
      if (r instanceof Response) return r;
      if (r !== undefined) return reponseApi(r);
    }
    if (/^Constitue le dossier d'enjeux/i.test(demande)) return reponseApi(ENJEUX_SIMULES);
    if (/Conçois le parcours/i.test(demande))
      return reponseApi(parcoursSimule(Number(/exactement (\d+) module/i.exec(demande)?.[1] ?? 3)));
    if (/choix multiples/i.test(demande))
      return reponseApi(qcmSimule(Number(/Exactement (\d+) questions/i.exec(demande)?.[1] ?? 10)));
    if (/diaporama/i.test(demande)) return reponseApi({ diapos: diaposSimulees() });
    return reponseApi(PROGRAMME_SIMULE);
  });
  vi.stubGlobal("fetch", faux);
  return { faux, appels };
}
