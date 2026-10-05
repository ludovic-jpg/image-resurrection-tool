/**
 * Bilan Pédagogique et Financier (Cerfa n° 10443) — agrégation par exercice (F-BPF-01, F-BPF-02).
 *
 * Repris de la base B : l'idée d'un écran BPF agrégeant le « réalisé ». Abandonné : l'agrégation faite
 * dans l'écran, sur des tables absentes du schéma (28 erreurs de typage). Ici, c'est une fonction pure.
 *
 * Périmètre (proposition du cahier des charges, à cadrer avec l'expert-comptable) : nombre de stagiaires,
 * heures-stagiaires, répartition par origine du financement, chiffre d'affaires, part sous-traitée.
 * Une action compte dans l'exercice de sa DATE DE FIN, dès lors que la formation a été réalisée.
 */
import type { ModeFinancement } from "../dossier/agregat";
import { aAtteint, type SousStatut } from "../pipeline/statuts";

export interface LigneRealise {
  dossier_reference: string;
  sous_statut: SousStatut;
  formation_titre: string;
  formation_date_debut: string;
  formation_date_fin: string;
  mode_financement: ModeFinancement;
  formateur_id: string;
  formateur_nom: string;
  nb_stagiaires: number;
  /** Somme des heures réellement émargées par les stagiaires du dossier. */
  heures_stagiaires: number;
  /** Heures de face-à-face dispensées par le formateur. */
  heures_dispensees: number;
  /** Chiffre d'affaires HT de l'action, en centimes. */
  montant_ht: number;
  /** Montant reversé au formateur sous-traitant, en centimes. */
  montant_sous_traite: number;
}

export const LIBELLE_FINANCEMENT: Record<ModeFinancement, string> = {
  opco: "Opérateurs de compétences (OPCO)",
  faf: "Fonds d'assurance formation de non-salariés (FAF)",
  entreprise: "Entreprises, pour la formation de leurs salariés",
  fonds_propres: "Particuliers, à leurs propres frais",
};

export interface Totaux {
  nb_actions: number;
  nb_stagiaires: number;
  heures_stagiaires: number;
  heures_dispensees: number;
  montant_ht: number;
  montant_sous_traite: number;
}

export interface Bpf {
  exercice: number;
  totaux: Totaux;
  par_financement: Array<{ mode: ModeFinancement; libelle: string } & Totaux>;
  par_formateur: Array<{ formateur_id: string; formateur_nom: string } & Totaux>;
  lignes: LigneRealise[];
}

const zero = (): Totaux => ({
  nb_actions: 0,
  nb_stagiaires: 0,
  heures_stagiaires: 0,
  heures_dispensees: 0,
  montant_ht: 0,
  montant_sous_traite: 0,
});

function cumuler(t: Totaux, l: LigneRealise): void {
  t.nb_actions += 1;
  t.nb_stagiaires += l.nb_stagiaires;
  t.heures_stagiaires = Math.round((t.heures_stagiaires + l.heures_stagiaires) * 100) / 100;
  t.heures_dispensees = Math.round((t.heures_dispensees + l.heures_dispensees) * 100) / 100;
  t.montant_ht += l.montant_ht;
  t.montant_sous_traite += l.montant_sous_traite;
}

/** Une action est « réalisée » si la formation est terminée et que le dossier n'a pas été refusé. */
export function estRealisee(l: Pick<LigneRealise, "sous_statut">): boolean {
  return aAtteint(l.sous_statut, "fin_dossier_incomplet");
}

export function exerciceDe(l: Pick<LigneRealise, "formation_date_fin">): number {
  return Number(l.formation_date_fin.slice(0, 4));
}

