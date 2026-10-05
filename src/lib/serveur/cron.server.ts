/**
 * Appel planifié (pg_cron + pg_net) de la tâche quotidienne — authentification par secret partagé.
 *
 * La requête porte l'en-tête `x-cron-secret` ; sa valeur doit être égale au secret `CRON_SECRET` du serveur. La
 * comparaison se fait en TEMPS CONSTANT : on compare les empreintes SHA-256 (longueur fixe) octet par octet sans sortie
 * anticipée, pour ne rien apprendre d'un secret deviné caractère par caractère.
 *
 *   • `CRON_SECRET` non défini → 503 (configuration manquante) : la route ne s'exécute JAMAIS sans secret ;
 *   • en-tête absent ou faux   → 401 ;
 *   • sinon la tâche s'exécute et la réponse porte le décompte.
 *
 * Aucun secret n'est journalisé ni renvoyé.
 */
import { empreintesEgales, sha256Hex } from "./hacheur.server";
import type { BdService } from "./bd.server";
import { clientService } from "./bd.server";
import {
  executerTachesQuotidiennes,
  type OptionsTaches,
  type ResultatTaches,
} from "./taches.server";

export const ENTETE_SECRET_CRON = "x-cron-secret";

const json = (corps: unknown, statut: number) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function secretCronValide(fourni: string | null, attendu: string): Promise<boolean> {
  if (!fourni) return false;
  return empreintesEgales(await sha256Hex(fourni), await sha256Hex(attendu));
}

export interface DependancesCron {
  /** Pour les tests. Défaut : lecture de `process.env.CRON_SECRET`. */
  secret?: string | undefined;
  executer?: (bd: BdService, options?: OptionsTaches) => Promise<ResultatTaches>;
  bd?: BdService;
}

export async function traiterAppelCron(
  requete: Request,
  dependances: DependancesCron = {},
): Promise<Response> {
  const attendu = (
    "secret" in dependances ? dependances.secret : process.env["CRON_SECRET"]
  )?.trim();
  if (!attendu) {
    console.error("[cron] CRON_SECRET n'est pas défini : tâche quotidienne refusée");
    return json({ erreur: "Le secret CRON_SECRET n'est pas défini sur le serveur." }, 503);
  }
  if (requete.method !== "POST") return json({ erreur: "Méthode non autorisée." }, 405);
  if (!(await secretCronValide(requete.headers.get(ENTETE_SECRET_CRON), attendu)))
    return json({ erreur: "Non autorisé." }, 401);
  try {
    const bd = dependances.bd ?? (await clientService());
    const resultat = await (dependances.executer ?? executerTachesQuotidiennes)(bd);
    return json({ ok: true, ...resultat }, 200);
  } catch (e) {
    console.error("[cron] tâche quotidienne en échec", e);
    return json({ erreur: "La tâche quotidienne a échoué." }, 500);
  }
}
