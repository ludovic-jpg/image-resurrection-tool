import { describe, expect, it } from "vitest";
import { FORMULAIRES } from "../formulaires/definitions";
import { corriger, sansCorrige, type Questionnaire } from "../formulaires/qcm";
import {
  DUREE_LIEN_POSITIONNEMENT_MS,
  dateIsoParis,
  egalProfond,
  estDateIso,
  etatDuLien,
  formulaireRecueil,
  planReprise,
  questionsSupplementaires,
  validerBrouillon,
  validerSignature,
} from "./regles";

const TEST: Questionnaire = {
  titre: "Test d'entrée",
  questions: [
    { enonce: "Q1", propositions: ["a", "b", "c"], bonne_reponse: 1 },
    { enonce: "Q2", propositions: ["x", "y"], bonne_reponse: 0 },
    { enonce: "Q3", propositions: ["u", "v", "w", "z"], bonne_reponse: 3 },
    { enonce: "Q4", propositions: ["p", "q"], bonne_reponse: 1 },
  ],
};
const TRACE = `data:image/png;base64,${"A".repeat(700)}`;
const RECUEIL_OK = {
  poste_anciennete: "Technicien, 3 ans",
  niveau_maitrise: "Intermédiaire",
  attentes: "Monter en compétence",
  besoins_principaux: "Pratique",
  handicap: "Non",
  programme_transmis: "Oui",
};
const def = formulaireRecueil([]);
const signature = (extra: Record<string, unknown> = {}) => ({
  recueil: RECUEIL_OK,
  reponses: [1, 0, 3, 1],
  date: "2026-10-05",
  trace_png: TRACE,
  lieu: "Rixheim",
  consentement: true,
  ...extra,
});

describe("recueil du positionnement", () => {
  it("reprend les questions fixes de l'organisme puis celles du formateur", () => {
    const d = formulaireRecueil(["Votre contrainte horaire ?", "Un point à éclaircir ?"]);
    expect(d.champs).toHaveLength(FORMULAIRES["00-AVT"].champs.length + 2);
    expect(d.champs.at(-1)).toMatchObject({ id: "supp_2", type: "texte_long" });
  });

  it("ne garde que 10 questions supplémentaires non vides, de type texte", () => {
    const q = questionsSupplementaires({
      questions_supplementaires: [...Array.from({ length: 14 }, (_, i) => `Q${i}`), "  ", 7],
    });
    expect(q).toHaveLength(10);
    expect(questionsSupplementaires(null)).toEqual([]);
    expect(questionsSupplementaires({ questions_supplementaires: "x" })).toEqual([]);
  });
});

describe("état du lien (jeton)", () => {
  const maintenant = new Date("2026-10-05T10:00:00Z");
  const base = { statut: "envoye", archive_le: null, expire_le: "2026-10-20T10:00:00Z" };
  it("valide tant que l'échéance n'est pas passée", () => {
    expect(etatDuLien(base, maintenant)).toBe("valide");
  });
  it("jeton inconnu ou positionnement archivé : invalide, sans distinction", () => {
    expect(etatDuLien(null, maintenant)).toBe("invalide");
    expect(etatDuLien({ ...base, archive_le: "2026-10-01T00:00:00Z" }, maintenant)).toBe(
      "invalide",
    );
  });
  it("lien échu : expiré, y compris à la seconde pile", () => {
    expect(etatDuLien({ ...base, expire_le: "2026-10-05T10:00:00Z" }, maintenant)).toBe("expire");
    expect(etatDuLien({ ...base, expire_le: "2026-09-01T00:00:00Z" }, maintenant)).toBe("expire");
  });
  it("un positionnement complet reste consultable après l'échéance", () => {
    expect(
      etatDuLien({ ...base, statut: "complet", expire_le: "2026-09-01T00:00:00Z" }, maintenant),
    ).toBe("valide");
  });
  it("le lien vaut 30 jours", () => {
    expect(DUREE_LIEN_POSITIONNEMENT_MS).toBe(30 * 24 * 3600 * 1000);
  });
});

