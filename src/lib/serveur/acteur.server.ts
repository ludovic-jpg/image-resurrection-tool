/**
 * Acteur courant d'une fonction serveur — équivalent serveur de `s4m_moi()` et de l'`Acteur` de
 * `src/serveur/services/socle.ts` (mêmes champs).
 *
 * RÈGLE ABSOLUE : l'acteur ne vient JAMAIS du corps de la requête. Il est reconstruit depuis le jeton de session :
 * `requireSupabaseAuth` (middleware) vérifie le jeton et fournit un client Supabase qui porte ce jeton ; on appelle
 * ensuite `s4m_moi()` avec CE client. La fonction SQL lit `auth.uid()` dans le jeton, puis le profil, le rôle et la
 * fiche formateur / stagiaire en base : le serveur et la RLS appliquent donc exactement la même définition de « qui agit ».
 * Un identifiant d'utilisateur, un rôle ou un organisme reçu dans les paramètres d'une fonction n'est jamais cru.
 *
 * Usage typique dans un `*.functions.ts` :
 *
 *   .middleware([requireSupabaseAuth])
 *   .handler(({ context }) => agirEnTantQue(context, gardeAdmin, async ({ acteur, bd }) => { … }))
 *
 * Les gardes de rôle renvoient un résultat TYPÉ (`{ ok: true, acteur } | Echec`) : un mauvais rôle donne un 403 français
 * propre, jamais une exception brute.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/domaine/referentiel/pieces";
import { clientService, type BdService } from "./bd.server";
import {
  executer,
  nonAuthentifie,
  versEchec,
  echec,
  type Echec,
  type Resultat,
} from "./erreurs.server";

/** Qui agit. Même forme que l'`Acteur` de `src/serveur/services/socle.ts` et que `acteur` de `s4m_moi()`. */
export interface Acteur {
  utilisateur_id: string;
  of_id: string;
  role: Role;
  /** Renseigné pour un formateur (candidature validée ou non). */
  formateur_id: string | null;
  /** Le formateur peut-il instruire des dossiers ? (`false` tant que sa candidature n'est pas validée) */
  formateur_valide: boolean;
  /** Renseigné pour un apprenant. */
  stagiaire_id: string | null;
  nom: string;
  email: string;
}

export type ActeurAdmin = Acteur & { role: "admin" };
/** Formateur avec fiche (candidat compris) : `formateur_id` est garanti. */
export type ActeurFormateur = Acteur & { role: "formateur"; formateur_id: string };
export type ActeurFormateurValide = ActeurFormateur & { formateur_valide: true };
export type ActeurApprenant = Acteur & { role: "apprenant"; stagiaire_id: string };

/** Ce que `requireSupabaseAuth` place dans le contexte d'une fonction serveur. */
export interface ContexteAuth {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>;
  userId: string;
}

const ROLES: readonly string[] = ["admin", "formateur", "apprenant"];

/**
 * Reconstruit l'acteur depuis le jeton (via la base). Lève `non_authentifie` si le compte n'a pas de profil actif.
 */
export async function reconstruireActeur(auth: ContexteAuth): Promise<Acteur> {
  const { data, error } = await auth.supabase.rpc("s4m_moi");
  if (error) {
    console.error("[acteur] s4m_moi a échoué", error);
    throw nonAuthentifie();
  }
  const a = (data as { acteur?: Partial<Acteur> | null } | null)?.acteur;
  if (
    !a ||
    typeof a.utilisateur_id !== "string" ||
    typeof a.of_id !== "string" ||
    typeof a.role !== "string" ||
    !ROLES.includes(a.role)
  )
    throw nonAuthentifie("Votre compte n'est pas actif. Contactez l'organisme.");
  // Garde-fou : le profil renvoyé doit être celui du jeton vérifié.
  if (a.utilisateur_id !== auth.userId) throw nonAuthentifie();
  return {
    utilisateur_id: a.utilisateur_id,
    of_id: a.of_id,
    role: a.role,
    formateur_id: a.formateur_id ?? null,
    formateur_valide: a.formateur_valide === true,
    stagiaire_id: a.stagiaire_id ?? null,
    nom: a.nom ?? "",
    email: a.email ?? "",
  };
}

// ——— Gardes de rôle : résultat typé ———

export type ResultatGarde<A extends Acteur = Acteur> = { ok: true; acteur: A } | Echec;
export type Garde<A extends Acteur = Acteur> = (acteur: Acteur) => ResultatGarde<A>;

const refus = (message?: string): Echec =>
  echec("interdit", message ?? "Cette action ne vous est pas permise.");

/** Réservé à l'administrateur de l'organisme. */
export const gardeAdmin: Garde<ActeurAdmin> = (a) =>
  a.role === "admin"
    ? { ok: true, acteur: a as ActeurAdmin }
    : refus("Cette action est réservée à l'administrateur de l'organisme.");

/** Formateur, même dont la candidature n'est pas encore validée (il n'accède alors qu'à sa candidature : F-ONB-02). */
export const gardeFormateur: Garde<ActeurFormateur> = (a) =>
  a.role === "formateur" && a.formateur_id
    ? { ok: true, acteur: a as ActeurFormateur }
    : refus("Cette action est réservée aux formateurs.");

/** Formateur dont la candidature est validée (équivalent de `exigerFormateurValide`). */
export const gardeFormateurValide: Garde<ActeurFormateurValide> = (a) => {
  if (a.role !== "formateur" || !a.formateur_id)
    return refus("Cette action est réservée aux formateurs.");
  if (!a.formateur_valide)
    return refus(
      "Votre candidature doit être validée par l'organisme avant d'accéder à cet espace.",
    );
  return { ok: true, acteur: a as ActeurFormateurValide };
};

export const gardeApprenant: Garde<ActeurApprenant> = (a) =>
  a.role === "apprenant" && a.stagiaire_id
    ? { ok: true, acteur: a as ActeurApprenant }
    : refus("Cette action est réservée aux apprenants.");

/** Personnel de l'organisme : l'admin, ou un formateur validé. Jamais un apprenant, jamais un candidat. */
export const gardeInterne: Garde<Acteur> = (a) => {
  if (a.role === "admin") return { ok: true, acteur: a };
  return gardeFormateurValide(a);
};

/** Garde sur une liste de rôles (sans autre condition). */
export function gardeRoles(...roles: Role[]): Garde<Acteur> {
  return (a) => (roles.includes(a.role) ? { ok: true, acteur: a } : refus());
}

/**
 * Point d'entrée d'une fonction serveur authentifiée : reconstruit l'acteur, applique la garde de rôle, charge le
 * client « service » puis exécute l'action. Ne lève jamais : renvoie `{ ok: true, donnees }` ou un `Echec`.
 */
export async function agirEnTantQue<A extends Acteur, T>(
  auth: ContexteAuth,
  garde: Garde<A>,
  action: (ctx: { acteur: A; bd: BdService }) => Promise<T>,
): Promise<Resultat<T>> {
  let acteur: A;
  try {
    const g = garde(await reconstruireActeur(auth));
    if (!g.ok) return g;
    acteur = g.acteur;
  } catch (e) {
    return versEchec(e);
  }
  return executer(async () => action({ acteur, bd: await clientService() }));
}
