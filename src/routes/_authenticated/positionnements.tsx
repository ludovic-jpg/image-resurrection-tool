import { createFileRoute } from "@tanstack/react-router";
import { Positionnements } from "@/client/ecrans/Positionnements";

export const Route = createFileRoute("/_authenticated/positionnements")({
  head: () => ({ meta: [{ title: "Positionnements | Dossiers de formation" }] }),
  component: Positionnements,
});
