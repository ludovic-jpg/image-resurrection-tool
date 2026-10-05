import { createFileRoute } from "@tanstack/react-router";
import { MaCandidature } from "@/client/ecrans/Candidature";

export const Route = createFileRoute("/_authenticated/profil")({
  head: () => ({ meta: [{ title: "Mon profil | Dossiers de formation" }] }),
  component: MaCandidature,
});
