import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { requeteMoi } from "./requetes";

export function useMoi() {
  return useQuery(requeteMoi);
}

/** L'acteur connecté. À n'utiliser que sous le cadre de l'application, qui garantit sa présence. */
export function useActeur() {
  const { data } = useMoi();
  if (!data?.acteur) throw new Error("useActeur appelé hors session");
  return data.acteur;
}

export function useDeconnexion() {
  const requetes = useQueryClient();
  return async () => {
    await api.post("/auth/deconnexion");
    requetes.clear();
    location.assign("/connexion");
  };
}
