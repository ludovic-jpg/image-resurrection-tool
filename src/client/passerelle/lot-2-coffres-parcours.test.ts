// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VueCoffre } from "../api";
import { connecter, echec, type FausseBd } from "./lot-2-faux-bd";

vi.mock("../bd", async () => ({ bd: (await import("./lot-2-faux-bd")).creerFausseBd() }));
const { bd } = (await import("../bd")) as unknown as { bd: FausseBd };
const { aiguiller } = await import("../aiguilleur");

const formation = {
  id: "f-1",
  formation_titre: "Excel & VBA",
  formation_duree_heures_total: 7,
  formation_niveau: "Débutant",
  formation_objectifs: "Savoir faire un tableau",
  formation_prerequis: "",
  formation_duree_jours: 1,
  formation_modalite: "presentiel",
  formation_effectif_min: null,
  formation_effectif_max: null,
  formation_prix_unitaire_ht: 90000,
  formation_prix_groupe_ht: null,
  mode_financement: "opco",
  formation_opco: "",
  formation_delai_acces: "",
  formation_accessibilite: "",
  formation_moyens_pedagogiques: "",
  formation_modalites_evaluation: "",
  formation_modalites_sanction: "",
  public_vise: "",
  programme: "",
  formation_modules: [
    {
      titre: "Bases",
      duree_heures: 7,
      objectifs: ["a"],
      contenus: ["b"],
      methodes: "",
      mise_en_pratique: "",
      evaluation: "",
    },
  ],
};

beforeEach(() => bd.reinitialiser());
afterEach(() => expect(bd.ecrituresInterdites()).toEqual([]));

const ops = (table: string, i = 0) => bd.operations(bd.surTable(table)[i]!);

describe("route 50 — GET /coffres-parcours", () => {
  const cartes = [
    {
      id: "f-1",
      formation_titre: "Excel",
      formateur: "Formatrice Démo",
      modules: 1,
      heures: 7,
      pedagogique: 3,
      administratif: 1,
      dossiers: 2,
      positionnements_signes: 1,
      positionnements_attente: 0,
    },
  ];

  it("renvoie les agrégats de la RPC s4m_coffres_parcours()", async () => {
    connecter(bd, "formatrice");
    bd.rpcReponse("s4m_coffres_parcours", { data: cartes });
    expect(await aiguiller("GET", "/coffres-parcours")).toEqual(cartes);
    expect(bd.rpc).toHaveBeenCalledWith("s4m_coffres_parcours");
  });

  it("est ouvert à l'admin ; liste vide si la RPC ne renvoie rien", async () => {
    connecter(bd, "admin");
    bd.rpcReponse("s4m_coffres_parcours", { data: null });
    expect(await aiguiller("GET", "/coffres-parcours")).toEqual([]);
  });

  it("refuse l'apprenant et le candidat non validé (403) sans appeler la RPC", async () => {
    for (const qui of ["apprenante", "candidat"] as const) {
      bd.reinitialiser();
      connecter(bd, qui);
      expect((await echec(aiguiller("GET", "/coffres-parcours"))).statut).toBe(403);
      expect(bd.rpc).not.toHaveBeenCalledWith("s4m_coffres_parcours");
    }
  });
});

