import { createFileRoute } from "@tanstack/react-router";
import { FicheFormation } from "@/client/ecrans/Formations";

export const Route = createFileRoute("/_authenticated/formations/$id")({
  head: () => ({ meta: [{ title: "Fiche formation | Dossiers de formation" }] }),
  component: FicheFormation,
});
