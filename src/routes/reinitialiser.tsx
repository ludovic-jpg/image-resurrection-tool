import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alerte, Bouton, Champ, Chargement } from "@/client/ui/base";
import { ChampMotDePasse } from "@/client/ui/champ-mot-de-passe";
import { CoquilleAcces } from "@/client/ui/coquille-acces";
import { messageReinitialisation } from "@/client/ui/erreurs-auth";

export const Route = createFileRoute("/reinitialiser")({
  head: () => ({
    meta: [
      { title: "Nouveau mot de passe | Dossiers de formation" },
      { name: "description", content: "Choisissez un nouveau mot de passe pour votre compte." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Nouveau mot de passe | Dossiers de formation" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reinitialiser,
});

type EtatLien = "verification" | "valide" | "invalide";

function Reinitialiser() {
  const [lien, setLien] = useState<EtatLien>("verification");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState("");
  const [termine, setTermine] = useState(false);
  const [charge, setCharge] = useState(false);

  // Le lien de l'e-mail ouvre une session de récupération : la bibliothèque la lit dans l'URL puis la signale.
  useEffect(() => {
    let actif = true;
    const { data: abonnement } = supabase.auth.onAuthStateChange((evenement, session) => {
      if (actif && session && (evenement === "PASSWORD_RECOVERY" || evenement === "SIGNED_IN"))
        setLien("valide");
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (actif && data.session) setLien("valide");
    });
    const delai = window.setTimeout(() => {
      if (actif) setLien((courant) => (courant === "verification" ? "invalide" : courant));
    }, 4000);
    return () => {
      actif = false;
      window.clearTimeout(delai);
      abonnement.subscription.unsubscribe();
    };
  }, []);

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    if (charge) return;
    setErreur("");
    if (motDePasse !== confirmation) {
      setErreur("Les deux mots de passe ne sont pas identiques.");
      return;
    }
    setCharge(true);
    const { error } = await supabase.auth.updateUser({ password: motDePasse });
    setCharge(false);
    if (error) {
      setErreur(messageReinitialisation(error));
      return;
    }
    setTermine(true);
  }

  return (
    <CoquilleAcces
      titre="Nouveau mot de passe"
      accroche="Choisissez un mot de passe d’au moins dix caractères."
      pied={
        <Link to="/connexion" className="font-medium text-accent hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      {termine ? (
        <div className="space-y-4">
          <Alerte ton="succes" titre="Mot de passe modifié">
            Votre nouveau mot de passe est enregistré.
          </Alerte>
          <Link to="/tableau-de-bord">
            <Bouton variante="primaire" className="w-full">
              Accéder à mon espace
            </Bouton>
          </Link>
        </div>
      ) : lien === "verification" ? (
        <Chargement libelle="Vérification du lien…" />
      ) : lien === "invalide" ? (
        <div className="space-y-4">
          <Alerte ton="attention" titre="Lien invalide ou expiré">
            Ce lien de réinitialisation ne fonctionne plus. Demandez-en un nouveau.
          </Alerte>
          <Link to="/mot-de-passe-oublie">
            <Bouton variante="primaire" className="w-full">
              Demander un nouveau lien
            </Bouton>
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={enregistrer}>
          <ChampMotDePasse
            libelle="Nouveau mot de passe"
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
            Enregistrer le mot de passe
          </Bouton>
        </form>
      )}
    </CoquilleAcces>
  );
}