describe("dates", () => {
  it("date du jour à Paris (et non en UTC)", () => {
    expect(dateIsoParis(new Date("2026-10-05T22:30:00Z"))).toBe("2026-10-06");
    expect(dateIsoParis(new Date("2026-10-05T10:00:00Z"))).toBe("2026-10-05");
  });
  it("refuse un jour qui n'existe pas", () => {
    expect(estDateIso("2026-10-05")).toBe(true);
    expect(estDateIso("2026-02-30")).toBe(false);
    expect(estDateIso("05/10/2026")).toBe(false);
  });
});

describe("brouillon", () => {
  it("accepte un brouillon partiel et le normalise", () => {
    const r = validerBrouillon({ recueil: { attentes: "x" }, reponses: [1, null] });
    expect(r).toEqual({
      ok: true,
      valeur: { recueil: { attentes: "x" }, reponses: [1, null], date: "" },
    });
    expect(validerBrouillon({})).toEqual({
      ok: true,
      valeur: { recueil: {}, reponses: [], date: "" },
    });
  });
  it("refuse les formes illisibles", () => {
    expect(validerBrouillon({ recueil: [] }).ok).toBe(false);
    expect(validerBrouillon({ recueil: { a: 3 } }).ok).toBe(false);
    expect(validerBrouillon({ reponses: [9] }).ok).toBe(false);
    expect(validerBrouillon({ reponses: [1.5] }).ok).toBe(false);
    expect(validerBrouillon({ reponses: new Array(41).fill(0) }).ok).toBe(false);
    expect(validerBrouillon({ recueil: { a: "x".repeat(4001) } }).ok).toBe(false);
    expect(validerBrouillon({ date: "2026-10-05T00" }).ok).toBe(false);
  });
});

describe("signature : contrôle et score", () => {
  it("accepte une signature complète", () => {
    const r = validerSignature(signature(), def, TEST);
    expect(r.ok).toBe(true);
  });

  it("le score est calculé par le serveur sur les bonnes réponses du questionnaire figé", () => {
    expect(corriger(TEST, [1, 0, 3, 1]).score).toBe(100);
    expect(corriger(TEST, [1, 0, 0, 0]).score).toBe(50);
    expect(corriger(TEST, [0, 1, 0, 0]).score).toBe(0);
    expect(corriger(TEST, [1, null, null, null]).score).toBe(25);
  });

  it("exige toutes les réponses du test, dans les bornes des propositions", () => {
    for (const reponses of [
      [1, 0, 3],
      [1, 0, 3, null],
      [1, 0, 3, 2],
      [5, 0, 3, 1],
    ]) {
      const r = validerSignature(signature({ reponses }), def, TEST);
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.erreurs).toContain("Test de positionnement : répondez à toutes les questions.");
    }
  });

  it("exige le recueil, la date, le lieu, le tracé et le consentement", () => {
    const r = validerSignature(
      signature({ recueil: {}, date: "", lieu: " ", trace_png: "x", consentement: false }),
      def,
      TEST,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.some((e) => e.startsWith("Recueil —"))).toBe(true);
      expect(r.erreurs).toContain("Indiquez la date.");
      expect(r.erreurs).toContain("Le lieu de signature est obligatoire.");
      expect(r.erreurs).toContain("Le consentement à la signature électronique est obligatoire.");
      expect(r.champs["attentes"]).toBeDefined();
    }
  });

  it("refuse un champ de recueil inconnu et un faux jour", () => {
    expect(
      validerSignature(signature({ recueil: { ...RECUEIL_OK, intrus: "x" } }), def, TEST).ok,
    ).toBe(false);
    expect(validerSignature(signature({ date: "2026-02-30" }), def, TEST).ok).toBe(false);
  });

  it("sans test au parcours, seul le recueil est contrôlé", () => {
    expect(validerSignature(signature({ reponses: [] }), def, null).ok).toBe(true);
  });
});

