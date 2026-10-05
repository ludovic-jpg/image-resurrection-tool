// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ModuleParcours } from "./parcours";
import { completerDepuisModules, controlerCoherence, resumer } from "./formation";

const module = (
  titre: string,
  duree: number,
  objectifs = [`Objectif de ${titre}`],
): ModuleParcours => ({
  titre,
  duree_heures: duree,
  objectifs,
  contenus: [`Contenu de ${titre}`],
  methodes: "",
  mise_en_pratique: "",
  evaluation: "",
});

describe("controlerCoherence", () => {
  it("accepte une formation cohérente", () => {
    expect(
      controlerCoherence({
        formation_effectif_min: 2,
        formation_effectif_max: 8,
        formation_duree_heures_total: 7,
        formation_duree_heures_presentiel: 4,
        formation_duree_heures_distanciel: 3,
        formation_modules: [module("A", 3), module("B", 4)],
      }),
    ).toBeNull();
  });

  it("refuse un effectif maximum inférieur au minimum", () => {
    const r = controlerCoherence({ formation_effectif_min: 10, formation_effectif_max: 4 });
    expect(r?.message).toBe("L'effectif maximum doit être supérieur ou égal au minimum.");
    expect(r?.details.champs).toEqual({ formation_effectif_max: r?.message });
  });

  it("refuse présentiel + distanciel différents de la durée totale", () => {
    const r = controlerCoherence({
      formation_duree_heures_total: 7,
      formation_duree_heures_presentiel: 4,
      formation_duree_heures_distanciel: 2,
    });
    expect(r?.message).toBe("Présentiel + distanciel (6 h) doit égaler la durée totale (7 h).");
    expect(Object.keys(r?.details.champs ?? {})).toEqual(["formation_duree_heures_presentiel"]);
  });

  it("refuse une somme de modules différente de la durée totale", () => {
    const r = controlerCoherence({
      formation_duree_heures_total: 8,
      formation_modules: [module("A", 3), module("B", 4)],
    });
    expect(r?.message).toBe(
      "La somme des durées des modules (7 h) doit égaler la durée totale (8 h).",
    );
  });

  it("renvoie la liste d'erreurs d'un parcours incomplet, avant tout autre contrôle", () => {
    const r = controlerCoherence({
      formation_effectif_min: 10,
      formation_effectif_max: 4,
      formation_modules: [{ ...module("A", 3), objectifs: [] }],
    });
    expect(r?.message).toBe("Le parcours est incomplet.");
    expect(r?.details.erreurs).toEqual(["Module 1 : au moins un objectif."]);
    expect(r?.details.champs).toBeUndefined();
  });

  it("garde le premier message quand plusieurs champs sont fautifs", () => {
    const r = controlerCoherence({
      formation_effectif_min: 10,
      formation_effectif_max: 4,
      formation_duree_heures_total: 7,
      formation_duree_heures_presentiel: 1,
    });
    expect(r?.message).toBe("L'effectif maximum doit être supérieur ou égal au minimum.");
    expect(Object.keys(r?.details.champs ?? {})).toHaveLength(2);
  });
});

describe("completerDepuisModules", () => {
  const modules = [module("A", 3, ["Maîtriser A", "Savoir A2"]), module("B", 4)];

  it("ne touche à rien sans modules", () => {
    const v = { programme: "", formation_objectifs: "" };
    expect(completerDepuisModules(v)).toBe(v);
    expect(completerDepuisModules({ ...v, formation_modules: [] })).toEqual({
      ...v,
      formation_modules: [],
    });
  });

  it("déduit le nombre de modules, le programme et les objectifs quand ils sont vides", () => {
    const r = completerDepuisModules({
      formation_modules: modules,
      formation_nb_modules: null as number | null,
      programme: " ",
      formation_objectifs: "",
    });
    expect(r.formation_nb_modules).toBe(2);
    expect(r.programme).toContain("Module 1 — A (3 h)");
    expect(r.formation_objectifs.split("\n")).toEqual([
      "Maîtriser A",
      "Objectif de B",
      "Savoir A2",
    ]);
  });

  it("garde le programme et les objectifs que le formateur a réécrits", () => {
    const r = completerDepuisModules({
      formation_modules: modules,
      formation_nb_modules: null as number | null,
      programme: "Mon programme",
      formation_objectifs: "Mes objectifs",
    });
    expect(r.programme).toBe("Mon programme");
    expect(r.formation_objectifs).toBe("Mes objectifs");
    expect(r.formation_nb_modules).toBe(2);
  });
});

describe("resumer", () => {
  it("résume une formation : titre, durée, nombre de modules", () => {
    expect(
      resumer("formation", {
        formation_titre: "Excel",
        formation_duree_heures_total: 14,
        formation_modules: [{}, {}],
      }),
    ).toBe("Excel · 14 h · 2 module(s)");
    expect(resumer("formation", null)).toBe(" · — h · 0 module(s)");
  });

  it("résume un outil : titre et nombre de questions", () => {
    expect(resumer("outil", { titre: "QCM", contenu: { questions: [1, 2, 3] } })).toBe(
      "QCM · 3 question(s)",
    );
    expect(resumer("outil", { titre: "Recueil", contenu: {} })).toBe("Recueil · 0 question(s)");
  });
});
