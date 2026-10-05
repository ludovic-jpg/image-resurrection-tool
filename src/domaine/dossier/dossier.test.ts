import { describe, expect, it } from "vitest";
import { ajouterJours, calculer, niveauAtteinte } from "./calculs";
import { dossierDeDemonstration } from "./fixture";
import {
  dureeSeanceHeures,
  formaterDate,
  formaterHeure,
  formaterMontant,
  formaterPourcentage,
} from "./formats";
import { resoudreVariables } from "./resolution";
import { estVariableConnue } from "../referentiel/variables";

describe("formats français", () => {
  it("formate dates, heures, montants et pourcentages", () => {
    expect(formaterDate("2026-11-03")).toBe("03/11/2026");
    expect(formaterDate("")).toBe("");
    expect(formaterHeure("9:00")).toBe("09 h 00");
    expect(formaterMontant(196_000)).toBe("1 960,00 €");
    expect(formaterMontant(5)).toBe("0,05 €");
    expect(formaterMontant(-12_345)).toBe("−123,45 €");
    expect(formaterMontant(null)).toBe("");
    expect(formaterPourcentage(25)).toBe("25 %");
    expect(formaterPourcentage(22.5)).toBe("22,5 %");
  });

  it("calcule la durée d'une séance", () => {
    expect(dureeSeanceHeures("09:00", "12:30")).toBe(3.5);
    expect(dureeSeanceHeures("14:00", "13:00")).toBe(0);
  });
});

describe("champs calculés", () => {
  it("déduit le net formateur du prix de vente et de la commission de portage", () => {
    const c = calculer(dossierDeDemonstration());
    expect(c.formation_nb_stagiaires).toBe(2);
    expect(c.formation_prix_total_ht).toBe(196_000); // 980 € × 2
    expect(c.portage_commission_montant).toBe(49_000); // 25 %
    expect(c.formateur_montant_total).toBe(147_000);
    expect(c.facture_formateur_net_a_payer).toBe(147_000);
    expect(c.formateur_cout_horaire).toBe(10_500); // 1 470 € / 14 h
    expect(c.portage_commission_montant! + c.formateur_montant_total!).toBe(
      c.formation_prix_total_ht,
    );
  });

  it("laisse primer le coût horaire saisi au contrat, et affiche la commission réellement constatée", () => {
    const d = dossierDeDemonstration();
    d.formation.formateur_cout_horaire = 9_000; // 90 €/h
    const c = calculer(d);
    expect(c.formateur_montant_total).toBe(126_000);
    expect(c.portage_commission_montant).toBe(70_000);
    expect(c.portage_commission_pourcentage).toBe(35.71);
  });

  it("calcule la facture de l'OF : exonération de TVA par défaut, acompte déduit du solde", () => {
    const d = dossierDeDemonstration();
    d.facture_of!.facture_of_acompte = 50_000;
    let c = calculer(d);
    expect([
      c.facture_of_montant_ht,
      c.facture_of_montant_tva,
      c.facture_of_montant_ttc,
      c.facture_of_solde_du,
    ]).toEqual([196_000, 0, 196_000, 146_000]);
    d.organisme.tva_pourcentage = 20;
    c = calculer(d);
    expect([c.facture_of_montant_tva, c.facture_of_montant_ttc]).toEqual([39_200, 235_200]);
  });

  it("ne calcule rien sans prix unitaire, plutôt que d'inventer un zéro", () => {
    const d = dossierDeDemonstration();
    d.formation.formation_prix_unitaire_ht = null;
    const c = calculer(d);
    expect(c.formation_prix_total_ht).toBeNull();
    expect(c.facture_of_montant_ttc).toBeNull();
    expect(c.formateur_montant_total).toBeNull();
  });

  it("calcule échéances et niveau d'atteinte", () => {
    expect(ajouterJours("2026-11-05", 30)).toBe("2026-12-05");
    expect(ajouterJours("2026-12-15", 30)).toBe("2027-01-14");
    expect(niveauAtteinte(85)).toBe("Objectifs atteints");
    expect(niveauAtteinte(60)).toBe("Objectifs partiellement atteints");
    expect(niveauAtteinte(20)).toBe("Objectifs non atteints");
    expect(niveauAtteinte(null)).toBe("");
  });
});

describe("résolution des variables", () => {
  it("ne produit que des variables du dictionnaire", () => {
    const hors = Object.keys(
      resoudreVariables(dossierDeDemonstration(), { stagiaireId: "stg-1" }),
    ).filter((nom) => !estVariableConnue(nom));
    expect(hors).toEqual([]);
  });

  it("reconstitue les groupes répétables à partir des tables enfants", () => {
    const v = resoudreVariables(dossierDeDemonstration());
    expect(v.stagiaire_1_nom).toBe("Anne Martin");
    expect(v.stagiaire_2_poste).toBe("Chef d'atelier");
    expect(v.stagiaire_3_nom).toBeUndefined();
    expect(v.session_4_heure_fin).toBe("17 h 00");
    expect(v.formation_liste_stagiaires).toBe("Anne Martin, Luc Petit");
    expect(v.formation_prix_total_ht).toBe("1 960,00 €");
  });

  it("isole le stagiaire d'une pièce individuelle sans toucher aux totaux du dossier", () => {
    const v = resoudreVariables(dossierDeDemonstration(), { stagiaireId: "stg-2" });
    expect(v.stagiaire_1_nom).toBe("Luc Petit");
    expect(v.stagiaire_2_nom).toBeUndefined();
    expect(v.formation_nb_stagiaires).toBe("2");
    expect(v.evaluation_acquis_score).toBe("60 / 100");
    expect(v.evaluation_acquis_niveau_atteinte).toBe("Objectifs partiellement atteints");
    expect(v.attestation_heures_realisees).toBe("10,5");
  });

  it("refuse un stagiaire étranger au dossier", () => {
    expect(() => resoudreVariables(dossierDeDemonstration(), { stagiaireId: "intrus" })).toThrow(
      /n'appartient pas/,
    );
  });

  it("n'insère la clause de subrogation que pour un financement OPCO ou FAF", () => {
    const d = dossierDeDemonstration();
    expect(resoudreVariables(d).formation_clause_subrogation).not.toBe("");
    d.mode_financement = "entreprise";
    expect(resoudreVariables(d).formation_clause_subrogation).toBe("");
  });

  it("borne à 8 stagiaires et 20 séances", () => {
    const d = dossierDeDemonstration();
    d.stagiaires = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      nom: `Stagiaire ${i + 1}`,
      poste: "",
      email: "",
      situation_handicap: "",
    }));
    d.seances = Array.from({ length: 25 }, (_, i) => ({
      id: `e${i}`,
      date: "2026-11-03",
      heure_debut: "09:00",
      heure_fin: "10:00",
    }));
    const v = resoudreVariables(d);
    expect(v.stagiaire_8_nom).toBe("Stagiaire 8");
    expect(v.stagiaire_9_nom).toBeUndefined();
    expect(v.session_21_date).toBeUndefined();
  });
});
