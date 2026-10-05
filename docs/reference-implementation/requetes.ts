import { QueryClient } from "@tanstack/react-query";
import { api, ErreurApi, type Moi } from "./api";

/** Client de requêtes unique, partagé entre React et les gardes du routeur. */
export const requetes = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Inutile de réessayer une erreur métier (403, 404, 409…) : seul un souci réseau mérite un second essai.
      retry: (tentatives, erreur) => erreur instanceof ErreurApi && erreur.statut === 0 && tentatives < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export const requeteMoi = { queryKey: ["moi"], queryFn: () => api.get<Moi>("/auth/moi"), staleTime: 60_000 } as const;
