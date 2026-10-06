import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alerte, Bouton, Champ } from "@/client/ui/base";
import { CoquilleAcces } from "@/client/ui/CoquilleAcces";
import { journaliser, LONGUEUR_MIN_MOT_DE_PASSE } from "@/client/auth/messages";

export const Route = createFileRoute("/reinitialisation")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Nouveau mot de passe | Dossiers de formation" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Reinitialisation,
});

type Etat = "verification" | "pret" | "lien_invalide";

function Reinitialisation() {
  const navigate = useNavigate();
  const [etat, setEtat] = useState<Etat>("verification");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState("");
  const [charge, setCharge] = useState(false);

  useEffect(() => {
    // Le client Supabase lit le jeton présent dans l'URL du lien reçu par e-mail et ouvre une session de récupération.
    const { data: abonnement } = supabase.auth.onAuthStateChange((evenement, session) => {
      if (evenement === "PASSWORD_RECOVERY" || session) setEtat("pret");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setEtat("pret");
    });
    const delai = window.setTimeout(
      () => setEtat((e) => (e === "verification" ? "lien_invalide" : e)),
      4000,
    );
    return () => {
      abonnement.subscription.unsubscribe();
      window.clearTimeout(delai);
    };
  }, []);

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
      setErreur(`Le mot de passe doit contenir au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`);
      return;
    }
    if (motDePasse !== confirmation) {
      setErreur("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setCharge(true);
    const { error } = await supabase.auth.updateUser({ password: motDePasse });
    setCharge(false);
    if (error) {
      journaliser("réinitialisation", error);
      setErreur(
        error.code === "same_password"
          ? "Choisissez un mot de passe différent de l’ancien."
          : "Le mot de passe n’a pas pu être enregistré. Demandez un nouveau lien puis réessayez.",
      );
      return;
    }
    await navigate({ to: "/tableau-de-bord", replace: true });
  }

  return (
    <CoquilleAcces
      titre="Nouveau mot de passe"
      accroche="Choisissez le mot de passe de votre compte."
    >
      {etat === "verification" && <Alerte>Vérification du lien…</Alerte>}
      {etat === "lien_invalide" && (
        <div className="space-y-4">
          <Alerte ton="attention">Ce lien n’est plus valable ou a déjà été utilisé.</Alerte>
          <Link to="/mot-de-passe-oublie" className="font-medium text-accent hover:underline">
            Demander un nouveau lien
          </Link>
        </div>
      )}
      {etat === "pret" && (
        <form className="space-y-4" onSubmit={enregistrer}>
          <Champ
            libelle="Nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            minLength={LONGUEUR_MIN_MOT_DE_PASSE}
            required
            aide={`${LONGUEUR_MIN_MOT_DE_PASSE} caractères au minimum.`}
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
          <Champ
            libelle="Confirmez le mot de passe"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          {erreur && <Alerte ton="danger">{erreur}</Alerte>}
          <Bouton type="submit" variante="primaire" className="w-full" enCours={charge}>
            Enregistrer et accéder à mon espace
          </Bouton>
        </form>
      )}
    </CoquilleAcces>
  );
}
