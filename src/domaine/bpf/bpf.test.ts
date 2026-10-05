import { describe, expect, it } from "vitest";
import { agregerBpf, bpfEnCsv, exercicesDisponibles, type LigneRealise } from "./agregation";

const ligne = (surcharge: Partial<LigneRealise>): LigneRealise => ({
  dossier_reference: "ADF-2026-0001",
  sous_statut: "archive",
  formation_titre: "Excel",
  formation_date_debut: "2026-11-03",
  formation_date_fin: "2026-11-04",
  mode_financement: "opco",
  formateur_id: "f1",
  formateur_nom: "Lambert Sophie",
  nb_stagiaires: 2,
  heures_stagiaires: 24.5,
  heures_dispensees: 14,
  montant_ht: 196_000,
  montant_sous_traite: 147_000,
  ...surcharge,
});

const LIGNES: LigneRealise[] = [
  ligne({}),
  ligne({
    dossier_reference: "ADF-2026-0002",
    mode_financement: "entreprise",
    formateur_id: "f2",
    formateur_nom: "Durand Paul",
    nb_stagiaires: 1,
    heures_stagiaires: 7,
    heures_dispensees: 7,
    montant_ht: 70_000,
    montant_sous_traite: 52_500,
  }),
  ligne({
    dossier_reference: "ADF-2026-0003",
    sous_statut: "fin_dossier_incomplet",
    nb_stagiaires: 3,
    heures_stagiaires: 10.25,
    montant_ht: 90_000,
    montant_sous_traite: 67_500,
  }),
  // Exclues de l'exercice 2026 :
  ligne({ dossier_reference: "ADF-2026-0004", sous_statut: "refus_financement" }),
  ligne({ dossier_reference: "ADF-2026-0005", sous_statut: "formation_debutee" }),
  ligne({
    dossier_reference: "ADF-2025-0009",
    formation_date_debut: "2025-12-29",
    formation_date_fin: "2025-12-30",
  }),
  // À cheval sur deux années : compte dans l'exercice de sa date de fin.
  ligne({
    dossier_reference: "ADF-2026-0006",
    formation_date_debut: "2026-12-28",
    formation_date_fin: "2027-01-05",
    montant_ht: 10_000,
    montant_sous_traite: 7_500,
    nb_stagiaires: 1,
    heures_stagiaires: 5,
    heures_dispensees: 5,
  }),
];

describe("agrégation du BPF", () => {
  it("ne retient que le réalisé de l'exercice : ni refus, ni formation en cours, ni autre année", () => {
    const bpf = agregerBpf(LIGNES, 2026);
    expect(bpf.lignes.map((l) => l.dossier_reference)).toEqual([
      "ADF-2026-0001",
      "ADF-2026-0002",
      "ADF-2026-0003",
    ]);
    expect(bpf.totaux).toEqual({
      nb_actions: 3,
      nb_stagiaires: 6,
      heures_stagiaires: 41.75,
      heures_dispensees: 35,
      montant_ht: 356_000,
      montant_sous_traite: 267_000,
    });
  });

  it("rattache une action à cheval sur deux années à l'exercice de sa date de fin", () => {
    expect(agregerBpf(LIGNES, 2027).lignes.map((l) => l.dossier_reference)).toEqual(["ADF-2026-0006"]);
    expect(exercicesDisponibles(LIGNES)).toEqual([2027, 2026, 2025]);
  });

  it("répartit par origine du financement et par formateur, sans perdre un centime", () => {
    const bpf = agregerBpf(LIGNES, 2026);
    expect(bpf.par_financement.map((f) => [f.mode, f.nb_actions, f.montant_ht])).toEqual([
      ["opco", 2, 286_000],
      ["entreprise", 1, 70_000],
    ]);
    expect(bpf.par_formateur.map((f) => [f.formateur_nom, f.nb_stagiaires, f.montant_sous_traite])).toEqual([
      ["Durand Paul", 1, 52_500],
      ["Lambert Sophie", 5, 214_500],
    ]);
    const somme = (xs: Array<{ montant_ht: number }>) => xs.reduce((a, x) => a + x.montant_ht, 0);
    expect(somme(bpf.par_financement)).toBe(bpf.totaux.montant_ht);
    expect(somme(bpf.par_formateur)).toBe(bpf.totaux.montant_ht);
  });

  it("rend un exercice vide sans erreur", () => {
    expect(agregerBpf(LIGNES, 2030).totaux.nb_actions).toBe(0);
  });

  it("exporte un CSV lisible par Excel en français", () => {
    const texte = bpfEnCsv(agregerBpf([ligne({ formation_titre: 'Excel ; "avancé"' })], 2026));
    expect(texte.startsWith("﻿")).toBe(true);
    expect(texte).toContain("Chiffre d'affaires HT (€);1960,00");
    expect(texte).toContain("Heures-stagiaires;24,5");
    expect(texte).toContain('"Excel ; ""avancé"""');
    expect(texte).toContain("\r\n");
  });
});
