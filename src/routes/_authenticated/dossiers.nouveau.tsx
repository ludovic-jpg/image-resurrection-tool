import { createFileRoute } from "@tanstack/react-router";
import { NouveauDossier } from "@/client/ecrans/NouveauDossier";

export const Route = createFileRoute("/_authenticated/dossiers/nouveau")({
  head: () => ({ meta: [{ title: "Nouveau dossier | Dossiers de formation" }] }),
  component: NouveauDossier,
});
