/**
 * Pré-remplissage d'un dossier à sa création (F-DOS-03) : tout ce qui est déjà connu — formation du catalogue,
 * entreprise — est recopié sous le nom des variables harmonisées. Règles reprises de `creerDossier` et de
 * `recreerDepuis` de l'ancien `src/serveur/services/dossiers.ts`, version pure.
 */
import type { Modalite, ModeFinancement } from "./agregat";

export interface FormationCatalogue {
  id: string;
  formation_titre: string;
  formation_objectifs: string;
  formation_niveau: string;
  formation_prerequis: string;
  public_vise: string;
  programme: string;
  formation_duree_heures_total: number | null;
  formation_duree_jours: number | null;
  formation_duree_heures_presentiel: number | null;
  formation_duree_heures_distanciel: number | null;
  formation_lieu_nom: string;
  formation_lieu_adresse: string;
  formation_lieu_siret: string;
  formation_lien_visio: string;
  formation_opco: string;
  formation_prix_unitaire_ht: number | null;
}

export interface EntrepriseCreation {
  id: string;
  entreprise_nom: string;
  entreprise_adresse: string;
  entreprise_siret: string;
  entreprise_opco: string;
}

/** Colonnes de `dossier_formation` fixées à la création, hors identité (id, référence, formateur, organisme). */
export function valeursInitialesDossier(a: {
  formation: FormationCatalogue;
  entreprise: EntrepriseCreation;
  modalite: Modalite;
  financement: ModeFinancement;
}): Record<string, string | number | null> {
  const { formation: f, entreprise: ent, modalite, financement } = a;
  const surSite = modalite !== "distanciel";
  const total = f.formation_duree_heures_total;
  return {
    entreprise_id: ent.id,
    formation_id: f.id,
    mode_financement: financement,
    formation_titre: f.formation_titre,
    formation_objectifs: f.formation_objectifs,
    formation_niveau: f.formation_niveau,
    formation_prerequis: f.formation_prerequis,
    formation_public_vise: f.public_vise,
    formation_programme: f.programme,
    formation_duree_heures_total: total,
    formation_duree_jours: f.formation_duree_jours,
    // Répartition présentiel / distanciel : celle du catalogue si la modalité est la même, sinon déduite.
    formation_duree_heures_presentiel:
      modalite === "presentiel"
        ? total
        : modalite === "mixte"
          ? f.formation_duree_heures_presentiel
          : null,
    formation_duree_heures_distanciel:
      modalite === "distanciel"
        ? total
        : modalite === "mixte"
          ? f.formation_duree_heures_distanciel
          : null,
    formation_modalite: modalite,
    // Lieu : celui du catalogue s'il est renseigné (salle louée, centre), sinon l'entreprise (intra).
    formation_lieu_nom: surSite ? f.formation_lieu_nom || ent.entreprise_nom : "",
    formation_lieu_adresse: surSite ? f.formation_lieu_adresse || ent.entreprise_adresse : "",
    formation_lieu_siret: surSite
      ? f.formation_lieu_nom
        ? f.formation_lieu_siret
        : ent.entreprise_siret
      : "",
    formation_lien_visio: modalite !== "presentiel" ? f.formation_lien_visio : "",
    formation_opco:
      financement === "opco" || financement === "faf"
        ? ent.entreprise_opco || f.formation_opco
        : "",
    formation_prix_unitaire_ht: f.formation_prix_unitaire_ht,
    // Version 7 : plus de coût horaire saisi ; la rémunération du formateur se calcule par la commission de l'organisme.
    formateur_cout_horaire: null,
  };
}

/** Modèle d'outil à rattacher au dossier : celui de la formation s'il existe, sinon le plus récent sans formation. */
export function choisirModele<T extends { formation_id: string | null }>(
  modelesRecentsDAbord: readonly T[],
  formationId: string,
): T | null {
  return (
    modelesRecentsDAbord.find((m) => m.formation_id === formationId) ??
    modelesRecentsDAbord.find((m) => m.formation_id === null) ??
    null
  );
}

/** Colonnes qu'un dossier recréé reprend de l'ancien (F-DOS-07 / RG-07) : lieu, financeur, prix, lieu de signature. */
export const COLONNES_REPRISES_A_LA_RECREATION = [
  "formation_lieu_nom",
  "formation_lieu_adresse",
  "formation_lieu_siret",
  "formation_lien_visio",
  "formation_opco",
  "signature_lieu",
  "formation_prix_unitaire_ht",
] as const;

export function reprisesDeLAncien(
  source: Record<string, unknown>,
): Record<(typeof COLONNES_REPRISES_A_LA_RECREATION)[number], unknown> {
  return Object.fromEntries(COLONNES_REPRISES_A_LA_RECREATION.map((c) => [c, source[c]])) as never;
}
