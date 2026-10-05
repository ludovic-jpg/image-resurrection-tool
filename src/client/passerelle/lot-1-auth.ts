/**
 * Lot 1 — authentification, session, compte (routes 1 à 8 de la carte).
 *
 * Le compte naît au `signUp` ; c'est le déclencheur SQL `s4m_on_auth_user_created` qui crée le profil. Ce module
 * ne crée JAMAIS de profil, de formateur ni de rôle à la main : l'invitation voyage dans `options.data.invitation`.
 */
import { normaliserEmail, verifierMotDePasse } from "@/domaine/compte/regles";
import { construireApercuSuppression } from "@/domaine/rgpd/apercu";
import { lireInvitation } from "@/lib/auth-compte.functions";
import { bd } from "../bd";
import { ErreurApi } from "../erreur";
import { route } from "../registre";
import type { Moi } from "../api";

const texte = (v: unknown) => (typeof v === "string" ? v : "");
const corpsDe = (c: unknown) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {});

function refuserMotDePasse(motDePasse: string, champ: string) {
  const message = verifierMotDePasse(motDePasse);
  if (message) throw new ErreurApi(message, 400, "validation", { champs: { [champ]: message } });
}

route("POST", "/auth/connexion", async ({ corps }) => {
  const c = corpsDe(corps);
  const { error } = await bd.auth.signInWithPassword({
    email: normaliserEmail(texte(c["email"])),
    password: texte(c["mot_de_passe"]),
  });
  if (error)
    throw new ErreurApi("Adresse e-mail ou mot de passe incorrect.", 401, "identifiants", null);
  return { ok: true };
});

route("POST", "/auth/inscription", async ({ corps }) => {
  const c = corpsDe(corps);
  const prenom = texte(c["prenom"]).trim();
  const nom = texte(c["nom"]).trim();
  if (!prenom || !nom)
    throw new ErreurApi("Indiquez votre prénom et votre nom.", 400, "validation", null);
  refuserMotDePasse(texte(c["mot_de_passe"]), "mot_de_passe");
  // Aucun `role` ni `of_id` ici : une inscription spontanée est toujours une candidature de formateur.
  const { data, error } = await bd.auth.signUp({
    email: normaliserEmail(texte(c["email"])),
    password: texte(c["mot_de_passe"]),
    options: { data: { prenom, nom } },
  });
  if (error)
    throw new ErreurApi(
      "Inscription impossible avec ces informations. Vérifiez l'adresse e-mail ou connectez-vous.",
      400,
      "inscription",
      null,
    );
  return { ok: true, session: Boolean(data.session) };
});

route("GET", "/auth/invitation/:jeton", async ({ params }) => {
  const r = await lireInvitation({ data: { jeton: params["jeton"] ?? "" } });
  if (!r.ok)
    throw new ErreurApi(
      "Ce lien d'invitation n'est plus valable. Demandez-en un nouveau à l'organisme.",
      404,
      "invitation_invalide",
      null,
    );
  return { email: r.email, prenom: r.prenom };
});

route("POST", "/auth/invitation/:jeton", async ({ params, corps }) => {
  const jeton = params["jeton"] ?? "";
  const motDePasse = texte(corpsDe(corps)["mot_de_passe"]);
  refuserMotDePasse(motDePasse, "mot_de_passe");
  const invitation = await lireInvitation({ data: { jeton } });
  if (!invitation.ok)
    throw new ErreurApi(
      "Ce lien d'invitation n'est plus valable. Demandez-en un nouveau à l'organisme.",
      404,
      "invitation_invalide",
      null,
    );
  // L'e-mail vient de l'invitation, jamais du formulaire : le déclencheur SQL vérifie de toute façon l'égalité.
  const { data, error } = await bd.auth.signUp({
    email: invitation.email,
    password: motDePasse,
    options: { data: { invitation: jeton } },
  });
  if (error)
    throw new ErreurApi(
      "Ce lien d'invitation n'a pas pu être utilisé. Demandez-en un nouveau à l'organisme.",
      400,
      "invitation_invalide",
      null,
    );
  if (!data.session) {
    const connexion = await bd.auth.signInWithPassword({
      email: invitation.email,
      password: motDePasse,
    });
    if (connexion.error)
      throw new ErreurApi(
        "Votre compte est créé. Confirmez votre adresse e-mail, puis connectez-vous.",
        409,
        "confirmation_requise",
        null,
      );
  }
  return { ok: true };
});

route("POST", "/compte/mot-de-passe", async ({ corps }) => {
  const c = corpsDe(corps);
  const nouveau = texte(c["nouveau"]);
  refuserMotDePasse(nouveau, "nouveau");
  const { data: utilisateur } = await bd.auth.getUser();
  const email = utilisateur.user?.email;
  if (!email)
    throw new ErreurApi("Votre session a expiré. Reconnectez-vous.", 401, "non_connecte", null);
  // Réauthentification : on ne change pas un mot de passe sur la seule foi d'une session ouverte.
  const verification = await bd.auth.signInWithPassword({ email, password: texte(c["ancien"]) });
  if (verification.error)
    throw new ErreurApi("L'ancien mot de passe est incorrect.", 400, "validation", {
      champs: { ancien: "Mot de passe incorrect." },
    });
  const { error } = await bd.auth.updateUser({ password: nouveau });
  if (error)
    throw new ErreurApi("Le mot de passe n'a pas pu être changé. Réessayez.", 500, "interne", null);
  await bd.auth.signOut({ scope: "global" });
  return { ok: true };
});

route("GET", "/compte/suppression", async () => {
  const { data } = await bd.rpc("s4m_moi");
  const acteur = (data as Moi | null)?.acteur;
  if (!acteur || acteur.role !== "formateur" || !acteur.formateur_id) {
    throw new ErreurApi(
      "La suppression de compte en libre-service concerne les formateurs.",
      403,
      "interdit",
      null,
    );
  }
  // La RLS limite la lecture aux dossiers du formateur connecté.
  const { data: dossiers, error } = await bd.from("dossier_formation").select("sous_statut");
  if (error) throw error;
  return construireApercuSuppression(
    ((dossiers ?? []) as { sous_statut: string }[]).map((d) => d.sous_statut),
  );
});
