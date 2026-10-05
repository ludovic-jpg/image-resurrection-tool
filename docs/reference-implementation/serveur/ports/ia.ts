/**
 * Port « IA pédagogique » : rédaction de propositions (parcours, tests, supports, dossier d'enjeux) pour l'espace
 * pédagogique.
 *
 * Cahier des charges oral du 23/09/2026 : l'IA est utile sur les supports pédagogiques, et seulement là ;
 * tout le reste (conventions, pièces, montants, statuts) doit être exact, donc produit sans IA.
 * Seul le service `pedagogie-ia` utilise ce port — un test de garde le vérifie.
 *
 * Version 7 (23/09/2026) : plus aucune « trame » sans IA. Sans IA configurée, les générateurs pédagogiques
 * expliquent comment l'activer (écran Organisme → Assistant IA) ; le reste de l'application fonctionne normalement.
 * Aucune donnée d'apprenant n'est jamais envoyée : uniquement la description de la FORMATION.
 */

export interface UsageIa {
  tokens_entree: number;
  tokens_sortie: number;
  recherches_web: number;
  modele: string;
  duree_ms: number;
  tentatives: number;
}

export interface ReponseIa {
  texte: string;
  usage: UsageIa;
  /** Sources citées par la recherche web (dédoublonnées), quand elle a eu lieu. */
  sources: Array<{ titre: string; url: string }>;
}

export interface AssistantPedagogique {
  readonly disponible: boolean;
  /** Décrit la configuration (modèle, recherche web) pour l'affichage — jamais la clé. */
  readonly description: string;
  /** Envoie une consigne et retourne la réponse. Lève une erreur lisible en cas d'échec. */
  rediger(consigneSysteme: string, demande: string, options?: OptionsRedaction): Promise<ReponseIa>;
}

export interface OptionsRedaction {
  /** Autorise l'IA à mener une recherche web avant de rédiger (si la configuration l'active). */
  recherche?: boolean;
  /** Nombre maximal de recherches pour cette demande (défaut 6). */
  maxRecherches?: number;
  /** Longueur maximale de la réponse (les plans de diaporama sont longs). */
  maxTokens?: number;
}

export const iaIndisponible: AssistantPedagogique = {
  disponible: false,
  description: "non configuré",
  rediger: () => Promise.reject(new Error("L'assistant IA n'est pas configuré sur ce serveur.")),
};

export interface ConfigIa {
  cle: string;
  modele: string;
  /** Identifiant de workspace Anthropic, exigé pour une clé qui n'est pas rattachée à un workspace. */
  workspace?: string;
  rechercheWeb?: boolean;
}

export const MODELE_IA_DEFAUT = "claude-sonnet-5";
/** Version de l'outil de recherche web côté serveur d'Anthropic (voir platform.claude.com/docs, « web search tool »). */
export const OUTIL_RECHERCHE_WEB = "web_search_20260318";

type Bloc =
  | { type: "text"; text: string; citations?: Array<{ url?: string; title?: string }> }
  | { type: "server_tool_use"; id: string; name: string; input: unknown }
  | { type: "web_search_tool_result"; tool_use_id: string; content: unknown }
  | { type: string; [k: string]: unknown };

