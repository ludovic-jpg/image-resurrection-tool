import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { Alerte, Bouton, Champ } from "@/client/ui/base";
import { CoquilleAcces, SeparateurOu } from "@/client/ui/CoquilleAcces";
import { journaliser, messageConnexion } from "@/client/auth/messages";

export const Route = createFileRoute("/connexion")({
  head: () => ({
    meta: [
      { title: "Connexion | Dossiers de formation" },
      { name: "description", content: "Connectez-vous à votre espace de formation sécurisé." },
      { property: "og:title", content: "Connexion | Dossiers de formation" },
      {
        property: "og:description",
        content: "Connectez-vous à votre espace de formation sécurisé.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Connexion,
});

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
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: motDePasse,
    });
    setCharge(false);
    if (error) {
      journaliser("connexion", error);
      setErreur(messageConnexion(error));
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
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      journaliser("google", result.error);
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
        <div className="-mt-1 text-right text-[13px]">
          <Link to="/mot-de-passe-oublie" className="font-medium text-accent hover:underline">
            Mot de passe oublié ?
          </Link>
        </div>
        {erreur && <Alerte ton="danger">{erreur}</Alerte>}
        <Bouton type="submit" variante="primaire" className="w-full" enCours={charge}>
          Se connecter
        </Bouton>
      </form>
      <SeparateurOu />
      <Bouton className="w-full" onClick={connecterGoogle}>
        Continuer avec Google
      </Bouton>
    </CoquilleAcces>
  );
}
