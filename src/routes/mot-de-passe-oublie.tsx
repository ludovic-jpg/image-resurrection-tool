import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alerte, Bouton, Champ } from "@/client/ui/base";
import { CoquilleAcces } from "@/client/ui/CoquilleAcces";
import { journaliser } from "@/client/auth/messages";

export const Route = createFileRoute("/mot-de-passe-oublie")({
  head: () => ({
    meta: [
      { title: "Mot de passe oublié | Dossiers de formation" },
      { name: "description", content: "Recevez un lien pour choisir un nouveau mot de passe." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MotDePasseOublie,
});

function MotDePasseOublie() {
  const [email, setEmail] = useState("");
  const [envoye, setEnvoye] = useState(false);
  const [charge, setCharge] = useState(false);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setCharge(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reinitialisation`,
    });
    setCharge(false);
    // Même message que l'adresse existe ou non : on ne révèle pas quels comptes existent.
    if (error) journaliser("mot de passe oublié", error);
    setEnvoye(true);
  }

  return (
    <CoquilleAcces
      titre="Mot de passe oublié"
      accroche="Indiquez l’adresse de votre compte : nous vous envoyons un lien pour en choisir un nouveau."
      pied={
        <Link to="/connexion" className="font-medium text-accent hover:underline">
          Revenir à la connexion
        </Link>
      }
    >
      {envoye ? (
        <Alerte ton="succes">
          Si un compte existe pour cette adresse, un e-mail vient de partir. Le lien est valable une
          heure ; pensez à vérifier vos courriers indésirables.
        </Alerte>
      ) : (
        <form className="space-y-4" onSubmit={envoyer}>
          <Champ
            libelle="Adresse e-mail"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Bouton type="submit" variante="primaire" className="w-full" enCours={charge}>
            Recevoir le lien
          </Bouton>
        </form>
      )}
    </CoquilleAcces>
  );
}
