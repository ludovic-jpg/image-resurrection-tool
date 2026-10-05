/**
 * Lignes du BPF — du dossier chargé en base à la ligne « réalisé » que `agregerBpf` additionne.
 *
 * Reprise PURE de `lignesRealisees` et de `heuresRealisees` de l'ancien serveur (`src/serveur/services/bpf.ts` et
 * `agregat.ts`) : le serveur ne fait plus que LIRE les lignes de la base et les passer ici, de sorte que le calcul
 * est identique à celui d'avant. Aucun import de React, de Supabase ni de réseau.
 */
import type { AgregatDossier, Entreprise, Formateur, Organisme } from "../dossier/agregat";
import { calculer } from "../dossier/calculs";
import { dureeSeanceHeures } from "../dossier/formats";
import type { SousStatut } from "../pipeline/statuts";
import type { LigneRealise } from "./agregation";

export interface SeanceBase {
  id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
}

const arrondi2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Heures réellement suivies par stagiaire. Émargement électronique : somme des séances signées par le stagiaire.
 * Si la feuille a été retournée sur papier (dépôt d'un fichier validé), on retient la durée prévue.
 */
export function heuresRealiseesParStagiaire(entrees: {
  duree_totale: number | null;
  stagiaire_ids: readonly string[];
  seances: readonly SeanceBase[];
  /** Émargements dont le signataire est « stagiaire ». */
  emargements: ReadonlyArray<{ seance_id: string; stagiaire_id: string }>;
  /** Stagiaires dont la feuille d'émargement (06-PDT) est validée par dépôt de fichier. */
  feuilles_sur_papier: readonly string[];
}): Record<string, number> {
  const sortie: Record<string, number> = {};
  for (const id of entrees.stagiaire_ids) {
    const parSignature = entrees.emargements
      .filter((e) => e.stagiaire_id === id)
      .reduce((total, e) => {
        const s = entrees.seances.find((x) => x.id === e.seance_id);
        return s ? total + dureeSeanceHeures(s.heure_debut, s.heure_fin) : total;
      }, 0);
    const surPapier = entrees.feuilles_sur_papier.includes(id);
    sortie[id] =
      parSignature > 0 ? arrondi2(parSignature) : surPapier ? (entrees.duree_totale ?? 0) : 0;
  }
  return sortie;
}

/** Ce que le serveur lit en base pour un dossier (colonnes nommées comme les variables harmonisées). */
export interface DossierBpf {
  dossier_reference: string;
  sous_statut: string;
  mode_financement: string;
  formateur_id: string;
  formation_titre: string;
  formation_date_debut: string;
  formation_date_fin: string;
  formation_duree_heures_total: number | null;
  [colonne: string]: unknown;
}

export interface EntreesLigneBpf {
  dossier: DossierBpf;
  organisme: Organisme;
  entreprise: Entreprise;
  formateur: Formateur;
  /** Nom d'affichage du formateur tel que le BPF le présente (« Nom Prénom »), ou `null` si sa fiche manque. */
  formateur_nom: string | null;
  stagiaires: AgregatDossier["stagiaires"];
  seances: readonly SeanceBase[];
  emargements: ReadonlyArray<{ seance_id: string; stagiaire_id: string }>;
  feuilles_sur_papier: readonly string[];
}

/** Une ligne du réalisé : mêmes champs, mêmes arrondis que l'ancien `lignesRealisees`. */
export function ligneRealisee(e: EntreesLigneBpf): LigneRealise {
  const d = e.dossier;
  const heures = heuresRealiseesParStagiaire({
    duree_totale: d.formation_duree_heures_total,
    stagiaire_ids: e.stagiaires.map((s) => s.id),
    seances: e.seances,
    emargements: e.emargements,
    feuilles_sur_papier: e.feuilles_sur_papier,
  });
  const agregat = {
    dossier_reference: d.dossier_reference,
    sous_statut: d.sous_statut as SousStatut,
    mode_financement: d.mode_financement,
    organisme: e.organisme,
    entreprise: e.entreprise,
    formateur: e.formateur,
    formation: d,
    stagiaires: e.stagiaires,
    seances: [...e.seances],
    facture_of: null,
    facture_formateur: null,
    evaluations: {},
    heures_realisees: heures,
  } as unknown as AgregatDossier;
  const c = calculer(agregat);
  const planifiees = e.seances.reduce(
    (t, s) => t + dureeSeanceHeures(s.heure_debut, s.heure_fin),
    0,
  );
  return {
    dossier_reference: d.dossier_reference,
    sous_statut: d.sous_statut as SousStatut,
    formation_titre: d.formation_titre,
    formation_date_debut: d.formation_date_debut,
    formation_date_fin: d.formation_date_fin,
    mode_financement: d.mode_financement as LigneRealise["mode_financement"],
    formateur_id: d.formateur_id,
    formateur_nom: e.formateur_nom ?? "Formateur",
    nb_stagiaires: e.stagiaires.length,
    heures_stagiaires: arrondi2(Object.values(heures).reduce((a, h) => a + h, 0)),
    heures_dispensees: planifiees || (d.formation_duree_heures_total ?? 0),
    montant_ht: c.formation_prix_total_ht ?? 0,
    montant_sous_traite: c.formateur_montant_total ?? 0,
  };
}

/** Nom du formateur dans le BPF : « Nom Prénom », comme l'ancien service. */
export const nomFormateurBpf = (f: { formateur_nom: string; formateur_prenom: string }): string =>
  `${f.formateur_nom} ${f.formateur_prenom}`.trim();

/** Projection d'une ligne `organisme_formation` vers l'organisme du noyau (on retire ce qui n'en fait pas partie). */
export function organismeDuNoyau(ligne: Record<string, unknown>): Organisme {
  const {
    id: _id,
    cree_le: _cree,
    couleur: _couleur,
    signature_representant_png: _signature,
    conservation_annees: _conservation,
    ...reste
  } = ligne;
  return reste as unknown as Organisme;
}

/** Projection d'une ligne `entreprise_cliente` vers l'entreprise du noyau. */
export function entrepriseDuNoyau(ligne: Record<string, unknown>): Entreprise {
  const { id: _id, of_id: _of, formateur_id: _f, cree_le: _cree, ...reste } = ligne;
  return reste as unknown as Entreprise;
}