export function agregerBpf(lignes: readonly LigneRealise[], exercice: number): Bpf {
  const retenues = lignes
    .filter((l) => estRealisee(l) && exerciceDe(l) === exercice)
    .sort(
      (a, b) =>
        a.formation_date_fin.localeCompare(b.formation_date_fin) ||
        a.dossier_reference.localeCompare(b.dossier_reference),
    );

  const totaux = zero();
  const parFinancement = new Map<ModeFinancement, Totaux>();
  const parFormateur = new Map<string, { formateur_nom: string } & Totaux>();

  for (const l of retenues) {
    cumuler(totaux, l);
    if (!parFinancement.has(l.mode_financement)) parFinancement.set(l.mode_financement, zero());
    cumuler(parFinancement.get(l.mode_financement)!, l);
    if (!parFormateur.has(l.formateur_id))
      parFormateur.set(l.formateur_id, { formateur_nom: l.formateur_nom, ...zero() });
    cumuler(parFormateur.get(l.formateur_id)!, l);
  }

  return {
    exercice,
    totaux,
    par_financement: (Object.keys(LIBELLE_FINANCEMENT) as ModeFinancement[])
      .filter((mode) => parFinancement.has(mode))
      .map((mode) => ({ mode, libelle: LIBELLE_FINANCEMENT[mode], ...parFinancement.get(mode)! })),
    par_formateur: [...parFormateur]
      .map(([formateur_id, t]) => ({ formateur_id, ...t }))
      .sort((a, b) => a.formateur_nom.localeCompare(b.formateur_nom)),
    lignes: retenues,
  };
}

/** Exercices pour lesquels il existe du réalisé, du plus récent au plus ancien. */
export function exercicesDisponibles(lignes: readonly LigneRealise[]): number[] {
  return [...new Set(lignes.filter(estRealisee).map(exerciceDe))].sort((a, b) => b - a);
}

const csv = (valeur: string | number) => {
  const s = String(valeur);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const euros = (centimes: number) => (centimes / 100).toFixed(2).replace(".", ",");
const nombre = (n: number) => String(n).replace(".", ",");

/** Export CSV (séparateur « ; », décimales à virgule : s'ouvre tel quel dans Excel en français). */
export function bpfEnCsv(bpf: Bpf): string {
  const L: string[] = [];
  const ligne = (...cellules: Array<string | number>) => L.push(cellules.map(csv).join(";"));

  ligne(`Bilan pédagogique et financier — exercice ${bpf.exercice}`);
  ligne();
  ligne("SYNTHÈSE");
  ligne("Nombre d'actions réalisées", bpf.totaux.nb_actions);
  ligne("Nombre de stagiaires", bpf.totaux.nb_stagiaires);
  ligne("Heures-stagiaires", nombre(bpf.totaux.heures_stagiaires));
  ligne("Heures dispensées", nombre(bpf.totaux.heures_dispensees));
  ligne("Chiffre d'affaires HT (€)", euros(bpf.totaux.montant_ht));
  ligne("Dont sous-traité à des formateurs (€)", euros(bpf.totaux.montant_sous_traite));
  ligne();
  ligne("RÉPARTITION PAR ORIGINE DU FINANCEMENT");
  ligne("Origine", "Actions", "Stagiaires", "Heures-stagiaires", "Produits HT (€)");
  for (const f of bpf.par_financement)
    ligne(f.libelle, f.nb_actions, f.nb_stagiaires, nombre(f.heures_stagiaires), euros(f.montant_ht));
  ligne();
  ligne("RÉPARTITION PAR FORMATEUR");
  ligne(
    "Formateur",
    "Actions",
    "Stagiaires",
    "Heures dispensées",
    "Heures-stagiaires",
    "CA HT (€)",
    "Montant sous-traité (€)",
  );
  for (const f of bpf.par_formateur) {
    ligne(
      f.formateur_nom,
      f.nb_actions,
      f.nb_stagiaires,
      nombre(f.heures_dispensees),
      nombre(f.heures_stagiaires),
      euros(f.montant_ht),
      euros(f.montant_sous_traite),
    );
  }
  ligne();
  ligne("DÉTAIL DES ACTIONS");
  ligne(
    "Dossier",
    "Formation",
    "Début",
    "Fin",
    "Financement",
    "Formateur",
    "Stagiaires",
    "Heures-stagiaires",
    "CA HT (€)",
  );
  for (const l of bpf.lignes) {
    ligne(
      l.dossier_reference,
      l.formation_titre,
      l.formation_date_debut,
      l.formation_date_fin,
      LIBELLE_FINANCEMENT[l.mode_financement],
      l.formateur_nom,
      l.nb_stagiaires,
      nombre(l.heures_stagiaires),
      euros(l.montant_ht),
    );
  }
  // BOM UTF-8 : sans lui, Excel affiche mal les accents.
  return `\uFEFF${L.join("\r\n")}\r\n`;
}
