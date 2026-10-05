import { createFileRoute } from "@tanstack/react-router";
import { MaCandidature } from "@/client/ecrans/Candidature";

export const Route = createFileRoute("/_authenticated/candidature")({
  head: () => ({ meta: [{ title: "Ma candidature | Dossiers de formation" }] }),
  component: MaCandidature,
});
