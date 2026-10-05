import { describe, expect, it } from "vitest";
import {
  DICTIONNAIRE,
  estSaisissable,
  estVariableConnue,
  nomCanonique,
  trouverVariable,
  validerNomVariable,
} from "./variables";
import { ALIAS_AMBIGUS, ciblesDesAliasExacts, resoudreAlias } from "./alias";
import { NOMENCLATURE, piecesDeLEspace, piecesDuReferentiel } from "./pieces";

describe("dictionnaire des variables", () => {
  it("ne contient aucun doublon", () => {
    const noms = DICTIONNAIRE.map((d) => d.nom);
    expect(new Set(noms).size).toBe(noms.length);
  });

  it("respecte les règles de nommage pour chaque variable", () => {
    const fautives = DICTIONNAIRE.map((d) => ({ nom: d.nom, erreurs: validerNomVariable(d.nom) })).filter(
      (x) => x.erreurs.length > 0,
    );
    expect(fautives).toEqual([]);
  });

  it("refuse les noms proscrits par la skill conventions-s4m", () => {
    for (const mauvais of ["objectifspédagogique", "format ", "DAT", "FOR", "Titreformation", "of__nom", "prix_"]) {
      expect(validerNomVariable(mauvais).length, mauvais).toBeGreaterThan(0);
    }
  });

  it("porte la bonne graphie du numéro Qualiopi (coquille « of_qualiodi_numero » de la skill)", () => {
    expect(estVariableConnue("of_qualiopi_numero")).toBe(true);
    expect(estVariableConnue("of_qualiodi_numero")).toBe(false);
  });

  it("scinde toujours prénom et nom du formateur", () => {
    expect(estVariableConnue("formateur_prenom")).toBe(true);
    expect(estVariableConnue("formateur_nom")).toBe(true);
  });

  it("reconnaît les variables numérotées dans les bornes des groupes répétables", () => {
    expect(nomCanonique("stagiaire_3_nom")).toBe("stagiaire_N_nom");
    expect(trouverVariable("session_20_heure_fin")?.repetable).toBe("session");
    expect(estVariableConnue("stagiaire_9_nom")).toBe(false); // 8 stagiaires au plus
    expect(estVariableConnue("session_21_date")).toBe(false); // 20 séances au plus
    expect(estVariableConnue("stagiaire_0_nom")).toBe(false);
  });

  it("interdit la saisie des champs calculés et des champs système", () => {
    for (const nom of [
      "formation_liste_stagiaires",
      "formation_nb_stagiaires",
      "formation_prix_total_ht",
      "formateur_montant_total",
      "facture_of_montant_ht",
      "facture_of_montant_tva",
      "facture_of_montant_ttc",
      "dossier_reference",
    ]) {
      expect(estSaisissable(nom), nom).toBe(false);
    }
    expect(estSaisissable("formation_titre")).toBe(true);
  });

  it("range l'identité de l'organisme dans la configuration, jamais dans la saisie d'un dossier", () => {
    const of = DICTIONNAIRE.filter((d) => d.nom.startsWith("of_"));
    expect(of.length).toBeGreaterThanOrEqual(19);
    expect(of.every((d) => d.origine === "config_of")).toBe(true);
    expect(trouverVariable("portage_commission_pourcentage")?.origine).toBe("config_of");
  });
});