describe("route 51 — GET /coffres-parcours/:id", () => {
  function programmer() {
    bd.reponses("formation", { data: formation });
    bd.reponses(
      "coffre_fichier:select",
      {
        data: [
          {
            id: "c-1",
            nom_fichier: "support.pptx",
            taille: 10,
            categorie: "support",
            description: "",
            origine: "depot",
            partageable: true,
            cree_le: "2026-10-01T10:00:00+00:00",
            supprime_le: null,
            chemin: "of-1/coffres/f-1/secret.pptx",
          },
        ],
      },
      { data: [] },
    );
    bd.reponses("modele_outil", {
      data: [
        { id: "o-1", type: "acquis", titre: "QCM", contenu: { questions: [1, 2] }, maj_le: "m" },
      ],
    });
    bd.reponses("positionnement_vue", {
      data: [
        {
          id: "p-1",
          apprenant: "Léa Martin",
          entreprise: "ACME",
          statut: "complet",
          score: 80,
          signe_le: "s",
          pdf: true,
          expire: false,
        },
      ],
    });
    bd.reponses("dossier_formation", {
      data: [
        {
          id: "d-1",
          dossier_reference: "ADF-2026-0001",
          sous_statut: "accord_financement",
          formation_date_debut: "2026-11-02",
          formation_date_fin: "2026-11-03",
          entreprise_cliente: { entreprise_nom: "ACME" },
        },
      ],
    });
    bd.reponses("piece_dossier", {
      data: [
        {
          id: "pi-1",
          dossier_id: "d-1",
          code: "PRG",
          stagiaire_id: null,
          statut: "valide",
          chemin_depart: "secret/chemin",
          chemin_retour: null,
        },
      ],
    });
    bd.reponses("stagiaire_dossier", {
      data: [
        {
          dossier_id: "d-1",
          stagiaire_id: "st-1",
          stagiaire: { stagiaire_prenom: "Léa", stagiaire_nom: "Martin" },
        },
      ],
    });
  }

  it("assemble la page du coffre (forme du service Node), formateur propriétaire", async () => {
    connecter(bd, "formatrice");
    programmer();
    const v = (await aiguiller("GET", "/coffres-parcours/f-1")) as VueCoffre;
    expect(Object.keys(v)).toEqual([
      "formation",
      "fichiers",
      "corbeille",
      "outils",
      "positionnements",
      "dossiers",
    ]);
    expect(v.formation).toMatchObject({
      id: "f-1",
      proprietaire: true,
      modules: [{ rang: 1, titre: "Bases", duree_heures: 7 }],
    });
    expect(v.fichiers).toHaveLength(1);
    expect(v.outils).toEqual([
      { id: "o-1", type: "acquis", titre: "QCM", questions: 2, maj_le: "m" },
    ]);
    expect(v.positionnements[0]).toMatchObject({ apprenant: "Léa Martin", statut: "complet" });
    expect(v.dossiers[0]).toMatchObject({
      reference: "ADF-2026-0001",
      entreprise: "ACME",
      statut: "Accord de financement",
      stagiaires: ["Léa Martin"],
      progression: { validees: 1, total: 1, disponibles: 1 },
    });
    expect(v.dossiers[0]!.pieces[0]).toMatchObject({ code: "PRG", depart: true, retour: false });
  });

  it("n'expose aucun chemin de stockage, empreinte ni jeton, et ne les demande pas", async () => {
    connecter(bd, "formatrice");
    programmer();
    const v = await aiguiller("GET", "/coffres-parcours/f-1");
    expect(JSON.stringify(v)).not.toMatch(/secret|chemin|empreinte|jeton/);
    const colonnes = [
      ops("piece_dossier")["select"]![0],
      ops("positionnement_vue")["select"]![0],
    ].join(",");
    expect(colonnes).not.toMatch(/empreinte|jeton|reponses|brouillon|signature_png|questionnaire/);
  });

  it("lit sous RLS : aucun filtre par formateur, un seul filtre par formation", async () => {
    connecter(bd, "formatrice");
    programmer();
    await aiguiller("GET", "/coffres-parcours/f-1");
    for (const t of ["modele_outil", "positionnement_vue", "dossier_formation"])
      expect(ops(t)["eq"]).toEqual(["formation_id", "f-1"]);
    for (const t of ["formation", "coffre_fichier", "modele_outil", "dossier_formation"])
      for (const appel of bd.surTable(t))
        expect(appel.operations.filter(([n, c]) => n === "eq" && c === "formateur_id")).toEqual([]);
  });

  it("n'a pas de corbeille pour l'admin, qui n'est pas propriétaire", async () => {
    connecter(bd, "admin");
    programmer();
    const v = (await aiguiller("GET", "/coffres-parcours/f-1")) as VueCoffre;
    expect(v.formation.proprietaire).toBe(false);
    expect(v.corbeille).toEqual([]);
    expect(bd.surTable("coffre_fichier")).toHaveLength(1);
  });

  it("ne lit ni pièces ni inscrits quand aucun dossier n'est ouvert sur le parcours", async () => {
    connecter(bd, "formatrice");
    programmer();
    bd.reponses("dossier_formation", { data: [] });
    const v = (await aiguiller("GET", "/coffres-parcours/f-1")) as VueCoffre;
    expect(v.dossiers).toEqual([]);
    expect(bd.surTable("piece_dossier")).toHaveLength(0);
    expect(bd.surTable("stagiaire_dossier")).toHaveLength(0);
  });

  it("répond 404 pour le parcours d'un autre formateur, 403 à l'apprenant sans rien lire", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: null });
    expect((await echec(aiguiller("GET", "/coffres-parcours/autre"))).statut).toBe(404);
    bd.reinitialiser();
    connecter(bd, "apprenante");
    expect((await echec(aiguiller("GET", "/coffres-parcours/f-1"))).statut).toBe(403);
    expect(bd.from).not.toHaveBeenCalled();
  });
});

