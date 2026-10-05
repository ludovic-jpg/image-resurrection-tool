import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { Alerte, Bouton, Champ } from "@/client/ui/base";

export const Route = createFileRoute("/connexion")({
  head: () => ({
    meta: [
      { title: "Connexion | Dossiers de formation" },
      { name: "description", content: "Connectez-vous à votre espace de formation sécurisé." },
      { property: "og:title", content: "Connexion | Dossiers de formation" },
      { property: "og:description", content: "Connectez-vous à votre espace de formation sécurisé." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Connexion,
});

export function CoquilleAcces({
  titre,
  accroche,
  children,
  pied,
}: {
  titre: string;
  accroche: string;
  children: ReactNode;
  pied?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-encre p-12 text-sur-accent lg:flex">
        <Link to="/" className="flex items-center gap-3 font-display text-lg font-semibold">
          <span className="grid size-9 place-items-center rounded-md bg-accent">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          Dossiers de formation
        </Link>
        <div>
          <p className="max-w-[22ch] font-display text-[40px] font-semibold leading-[1.1]">
            Un dossier complet, sans courir après les signatures.
          </p>
          <p className="mt-6 max-w-[46ch] text-[15px] leading-relaxed text-sur-accent/70">
            De la candidature du formateur à l’archivage : chaque pièce est générée, suivie, signée et
            classée.
          </p>
        </div>
        <ol className="grid grid-cols-7 gap-1.5 text-[11px] font-medium text-sur-accent/60">
          {["Création", "Finance.", "Début", "Fin", "Paiem.", "Encaissé", "Archivé"].map((e, i) => (
            <li key={e}>
              <span className={`mb-2 block h-1 ${i < 3 ? "bg-attente" : "bg-sur-accent/20"}`} />
              {e}
            </li>
          ))}
        </ol>
      </aside>
      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-10 flex items-center gap-2 font-display font-semibold lg:hidden">
            <ShieldCheck className="size-5 text-accent" />
            Dossiers de formation
          </Link>
          <h1 className="text-[28px] font-semibold leading-tight">{titre}</h1>
          <p className="mt-2 text-encre-2">{accroche}</p>
          <div className="mt-8">{children}</div>
          {pied && <div className="mt-8 border-t border-trait pt-5 text-sm text-encre-2">{pied}</div>}
        </div>
      </main>
    </div>
  );
}

function Connexion() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState("");
  const [charge, setCharge] = useState(false);
  async function connecter(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setCharge(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
    setCharge(false);
    if (error) {
      setErreur("La connexion a échoué. Vérifiez votre adresse e-mail et votre mot de passe.");
      return;
    }
    await navigate({ to: "/tableau-de-bord" });
  }
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/tableau-de-bord", replace: true });
    });
  }, [navigate]);
  async function connecterGoogle() {
    setErreur("");
    sessionStorage.setItem("s4m_retour_auth", "/tableau-de-bord");
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) {
      setErreur("La connexion avec Google a échoué. Réessayez.");
      return;
    }
    if (result.redirected) return;
    sessionStorage.removeItem("s4m_retour_auth");
    await navigate({ to: "/tableau-de-bord" });
  }
  return (
    <CoquilleAcces
      titre="Connexion"
      accroche="Formateur, apprenant ou organisme : un seul accès."
      pied={
        <>
          Vous êtes formateur et souhaitez être porté ?{" "}
          <Link to="/inscription" className="font-medium text-accent hover:underline">
            Déposer une candidature
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={connecter}>
        <Champ
          libelle="Adresse e-mail"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Champ
          libelle="Mot de passe"
          type="password"
          autoComplete="current-password"
          required
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
        />
        {erreur && <Alerte ton="danger">{erreur}</Alerte>}
        <Bouton type="submit" variante="primaire" className="w-full" enCours={charge}>
          Se connecter
        </Bouton>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-encre-3">
        <span className="h-px flex-1 bg-trait" />
        ou
        <span className="h-px flex-1 bg-trait" />
      </div>
      <Bouton className="w-full" onClick={connecterGoogle}>
        Continuer avec Google
      </Bouton>
    </CoquilleAcces>
  );
}
