import { createFileRoute } from "@tanstack/react-router";
import { Invitation } from "@/client/ecrans/Acces";

export const Route = createFileRoute("/invitation/$jeton")({
  head: () => ({ meta: [{ title: "Invitation | Dossiers de formation" }] }),
  ssr: false,
  component: Invitation,
});
