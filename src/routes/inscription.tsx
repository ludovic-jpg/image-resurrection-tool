import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { Alerte, Bouton, Champ } from "@/client/ui/base";
import { ChampMotDePasse } from "@/client/ui/champ-mot-de-passe";
import { CoquilleAcces } from "@/client/ui/coquille-acces";
import { MESSAGE_COMPTE_EXISTANT, messageInscription } from "@/client/ui/erreurs-auth";

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
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Inscription,
});

function Inscription() {
  const [v, setV] = useState({ prenom: "", nom: "", email: "", motDePasse: "", confirmation: "" });
  const [consentement, setConsentement] = useState(false);
  const [erreur, setErreur] = useState("");
  const [termine, setTermine] = useState(false);
  const [charge, setCharge] = useState(false);

  const champ = (cle: keyof typeof v) => ({
    value: v[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [cle]: e.target.value }),
  });

  async function inscrire(e: React.FormEvent) {
    e.preventDefault();
    if (charge) return;
    setErreur("");
    if (v.motDePasse !== v.confirmation) {
      setErreur("Les deux mots de passe ne sont pas identiques.");
      return;
    }
    if (!consentement) {
      setErreur("Vous devez accepter le traitement de vos données pour déposer une candidature.");
      return;
    }
    setCharge(true);
    const { data, error } = await supabase.auth.signUp({
      email: v.email,
      password: v.motDePasse,
      options: { data: { role: "formateur", prenom: v.prenom, nom: v.nom } },
    });
    setCharge(false);
    if (error) {
      setErreur(messageInscription(error));
      return;
    }
    // Supabase ne signale pas toujours un e-mail déjà connu : il renvoie alors un compte sans identité.
    if (data.user && data.user.identities?.length === 0) {
      setErreur(MESSAGE_COMPTE_EXISTANT);
      return;
    }
    setTermine(true);
  }

  async function google() {
    setErreur("");
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
      {termine ? (
        <div className="space-y-4">
          <Alerte ton="succes" titre="Compte créé">
            Consultez votre messagerie pour confirmer votre adresse e-mail, puis connectez-vous.
          </Alerte>
          <Link to="/connexion">
            <Bouton variante="primaire" className="w-full">
              Aller à la connexion
            </Bouton>
          </Link>
        </div>
      ) : (
        <>
          <form className="space-y-4" onSubmit={inscrire}>
            <div className="grid grid-cols-2 gap-3">
              <Champ libelle="Prénom" required autoComplete="given-name" {...champ("prenom")} />
              <Champ libelle="Nom" required autoComplete="family-name" {...champ("nom")} />
            </div>
            <Champ
              libelle="Adresse e-mail"
              type="email"
              required
              autoComplete="email"
              {...champ("email")}
            />
            <ChampMotDePasse
              libelle="Mot de passe"
              minLength={10}
              required
              autoComplete="new-password"
              aide="Dix caractères au minimum."
              {...champ("motDePasse")}
            />
            <Champ
              libelle="Confirmer le mot de passe"
              type="password"
              minLength={10}
              required
              autoComplete="new-password"
              {...champ("confirmation")}
            />
            <label className="flex cursor-pointer items-start gap-2 text-[13px] leading-snug text-encre-2">
              <input
                type="checkbox"
                required
                checked={consentement}
                onChange={(e) => setConsentement(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              J’accepte que l’organisme de formation traite mes données pour étudier ma candidature.
            </label>
            {erreur && <Alerte ton="danger">{erreur}</Alerte>}
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
        </>
      )}
    </CoquilleAcces>
  );
}
