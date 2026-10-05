/**
 * Suppression de compte formateur (route 9) — équivalent serveur de `rgpd.supprimerMonCompte`.
 *
 * Ordre des opérations, pensé pour qu'un échec laisse toujours un état réessayable ou sûr :
 *   1. phrase exacte, puis mot de passe vérifié par reconnexion (rien n'est touché avant) ;
 *   2. fichiers de candidature du Storage (`archive/<of>/candidatures/<formateur>`) : si cela échoue, le compte est
 *      intact et l'utilisateur peut réessayer ;
 *   3. effacement en base, ATOMIQUE (fonction SQL `s4m_effacer_donnees_formateur`) : tout ou rien ;
 *   4. fichiers restants dont la base a donné la liste (brouillons, positionnements, coffres), puis comptes Auth des
 *      apprenants dont la fiche a disparu, puis compte Auth du formateur lui-même (dernier : après lui, la session
 *      n'a plus de sens). Les échecs de cette étape sont journalisés dans les logs et signalés ; les données de la base
 *      sont déjà effacées.
 */
import { cheminAppartientA, nomSur } from "@/domaine/archive/chemins";
import {
  MESSAGE_MOT_DE_PASSE_INCORRECT,
  MESSAGE_PHRASE_INCORRECTE,
  phraseDeConfirmationValide,
} from "@/domaine/rgpd/confirmation";
import type { ActeurFormateur } from "./acteur.server";
import type { BdService } from "./bd.server";
import { variable } from "./config.server";
import { ErreurMetier, introuvable, invalide } from "./erreurs.server";
import { verifierParReconnexion, type VerificateurMotDePasse } from "./mot-de-passe.server";

const NOM_BUCKET_ARCHIVE = "archive";
const NOM_BUCKET_COFFRE = "coffre";

export interface DependancesSuppression {
  verifierMotDePasse?: VerificateurMotDePasse;
}

interface ResultatEffacement {
  of_id: string;
  archive: string[];
  coffre: string[];
  comptes_apprenants: string[];
}

/** Supprime tout le contenu d'un « dossier » Storage (liste puis suppression, par pages). */
async function viderPrefixe(bd: BdService, bucket: string, prefixe: string): Promise<void> {
  for (let tour = 0; tour < 200; tour++) {
    const { data, error } = await bd.storage.from(bucket).list(prefixe, { limit: 100, offset: 0 });
    if (error) throw new Error(`Storage : liste de ${prefixe} impossible (${error.message})`);
    const noms = (data ?? []).map((f) => `${prefixe}/${f.name}`);
    if (noms.length === 0) return;
    const { error: errSuppr } = await bd.storage.from(bucket).remove(noms);
    if (errSuppr)
      throw new Error(`Storage : suppression de ${prefixe} impossible (${errSuppr.message})`);
  }
  throw new Error(`Storage : ${prefixe} n'a pas pu être vidé`);
}

async function supprimerChemins(
  bd: BdService,
  bucket: string,
  ofId: string,
  chemins: readonly string[],
): Promise<number> {
  // Garde-fou : la base ne renvoie que des chemins de l'organisme ; on ne fait pas confiance à ce seul point.
  const sains = chemins.filter((c) => cheminAppartientA(c, ofId));
  let echecs = chemins.length - sains.length;
  for (let i = 0; i < sains.length; i += 100) {
    const lot = sains.slice(i, i + 100);
    const { error } = await bd.storage.from(bucket).remove(lot);
    if (error) {
      console.error("[rgpd] fichiers non supprimés", error);
      echecs += lot.length;
    }
  }
  return echecs;
}

async function supprimerCompteAuth(bd: BdService, id: string): Promise<boolean> {
  for (let essai = 0; essai < 2; essai++) {
    const { error } = await bd.auth.admin.deleteUser(id);
    if (!error) return true;
    // Déjà supprimé : l'objectif est atteint.
    if (error.status === 404 || /not found/i.test(error.message)) return true;
    console.error("[rgpd] suppression du compte Auth impossible", error);
  }
  return false;
}

export async function supprimerCompteFormateur(
  bd: BdService,
  acteur: ActeurFormateur,
  confirmation: { phrase: unknown; mot_de_passe: unknown },
  dependances: DependancesSuppression = {},
): Promise<{ ok: true }> {
  // 1. Confirmation : phrase exacte, puis mot de passe (preuve de reconnexion).
  if (!phraseDeConfirmationValide(confirmation.phrase))
    throw invalide(MESSAGE_PHRASE_INCORRECTE, { champs: { phrase: MESSAGE_PHRASE_INCORRECTE } });
  const motDePasse = typeof confirmation.mot_de_passe === "string" ? confirmation.mot_de_passe : "";
  const refus = () =>
    invalide(MESSAGE_MOT_DE_PASSE_INCORRECT, {
      champs: { mot_de_passe: MESSAGE_MOT_DE_PASSE_INCORRECT },
    });
  if (!motDePasse) throw refus();
  const { data: compte, error: errCompte } = await bd.auth.admin.getUserById(acteur.utilisateur_id);
  const email = compte?.user?.email ?? acteur.email;
  if (errCompte || !email) throw introuvable("Compte");
  const verifier = dependances.verifierMotDePasse ?? verifierParReconnexion;
  if (!(await verifier(email, motDePasse))) throw refus();

  // 2. Pièces de candidature dans le Storage.
  const bucketArchive = variable("ARCHIVE_BUCKET") ?? NOM_BUCKET_ARCHIVE;
  await viderPrefixe(
    bd,
    bucketArchive,
    `${nomSur(acteur.of_id)}/candidatures/${nomSur(acteur.formateur_id)}`,
  );

  // 3. Effacement atomique en base.
  const { data, error } = await bd.rpc("s4m_effacer_donnees_formateur", {
    p_formateur_id: acteur.formateur_id,
    p_utilisateur_id: acteur.utilisateur_id,
  });
  if (error) {
    if (error.code === "P0002") throw introuvable("Compte");
    console.error("[rgpd] effacement en base impossible", error);
    throw new Error(`Effacement impossible : ${error.message}`);
  }
  const efface = data as ResultatEffacement;

  // 4. Fichiers restants, comptes des apprenants, compte du formateur.
  let restes = 0;
  restes += await supprimerChemins(bd, bucketArchive, acteur.of_id, efface.archive ?? []);
  restes += await supprimerChemins(
    bd,
    variable("COFFRE_BUCKET") ?? NOM_BUCKET_COFFRE,
    acteur.of_id,
    efface.coffre ?? [],
  );
  for (const id of efface.comptes_apprenants ?? [])
    if (!(await supprimerCompteAuth(bd, id))) restes++;
  if (!(await supprimerCompteAuth(bd, acteur.utilisateur_id)))
    throw new ErreurMetier(
      "indisponible",
      "Vos données ont été effacées, mais la fermeture de votre compte n'a pas pu être terminée. Prévenez l'organisme.",
    );
  if (restes > 0)
    console.error(
      `[rgpd] ${restes} élément(s) à nettoyer à la main (fichiers ou comptes), formateur ${acteur.formateur_id}`,
    );
  return { ok: true };
}
