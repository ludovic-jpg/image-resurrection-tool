import { createFileRoute } from "@tanstack/react-router";
import { Compte } from "@/client/ecrans/Divers";

export const Route = createFileRoute("/_authenticated/compte")({
  head: () => ({ meta: [{ title: "Mon compte | Dossiers de formation" }] }),
  component: Compte,
});