interface CorpsReponse {
  content?: Bloc[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
  error?: { type?: string; message?: string };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Adaptateur Claude (API Messages d'Anthropic).
 *  - recherche web côté serveur (outil `web_search`), localisée en France ;
 *  - reprise automatique d'une réponse mise en pause (`stop_reason: pause_turn`) ;
 *  - trois tentatives sur les erreurs passagères (429, 5xx, réseau), avec attente croissante ;
 *  - cache de la consigne système (`cache_control`) pour réduire le coût des appels répétés ;
 *  - aucun corps d'erreur recopié à l'utilisateur (il peut contenir des détails de compte).
 */
export class IaAnthropic implements AssistantPedagogique {
  readonly disponible = true;
  readonly description: string;
  private readonly rechercheWeb: boolean;
  constructor(
    private readonly config: ConfigIa,
    private readonly appel: typeof fetch = fetch,
    private readonly delaiMs = 240_000,
    private readonly attenteMs = 2_000,
  ) {
    this.rechercheWeb = config.rechercheWeb === true;
    this.description = `${config.modele}${this.rechercheWeb ? " + recherche web" : ""}`;
  }

  private entetes(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.config.cle,
      "anthropic-version": "2023-06-01",
      ...(this.config.workspace ? { "anthropic-workspace-id": this.config.workspace } : {}),
    };
  }

  private async appeler(corps: Record<string, unknown>): Promise<{ corps: CorpsReponse; tentatives: number }> {
    let derniere: Error = new Error("L'assistant IA est indisponible.");
    for (let tentative = 1; tentative <= 3; tentative++) {
      let reponse: Response;
      try {
        reponse = await this.appel("https://api.anthropic.com/v1/messages", { method: "POST", headers: this.entetes(), body: JSON.stringify(corps), signal: AbortSignal.timeout(this.delaiMs) });
      } catch (e) {
        derniere = new Error(e instanceof Error && e.name === "TimeoutError" ? "L'assistant IA n'a pas répondu à temps. Réessayez." : "Le serveur ne parvient pas à joindre l'assistant IA (réseau).");
        await pause(this.attenteMs * tentative);
        continue;
      }
      if (reponse.ok) return { corps: (await reponse.json()) as CorpsReponse, tentatives: tentative };
      const detail = ((await reponse.json().catch(() => null)) as CorpsReponse | null)?.error;
      if (reponse.status === 401) throw new Error("Clé d'API IA refusée : vérifiez la clé dans Organisme → Assistant IA.");
      if (reponse.status === 403) throw new Error("Accès refusé par l'API IA : vérifiez le workspace ou les droits de la clé.");
      if (reponse.status === 400) {
        // Erreur de requête : la reformuler ne changera rien ; on donne le type d'erreur, jamais le message brut.
        const type = detail?.type ?? "invalid_request";
        if (/workspace/i.test(detail?.message ?? "")) throw new Error("Cette clé n'est pas rattachée à un workspace : renseignez l'identifiant du workspace dans Organisme → Assistant IA.");
        if (/model/i.test(detail?.message ?? "")) throw new Error(`Modèle IA inconnu (« ${this.config.modele} ») : choisissez-en un autre dans Organisme → Assistant IA.`);
        throw new Error(`Requête refusée par l'assistant IA (${type}).`);
      }
      if (reponse.status === 429 || reponse.status >= 500) {
        derniere = new Error(reponse.status === 429 ? "L'assistant IA est saturé (limite de débit). Réessayez dans un instant." : `L'assistant IA a répondu une erreur (${reponse.status}). Réessayez dans un instant.`);
        const retryAfter = Number(reponse.headers.get("retry-after"));
        await pause(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : this.attenteMs * tentative);
        continue;
      }
      throw new Error(`L'assistant IA a répondu une erreur (${reponse.status}).`);
    }
    throw derniere;
  }

  async rediger(consigneSysteme: string, demande: string, options: OptionsRedaction = {}): Promise<ReponseIa> {
    const debut = Date.now();
    const avecRecherche = this.rechercheWeb && options.recherche === true;
    const outils = avecRecherche
      ? {
          tools: [{ type: OUTIL_RECHERCHE_WEB, name: "web_search", max_uses: options.maxRecherches ?? 6, user_location: { type: "approximate", country: "FR", timezone: "Europe/Paris" } }],
        }
      : {};
    const base = {
      model: this.config.modele,
      max_tokens: options.maxTokens ?? 4096,
      system: [{ type: "text", text: consigneSysteme, cache_control: { type: "ephemeral" } }],
      ...outils,
    };
    const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [{ role: "user", content: demande }];
    const usage: UsageIa = { tokens_entree: 0, tokens_sortie: 0, recherches_web: 0, modele: this.config.modele, duree_ms: 0, tentatives: 0 };
    const blocs: Bloc[] = [];

    // Une réponse longue (recherche web en plusieurs tours) peut être mise en pause : on la reprend telle quelle.
    let arret: string | undefined;
    for (let tour = 0; tour < 6; tour++) {
      const { corps, tentatives } = await this.appeler({ ...base, messages });
      usage.tentatives += tentatives;
      usage.tokens_entree += corps.usage?.input_tokens ?? 0;
      usage.tokens_sortie += corps.usage?.output_tokens ?? 0;
      usage.recherches_web += corps.usage?.server_tool_use?.web_search_requests ?? 0;
      blocs.push(...(corps.content ?? []));
      arret = corps.stop_reason;
      if (corps.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: corps.content ?? [] });
        continue;
      }
      break;
    }
    usage.duree_ms = Date.now() - debut;

    const texte = blocs.filter((b): b is Extract<Bloc, { type: "text" }> => b.type === "text").map((b) => String(b.text ?? "")).join("");
    if (!texte.trim()) throw new Error("L'assistant IA a renvoyé une réponse vide.");
    // Réponse coupée : le JSON serait incomplet ; mieux vaut le dire que « proposition inexploitable ».
    if (arret === "max_tokens") throw new Error("La réponse de l'assistant IA a été coupée (trop longue). Réessayez, ou demandez moins de questions ou de modules.");
    const sources = new Map<string, string>();
    for (const b of blocs) {
      if (b.type === "text") for (const c of (b as Extract<Bloc, { type: "text" }>).citations ?? []) if (c.url && !sources.has(c.url)) sources.set(c.url, c.title ?? c.url);
      if (b.type === "web_search_tool_result" && Array.isArray((b as { content?: unknown }).content)) {
        for (const r of (b as { content: Array<{ url?: string; title?: string }> }).content) if (r.url && !sources.has(r.url)) sources.set(r.url, r.title ?? r.url);
      }
    }
    return { texte, usage, sources: [...sources].slice(0, 12).map(([url, titre]) => ({ url, titre })) };
  }
}

