import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { Alerte, Bouton, Champ } from "@/client/ui/base";
import { CoquilleAcces, SeparateurOu } from "@/client/ui/CoquilleAcces";
import { journaliser, LONGUEUR_MIN_MOT_DE_PASSE, messageInscription } from "@/client/auth/messages";

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
    setMessage("");
    const { data, error } = await supabase.auth.signUp({
      email: v.email.trim(),
      password: v.motDePasse,
      options: {
        // Le lien de confirmation ramène sur la page de connexion de CE site (et non sur l'URL par défaut du projet).
        emailRedirectTo: `${window.location.origin}/connexion`,
        data: { role: "formateur", prenom: v.prenom.trim(), nom: v.nom.trim() },
      },
    });
    setCharge(false);
    if (error) {
      journaliser("inscription", error);
      setErreur(messageInscription(error));
      return;
    }
    // Supabase répond « succès » sans identité quand l'adresse existe déjà (protection contre l'énumération).
    if (data.user && data.user.identities?.length === 0) {
      setErreur(messageInscription({ code: "user_already_exists" }));
      return;
    }
    setMessage(
      "Votre compte est créé. Consultez votre messagerie pour confirmer votre adresse e-mail.",
    );
  }

  async function google() {
    setErreur("");
    sessionStorage.setItem("s4m_retour_auth", "/tableau-de-bord");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      journaliser("google", result.error);
      setErreur("La connexion avec Google a échoué. Réessayez.");
    }
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
          <Champ libelle="Prénom" autoComplete="given-name" required {...champ("prenom")} />
          <Champ libelle="Nom" autoComplete="family-name" required {...champ("nom")} />
        </div>
        <Champ
          libelle="Adresse e-mail"
          type="email"
          autoComplete="email"
          required
          {...champ("email")}
        />
        <Champ
          libelle="Mot de passe"
          type="password"
          autoComplete="new-password"
          minLength={LONGUEUR_MIN_MOT_DE_PASSE}
          required
          aide={`${LONGUEUR_MIN_MOT_DE_PASSE} caractères au minimum.`}
          {...champ("motDePasse")}
        />
        {erreur && <Alerte ton="danger">{erreur}</Alerte>}
        {message && <Alerte ton="succes">{message}</Alerte>}
        <Bouton
          type="submit"
          variante="primaire"
          className="w-full"
          enCours={charge}
          disabled={!!message}
        >
          Créer mon compte
        </Bouton>
      </form>
      <SeparateurOu />
      <Bouton className="w-full" onClick={google}>
        Continuer avec Google
      </Bouton>
    </CoquilleAcces>
  );
}
