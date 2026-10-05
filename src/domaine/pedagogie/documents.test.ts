// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  documentOutil as outilDuService,
  documentProgramme as programmeDuService,
} from "@/serveur/services/supports";
import { documentOutil, documentProgramme, type FormationImprimable } from "./documents";

const organisme = { nom: "Skills4mation", couleur: "#1d6a45" };

const formation: FormationImprimable = {
  formation_titre: "Conduite de réunion <efficace>",
  formation_objectifs: "Préparer une réunion\nAnimer & conclure",
  formation_niveau: "Intermédiaire",
  formation_prerequis: "Aucun",
  formation_duree_heures_total: 7.5,
  formation_duree_jours: 1.5,
  formation_modalite: "mixte",
  formation_effectif_min: 2,
  formation_effectif_max: 8,
  formation_prix_unitaire_ht: 90000,
  formation_prix_groupe_ht: 450000,
  mode_financement: "opco",
  formation_opco: "AKTO",
  formation_delai_acces: "Sous 1 semaine",
  formation_accessibilite: "Locaux accessibles",
  formation_moyens_pedagogiques: "Vidéoprojecteur",
  formation_modalites_evaluation: "QCM final",
  formation_modalites_sanction: "Attestation de fin de formation",
  public_vise: "Managers",
  programme: "Programme libre",
  formation_modules: [
    {
      titre: "Préparer",
      duree_heures: 3.5,
      objectifs: ["Cadrer l'objectif"],
      contenus: ["Ordre du jour", "Participants"],
      methodes: "Apports et ateliers",
      mise_en_pratique: "Jeu de rôle",
      evaluation: "Quiz",
    },
    {
      titre: "Animer",
      duree_heures: 4,
      objectifs: ["Tenir le temps", "Donner la parole"],
      contenus: ["Rôles"],
      methodes: "",
      mise_en_pratique: "",
      evaluation: "",
    },
  ],
};

const questionnaire = {
  titre: "Positionnement réunion",
  questions: [
    { enonce: "Qui anime ?", propositions: ["Le chef", "Le facilitateur"], bonne_reponse: 1 },
    { enonce: "Durée idéale ?", propositions: ["1 h", "3 h", "6 h"], bonne_reponse: 0 },
  ],
};

describe("documents imprimables (versions pures)", () => {
  it("le programme est identique, octet pour octet, à celui du service Node", () => {
    expect(documentProgramme(formation, organisme)).toBe(
      programmeDuService(formation as never, organisme),
    );
  });

  it("le programme sans module affiche le programme libre, comme le service", () => {
    const libre = { ...formation, formation_modules: [] };
    expect(documentProgramme(libre, organisme)).toBe(programmeDuService(libre as never, organisme));
    expect(documentProgramme(libre, organisme)).toContain("Programme détaillé");
  });

  it("échappe le HTML saisi par le formateur", () => {
    const html = documentProgramme(formation, organisme);
    expect(html).toContain("Conduite de réunion &lt;efficace&gt;");
    expect(html).not.toContain("<efficace>");
  });

  it("un questionnaire sans corrigé est identique à celui du service Node et ne révèle aucune bonne réponse", () => {
    const outil = { type: "positionnement", titre: questionnaire.titre, contenu: questionnaire };
    const html = documentOutil(outil, organisme, "Conduite de réunion");
    expect(html).toBe(outilDuService(outil as never, organisme, "Conduite de réunion"));
    expect(html).not.toContain("✔");
  });

  it("le corrigé marque la bonne réponse, comme le service Node", () => {
    const outil = { type: "acquis", titre: questionnaire.titre, contenu: questionnaire };
    const html = documentOutil(outil, organisme, null, true);
    expect(html).toBe(outilDuService(outil as never, organisme, null, true));
    expect(html.match(/✔/g)).toHaveLength(2);
    expect(html).toContain("CORRIGÉ (réservé au formateur)");
  });

  it("le recueil des besoins reprend les questions fixes et les questions supplémentaires", () => {
    const outil = {
      type: "recueil",
      titre: "Recueil",
      contenu: { questions_supplementaires: ["Une attente particulière ?"] },
    };
    const html = documentOutil(outil, organisme, null);
    expect(html).toBe(outilDuService(outil as never, organisme, null));
    expect(html).toContain("Une attente particulière ?");
  });

  it("la date du pied de page peut être fournie, pour un rendu reproductible", () => {
    const html = documentProgramme(formation, organisme, new Date(2026, 9, 5));
    expect(html).toContain(`version du ${new Date(2026, 9, 5).toLocaleDateString("fr-FR")}`);
  });
});