describe("route 52 — GET /coffres-parcours/:id/programme", () => {
  it("produit le programme imprimable (HTML) avec le nom de l'organisme public", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: formation });
    bd.reponses("organisme_public", { data: { of_nom: "Skills4mation", couleur: "#1d6a45" } });
    const r = (await aiguiller("GET", "/coffres-parcours/f-1/programme")) as {
      nom: string;
      contenu: string;
      type_mime: string;
    };
    expect(r.nom).toBe("Programme - Excel & VBA.html");
    expect(r.type_mime).toBe("text/html; charset=utf-8");
    expect(r.contenu).toContain("Programme de formation — Skills4mation");
    expect(r.contenu).toContain("Excel &amp; VBA");
    expect(bd.surTable("organisme_formation")).toHaveLength(0); // jamais la table complète (IBAN…)
  });

  it("répond 404 pour un parcours qui n'est pas le sien et 403 à l'apprenant", async () => {
    connecter(bd, "formatrice");
    bd.reponses("formation", { data: null });
    expect((await echec(aiguiller("GET", "/coffres-parcours/autre/programme"))).statut).toBe(404);
    bd.reinitialiser();
    connecter(bd, "apprenante");
    expect((await echec(aiguiller("GET", "/coffres-parcours/f-1/programme"))).statut).toBe(403);
  });
});

describe("route 54 — GET /outils/:id/document", () => {
  const outil = {
    type: "acquis",
    titre: "Évaluation finale",
    formation_id: "f-1",
    contenu: {
      titre: "Évaluation finale",
      questions: [{ enonce: "Q1 ?", propositions: ["Oui", "Non"], bonne_reponse: 1 }],
    },
  };

  function programmer() {
    bd.reponses("modele_outil", { data: outil });
    bd.reponses("formation", { data: { formation_titre: "Excel" } });
    bd.reponses("organisme_public", { data: { of_nom: "Skills4mation", couleur: "#1d6a45" } });
  }

  it("produit le questionnaire SANS corrigé par défaut", async () => {
    connecter(bd, "formatrice");
    programmer();
    const r = (await aiguiller("GET", "/outils/o-1/document")) as { nom: string; contenu: string };
    expect(r.nom).toBe("Évaluation finale.html");
    expect(r.contenu).toContain("Q1 ?");
    expect(r.contenu).not.toContain("✔");
  });

  it("marque le corrigé avec ?corrige=1 (formateur propriétaire, admin)", async () => {
    for (const qui of ["formatrice", "admin"] as const) {
      bd.reinitialiser();
      connecter(bd, qui);
      programmer();
      const r = (await aiguiller("GET", "/outils/o-1/document?corrige=1")) as {
        nom: string;
        contenu: string;
      };
      expect(r.nom).toBe("Évaluation finale - corrige.html");
      expect(r.contenu).toContain("✔");
    }
  });

  it("refuse l'apprenant (403) sans rien lire : jamais de corrigé pour lui", async () => {
    connecter(bd, "apprenante");
    programmer();
    expect((await echec(aiguiller("GET", "/outils/o-1/document?corrige=1"))).statut).toBe(403);
    expect(bd.from).not.toHaveBeenCalled();
  });

  it("répond 404 pour l'outil d'un autre formateur", async () => {
    connecter(bd, "formatrice");
    bd.reponses("modele_outil", { data: null });
    const e = await echec(aiguiller("GET", "/outils/autre/document"));
    expect([e.statut, e.message]).toEqual([404, "Questionnaire introuvable."]);
  });
});