export function creerAssistant(config: Partial<ConfigIa> | undefined, appel: typeof fetch = fetch): AssistantPedagogique {
  if (!config?.cle) return iaIndisponible;
  return new IaAnthropic({ cle: config.cle, modele: config.modele || MODELE_IA_DEFAUT, workspace: config.workspace, rechercheWeb: config.rechercheWeb }, appel);
}

// ——— Assistant factice (démonstration, tests de bout en bout) ———

/**
 * Assistant « factice » : sans réseau ni clé, il produit des réponses VALIDES mais visiblement fictives, marquées
 * « [démonstration] ». Activé par `IA_FACTICE=oui` : sert à essayer l'application et à la tester de bout en bout
 * sans dépenser de crédits. Jamais en production.
 */
export class IaFactice implements AssistantPedagogique {
  readonly disponible = true;
  readonly description = "assistant factice (démonstration, sans réseau)";

  async rediger(_consigne: string, demande: string): Promise<ReponseIa> {
    const titre = /Intitulé : (.+)/.exec(demande)?.[1]?.trim() ?? "la formation";
    const usage: UsageIa = { tokens_entree: 0, tokens_sortie: 0, recherches_web: 0, modele: "factice", duree_ms: 0, tentatives: 1 };
    const json = (o: unknown) => ({ texte: JSON.stringify(o), usage, sources: [] });
    // Seule la consigne d'analyse COMMENCE ainsi ; les autres (parcours, tests, diaporamas) citent aussi « dossier d'enjeux ».
    if (/^Constitue le dossier d'enjeux/i.test(demande)) {
      return json({
        resume: `[démonstration] Dossier d'enjeux fictif pour « ${titre} » : ce texte remplace la recherche web de l'assistant réel. Il sert à essayer l'application sans clé d'API.`,
        enjeux: ["[démonstration] Enjeu n° 1 pour l'entreprise", "[démonstration] Enjeu n° 2 pour le stagiaire", "[démonstration] Enjeu n° 3 réglementaire"],
        cadre: ["[démonstration] Texte de référence applicable", "[démonstration] Norme ou référentiel"],
        notions_cles: ["[démonstration] Notion clé A", "[démonstration] Notion clé B", "[démonstration] Notion clé C", "[démonstration] Notion clé D"],
        erreurs_frequentes: ["[démonstration] Erreur fréquente n° 1", "[démonstration] Erreur fréquente n° 2"],
        pratiques_actuelles: ["[démonstration] Pratique actuelle n° 1"],
        public_vise: `[démonstration] Salariés et indépendants concernés par « ${titre} ».`,
        prerequis: "[démonstration] Aucun prérequis particulier.",
        glossaire: [{ terme: "[démonstration] Terme", definition: "Définition fictive." }],
        sources: [{ titre: "[démonstration] Source fictive", url: "https://example.org/demonstration" }],
      });
    }
    if (/Conçois le parcours/i.test(demande)) {
      const n = Number(/exactement (\d+) module/i.exec(demande)?.[1] ?? 3);
      return json({
        objectifs: ["[démonstration] Identifier les enjeux du sujet", "[démonstration] Appliquer la méthode de référence", "[démonstration] Évaluer ses résultats"],
        public_vise: `[démonstration] Public visé fictif pour « ${titre} ».`,
        prerequis: "[démonstration] Aucun prérequis.",
        modules: Array.from({ length: n }, (_, i) => ({
          titre: `[démonstration] Module ${i + 1} — ${titre}`,
          objectifs: [`[démonstration] Objectif ${i + 1}.1`, `[démonstration] Objectif ${i + 1}.2`],
          contenus: ["[démonstration] Contenu A", "[démonstration] Contenu B", "[démonstration] Contenu C"],
          methodes: "[démonstration] Apports courts, atelier, échanges.",
          mise_en_pratique: "[démonstration] Atelier de 45 minutes sur un cas concret.",
          evaluation: "[démonstration] Quiz de fin de module.",
        })),
      });
    }
    if (/choix multiples/i.test(demande)) {
      const n = Number(/Exactement (\d+) questions/i.exec(demande)?.[1] ?? 10);
      return json({
        titre: `[démonstration] ${/TEST DE POSITIONNEMENT/.test(demande) ? "Test de positionnement" : "Évaluation des acquis"} — ${titre}`,
        questions: Array.from({ length: n }, (_, i) => ({ enonce: `[démonstration] Question ${i + 1} sur « ${titre} » ?`, propositions: ["Proposition A", "Proposition B", "Proposition C", "Proposition D"], bonne_reponse: i % 4 })),
      });
    }
    if (/diaporama/i.test(demande)) {
      const types = ["titre", "objectifs", "sommaire", "amorce", "notion", "notion", "schema", "exemple", "point_etape", "notion", "notion", "exemple", "schema", "pratique", "pratique", "debriefing", "vigilance", "notion", "synthese", "quiz"];
      return json({ diapos: types.map((type, i) => ({ type, titre: `[démonstration] Diapositive ${i + 1} (${type})`, points: ["Point 1", "Point 2", "Point 3"], visuel: "Schéma fictif", notes: "Notes fictives du formateur." })) });
    }
    return json({ objectifs: ["[démonstration] Objectif 1", "[démonstration] Objectif 2", "[démonstration] Objectif 3"], programme: `[démonstration] Programme fictif de « ${titre} » — séquence 1, séquence 2, séquence 3.` });
  }
}
