import { createFileRoute } from "@tanstack/react-router";
import { Bpf } from "@/client/ecrans/Divers";

export const Route = createFileRoute("/_authenticated/bpf")({
  head: () => ({ meta: [{ title: "BPF | Dossiers de formation" }] }),
  component: Bpf,
});
