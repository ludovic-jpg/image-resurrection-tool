/**
 * Assistant IA de l'espace pédagogique — équivalent du port `src/serveur/ports/ia.ts` (adaptateur Claude).
 *
 * C'est le SEUL fichier qui parle à l'API d'Anthropic (appel HTTP direct par `fetch`, sans SDK : compatible Cloudflare
 * Workers) et le seul qui lit la clé d'API. Seul `ia-pedagogie.server.ts` l'importe : le test de garde
 * `src/lib/serveur/ia-perimetre.test.ts` le vérifie, car l'IA ne doit JAMAIS toucher aux conventions, aux pièces, au
 * pipeline ni aux montants (cahier des charges oral du 23/09/2026 : « tout doit être produit de manière très exacte »).
 *
 * Configuration (ordre de priorité) :
 *   1. les réglages de l'organisme (Organisme → Assistant IA) : clé chiffrée avec `CLE_SECRETS`, modèle, workspace,
 *      recherche web ; l'organisme peut aussi désactiver l'assistant (`ia_active` = « non ») ;
 *   2. à défaut de clé propre à l'organisme, les secrets du serveur :
 *        ANTHROPIC_API_KEY   clé d'API Anthropic
 *        IA_MODELE           modèle par défaut (identifiant de l'API) — AUCUN nom de modèle n'est supposé ailleurs
 *        IA_WORKSPACE_ID     identifiant de workspace (facultatif ; exigé pour une clé non rattachée à un workspace)
 *        IA_RECHERCHE_WEB    « oui » (défaut) ou « non »
 *   3. si ni `ia_modele` ni `IA_MODELE` ne sont définis : le repli `MODELE_IA_REPLI` ci-dessous.
 *
 * Aucune donnée d'apprenant n'est jamais envoyée : uniquement la description de la FORMATION.
 * Aucun corps d'erreur de l'API n'est recopié à l'utilisateur (il peut contenir des détails de compte).
 */
import type { BdService } from "./bd.server";
import { chiffreurDepuisEnvironnement } from "./chiffrement.server";

/**
 * Repli documenté, utilisé SEULEMENT si ni le réglage de l'organisme ni le secret `IA_MODELE` n'indiquent de modèle.
 * Identifiant relevé sur platform.claude.com/docs/en/models/overview le 05/10/2026 (« Claude Sonnet 5.5 »).
 */
export const MODELE_IA_REPLI = "claude-sonnet-5-5";
/** Version de l'outil de recherche web côté serveur d'Anthropic (platform.claude.com/docs, « web search tool », 05/10/2026). */
export const OUTIL_RECHERCHE_WEB = "web_search_20260318";
const URL_API = "https://api.anthropic.com/v1/messages";

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

export interface OptionsRedaction {
  /** Autorise l'IA à mener une recherche web avant de rédiger (si la configuration l'active). */
  recherche?: boolean;
  /** Nombre maximal de recherches pour cette demande (défaut 6). */
  maxRecherches?: number;
  /** Longueur maximale de la réponse (les plans de diaporama sont longs). */
  maxTokens?: number;
}

export interface AssistantPedagogique {
  readonly disponible: boolean;
  /** Décrit la configuration (modèle, recherche web) pour l'affichage — jamais la clé. */
  readonly description: string;
  /** Envoie une consigne et retourne la réponse. Lève une erreur lisible en cas d'échec. */
  rediger(consigneSysteme: string, demande: string, options?: OptionsRedaction): Promise<ReponseIa>;
}

export const MESSAGE_IA_NON_CONFIGUREE =
  "L'assistant IA n'est pas configuré. Demandez à l'administrateur de l'organisme de renseigner la clé d'API dans « Organisme → Assistant IA ».";
export const MESSAGE_IA_DESACTIVEE =
  "L'assistant IA est désactivé pour cet organisme. L'administrateur peut le réactiver dans « Organisme → Assistant IA ».";
export const MESSAGE_CLE_ILLISIBLE =
  "La clé d'API IA enregistrée est illisible (la clé de chiffrement a changé). L'administrateur doit la ressaisir dans « Organisme → Assistant IA ».";

export const iaIndisponible = (message = MESSAGE_IA_NON_CONFIGUREE): AssistantPedagogique => ({
  disponible: false,
  description: "non configuré",
  rediger: () => Promise.reject(new Error(message)),
});

export interface ConfigIa {
  cle: string;
  modele: string;
  /** Identifiant de workspace Anthropic, exigé pour une clé qui n'est pas rattachée à un workspace. */
  workspace?: string;
  rechercheWeb?: boolean;
}

type Bloc =
  | { type: "text"; text: string; citations?: Array<{ url?: string; title?: string }> }
  | { type: "server_tool_use"; id: string; name: string; input: unknown }
  | { type: "web_search_tool_result"; tool_use_id: string; content: unknown }
  | { type: string; [k: string]: unknown };

