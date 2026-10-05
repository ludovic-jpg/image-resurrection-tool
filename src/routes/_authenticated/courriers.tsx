import { createFileRoute } from "@tanstack/react-router";
import { Courriers } from "@/client/ecrans/Divers";

export const Route = createFileRoute("/_authenticated/courriers")({
  head: () => ({ meta: [{ title: "Boîte d'envoi | Dossiers de formation" }] }),
  component: Courriers,
});
