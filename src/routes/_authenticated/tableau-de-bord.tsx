import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, FolderKanban, LogOut, ShieldCheck } from "lucide-react";
import { Bouton, Carte } from "@/client/ui/base";
import { supabase } from "@/integrations/supabase/client";
export const Route = createFileRoute("/_authenticated/tableau-de-bord")({
  head: () => ({
    meta: [
      { title: "Tableau de bord | Dossiers de formation" },
      { name: "description", content: "Votre espace sécurisé de gestion des formations." },
      { property: "og:title", content: "Tableau de bord | Dossiers de formation" },
      { property: "og:description", content: "Votre espace sécurisé de gestion des formations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Tableau,
});
function Tableau() {
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();
  async function sortir() {
    await supabase.auth.signOut();
    await navigate({ to: "/connexion", replace: true });
  }
  return (
    <main className="min-h-dvh bg-papier">
      <header className="border-b border-trait bg-carte">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-3 font-display font-semibold">
            <span className="grid size-9 place-items-center rounded-md bg-accent text-sur-accent">
              <ShieldCheck className="size-5" />
            </span>
            Dossiers de formation
          </Link>
          <Bouton variante="discret" icone={<LogOut />} onClick={sortir}>
            Déconnexion
          </Bouton>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-10">
        <p className="text-sm text-encre-3">{user.email}</p>
        <h1 className="mt-2 text-3xl font-semibold">Votre espace est prêt</h1>
        <p className="mt-3 max-w-2xl text-encre-2">
          La reprise de l’application est en cours. L’accès sécurisé fonctionne ; les dossiers et
          outils métier sont raccordés par lots.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Carte className="p-5">
            <FolderKanban className="size-6 text-accent" />
            <h2 className="mt-4 font-semibold">Dossiers de formation</h2>
            <p className="mt-1 text-sm text-encre-2">
              Le pipeline et les pièces seront disponibles après le raccordement des données.
            </p>
          </Carte>
          <Carte className="p-5">
            <CheckCircle2 className="size-6 text-valide" />
            <h2 className="mt-4 font-semibold">Connexion sécurisée</h2>
            <p className="mt-1 text-sm text-encre-2">
              Votre session est protégée et votre adresse e-mail identifie votre compte.
            </p>
          </Carte>
        </div>
      </section>
    </main>
  );
}
