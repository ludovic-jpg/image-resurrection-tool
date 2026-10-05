/**
 * Route serveur « tâche quotidienne » — POST /api/taches-quotidiennes.
 *
 * Appelée chaque nuit à 03:00 (Europe/Paris) par pg_cron + pg_net (voir la migration `…_lot8_tache_quotidienne.sql`).
 * Ce n'est PAS une route d'utilisateur : aucune session, aucun acteur ; la seule protection est l'en-tête
 * `x-cron-secret` comparé à `CRON_SECRET` (voir `lib/serveur/cron.server.ts`). Le module serveur est chargé à l'appel,
 * jamais en tête de fichier : le client service ne doit pas entrer dans le paquet du navigateur.
 */
import { createFileRoute } from "@tanstack/react-router";

// `routeTree.gen.ts` est un fichier généré qu'on ne commite pas ici : Lovable le régénère au build et y ajoute cette
// route. Tant que ce n'est pas fait, le chemin est inconnu des types ; l'ignorance est volontaire (et sans effet
// une fois l'arbre régénéré, contrairement à `@ts-expect-error`).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const Route = createFileRoute("/api/taches-quotidiennes")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { traiterAppelCron } = await import("@/lib/serveur/cron.server");
        return traiterAppelCron(request);
      },
      // Toute autre méthode : 405 (et non la page de l'application).
      GET: async () =>
        new Response(JSON.stringify({ erreur: "Méthode non autorisée." }), {
          status: 405,
          headers: { "content-type": "application/json; charset=utf-8", allow: "POST" },
        }),
    },
  },
});