describe("le corrigé ne sort pas", () => {
  it("sansCorrige retire toute bonne réponse, même ajoutée au modèle", () => {
    const avecExtra = {
      ...TEST,
      questions: TEST.questions.map((q) => ({ ...q, explication: "secret" })),
    } as Questionnaire;
    const json = JSON.stringify(sansCorrige(avecExtra));
    expect(json).not.toContain("bonne_reponse");
    expect(json).not.toContain("explication");
    expect(json).toContain("Q1");
  });
});

describe("égalité profonde", () => {
  it("ne dépend pas de l'ordre des clés", () => {
    expect(egalProfond({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(egalProfond({ a: 1 }, { a: 2 })).toBe(false);
    expect(egalProfond([1, 2], [2, 1])).toBe(false);
    expect(egalProfond({ a: undefined }, { b: undefined })).toBe(false);
    expect(egalProfond(null, {})).toBe(false);
  });
});

describe("reprise dans un dossier", () => {
  const signe = (id: string, stagiaire: string, q: unknown, date: string) => ({
    id,
    stagiaire_id: stagiaire,
    questionnaire: q,
    recueil: { attentes: "A", supp_1: "question du formateur" },
    reponses: [1, 0, 3, 1],
    score: 100,
    signe_le: date,
  });

  it("reprend le recueil sans les questions du formateur, et le test s'il est identique", () => {
    const [e] = planReprise([signe("p1", "s1", TEST, "2026-10-01T09:00:00Z")], ["s1"], {
      questions: TEST.questions,
      titre: TEST.titre,
    });
    expect(e).toMatchObject({
      positionnement_id: "p1",
      stagiaire_id: "s1",
      recueil: { attentes: "A" },
      reprendre_test: true,
      reponses: [1, 0, 3, 1],
      signe_le: "2026-10-01",
    });
    expect(e!.recueil).not.toHaveProperty("supp_1");
  });

  it("ne reprend PAS le test si le questionnaire du dossier diffère, même d'une proposition", () => {
    const autre: Questionnaire = {
      ...TEST,
      questions: TEST.questions.map((q, i) =>
        i === 0 ? { ...q, propositions: ["a", "b", "d"] } : q,
      ),
    };
    const [e] = planReprise([signe("p1", "s1", TEST, "2026-10-01T09:00:00Z")], ["s1"], autre);
    expect(e!.reprendre_test).toBe(false);
    expect(e!.reponses).toBeNull();
    expect(e!.recueil).toEqual({ attentes: "A" });
  });

  it("ne reprend pas le test si le dossier n'en a pas ou si la bonne réponse a changé", () => {
    expect(
      planReprise([signe("p1", "s1", TEST, "2026-10-01T09:00:00Z")], ["s1"], null)[0]!
        .reprendre_test,
    ).toBe(false);
    const autre = { ...TEST, questions: TEST.questions.map((q) => ({ ...q, bonne_reponse: 0 })) };
    expect(
      planReprise([signe("p1", "s1", TEST, "2026-10-01T09:00:00Z")], ["s1"], autre)[0]!
        .reprendre_test,
    ).toBe(false);
  });

  it("prend le positionnement signé le plus récent de chaque inscrit et ignore les autres stagiaires", () => {
    const plan = planReprise(
      [
        signe("ancien", "s1", TEST, "2026-09-01T09:00:00Z"),
        signe("recent", "s1", TEST, "2026-10-01T09:00:00Z"),
        signe("autre", "s9", TEST, "2026-10-02T09:00:00Z"),
      ],
      ["s1", "s2"],
      TEST,
    );
    expect(plan.map((e) => e.positionnement_id)).toEqual(["recent"]);
  });
});
