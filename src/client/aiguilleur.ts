/**
 * Aiguilleur des appels de l'interface.
 *
 * Chaque gestionnaire s'enregistre avec `route("GET", "/formations/:id", …)` (voir `./registre.ts`). Les modules de
 * `./passerelle/` sont rangés par lot de la migration (voir `lovable/PROMPTS_PAR_LOTS.md`).
 */
import { ErreurApi } from "./erreur";
import { table } from "./registre";
import "./passerelle";

export { route, routesEnregistrees } from "./registre";

export async function aiguiller(
  methode: string,
  cheminComplet: string,
  corps?: unknown,
): Promise<unknown> {
  const [chemin = "", requete = ""] = cheminComplet.split("?");
  for (const e of table) {
    if (e.methode !== methode) continue;
    const m = e.motif.exec(chemin);
    if (!m) continue;
    const params: Record<string, string> = {};
    e.cles.forEach((cle, i) => (params[cle] = decodeURIComponent(m[i + 1] ?? "")));
    return e.gestionnaire({ params, requete: new URLSearchParams(requete), corps });
  }
  throw new ErreurApi(
    "Cette fonction arrive dans un prochain lot de la reprise.",
    501,
    "non_porte",
    null,
  );
}

/** Traduit une erreur Supabase (PostgREST, Auth, RPC) dans le format que les écrans connaissent. */
export function erreurInconnue(e: unknown): ErreurApi {
  const err = e as { message?: string; code?: string; status?: number } | null;
  const code = err?.code ?? "";
  // « introuvable » plutôt que « interdit » : un objet cloisonné ne révèle pas son existence.
  if (code === "PGRST116" || code === "42501")
    return new ErreurApi("Élément introuvable.", 404, "introuvable", null);
  if (code === "23505") return new ErreurApi("Cet élément existe déjà.", 409, "doublon", null);
  if (err?.status === 401 || code === "PGRST301")
    return new ErreurApi("Votre session a expiré. Reconnectez-vous.", 401, "non_connecte", null);
  if (typeof fetch !== "undefined" && e instanceof TypeError)
    return new ErreurApi("Le service ne répond pas. Réessayez dans un instant.", 0, "reseau", null);
  console.error("[aiguilleur]", e);
  return new ErreurApi(
    "Une erreur est survenue. Réessayez ; si elle persiste, prévenez l'organisme.",
    500,
    "interne",
    null,
  );
}
