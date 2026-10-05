import { describe, expect, it } from "vitest";
import { construireArchives } from "./vue";

describe("archives et corbeille", () => {
  const vue = construireArchives({
    formations: [{ id: "f1", formation_titre: "Excel", archivee_le: "2026-10-01T08:00:00+00:00" }],
    outils: [
      { id: "o1", titre: "QCM", type: "positionnement", archive_le: "2026-10-02T08:00:00+00:00" },
    ],
    fichiers: [
      {
        id: "c1",
        nom_fichier: "support.pdf",
        formation_id: "f1",
        supprime_le: "2026-10-03T08:00:00+00:00",
        taille: 1234,
      },
      {
        id: "c2",
        nom_fichier: "orphelin.pdf",
        formation_id: "inconnue",
        supprime_le: "2026-10-03T08:00:00+00:00",
        taille: 1,
      },
    ],
    formations_des_fichiers: [{ id: "f1", formation_titre: "Excel" }],
    stagiaires: [
      {
        id: "s1",
        stagiaire_prenom: "Anne",
        stagiaire_nom: "Martin",
        archive_le: "2026-10-04T08:00:00+00:00",
      },
    ],
    entreprises: [
      { id: "e1", entreprise_nom: "Dupont SARL", archive_le: "2026-10-05T08:00:00+00:00" },
    ],
    positionnements: [
      {
        id: "p1",
        apprenant: "Luc Petit",
        formation_titre: "Excel",
        archive_le: "2026-10-06T08:00:00+00:00",
      },
    ],
  });
  it("six listes, mêmes champs que l'ancien service", () => {
    expect(Object.keys(vue)).toEqual([
      "formations",
      "outils",
      "fichiers",
      "stagiaires",
      "entreprises",
      "positionnements",
    ]);
    expect(vue.formations).toEqual([
      { id: "f1", titre: "Excel", depuis: "2026-10-01T08:00:00+00:00" },
    ]);
    expect(vue.outils).toEqual([
      { id: "o1", titre: "QCM", type: "positionnement", depuis: "2026-10-02T08:00:00+00:00" },
    ]);
    expect(vue.fichiers).toEqual([
      {
        id: "c1",
        nom: "support.pdf",
        formation: "Excel",
        formation_id: "f1",
        depuis: "2026-10-03T08:00:00+00:00",
        taille: 1234,
      },
    ]);
    expect(vue.stagiaires).toEqual([
      { id: "s1", nom: "Anne Martin", depuis: "2026-10-04T08:00:00+00:00" },
    ]);
    expect(vue.entreprises).toEqual([
      { id: "e1", nom: "Dupont SARL", depuis: "2026-10-05T08:00:00+00:00" },
    ]);
    expect(vue.positionnements).toEqual([
      { id: "p1", nom: "Luc Petit — Excel", depuis: "2026-10-06T08:00:00+00:00" },
    ]);
  });
  it("un fichier dont la formation n'est pas lisible n'est pas listé (jointure interne de l'ancien service)", () => {
    expect(vue.fichiers.map((f) => f.id)).toEqual(["c1"]);
  });
});
