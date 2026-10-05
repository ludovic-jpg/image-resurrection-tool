import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alerte, Bouton, Champ } from "@/client/ui/base";
import { CoquilleAcces } from "@/client/ui/coquille-acces";
import { messageReinitialisation } from "@/client/ui/erreurs-auth";

export const Route = createFileRoute("/mot-de-passe-oublie")({
  head: () => ({
    meta: [
      { title: "Mot de passe oublié | Dossiers de formation" },
      { name: "description", content: "Recevez un lien pour choisir un nouveau mot de passe." },
      { property: "og:title", content: "Mot de passe oublié | Dossiers de formation" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MotDePasseOublie,
});

function MotDePasseOublie() {
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoye, setEnvoye] = useState(false);
  const [charge, setCharge] = useState(false);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (charge) return;
    setErreur("");
    setCharge(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reinitialiser`,
    });
    setCharge(false);
    if (error) {
      setErreur(messageReinitialisation(error));
      return;
    }
    setEnvoye(true);
  }

  return (
    <CoquilleAcces
      titre="Mot de passe oublié"
      accroche="Indiquez votre adresse e-mail : nous vous envoyons un lien pour en choisir un nouveau."
      pied={
        <Link to="/connexion" className="font-medium text-accent hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      {envoye ? (
        // Même message que le compte existe ou non : on ne révèle jamais quelles adresses sont inscrites.
        <Alerte ton="succes" titre="Demande envoyée">
          Si un compte existe pour cette adresse, un e-mail avec un lien de réinitialisation vient
          d’être envoyé. Pensez à vérifier vos courriers indésirables.
        </Alerte>
      ) : (
        <form className="space-y-4" onSubmit={envoyer}>
          <Champ
            libelle="Adresse e-mail"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {erreur && <Alerte ton="danger">{erreur}</Alerte>}
          <Bouton type="submit" variante="primaire" className="w-full" enCours={charge}>
            Envoyer le lien
          </Bouton>
        </form>
      )}
    </CoquilleAcces>
  );
}
