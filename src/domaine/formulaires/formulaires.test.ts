import { describe, expect, it } from "vitest";
import { FORMULAIRES, moyenneNotes, validerReponses } from "./definitions";
import { corriger, sansCorrige, validerQuestionnaire, type Questionnaire } from "./qcm";
import { zoneGrilleNotes, zoneQcm, zoneReponses, zoneSynthesePositionnement } from "../gabarits/zones";

const qcm: Questionnaire = {
  titre: "Positionnement Excel",
  questions: [
    {
      enonce: "Que fait RECHERCHEV ?",
      propositions: ["Une recherche verticale", "Un tri", "Un graphique"],
      bonne_reponse: 0,
    },
    {
      enonce: "Un TCD sert à…",
      propositions: ["Mettre en page", "Synthétiser des données"],
      bonne_reponse: 1,
    },
    { enonce: "Raccourci pour annuler ?", propositions: ["Ctrl+Z", "Ctrl+Y"], bonne_reponse: 0 },
  ],
};

describe("formulaires à questions fixes", () => {
  it("exige les réponses obligatoires du recueil des besoins", () => {
    const erreurs = validerReponses(FORMULAIRES["00-AVT"], { attentes: "Gagner du temps" });
    expect(Object.keys(erreurs).sort()).toEqual([
      "besoins_principaux",
      "handicap",
      "niveau_maitrise",
      "poste_anciennete",
      "programme_transmis",
    ]);
  });

  it("refuse une note hors échelle, un choix non proposé et un champ inconnu", () => {
    const base = Object.fromEntries(
      FORMULAIRES["08-FIN"].champs.filter((c) => c.type === "note").map((c) => [c.id, "4"]),
    );
    expect(validerReponses(FORMULAIRES["08-FIN"], base)).toEqual({});
    expect(validerReponses(FORMULAIRES["08-FIN"], { ...base, contenu: "6" }).contenu).toMatch(/entre 1 et 5/);
    expect(validerReponses(FORMULAIRES["08-FIN"], { ...base, contenu: "3.5" }).contenu).toBeDefined();
    expect(validerReponses(FORMULAIRES["08-FIN"], { ...base, pirate: "x" }).pirate).toBe("Champ inconnu");
    expect(
      validerReponses(FORMULAIRES["00-AVT"], { niveau_maitrise: "Expert mondial" }).niveau_maitrise,
    ).toBe("Choix non proposé");
  });

  it("reprend les dix critères de la grille à chaud de l'organisme, notés de 1 à 5", () => {
    expect(FORMULAIRES["08-FIN"].champs.filter((c) => c.type === "note")).toHaveLength(10);
  });

  it("calcule la note moyenne", () => {
    expect(
      moyenneNotes(FORMULAIRES["12-APR"], {
        pratique: "5",
        effets: "4",
        mobilisation: "4",
        accompagnement: "3",
        recommandation: "5",
      }),
    ).toBe(4.2);
    expect(moyenneNotes(FORMULAIRES["12-APR"], {})).toBeNull();
  });
});

describe("questionnaires à choix multiples", () => {
  it("valide la structure d'un modèle", () => {
    expect(validerQuestionnaire(qcm)).toEqual([]);
    const erreurs = validerQuestionnaire({
      titre: " ",
      questions: [{ enonce: "", propositions: ["a", "a"], bonne_reponse: 5 }],
    });
    expect(erreurs).toHaveLength(4);
    expect(validerQuestionnaire({ titre: "T", questions: [] })).toEqual([
      "Le questionnaire doit comporter au moins une question.",
    ]);
  });

  it("corrige une copie ; une question sans réponse est fausse", () => {
    expect(corriger(qcm, [0, 1, 1])).toEqual({ bonnes: 2, total: 3, score: 67, detail: [true, true, false] });
    expect(corriger(qcm, [0, null]).bonnes).toBe(1);
  });

  it("ne livre jamais le corrigé à l'apprenant", () => {
    expect(JSON.stringify(sansCorrige(qcm))).not.toContain("bonne_reponse");
  });
});

describe("zones HTML", () => {
  it("échappe les réponses libres", () => {
    const html = zoneReponses(FORMULAIRES["00-AVT"], { attentes: "<b>tout</b>\nvite" });
    expect(html).toContain("&lt;b&gt;tout&lt;/b&gt;<br>vite");
    expect(html).not.toContain("<b>tout");
  });

  it("rend la grille de notes avec sa moyenne", () => {
    const html = zoneGrilleNotes(FORMULAIRES["12-APR"], {
      pratique: "5",
      effets: "5",
      mobilisation: "5",
      accompagnement: "5",
      recommandation: "5",
    });
    expect(html).toContain("Note moyenne");
    expect(html).toContain("5 / 5");
    expect(html.match(/●/g)).toHaveLength(5);
  });

  it("n'affiche les bonnes réponses d'un QCM que sur une copie corrigée", () => {
    expect(zoneQcm(qcm)).not.toContain("bonne réponse");
    const corrige = zoneQcm(qcm, [0, 0, 0]);
    expect(corrige).toContain("bonne réponse");
    expect(corrige).toContain("2 bonne(s) réponse(s) sur 3 — 67 / 100");
    expect(zoneSynthesePositionnement(qcm, [0, 1, 0])).toContain("100 / 100");
    expect(zoneSynthesePositionnement(null)).toContain("non encore renseigné");
  });
});
