import { createFileRoute } from "@tanstack/react-router";
import { Repertoire } from "@/client/ecrans/Repertoire";

export const Route = createFileRoute("/_authenticated/repertoire")({
  head: () => ({ meta: [{ title: "Répertoire | Dossiers de formation" }] }),
  component: Repertoire,
});
