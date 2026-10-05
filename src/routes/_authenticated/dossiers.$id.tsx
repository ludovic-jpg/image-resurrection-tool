import { createFileRoute } from "@tanstack/react-router";
import { EcranDossier } from "@/client/ecrans/Dossier";

export const Route = createFileRoute("/_authenticated/dossiers/$id")({
  head: () => ({ meta: [{ title: "Dossier | Dossiers de formation" }] }),
  component: EcranDossier,
});