describe("table d'alias", () => {
  it("ne pointe que vers des variables existantes", () => {
    const orphelines = ciblesDesAliasExacts().filter((c) => !estVariableConnue(c));
    expect(orphelines).toEqual([]);
  });

  it("résout les anciennes graphies multiples vers un seul nom", () => {
    for (const ancien of ["nbadf", "adf", "NBADF", "ADF"]) {
      expect(resoudreAlias(ancien)).toEqual({ statut: "resolu", cibles: ["dossier_reference"] });
    }
  });

  it("scinde l'ancien nom du formateur en prénom + nom", () => {
    expect(resoudreAlias("nomformateur")).toEqual({
      statut: "resolu",
      cibles: ["formateur_prenom", "formateur_nom"],
    });
  });

  it("tolère l'espace finale de « {{format }} »", () => {
    expect(resoudreAlias("format ")).toEqual({ statut: "resolu", cibles: ["formation_modalite"] });
  });

  it("résout les formes à rang variable, ordinaux compris", () => {
    expect(resoudreAlias("nomapp4")).toEqual({ statut: "resolu", cibles: ["stagiaire_4_nom"] });
    expect(resoudreAlias("positionapp8")).toEqual({ statut: "resolu", cibles: ["stagiaire_8_poste"] });
    expect(resoudreAlias("Date_Session_17")).toEqual({ statut: "resolu", cibles: ["session_17_date"] });
    expect(resoudreAlias("Date_1ere_Session")).toEqual({ statut: "resolu", cibles: ["session_1_date"] });
    expect(resoudreAlias("Heure_debut_3eme_session")).toEqual({
      statut: "resolu",
      cibles: ["session_3_heure_debut"],
    });
    expect(resoudreAlias("nomapp9")).toEqual({ statut: "inconnu" });
  });

  it("refuse de trancher un alias ambigu (bug « prixun » du gabarit de facture)", () => {
    expect(resoudreAlias("prixun")).toEqual({ statut: "ambigu", candidats: ALIAS_AMBIGUS.prixun });
  });

  it("ne devine jamais un nom inconnu", () => {
    expect(resoudreAlias("variable")).toEqual({ statut: "inconnu" });
    expect(resoudreAlias("${varName}")).toEqual({ statut: "inconnu" });
  });
});

describe("nomenclature des pièces", () => {
  it("contient les 13 pièces du référentiel, triées chronologiquement par leur nom de fichier", () => {
    const ref = piecesDuReferentiel();
    expect(ref).toHaveLength(13);
    const fichiers = ref.map((d) => d.fichier);
    expect([...fichiers].sort()).toEqual(fichiers);
    for (const d of ref) expect(d.fichier).toMatch(/^\d{2}_(AVT|PDT|FIN|APR)_[A-Za-z-]+$/);
  });

  it("n'a aucun code en double", () => {
    expect(new Set(NOMENCLATURE.map((d) => d.code)).size).toBe(NOMENCLATURE.length);
  });

  it("reproduit l'espace Communication avec l'Apprenant du cahier des charges (6.4.2), programme en annexe compris", () => {
    // « 2 ter Programme » : ajout du 23/09/2026 — la convention renvoie à un programme « en annexe » qui n'existait pas.
    expect(piecesDeLEspace("apprenant").map((d) => `${d.ordre} ${d.libelle}`)).toEqual([
      "1 Pré-dossier",
      "2 Convention de formation",
      "2 bis Planning",
      "2 ter Programme de formation",
      "3 Accord de financement",
      "4 Convocation",
      "5 Feuille d'émargement",
      "6 Évaluation des acquis",
      "7 Attestation de réalisation",
    ]);
  });

  it("reproduit l'espace Communication avec l'OF (6.4.3) : ODM, facture formateur, facture OF", () => {
    expect(piecesDeLEspace("of").map((d) => d.code)).toEqual(["04-AVT", "10-FIN", "11-FIN"]);
  });

  it("transmet le planning sans statut de signature (F-COM-03bis)", () => {
    const planning = NOMENCLATURE.find((d) => d.code === "03-AVT")!;
    expect(planning.suiviStatut).toBe(false);
    expect(planning.valideePar).toEqual([]);
  });

  it("laisse tout acteur du dossier déposer l'Accord de financement (F-COM-10, RG-06)", () => {
    const accord = NOMENCLATURE.find((d) => d.code === "ACC")!;
    expect([...accord.valideePar].sort()).toEqual(["admin", "apprenant", "formateur"]);
    expect(accord.mode).toBe("deposee");
  });

  it("n'expose à l'apprenant ni l'ODM ni les factures", () => {
    const codes = piecesDeLEspace("apprenant").map((d) => d.code);
    expect(codes).not.toContain("04-AVT");
    expect(codes).not.toContain("10-FIN");
    expect(codes).not.toContain("11-FIN");
  });

  it("exige qu'une pièce suivie ait au moins un rôle validant, et l'inverse", () => {
    for (const d of NOMENCLATURE) {
      expect(d.valideePar.length > 0, d.code).toBe(d.suiviStatut);
    }
  });
});
