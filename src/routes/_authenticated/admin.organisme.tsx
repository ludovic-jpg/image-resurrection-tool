import { createFileRoute } from "@tanstack/react-router";
import { AdminOrganisme } from "@/client/ecrans/Admin";

export const Route = createFileRoute("/_authenticated/admin/organisme")({
  head: () => ({ meta: [{ title: "Organisme | Dossiers de formation" }] }),
  component: AdminOrganisme,
});
