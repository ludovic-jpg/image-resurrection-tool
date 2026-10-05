import { createFileRoute } from "@tanstack/react-router";
import { CoffreParcours } from "@/client/ecrans/Coffre";

export const Route = createFileRoute("/_authenticated/coffres/$id")({
  head: () => ({ meta: [{ title: "Coffre-fort | Dossiers de formation" }] }),
  component: CoffreParcours,
});
