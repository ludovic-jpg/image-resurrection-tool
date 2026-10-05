import { createFileRoute, redirect } from "@tanstack/react-router";
import { Cadre } from "@/client/ecrans/Cadre";
import { requeteMoi, requetes } from "@/client/requetes";

/** Pages que peut ouvrir un formateur dont la candidature n'est pas encore validée (F-ONB-02). */
const PAGES_CANDIDAT = ["/candidature", "/profil", "/compte"];

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Garde d'accès, AVANT tout rendu : pas de session → connexion ; formateur non validé → sa candidature.
  beforeLoad: async ({ location }) => {
    const { acteur } = await requetes.ensureQueryData(requeteMoi);
    if (!acteur) throw redirect({ to: "/connexion" });
    if (
      acteur.role === "formateur" &&
      !acteur.formateur_valide &&
      !PAGES_CANDIDAT.includes(location.pathname)
    ) {
      throw redirect({ to: "/candidature" });
    }
    return { acteur };
  },
  component: Cadre,
});
