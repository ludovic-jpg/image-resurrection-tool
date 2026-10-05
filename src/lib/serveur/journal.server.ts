/**
 * Journal d'audit (table `evenement`) — équivalent de `journaliser()` de `src/serveur/services/socle.ts`.
 *
 * L'écriture passe par le client « service » : aucune politique d'insertion n'existe pour les clients (le journal ne se
 * forge pas depuis le navigateur). Un échec d'écriture du journal LÈVE une exception : mieux vaut interrompre une action
 * que la laisser sans trace. Ne jamais mettre de secret ni de mot de passe dans `detail`.
 */
import type { Acteur } from "./acteur.server";
import type { BdService } from "./bd.server";

export interface EntreeJournal {
  of_id: string;
  dossier_id?: string | null;
  /** L'acteur (seuls son id et son rôle sont retenus), ou `"systeme"` pour une action sans utilisateur. */
  acteur: Pick<Acteur, "utilisateur_id" | "role"> | "systeme";
  /** Code court stable, ex. `candidature_validee`. */
  type: string;
  /** Phrase lisible, ex. « Candidature de Marie Durand validée ». */
  libelle: string;
  detail?: unknown;
}

export async function journaliser(bd: BdService, entree: EntreeJournal): Promise<void> {
  const acteur = entree.acteur === "systeme" ? null : entree.acteur;
  const { error } = await bd.from("evenement").insert({
    of_id: entree.of_id,
    dossier_id: entree.dossier_id ?? null,
    acteur_id: acteur?.utilisateur_id || null,
    acteur_role: acteur ? acteur.role : "systeme",
    type: entree.type,
    libelle: entree.libelle,
    detail: entree.detail ?? null,
  });
  if (error) {
    console.error("[journal] écriture impossible", error);
    throw new Error(`Journal : ${error.message}`);
  }
}
