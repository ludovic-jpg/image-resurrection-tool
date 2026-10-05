import { describe, expect, it } from "vitest";
import { courrielDeTest, courriels } from "./modeles";

const base = {
  of_nom: "Organisme <Test>",
  prenom: "Camille",
  lien: "https://app.exemple/x?a=1&b=2",
};

describe("modèles d'e-mail", () => {
  it("en compte exactement 16", () => {
    expect(Object.keys(courriels).sort()).toEqual(
      [
        "candidatureSoumise",
        "decisionCandidature",
        "demandeValidation",
        "depotDeclare",
        "elementsPedagogiques",
        "formulaireApprenant",
        "formulaireConfirmation",
        "formulaireRecu",
        "invitationApprenant",
        "invitationPositionnement",
        "odmFormateur",
        "piecesFinancementEntreprise",
        "positionnementComplet",
        "positionnementConfirmation",
        "relanceApprenant",
        "renvoiEnBrouillon",
      ].sort(),
    );
  });

  it("échappe le HTML dans le nom de l'organisme et dans le lien", () => {
    const c = courriels.candidatureSoumise({ of_nom: base.of_nom, candidat: "A", lien: base.lien });
    expect(c.corps_html).toContain("Organisme &lt;Test&gt;");
    expect(c.corps_html).not.toContain("<Test>");
    expect(c.corps_html).toContain('href="https://app.exemple/x?a=1&amp;b=2"');
  });

  it("neutralise une injection dans un champ saisi par l'utilisateur", () => {
    const c = courriels.renvoiEnBrouillon({
      ...base,
      reference: "ADF-2026-0001",
      motif: '<img src=x onerror="alert(1)">',
    });
    expect(c.corps_html).not.toContain("<img");
    expect(c.corps_html).toContain("&lt;img");
  });

  it("décision de candidature : validée, ou refusée avec le motif", () => {
    const ok = courriels.decisionCandidature({ ...base, validee: true, motif: "" });
    expect(ok.sujet).toBe("Votre candidature est validée");
    expect(ok.corps_html).toContain("validée");
    const ko = courriels.decisionCandidature({
      ...base,
      validee: false,
      motif: "Pièces illisibles",
    });
    expect(ko.sujet).toBe("Suite donnée à votre candidature");
    expect(ko.corps_html).toContain("Motif indiqué : Pièces illisibles");
    const sansMotif = courriels.decisionCandidature({ ...base, validee: false, motif: "" });
    expect(sansMotif.corps_html).not.toContain("Motif indiqué");
  });

  it("relance de formulaire : préfixe « Rappel — » seulement pour une relance", () => {
    const a = {
      ...base,
      formateur: "",
      formation: "Soudure",
      libelle: "Recueil des besoins",
      message: "",
      expire: "1 janvier",
    };
    expect(courriels.formulaireApprenant({ ...a, relance: false }).sujet).toBe(
      "Recueil des besoins — Soudure",
    );
    expect(courriels.formulaireApprenant({ ...a, relance: true }).sujet).toBe(
      "Rappel — Recueil des besoins — Soudure",
    );
  });

  it("chaque modèle produit un sujet et un corps non vides", () => {
    const sorties = [
      courriels.invitationApprenant({ ...base, formateur: "F", formation: "X" }),
      courriels.relanceApprenant({ ...base, formation: "X", pieces: ["a", "b"] }),
      courriels.demandeValidation({ ...base, formateur: "F", reference: "R", formation: "X" }),
      courriels.depotDeclare({ ...base, reference: "R", formation: "X", par: "P" }),
      courriels.piecesFinancementEntreprise({
        of_nom: "O",
        representant: "R",
        formation: "X",
        stagiaires: "S",
        reference: "R",
        pieces: ["p"],
      }),
      courriels.odmFormateur({ ...base, reference: "R", formation: "X" }),
      courriels.elementsPedagogiques({ ...base, formation: "X", date_debut: "1 mai" }),
      courriels.positionnementComplet({ ...base, apprenant: "A", formation: "X", score: "8/10" }),
      courriels.positionnementConfirmation({ ...base, formation: "X" }),
      courriels.formulaireConfirmation({ ...base, formation: "X", libelle: "L" }),
      courriels.formulaireRecu({
        ...base,
        apprenant: "A",
        formation: "X",
        libelle: "L",
        reference: "R",
      }),
      courriels.invitationPositionnement({
        ...base,
        nom: "N",
        email: "a@b.fr",
        formateur: "F",
        formation: "X",
        message: "",
        expire: "demain",
      }),
    ];
    for (const s of sorties) {
      expect(s.sujet.length).toBeGreaterThan(5);
      expect(s.corps_html).toContain("<div");
    }
  });

  it("e-mail de test : horodaté en heure de Paris, nom échappé", () => {
    const c = courrielDeTest({ nom: "<b>Ana</b>", instant: new Date("2026-10-05T10:00:00Z") });
    expect(c.sujet).toBe("Test d'envoi — plateforme de formation");
    expect(c.corps_html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(c.corps_html).toMatch(/5 octobre 2026/);
  });
});
