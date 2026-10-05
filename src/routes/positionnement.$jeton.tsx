import { createFileRoute } from "@tanstack/react-router";
import { PagePositionnement } from "@/client/ecrans/Positionnements";

export const Route = createFileRoute("/positionnement/$jeton")({
  head: () => ({ meta: [{ title: "Positionnement | Dossiers de formation" }] }),
  ssr: false,
  component: PagePositionnement,
});
