import { createFileRoute } from "@tanstack/react-router";
import { Outils } from "@/client/ecrans/Outils";

export const Route = createFileRoute("/_authenticated/outils")({
  head: () => ({ meta: [{ title: "Outils pédagogiques | Dossiers de formation" }] }),
  component: Outils,
});
