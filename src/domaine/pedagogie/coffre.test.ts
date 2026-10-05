// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assemblerCoffreParcours, type EntreesCoffreParcours } from "./coffre";

const entrees = (surcharge: Partial<EntreesCoffreParcours> = {}): EntreesCoffreParcours => ({
  formation: {
    id: "f1",
    formation_titre: "Excel",
    formation_duree_heures_total: 7,
    formation_niveau: "Débutant",
    formation_modules: [
      {
        titre: "Bases",
        duree_heures: 3,
        objectifs: ["a"],
        contenus: ["b"],
        methodes: "",
        mise_en_pratique: "",
        evaluation: "",
      },
    ],
  },
  proprietaire: true,
  fichiers: [
    {
      id: "c1",
      nom_fichier: "support.pptx",
      taille: 10,
      categorie: "support",
      description: "",
      origine: "depot",
      partageable: true,
      cree_le: "2026-10-01T10:00:00+00:00",
      supprime_le: null,
    },
  ],
  corbeille: [
    {
      id: "c2",
      nom_fichier: "vieux.pdf",
      taille: 5,
      categorie: "ressource",
      description: "",
      origine: "depot",
      partageable: false,
      cree_le: "2026-09-01T10:00:00+00:00",
      supprime_le: "2026-10-02T08:00:00+00:00",
    },
  ],
  outils: [
    {
      id: "o1",
      type: "positionnement",
      titre: "QCM",
      contenu: { questions: [1, 2, 3] },
      maj_le: "2026-10-03T09:00:00+00:00",
    },
    {
      id: "o2",
      type: "recueil",
      titre: "Recueil",
      contenu: { questions_supplementaires: ["x"] },
      maj_le: "m",
    },
  ],
  positionnements: [
    {
      id: "p1",
      apprenant: "Léa Martin",
      entreprise: "ACME",
      statut: "complet",
      score: 80,
      signe_le: "2026-10-04T09:00:00+00:00",
      pdf: true,
      expire: false,
    },
  ],
  dossiers: [
    {
      id: "d1",
      dossier_reference: "ADF-2026-0001",
      sous_statut: "accord_financement",
      formation_date_debut: "2026-11-02",
      formation_date_fin: "2026-11-03",
      entreprise_nom: "ACME",
    },
    {
      id: "d2",
      dossier_reference: "ADF-2026-0002",
      sous_statut: "brouillon",
      formation_date_debut: "",
      formation_date_fin: "",
      entreprise_nom: "Autre",
    },
  ],
  pieces: [
    {
      id: "pi1",
      dossier_id: "d1",
      code: "02-AVT",
      stagiaire_id: "s1",
      statut: "valide",
      chemin_depart: "x",
      chemin_retour: null,
    },
    {
      id: "pi2",
      dossier_id: "d1",
      code: "00-AVT",
      stagiaire_id: null,
      statut: "en_attente",
      chemin_depart: null,
      chemin_retour: null,
    },
    {
      id: "pi3",
      dossier_id: "d1",
      code: "CODE-INCONNU",
      stagiaire_id: null,
      statut: "valide",
      chemin_depart: "y",
      chemin_retour: "z",
    },
  ],
  inscrits: [
    { dossier_id: "d1", stagiaire_id: "s1", stagiaire_prenom: "Léa", stagiaire_nom: "Martin" },
  ],
  ...surcharge,
});

describe("assemblerCoffreParcours", () => {
  it("reproduit la forme du service : formation, fichiers, corbeille, outils, positionnements, dossiers", () => {
    const v = assemblerCoffreParcours(entrees());
    expect(Object.keys(v)).toEqual([
      "formation",
      "fichiers",
      "corbeille",
      "outils",
      "positionnements",
      "dossiers",
    ]);
    expect(v.formation).toEqual({
      id: "f1",
      formation_titre: "Excel",
      formation_duree_heures_total: 7,
      formation_niveau: "Débutant",
      modules: [{ rang: 1, titre: "Bases", duree_heures: 3 }],
      proprietaire: true,
    });
    expect(v.fichiers[0]).toEqual({
      id: "c1",
      nom_fichier: "support.pptx",
      taille: 10,
      categorie: "support",
      description: "",
      origine: "depot",
      partageable: true,
      cree_le: "2026-10-01T10:00:00+00:00",
    });
    expect(v.corbeille[0]).toEqual({
      id: "c2",
      nom_fichier: "vieux.pdf",
      taille: 5,
      categorie: "ressource",
      supprime_le: "2026-10-02T08:00:00+00:00",
    });
    expect(v.outils.map((o) => [o.id, o.questions])).toEqual([
      ["o1", 3],
      ["o2", 1],
    ]);
  });

  it("calcule la progression et le détail des pièces d'un dossier, sans jamais exposer de chemin ni d'empreinte", () => {
    const v = assemblerCoffreParcours(entrees());
    const d1 = v.dossiers[0]!;
    expect(d1).toMatchObject({
      reference: "ADF-2026-0001",
      entreprise: "ACME",
      statut: "Accord de financement",
      stagiaires: ["Léa Martin"],
      dates: "2026-11-02 → 2026-11-03",
      progression: { validees: 1, total: 2, disponibles: 1 },
    });
    expect(d1.pieces.map((p) => p.code)).toEqual(["00-AVT", "02-AVT"]);
    expect(d1.pieces.find((p) => p.code === "02-AVT")).toMatchObject({
      stagiaire: "Léa Martin",
      depart: true,
      retour: false,
      statut: "valide",
    });
    expect(JSON.stringify(v)).not.toMatch(/chemin|empreinte|jeton/);
    expect(v.dossiers[1]).toMatchObject({
      dates: "",
      progression: { validees: 0, total: 0, disponibles: 0 },
    });
  });

  it("ne garde des positionnements que les colonnes de suivi", () => {
    const [p] = assemblerCoffreParcours(
      entrees({
        positionnements: [
          { ...entrees().positionnements[0]!, jeton_hash: "secret", reponses: [1] } as never,
        ],
      }),
    ).positionnements;
    expect(Object.keys(p!).sort()).toEqual(
      ["apprenant", "entreprise", "expire", "id", "pdf", "score", "signe_le", "statut"].sort(),
    );
  });

  it("marque l'organisme comme non propriétaire", () => {
    expect(
      assemblerCoffreParcours(entrees({ proprietaire: false, corbeille: [] })).formation
        .proprietaire,
    ).toBe(false);
  });
});
