import { createFileRoute } from "@tanstack/react-router";
import { PageFormulaire } from "@/client/ecrans/Formulaire";

export const Route = createFileRoute("/formulaire/$jeton")({
  head: () => ({ meta: [{ title: "Formulaire | Dossiers de formation" }] }),
  ssr: false,
  component: PageFormulaire,
});
