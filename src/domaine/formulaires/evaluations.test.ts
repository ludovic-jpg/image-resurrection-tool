import { describe, expect, it } from "vitest";
import {
  CONFIG_EVALUATIONS,
  controlerReponses,
  estTypeEvaluation,
  formulaireDe,
  questionnaireOuvert,
  statutPagePublique,
  statutSuiviFormulaire,
} from "./evaluations";

const QCM = {
  titre: "T",
  questions: [
    { enonce: "Q1", propositions: ["a", "b"], bonne_reponse: 1 },
    { enonce: "Q2", propositions: ["a", "b", "c"], bonne_reponse: 0 },
  ],
};

describe("questionnaires ouverts selon l'étape", () => {
  it("recueil et positionnement dès la création, acquis une fois la formation commencée", () => {
    expect(questionnaireOuvert("brouillon", "recueil")).toBe(true);
    expect(questionnaireOuvert("brouillon", "acquis")).toBe(false);
    expect(questionnaireOuvert("formation_debutee", "acquis")).toBe(true);
  });
  it("jamais sur un dossier terminal", () => {
    expect(questionnaireOuvert("archive", "recueil")).toBe(false);
    expect(questionnaireOuvert("refus_financement", "positionnement")).toBe(false);
  });
  it("reconnaît les types", () => {
    expect(estTypeEvaluation("acquis")).toBe(true);
    expect(estTypeEvaluation("autre")).toBe(false);
    expect(formulaireDe("positionnement")).toBeNull();
    expect(formulaireDe("recueil")).not.toBeNull();
    expect(CONFIG_EVALUATIONS.recueil.code).toBeTruthy();
  });
});

describe("contrôle des réponses", () => {
  it("QCM : calcule le score et normalise", () => {
    const r = controlerReponses({ questionnaire_positionnement: QCM }, "positionnement", [1, 0]);
    expect(r).toMatchObject({ ok: true, reponses: [1, 0], score: 100 });
  });
  it("QCM : refuse une réponse manquante ou hors bornes", () => {
    const d = { questionnaire_acquis: QCM };
    expect(controlerReponses(d, "acquis", [1])).toMatchObject({ ok: false, code: "invalide" });
    expect(controlerReponses(d, "acquis", [1, 7])).toMatchObject({ ok: false, code: "invalide" });
  });
  it("sans questionnaire rattaché : conflit", () => {
    expect(controlerReponses({}, "acquis", [])).toMatchObject({ ok: false, code: "conflit" });
  });
  it("formulaire à champs fixes : erreurs par champ", () => {
    const r = controlerReponses({}, "recueil", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).length).toBeGreaterThan(0);
    expect(controlerReponses({}, "recueil", [1])).toMatchObject({ ok: false, code: "invalide" });
  });
});

describe("statuts", () => {
  const maintenant = new Date("2026-10-05T10:00:00Z");
  it("suivi : la pièce validée prime, puis la ligne, puis l'échéance", () => {
    expect(statutSuiviFormulaire(null, false, maintenant)).toBe("non_envoye");
    expect(statutSuiviFormulaire(null, true, maintenant)).toBe("valide");
    expect(
      statutSuiviFormulaire({ statut: "complet", expire_le: "2020-01-01" }, false, maintenant),
    ).toBe("valide");
    expect(
      statutSuiviFormulaire({ statut: "en_cours", expire_le: "2020-01-01" }, false, maintenant),
    ).toBe("en_cours");
    expect(
      statutSuiviFormulaire(
        { statut: "envoye", expire_le: "2026-10-05T09:00:00Z" },
        false,
        maintenant,
      ),
    ).toBe("expire");
    expect(
      statutSuiviFormulaire(
        { statut: "envoye", expire_le: "2026-12-01T00:00:00Z" },
        false,
        maintenant,
      ),
    ).toBe("envoye");
  });
  it("page publique", () => {
    expect(statutPagePublique({ statut: "envoye" }, true)).toBe("complet");
    expect(statutPagePublique({ statut: "en_cours" }, false)).toBe("en_cours");
    expect(statutPagePublique({ statut: "envoye" }, false)).toBe("envoye");
  });
});
