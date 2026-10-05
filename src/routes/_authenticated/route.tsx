import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Chargement } from "@/client/ui/base";
import { supabase } from "@/integrations/supabase/client";

// La session est lue localement (aucun appel réseau à chaque page) : les droits sur les données restent
// imposés côté base par les règles RLS, jamais par cette garde, qui ne sert qu'à orienter l'interface.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  pendingComponent: () => <Chargement />,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/connexion" });
    return { user: data.session.user };
  },
  component: () => <Outlet />,
});
