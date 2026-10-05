import { requetes } from "@/client/requetes";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Le même client de requêtes sert aux gardes de routes et aux écrans : un seul cache pour toute l'application.
  const queryClient = requetes;

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
