import { createFileRoute } from "@tanstack/react-router";
import { MesDossiers } from "@/client/ecrans/Accueil";

export const Route = createFileRoute("/_authenticated/dossiers/")({
  head: () => ({ meta: [{ title: "Mes dossiers | Dossiers de formation" }] }),
  component: MesDossiers,
});
