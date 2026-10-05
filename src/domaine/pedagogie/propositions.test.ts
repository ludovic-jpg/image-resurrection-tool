/**
 * IA de l'espace pédagogique : la réponse de l'IA est validée strictement, et jamais « réparée » en silence.
 */
import { describe, expect, it } from "vitest";
import {
  consigneDiapos,
  consigneEnjeux,
  consigneParcours,
  consigneProgramme,
  consigneQcm,
  decrireEnjeux,
  extraireJson,
  validerPropositionEnjeux,
  validerPropositionParcours,
  validerPropositionProgramme,
  validerPropositionQcm,
  type ContexteFormation,
  type DossierEnjeux,
} from "./propositions";

const FORMATION: ContexteFormation = {
  formation_titre: "Excel — tableaux croisés dynamiques",
  formation_objectifs: "Construire un TCD.\nAutomatiser un reporting.",
  formation_niveau: "Intermédiaire",
  formation_prerequis: "Bases d'Excel",
  public_vise: "Assistants de gestion",
  programme: "Jour 1 — TCD.\nJour 2 — Automatisation.",
  formation_duree_heures_total: 14,
};

const ENJEUX: DossierEnjeux = {
  resume:
    "Les tableaux croisés dynamiques sont l'outil central de synthèse d'Excel ; leur maîtrise conditionne la fiabilité du reporting.",
  enjeux: [
    "Fiabiliser le reporting mensuel",
    "Réduire le temps de production des tableaux de bord",
  ],
  cadre: ["Aucune obligation réglementaire ; bonnes pratiques Microsoft"],
  notions_cles: ["Tableau croisé dynamique", "Segments", "Power Query"],
  erreurs_frequentes: ["Confondre valeurs et étiquettes de lignes"],
  pratiques_actuelles: ["Power Query pour l'import"],
  public_vise: "Assistants de gestion et comptables.",
  prerequis: "Formules simples et mise en forme.",
  glossaire: [{ terme: "TCD", definition: "Tableau croisé dynamique" }],
  sources: [{ titre: "Support Microsoft", url: "https://support.microsoft.com/fr-fr/excel" }],
};

const question = (i: number) => ({
  enonce: `Question ${i} ?`,
  propositions: ["A", "B", "C", "D"],
  bonne_reponse: i % 4,
});
const qcm = (n: number) => ({
  titre: "Positionnement Excel",
  questions: Array.from({ length: n }, (_, i) => question(i)),
});

describe("consignes envoyées à l'IA", () => {
  it("décrivent la formation, le nombre exact de questions et le schéma JSON attendu", () => {
    const c = consigneQcm(FORMATION, "positionnement", 10);
    expect(c).toContain("Exactement 10 questions");
    expect(c).toContain("Excel — tableaux croisés dynamiques");
    expect(c).toContain("indicateur Qualiopi n° 8");
    expect(consigneQcm(FORMATION, "acquis", 5)).toContain("n° 11");
  });

  it("ne transmettent que la description de la formation : aucune donnée d'apprenant, d'entreprise ni de prix", () => {
    const c = consigneProgramme(FORMATION);
    for (const interdit of ["stagiaire", "SIRET", "€", "prix"])
      expect(c.toLowerCase()).not.toContain(interdit.toLowerCase());
  });

  it("version 7 : la consigne d'enjeux demande une recherche web, le schéma du dossier et ses sources", () => {
    const c = consigneEnjeux({
      titre: "Habilitation électrique BS-BE manœuvre",
      niveau: "Débutant",
      heures: 14,
      modalite: "presentiel",
    });
    expect(c).toContain("recherche web");
    expect(c).toContain('"notions_cles"');
    expect(c).toContain('"sources"');
    expect(c).toContain("Habilitation électrique BS-BE manœuvre");
    expect(c).toContain("14 h");
  });

  it("version 7 : le dossier d'enjeux est injecté dans les consignes de parcours, de QCM et de diapositives", () => {
    const parcours = consigneParcours(
      { titre: "Excel", heures: 14, jours: 2, nb_modules: 3 },
      [5, 4.5, 4.5],
      ENJEUX,
    );
    expect(parcours).toContain("DOSSIER D'ENJEUX");
    expect(parcours).toContain("Power Query");
    expect(parcours).toContain("module 1 = 5 h, module 2 = 4,5 h, module 3 = 4,5 h");
    expect(parcours).toContain('"public_vise"');
    expect(consigneQcm({ ...FORMATION, enjeux: ENJEUX }, "acquis", 5)).toContain(
      "Confondre valeurs et étiquettes de lignes",
    );
    const module = {
      titre: "TCD",
      duree_heures: 5,
      objectifs: ["Construire un TCD"],
      contenus: ["Champs"],
      methodes: "",
      mise_en_pratique: "",
      evaluation: "",
    };
    expect(consigneDiapos({ ...FORMATION, enjeux: ENJEUX }, module, 1)).toContain("Segments");
    expect(decrireEnjeux(null)).toBe("");
    expect(consigneQcm(FORMATION, "acquis", 5)).not.toContain("DOSSIER D'ENJEUX");
  });
});

