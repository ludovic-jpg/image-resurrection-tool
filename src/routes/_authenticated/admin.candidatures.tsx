import { createFileRoute } from "@tanstack/react-router";
import { AdminCandidatures } from "@/client/ecrans/Admin";

export const Route = createFileRoute("/_authenticated/admin/candidatures")({
  head: () => ({ meta: [{ title: "Candidatures | Dossiers de formation" }] }),
  component: AdminCandidatures,
});
