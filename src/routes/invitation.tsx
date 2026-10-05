import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alerte, Bouton, Champ } from "@/client/ui/base";
import { ChampMotDePasse } from "@/client/ui/champ-mot-de-passe";
import { CoquilleAcces } from "@/client/ui/coquille-acces";
import { MESSAGE_COMPTE_EXISTANT, messageInvitation } from "@/client/ui/erreurs-auth";

export const Route = createFileRoute("/invitation")({
  validateSearch: (search: Record<string, unknown>): { jeton: string } => ({
    jeton: typeof search["jeton"] === "string" ? search["jeton"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Invitation | Dossiers de formation" },
      {
        name: "description",
        content: "Créez votre compte à partir de l’invitation reçue par e-mail.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Invitation | Dossiers de formation" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Invitation,
});

function Invitation() {
  const { jeton } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState("");
  const [termine, setTermine] = useState(false);
  const [charge, setCharge] = useState(false);

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    if (charge) return;
    setErreur("");
    if (motDePasse !== confirmation) {
      setErreur("Les deux mots de passe ne sont pas identiques.");
      return;
    }
    setCharge(true);
    // Le rôle, l'organisme et l'identité viennent de l'invitation, vérifiée côté base : jamais de ce formulaire.
    const { data, error } = await supabase.auth.signUp({
      email,
      password: motDePasse,
      options: { data: { invitation: jeton } },
    });
    setCharge(false);
    if (error) {
      setErreur(messageInvitation(error));
      return;
    }
    if (data.user && data.user.identities?.length === 0) {
      setErreur(MESSAGE_COMPTE_EXISTANT);
      return;
    }
    setTermine(true);
  }

  const pied = (
    <>
      Vous avez déjà un compte ?{" "}
      <Link to="/connexion" className="font-medium text-accent hover:underline">
        Se connecter
      </Link>
    </>
  );

  if (!jeton) {
    return (
      <CoquilleAcces titre="Invitation" accroche="Ce lien d’invitation est incomplet." pied={pied}>
        <Alerte ton="attention">
          Ouvrez le lien tel qu’il figure dans l’e-mail d’invitation, ou demandez-en un nouveau à
          l’organisme.
        </Alerte>
      </CoquilleAcces>
    );
  }

  return (
    <CoquilleAcces
      titre="Créer mon compte"
      accroche="Utilisez l’adresse e-mail à laquelle l’invitation a été envoyée."
      pied={pied}
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
        <form className="space-y-4" onSubmit={creer}>
          <Champ
            libelle="Adresse e-mail"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <ChampMotDePasse
            libelle="Mot de passe"
            minLength={10}
            required
            autoComplete="new-password"
            aide="Dix caractères au minimum."
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
          <Champ
            libelle="Confirmer le mot de passe"
            type="password"
            minLength={10}
            required
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          {erreur && <Alerte ton="danger">{erreur}</Alerte>}
          <Bouton type="submit" variante="primaire" className="w-full" enCours={charge}>
            Créer mon compte
          </Bouton>
        </form>
      )}
    </CoquilleAcces>
  );
}
