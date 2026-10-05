import { createFileRoute } from "@tanstack/react-router";
import { Accueil } from "@/client/ecrans/Accueil";

export const Route = createFileRoute("/_authenticated/tableau-de-bord")({
  head: () => ({ meta: [{ title: "Accueil | Dossiers de formation" }] }),
  component: Accueil,
});
