import { createFileRoute } from "@tanstack/react-router";
import { Formations } from "@/client/ecrans/Formations";

export const Route = createFileRoute("/_authenticated/formations/")({
  head: () => ({ meta: [{ title: "Formations | Dossiers de formation" }] }),
  component: Formations,
});
