import { createFileRoute } from "@tanstack/react-router";
import { Archives } from "@/client/ecrans/Archives";

export const Route = createFileRoute("/_authenticated/archives")({
  head: () => ({ meta: [{ title: "Archives | Dossiers de formation" }] }),
  component: Archives,
});
