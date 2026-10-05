import { describe, expect, it } from "vitest";
import { dossierDeDemonstration } from "../dossier/fixture";
import { agregerBpf, bpfEnCsv } from "./agregation";
import {
  entrepriseDuNoyau,
  heuresRealiseesParStagiaire,
  ligneRealisee,
  nomFormateurBpf,
  organismeDuNoyau,
  type EntreesLigneBpf,
} from "./lignes";

const d = dossierDeDemonstration();
const dossier = {
  ...d.formation,
  dossier_reference: d.dossier_reference,
  sous_statut: "archive",
  mode_financement: d.mode_financement,
  formateur_id: "f1",
};
const emargements = [
  ...["sea-1", "sea-2", "sea-3", "sea-4"].map((seance_id) => ({
    seance_id,
    stagiaire_id: "stg-1",
  })),
  ...["sea-1", "sea-2", "sea-3"].map((seance_id) => ({ seance_id, stagiaire_id: "stg-2" })),
];
const entrees = (surcharge: Partial<EntreesLigneBpf> = {}): EntreesLigneBpf => ({
  dossier,
  organisme: d.organisme,
  entreprise: d.entreprise,
  formateur: d.formateur,
  formateur_nom: "Lambert Sophie",
  stagiaires: d.stagiaires,
  seances: d.seances,
  emargements,
  feuilles_sur_papier: [],
  ...surcharge,
});

describe("ligne du réalisé (dossier de démonstration)", () => {
  it("heures émargées, durée dispensée, chiffre d'affaires et part sous-traitée", () => {
    expect(ligneRealisee(entrees())).toEqual({
      dossier_reference: "ADF-2026-0001",
      sous_statut: "archive",
      formation_titre: "Excel — tableaux croisés dynamiques et automatisation",
      formation_date_debut: "2026-11-03",
      formation_date_fin: "2026-11-04",
      mode_financement: "opco",
      formateur_id: "f1",
      formateur_nom: "Lambert Sophie",
      nb_stagiaires: 2,
      heures_stagiaires: 24.5, // 14 h + 10 h 30
      heures_dispensees: 14,
      montant_ht: 196_000, // 2 × 980 €
      montant_sous_traite: 147_000, // 196 000 − 25 % de commission
    });
  });

  it("sans fiche formateur : « Formateur », comme l'ancien service", () => {
    expect(ligneRealisee(entrees({ formateur_nom: null })).formateur_nom).toBe("Formateur");
  });

  it("sans séance planifiée : la durée totale de la formation", () => {
    const l = ligneRealisee(entrees({ seances: [], emargements: [] }));
    expect(l.heures_dispensees).toBe(14);
    expect(l.heures_stagiaires).toBe(0);
  });

  it("alimente un BPF dont l'export CSV est stable", () => {
    const bpf = agregerBpf([ligneRealisee(entrees())], 2026);
    expect(bpf.totaux).toMatchObject({ nb_actions: 1, nb_stagiaires: 2, montant_ht: 196_000 });
    const csv = bpfEnCsv(bpf);
    expect(csv).toContain("Heures-stagiaires;24,5");
    expect(csv).toContain("Chiffre d'affaires HT (€);1960,00");
  });
});

describe("heures réellement suivies", () => {
  const base = {
    duree_totale: 14,
    stagiaire_ids: ["stg-1", "stg-2"],
    seances: d.seances,
    emargements,
    feuilles_sur_papier: [] as string[],
  };
  it("somme des séances signées par chaque stagiaire", () => {
    expect(heuresRealiseesParStagiaire(base)).toEqual({ "stg-1": 14, "stg-2": 10.5 });
  });
  it("feuille retournée sur papier et validée : durée prévue de la formation", () => {
    expect(
      heuresRealiseesParStagiaire({ ...base, emargements: [], feuilles_sur_papier: ["stg-2"] }),
    ).toEqual({ "stg-1": 0, "stg-2": 14 });
  });
  it("la signature électronique prime sur la feuille papier", () => {
    expect(heuresRealiseesParStagiaire({ ...base, feuilles_sur_papier: ["stg-2"] })["stg-2"]).toBe(
      10.5,
    );
  });
});

describe("projections", () => {
  it("nom du formateur : « Nom Prénom »", () => {
    expect(nomFormateurBpf({ formateur_nom: "Lambert", formateur_prenom: "Sophie" })).toBe(
      "Lambert Sophie",
    );
    expect(nomFormateurBpf({ formateur_nom: "Lambert", formateur_prenom: "" })).toBe("Lambert");
  });
  it("organisme du noyau : sans identifiant, couleur, signature ni conservation", () => {
    const o = organismeDuNoyau({
      id: "of",
      cree_le: "x",
      couleur: "#fff",
      signature_representant_png: "",
      conservation_annees: 10,
      of_nom: "OF",
      tva_pourcentage: 0,
    });
    expect(o).toEqual({ of_nom: "OF", tva_pourcentage: 0 });
  });
  it("entreprise du noyau : sans identifiant, organisme, formateur ni date", () => {
    expect(
      entrepriseDuNoyau({
        id: "e",
        of_id: "o",
        formateur_id: "f",
        cree_le: "x",
        entreprise_nom: "Dupont",
      }),
    ).toEqual({ entreprise_nom: "Dupont" });
  });
});
