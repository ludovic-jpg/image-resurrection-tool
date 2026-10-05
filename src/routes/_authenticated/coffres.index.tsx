import { createFileRoute } from "@tanstack/react-router";
import { CoffresParcours } from "@/client/ecrans/Coffre";

export const Route = createFileRoute("/_authenticated/coffres/")({
  head: () => ({ meta: [{ title: "Coffres-forts | Dossiers de formation" }] }),
  component: CoffresParcours,
});
