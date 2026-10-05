import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { Alerte, Bouton, Champ } from "@/client/ui/base";
import { CoquilleAcces } from "./connexion";

export const Route = createFileRoute("/inscription")({
  head: () => ({
    meta: [
      { title: "Candidature formateur | Dossiers de formation" },
      {
        name: "description",
        content: "Créez votre compte et déposez votre candidature de formateur.",
      },
      { property: "og:title", content: "Candidature formateur" },
      {
        property: "og:description",
        content: "Créez votre compte et déposez votre candidature de formateur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Inscription,
});

function Inscription() {
  const [v, setV] = useState({ prenom: "", nom: "", email: "", motDePasse: "" });
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [charge, setCharge] = useState(false);
  const champ = (cle: keyof typeof v) => ({
    value: v[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [cle]: e.target.value }),
  });
  async function inscrire(e: React.FormEvent) {
    e.preventDefault();
    setCharge(true);
    setErreur("");
    const { error } = await supabase.auth.signUp({
      email: v.email,
      password: v.motDePasse,
      options: { data: { role: "formateur", prenom: v.prenom, nom: v.nom } },
    });
    setCharge(false);
    if (error) {
      setErreur("La création du compte a échoué. Vérifiez les informations puis réessayez.");
      return;
    }
    setMessage(
      "Votre compte est créé. Consultez votre messagerie pour confirmer votre adresse e-mail.",
    );
  }
  async function google() {
    sessionStorage.setItem("s4m_retour_auth", "/tableau-de-bord");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) setErreur("La connexion avec Google a échoué. Réessayez.");
  }
  return (
    <CoquilleAcces
      titre="Candidature formateur"
      accroche="Créez votre compte, puis complétez votre dossier. L’organisme l’étudie et vous répond par e-mail."
      pied={
        <>
          Déjà inscrit ?{" "}
          <Link to="/connexion" className="font-medium text-accent hover:underline">
            Se connecter
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={inscrire}>
        <div className="grid grid-cols-2 gap-3">
          <Champ libelle="Prénom" required {...champ("prenom")} />
          <Champ libelle="Nom" required {...champ("nom")} />
        </div>
        <Champ libelle="Adresse e-mail" type="email" required {...champ("email")} />
        <Champ
          libelle="Mot de passe"
          type="password"
          minLength={10}
          required
          aide="Dix caractères au minimum."
          {...champ("motDePasse")}
        />
        {erreur && <Alerte ton="danger">{erreur}</Alerte>}
        {message && <Alerte ton="succes">{message}</Alerte>}
        <Bouton type="submit" variante="primaire" className="w-full" enCours={charge}>
          Créer mon compte
        </Bouton>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-encre-3">
        <span className="h-px flex-1 bg-trait" />
        ou
        <span className="h-px flex-1 bg-trait" />
      </div>
      <Bouton className="w-full" onClick={google}>
        Continuer avec Google
      </Bouton>
    </CoquilleAcces>
  );
}
