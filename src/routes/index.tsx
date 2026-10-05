import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight, CheckCircle2, FolderLock, GraduationCap, ShieldCheck } from "lucide-react";
import { Bouton } from "@/client/ui/base";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dossiers de formation | Accueil" },
      { name: "description", content: "Gérez chaque dossier de formation, de la candidature à l’archivage." },
      { property: "og:title", content: "Dossiers de formation" },
      {
        property: "og:description",
        content: "Gérez chaque dossier de formation, de la candidature à l’archivage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    if (sessionStorage.getItem("s4m_retour_auth") !== "/tableau-de-bord") return;
    const aller = () => {
      sessionStorage.removeItem("s4m_retour_auth");
      void navigate({ to: "/tableau-de-bord", replace: true });
    };
    // Attendre que la session Google soit bien enregistrée avant d'ouvrir l'espace protégé.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) aller();
    });
    const { data: abonnement } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) aller();
    });
    return () => abonnement.subscription.unsubscribe();
  }, [navigate]);
  return (
    <main className="min-h-dvh bg-papier">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3 font-display font-semibold text-encre">
          <span className="grid size-9 place-items-center rounded-md bg-accent text-sur-accent">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          Dossiers de formation
        </div>
        <Link to="/connexion">
          <Bouton variante="primaire">Connexion</Bouton>
        </Link>
      </header>
      <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-12 sm:px-8 lg:grid-cols-[minmax(0,3fr)_minmax(340px,2fr)] lg:items-center lg:pt-20">
        <div>
          <p className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-accent">
            <CheckCircle2 className="size-4" aria-hidden /> Suivi Qualiopi, sans fichiers éparpillés
          </p>
          <h1 className="max-w-[16ch] text-[42px] font-semibold leading-[1.08] text-encre sm:text-[56px]">
            Un dossier complet, sans courir après les signatures.
          </h1>
          <p className="mt-6 max-w-[58ch] text-base leading-relaxed text-encre-2">
            De la candidature du formateur à l’archivage, chaque pièce est générée, suivie, signée et classée
            au même endroit.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/connexion">
              <Bouton variante="primaire" icone={<ArrowRight className="size-4" aria-hidden />}>
                Accéder à mon espace
              </Bouton>
            </Link>
            <Link to="/inscription">
              <Bouton>Déposer une candidature</Bouton>
            </Link>
          </div>
        </div>
        <div className="border-l-4 border-attente bg-encre p-7 text-sur-accent shadow-flottant sm:p-9">
          <div className="grid gap-7">
            <div className="flex gap-4">
              <FolderLock className="mt-1 size-6 shrink-0 text-attente" aria-hidden />
              <div>
                <h2 className="font-semibold">Documents regroupés</h2>
                <p className="mt-1 text-sm leading-relaxed text-sur-accent/70">
                  Contrats, conventions, factures, évaluations et preuves restent liés au bon dossier.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <GraduationCap className="mt-1 size-6 shrink-0 text-attente" aria-hidden />
              <div>
                <h2 className="font-semibold">Trois espaces adaptés</h2>
                <p className="mt-1 text-sm leading-relaxed text-sur-accent/70">
                  Organisme, formateur et apprenant voient uniquement les informations qui les concernent.
                </p>
              </div>
            </div>
          </div>
          <ol
            className="mt-10 grid grid-cols-7 gap-1.5 text-[10px] font-medium text-sur-accent/60"
            aria-label="Étapes du dossier"
          >
            {["Création", "Finance.", "Début", "Fin", "Paiem.", "Encaissé", "Archivé"].map((etape, index) => (
              <li key={etape}>
                <span className={`mb-2 block h-1 ${index < 3 ? "bg-attente" : "bg-sur-accent/20"}`} />
                {etape}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