interface CorpsReponse {
  content?: Bloc[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
  error?: { type?: string; message?: string };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Adaptateur Claude (API Messages d'Anthropic) :
 *  - recherche web côté serveur (outil `web_search`), localisée en France ;
 *  - reprise automatique d'une réponse mise en pause (`stop_reason: pause_turn`) ;
 *  - trois tentatives sur les erreurs passagères (429, 5xx, réseau), avec attente croissante ;
 *  - cache de la consigne système (`cache_control`) pour réduire le coût des appels répétés.
 */
export class IaAnthropic implements AssistantPedagogique {
  readonly disponible = true;
  readonly description: string;
  private readonly rechercheWeb: boolean;
  constructor(
    private readonly config: ConfigIa,
    /** Injectable pour les tests ; par défaut le `fetch` global, lu à chaque appel. */
    private readonly appel: typeof fetch = (entree, init) => fetch(entree, init),
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

  private async appeler(
    corps: Record<string, unknown>,
  ): Promise<{ corps: CorpsReponse; tentatives: number }> {
    let derniere: Error = new Error("L'assistant IA est indisponible.");
    for (let tentative = 1; tentative <= 3; tentative++) {
      let reponse: Response;
      try {
        reponse = await this.appel(URL_API, {
          method: "POST",
          headers: this.entetes(),
          body: JSON.stringify(corps),
          signal: AbortSignal.timeout(this.delaiMs),
        });
      } catch (e) {
        derniere = new Error(
          e instanceof Error && e.name === "TimeoutError"
            ? "L'assistant IA n'a pas répondu à temps. Réessayez."
            : "Le serveur ne parvient pas à joindre l'assistant IA (réseau).",
        );
        await pause(this.attenteMs * tentative);
        continue;
      }
      if (reponse.ok)
        return { corps: (await reponse.json()) as CorpsReponse, tentatives: tentative };
      const detail = ((await reponse.json().catch(() => null)) as CorpsReponse | null)?.error;
      if (reponse.status === 401)
        throw new Error("Clé d'API IA refusée : vérifiez la clé dans Organisme → Assistant IA.");
      if (reponse.status === 403)
        throw new Error(
          "Accès refusé par l'API IA : vérifiez le workspace ou les droits de la clé.",
        );
      if (reponse.status === 400) {
        // Erreur de requête : la reformuler ne changera rien ; on donne le type d'erreur, jamais le message brut.
        const type = detail?.type ?? "invalid_request";
        if (/workspace/i.test(detail?.message ?? ""))
          throw new Error(
            "Cette clé n'est pas rattachée à un workspace : renseignez l'identifiant du workspace dans Organisme → Assistant IA.",
          );
        if (/model/i.test(detail?.message ?? ""))
          throw new Error(
            `Modèle IA inconnu (« ${this.config.modele} ») : choisissez-en un autre dans Organisme → Assistant IA.`,
          );
        throw new Error(`Requête refusée par l'assistant IA (${type}).`);
      }
      if (reponse.status === 429 || reponse.status >= 500) {
        derniere = new Error(
          reponse.status === 429
            ? "L'assistant IA est saturé (limite de débit). Réessayez dans un instant."
            : `L'assistant IA a répondu une erreur (${reponse.status}). Réessayez dans un instant.`,
        );
        const retryAfter = Number(reponse.headers.get("retry-after"));
        await pause(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter, 30) * 1000
            : this.attenteMs * tentative,
        );
        continue;
      }
      throw new Error(`L'assistant IA a répondu une erreur (${reponse.status}).`);
    }
    throw derniere;
  }

  async rediger(
    consigneSysteme: string,
    demande: string,
    options: OptionsRedaction = {},
  ): Promise<ReponseIa> {
    const debut = Date.now();
    const avecRecherche = this.rechercheWeb && options.recherche === true;
    const outils = avecRecherche
      ? {
          tools: [
            {
              type: OUTIL_RECHERCHE_WEB,
              name: "web_search",
              max_uses: options.maxRecherches ?? 6,
              user_location: { type: "approximate", country: "FR", timezone: "Europe/Paris" },
            },
          ],
        }
      : {};
    const base = {
      model: this.config.modele,
      max_tokens: options.maxTokens ?? 4096,
      system: [{ type: "text", text: consigneSysteme, cache_control: { type: "ephemeral" } }],
      ...outils,
    };
    const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
      { role: "user", content: demande },
    ];
    const usage: UsageIa = {
      tokens_entree: 0,
      tokens_sortie: 0,
      recherches_web: 0,
      modele: this.config.modele,
      duree_ms: 0,
      tentatives: 0,
    };
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

    const texte = blocs
      .filter((b): b is Extract<Bloc, { type: "text" }> => b.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("");
    if (!texte.trim()) throw new Error("L'assistant IA a renvoyé une réponse vide.");
    // Réponse coupée : le JSON serait incomplet ; mieux vaut le dire que « proposition inexploitable ».
    if (arret === "max_tokens")
      throw new Error(
        "La réponse de l'assistant IA a été coupée (trop longue). Réessayez, ou demandez moins de questions ou de modules.",
      );
    const sources = new Map<string, string>();
    for (const b of blocs) {
      if (b.type === "text")
        for (const c of (b as Extract<Bloc, { type: "text" }>).citations ?? [])
          if (c.url && !sources.has(c.url)) sources.set(c.url, c.title ?? c.url);
      if (
        b.type === "web_search_tool_result" &&
        Array.isArray((b as { content?: unknown }).content)
      ) {
        for (const r of (b as { content: Array<{ url?: string; title?: string }> }).content)
          if (r.url && !sources.has(r.url)) sources.set(r.url, r.title ?? r.url);
      }
    }
    return {
      texte,
      usage,
      sources: [...sources].slice(0, 12).map(([url, titre]) => ({ url, titre })),
    };
  }
}

// ——— Configuration : réglages de l'organisme, puis secrets du serveur ———

/** Lecture d'un secret du serveur (variable vide = non définie). Lecture locale : ce fichier est seul à les connaître. */
function secret(nom: "ANTHROPIC_API_KEY" | "IA_MODELE" | "IA_WORKSPACE_ID" | "IA_RECHERCHE_WEB") {
  const brut = typeof process !== "undefined" ? process.env?.[nom] : undefined;
  const v = brut?.trim();
  return v ? v : undefined;
}

const CLES_REGLAGES = [
  "ia_active",
  "ia_cle",
  "ia_modele",
  "ia_workspace",
  "ia_recherche_web",
] as const;

export type ConfigurationIa =
  { disponible: true; config: ConfigIa } | { disponible: false; message: string };

/**
 * Configuration effective de l'assistant pour un organisme. Ne lève jamais : sans clé, renvoie `disponible: false` avec
 * le message français à montrer. Une clé d'organisme illisible (CLE_SECRETS changée ou absente) est ignorée : si le
 * serveur a sa propre clé, elle prend le relais ; sinon le message demande de ressaisir la clé.
 */
export async function configurationIa(bd: BdService, ofId: string): Promise<ConfigurationIa> {
  const { data, error } = await bd
    .from("reglage")
    .select("cle, valeur, secret")
    .eq("of_id", ofId)
    .in("cle", [...CLES_REGLAGES]);
  if (error) {
    // Pas de plantage : on retombe sur les secrets du serveur, et on trace la cause.
    console.error("[ia] lecture des réglages impossible", error);
  }
  const reglages = new Map<string, { valeur: string; secret: boolean }>();
  for (const l of (data ?? []) as Array<{ cle: string; valeur: string; secret: boolean }>)
    reglages.set(l.cle, { valeur: l.valeur ?? "", secret: l.secret === true });

  if (reglages.get("ia_active")?.valeur === "non")
    return { disponible: false, message: MESSAGE_IA_DESACTIVEE };

  let cleOrganisme = "";
  let illisible = false;
  const scelle = reglages.get("ia_cle");
  if (scelle?.valeur) {
    try {
      const chiffreur = await chiffreurDepuisEnvironnement();
      cleOrganisme = await chiffreur.dechiffrer(scelle.valeur);
    } catch (e) {
      console.warn("[ia] clé d'organisme illisible", e instanceof Error ? e.message : e);
      illisible = true;
    }
  }

  const modeleOrganisme = reglages.get("ia_modele")?.valeur ?? "";
  const workspaceOrganisme = reglages.get("ia_workspace")?.valeur ?? "";
  const rechercheOrganisme = reglages.get("ia_recherche_web")?.valeur ?? "oui";
  const modele = (m: string | undefined) => m || secret("IA_MODELE") || MODELE_IA_REPLI;

  if (cleOrganisme) {
    return {
      disponible: true,
      config: {
        cle: cleOrganisme,
        modele: modele(modeleOrganisme),
        workspace: workspaceOrganisme || secret("IA_WORKSPACE_ID"),
        rechercheWeb: rechercheOrganisme !== "non",
      },
    };
  }
  const cleServeur = secret("ANTHROPIC_API_KEY");
  if (cleServeur) {
    return {
      disponible: true,
      config: {
        cle: cleServeur,
        modele: modele(modeleOrganisme),
        workspace: workspaceOrganisme || secret("IA_WORKSPACE_ID"),
        rechercheWeb: secret("IA_RECHERCHE_WEB") !== "non",
      },
    };
  }
  return {
    disponible: false,
    message: illisible ? MESSAGE_CLE_ILLISIBLE : MESSAGE_IA_NON_CONFIGUREE,
  };
}

/** L'assistant à utiliser pour cet organisme (indisponible, avec son message, sans clé). */
export async function assistantPourOrganisme(
  bd: BdService,
  ofId: string,
  appel?: typeof fetch,
): Promise<AssistantPedagogique> {
  const c = await configurationIa(bd, ofId);
  return c.disponible ? new IaAnthropic(c.config, appel) : iaIndisponible(c.message);
}
