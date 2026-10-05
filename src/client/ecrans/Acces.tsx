/** Connexion, inscription d'un candidat formateur (F-ONB-01), acceptation d'une invitation d'apprenant (F-COM-05). */
import { useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import type { ErreurApi } from "../api";
import { api } from "../api";
import { Alerte, Bouton, Champ, Chargement } from "../ui/base";

function Coquille({
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
        <div className="flex items-center gap-3 font-display text-lg font-semibold">
          <span className="grid size-9 place-items-center rounded-md bg-accent">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          Dossiers de formation
        </div>
        <div>
          <p className="max-w-[22ch] font-display text-[40px] leading-[1.1] font-semibold">
            Un dossier complet, sans courir après les signatures.
          </p>
          <p className="mt-6 max-w-[46ch] text-[15px] leading-relaxed text-sur-accent/70">
            De la candidature du formateur à l'archivage : chaque pièce est générée, suivie, signée
            et classée — conforme au référentiel Qualiopi.
          </p>
        </div>
        <ol className="grid grid-cols-7 gap-1.5 text-[11px] font-medium tracking-wide text-sur-accent/60">
          {["Création", "Financement", "Début", "Fin", "Paiement", "Encaissé", "Archivé"].map(
            (e, i) => (
              <li key={e}>
                <span
                  className={`mb-2 block h-1 rounded-full ${i < 3 ? "bg-attente" : "bg-sur-accent/20"}`}
                />
                {e}
              </li>
            ),
          )}
        </ol>
      </aside>
      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-[28px] font-semibold leading-tight">{titre}</h1>
          <p className="mt-2 text-encre-2">{accroche}</p>
          <div className="mt-8">{children}</div>
          {pied && (
            <div className="mt-8 border-t border-trait pt-5 text-sm text-encre-2">{pied}</div>
          )}
        </div>
      </main>
    </div>
  );
}

export function Connexion() {
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const requetes = useQueryClient();
  const connexion = useMutation({
    mutationFn: () => api.post("/auth/connexion", { email, mot_de_passe: mdp }),
    onSuccess: () => {
      requetes.clear();
      // Rechargement complet volontaire : la session change, tout l'état en mémoire doit repartir de zéro.
      const retour = new URLSearchParams(location.search).get("retour");
      location.assign(
        retour?.startsWith("/") && !retour.startsWith("//") ? retour : "/tableau-de-bord",
      );
    },
  });
  return (
    <Coquille
      titre="Connexion"
      accroche="Formateur, apprenant ou organisme : un seul accès."
      pied={
        <>
          Vous êtes formateur et souhaitez être porté ?{" "}
          <Link
            to="/inscription"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Déposer une candidature
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          connexion.mutate();
        }}
      >
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
          value={mdp}
          onChange={(e) => setMdp(e.target.value)}
        />
        {connexion.error && <Alerte ton="danger">{connexion.error.message}</Alerte>}
        <Bouton type="submit" variante="primaire" className="w-full" enCours={connexion.isPending}>
          Se connecter
        </Bouton>
      </form>
    </Coquille>
  );
}

export function Inscription() {
  const [v, setV] = useState({ prenom: "", nom: "", email: "", mot_de_passe: "" });
  const champ = (cle: keyof typeof v) => ({
    value: v[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [cle]: e.target.value }),
  });
  const inscription = useMutation({
    mutationFn: () => api.post("/auth/inscription", v),
    onSuccess: () => location.assign("/candidature"),
  });
  return (
    <Coquille
      titre="Candidature formateur"
      accroche="Créez votre compte, puis complétez votre dossier. L'organisme l'étudie et vous répond par e-mail."
      pied={
        <>
          Déjà inscrit ?{" "}
          <Link
            to="/connexion"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Se connecter
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          inscription.mutate();
        }}
      >
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
          required
          minLength={10}
          aide="Dix caractères au minimum."
          {...champ("mot_de_passe")}
        />
        {inscription.error && <Alerte ton="danger">{inscription.error.message}</Alerte>}
        <Bouton
          type="submit"
          variante="primaire"
          className="w-full"
          enCours={inscription.isPending}
        >
          Créer mon compte
        </Bouton>
      </form>
    </Coquille>
  );
}

export function Invitation() {
  const { jeton } = useParams({ from: "/invitation/$jeton" });
  const [mdp, setMdp] = useState("");
  const invitation = useQuery({
    queryKey: ["invitation", jeton],
    queryFn: () => api.get<{ email: string; prenom: string }>(`/auth/invitation/${jeton}`),
    retry: false,
  });
  const accepter = useMutation({
    mutationFn: () => api.post(`/auth/invitation/${jeton}`, { mot_de_passe: mdp }),
    onSuccess: () => location.assign("/tableau-de-bord"),
  });

  if (invitation.isPending)
    return (
      <Coquille titre="Votre espace personnel" accroche="">
        <Chargement />
      </Coquille>
    );
  if (invitation.error) {
    return (
      <Coquille titre="Lien expiré" accroche="Ce lien d'invitation n'est plus valable.">
        <Alerte ton="attention">{(invitation.error as ErreurApi).message}</Alerte>
        <p className="mt-5 text-sm text-encre-2">
          Vous avez déjà choisi un mot de passe ?{" "}
          <Link
            to="/connexion"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Connectez-vous
          </Link>
          .
        </p>
      </Coquille>
    );
  }
  return (
    <Coquille
      titre={`Bienvenue, ${invitation.data.prenom}`}
      accroche="Choisissez un mot de passe pour accéder à vos documents de formation."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          accepter.mutate();
        }}
      >
        <Champ libelle="Adresse e-mail" value={invitation.data.email} disabled readOnly />
        <Champ
          libelle="Votre mot de passe"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          aide="Dix caractères au minimum."
          value={mdp}
          onChange={(e) => setMdp(e.target.value)}
        />
        {accepter.error && <Alerte ton="danger">{accepter.error.message}</Alerte>}
        <Bouton type="submit" variante="primaire" className="w-full" enCours={accepter.isPending}>
          Accéder à mon espace
        </Bouton>
      </form>
    </Coquille>
  );
}