describe("validation d'un dossier d'enjeux proposé (version 7)", () => {
  it("accepte un dossier conforme et y ajoute les sources relevées par la recherche web, sans doublon", () => {
    const r = validerPropositionEnjeux(ENJEUX, [
      { titre: "Support Microsoft", url: "https://support.microsoft.com/fr-fr/excel" },
      { titre: "Doc Power Query", url: "https://learn.microsoft.com/power-query" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valeur.sources.map((x) => x.url)).toEqual([
        "https://support.microsoft.com/fr-fr/excel",
        "https://learn.microsoft.com/power-query",
      ]);
      expect(r.valeur.notions_cles).toEqual([
        "Tableau croisé dynamique",
        "Segments",
        "Power Query",
      ]);
    }
  });

  it("refuse un résumé trop court, moins de deux enjeux ou moins de trois notions clés — sans « réparer »", () => {
    expect(validerPropositionEnjeux({ ...ENJEUX, resume: "Court." })).toMatchObject({
      ok: false,
      erreurs: [expect.stringContaining("résumé")],
    });
    expect(validerPropositionEnjeux({ ...ENJEUX, enjeux: ["Un seul"] }).ok).toBe(false);
    expect(validerPropositionEnjeux({ ...ENJEUX, notions_cles: ["A", "B"] }).ok).toBe(false);
    expect(validerPropositionEnjeux(null).ok).toBe(false);
    expect(validerPropositionEnjeux("texte").ok).toBe(false);
  });

  it("ignore les sources sans adresse http(s)", () => {
    const r = validerPropositionEnjeux({
      ...ENJEUX,
      sources: [
        { titre: "Bidon", url: "javascript:alert(1)" },
        { titre: "OK", url: "http://exemple.example" },
      ],
    });
    expect(r.ok && r.valeur.sources).toEqual([{ titre: "OK", url: "http://exemple.example" }]);
  });
});

describe("validation d'un parcours proposé (version 7)", () => {
  const module = (i: number) => ({
    titre: `Module ${i}`,
    objectifs: ["Construire un TCD"],
    contenus: ["Champs"],
    methodes: "Apports",
    mise_en_pratique: "Atelier",
    evaluation: "Quiz",
    duree_heures: 99,
  });

  it("impose les durées de la plateforme et renvoie public visé et prérequis pour la convention", () => {
    const r = validerPropositionParcours(
      {
        objectifs: ["A faire", "B faire", "C faire"],
        public_vise: "  Assistants de gestion. ",
        prerequis: "Bases d'Excel.",
        modules: [module(1), module(2)],
      },
      [4, 3],
    );
    expect(r).toMatchObject({
      ok: true,
      valeur: { public_vise: "Assistants de gestion.", prerequis: "Bases d'Excel." },
    });
    if (r.ok) expect(r.valeur.modules.map((m) => m.duree_heures)).toEqual([4, 3]);
  });

  it("public visé et prérequis absents valent chaîne vide ; nombre de modules ou d'objectifs erroné = refus", () => {
    const ok = validerPropositionParcours(
      { objectifs: ["A", "B", "C"], modules: [module(1)] },
      [7],
    );
    expect(ok).toMatchObject({ ok: true, valeur: { public_vise: "", prerequis: "" } });
    expect(
      validerPropositionParcours({ objectifs: ["A", "B", "C"], modules: [module(1)] }, [4, 3]),
    ).toMatchObject({ ok: false, erreurs: [expect.stringContaining("au lieu de 2")] });
    expect(validerPropositionParcours({ objectifs: ["A"], modules: [module(1)] }, [7]).ok).toBe(
      false,
    );
  });
});

describe("validation d'un QCM proposé", () => {
  it("accepte un QCM conforme", () => {
    expect(validerPropositionQcm(qcm(10), 10)).toMatchObject({
      ok: true,
      valeur: { titre: "Positionnement Excel" },
    });
  });

  it("refuse un nombre de questions différent de celui demandé", () => {
    expect(validerPropositionQcm(qcm(9), 10)).toMatchObject({
      ok: false,
      erreurs: [expect.stringContaining("9 questions au lieu de 10")],
    });
  });

  it("refuse une bonne réponse hors des propositions, ou des propositions en double", () => {
    const hors = qcm(3);
    hors.questions[1]!.bonne_reponse = 7;
    expect(validerPropositionQcm(hors, 3).ok).toBe(false);
    const doublon = qcm(3);
    doublon.questions[0]!.propositions = ["A", "A", "C", "D"];
    expect(validerPropositionQcm(doublon, 3).ok).toBe(false);
  });

  it("refuse une réponse qui ne suit pas le schéma", () => {
    expect(validerPropositionQcm(null, 3).ok).toBe(false);
    expect(validerPropositionQcm({ questions: "non" }, 3).ok).toBe(false);
  });
});

describe("validation d'une proposition d'objectifs et de programme", () => {
  it("rend les objectifs « un par ligne », sans puces ni numéros", () => {
    const r = validerPropositionProgramme({
      objectifs: ["1. Construire un TCD", "- Automatiser un reporting", "• Fiabiliser ses données"],
      programme: "Jour 1 — Tableaux croisés dynamiques et segments.",
    });
    expect(r).toEqual({
      ok: true,
      valeur: {
        formation_objectifs: "Construire un TCD\nAutomatiser un reporting\nFiabiliser ses données",
        programme: "Jour 1 — Tableaux croisés dynamiques et segments.",
      },
    });
  });

  it("refuse moins de trois objectifs, ou un programme vide", () => {
    expect(
      validerPropositionProgramme({
        objectifs: ["Un seul"],
        programme: "Jour 1 — Tableaux croisés dynamiques.",
      }).ok,
    ).toBe(false);
    expect(validerPropositionProgramme({ objectifs: ["A", "B", "C"], programme: "" }).ok).toBe(
      false,
    );
  });
});

describe("lecture de la réponse brute", () => {
  it("extrait le JSON, même entouré d'un bloc ```json", () => {
    expect(extraireJson('Voici :\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extraireJson('{"a": {"b": 2}}')).toEqual({ a: { b: 2 } });
  });

  it("tolère une virgule finale avant « } » ou « ] » (erreur fréquente de l'IA), et rien d'autre", () => {
    expect(extraireJson('{"a": [1, 2,], "b": 3,}')).toEqual({ a: [1, 2], b: 3 });
    expect(extraireJson('{"a": 1, "a" 2}')).toBeNull();
  });

  it("retourne null plutôt que de deviner", () => {
    expect(extraireJson("pas de JSON ici")).toBeNull();
    expect(extraireJson('{"a": 1')).toBeNull();
  });
});
