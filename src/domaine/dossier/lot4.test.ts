import { describe, expect, it } from "vitest";
import { definitionPiece } from "../referentiel/pieces";
import { aAtteint, SOUS_STATUTS, type SousStatut } from "../pipeline/statuts";
import { REGLES, type Action } from "../pipeline/transitions";
import { colonnesDeTransition } from "../pipeline/application";
import {
  MESSAGE_DOSSIER_FIGE,
  brouillonSupprimable,
  dossierModifiable,
  objectifsRenseignables,
  stagiairesModifiables,
} from "./droits";
import { cleCompteur, formaterNumero } from "./numerotation";
import { manquesAvantSoumission, type DossierASoumettre } from "./soumission";
import {
  CHAMPS_DOSSIER_MODIFIABLES,
  validerCreationDossier,
  validerListeStagiaires,
  validerSaisieDossier,
  validerSeances,
} from "./saisie";
import {
  choisirModele,
  reprisesDeLAncien,
  valeursInitialesDossier,
  type EntrepriseCreation,
  type FormationCatalogue,
} from "./creation";
import { documentsEnAttenteDe, heuresRealisees, vuePiece, type LignePieceBrute } from "./lecture";
import {
  CONFIG_EVALUATIONS,
  TYPES_EVALUATION,
  formulaireDe,
  questionnaireOuvert,
  statutFormulaire,
} from "./evaluations";

const STATUTS = SOUS_STATUTS.map((s) => s.cle) as SousStatut[];

describe("droits de modification d'un dossier", () => {
  it("le formateur modifie en brouillon seulement ; l'admin aussi pendant la validation ; jamais l'apprenant", () => {
    for (const s of STATUTS) {
      expect(dossierModifiable("formateur", s)).toBe(s === "brouillon");
      expect(dossierModifiable("admin", s)).toBe(s === "brouillon" || s === "en_cours_validation");
      expect(dossierModifiable("apprenant", s)).toBe(false);
    }
    expect(MESSAGE_DOSSIER_FIGE).toMatch(/pièces émises font foi/);
  });
  it("les apprenants du dossier et la suppression : formateur, brouillon, rien d'autre", () => {
    for (const s of STATUTS) {
      expect(stagiairesModifiables("formateur", s)).toBe(s === "brouillon");
      expect(brouillonSupprimable("formateur", s)).toBe(s === "brouillon");
      expect(stagiairesModifiables("admin", s)).toBe(false);
      expect(brouillonSupprimable("admin", s)).toBe(false);
    }
  });
  it("les objectifs atteints se renseignent tant que le dossier n'est pas terminal", () => {
    expect(objectifsRenseignables("formation_debutee")).toBe(true);
    expect(objectifsRenseignables("archive")).toBe(false);
    expect(objectifsRenseignables("refus_financement")).toBe(false);
  });
});

describe("numérotation", () => {
  it("ADF-2026-0001, FA et FF : un compteur par préfixe et par année", () => {
    expect(formaterNumero("ADF", 2026, 1)).toBe("ADF-2026-0001");
    expect(formaterNumero("FA", 2026, 123)).toBe("FA-2026-0123");
    expect(formaterNumero("FF", 2027, 12345)).toBe("FF-2027-12345");
    expect(cleCompteur("ADF", 2026)).toBe("ADF-2026");
  });
});

const COMPLET: DossierASoumettre = {
  formation_titre: "Soudure",
  formation_objectifs: "Souder",
  formation_programme: "Jour 1",
  formation_date_debut: "2026-11-02",
  formation_date_fin: "2026-11-03",
  formation_duree_heures_total: 14,
  formation_prix_unitaire_ht: 120000,
  formation_modalite: "presentiel",
  formation_lieu_adresse: "1 rue X",
  formation_lien_visio: "",
  signature_lieu: "Mulhouse",
};
const ENT = {
  entreprise_siret: "123",
  entreprise_representant_nom: "Durand",
  entreprise_representant_email: "d@x.fr",
};

describe("manques avant soumission (complète la garde RG-02)", () => {
  it("un dossier complet n'a aucun manque", () => {
    expect(manquesAvantSoumission(COMPLET, ENT, 2)).toEqual([]);
  });
  it("liste chaque champ manquant, dans l'ordre", () => {
    const vide: DossierASoumettre = {
      ...COMPLET,
      formation_titre: "",
      formation_objectifs: "",
      formation_programme: "",
      formation_date_debut: "",
      formation_duree_heures_total: null,
      formation_prix_unitaire_ht: null,
      formation_lieu_adresse: "",
      signature_lieu: "",
    };
    expect(manquesAvantSoumission(vide, {}, 0)).toEqual([
      "Intitulé de la formation",
      "Objectifs de la formation",
      "Programme détaillé de la formation (annexe de la convention)",
      "Dates de début et de fin",
      "Durée totale en heures",
      "Prix unitaire HT",
      "Au moins une séance au planning",
      "Adresse du lieu de formation",
      "Lieu de signature de la convention",
      "SIRET de l'entreprise",
      "Nom du représentant de l'entreprise",
      "E-mail du représentant de l'entreprise",
    ]);
  });
  it("date de fin avant le début ; lien visio requis hors présentiel ; adresse non requise en distanciel", () => {
    expect(
      manquesAvantSoumission({ ...COMPLET, formation_date_fin: "2026-10-01" }, ENT, 1),
    ).toEqual(["La date de fin précède la date de début"]);
    expect(manquesAvantSoumission({ ...COMPLET, formation_modalite: "mixte" }, ENT, 1)).toEqual([
      "Lien de connexion à distance",
    ]);
    expect(
      manquesAvantSoumission(
        {
          ...COMPLET,
          formation_modalite: "distanciel",
          formation_lieu_adresse: "",
          formation_lien_visio: "https://v.fr",
        },
        ENT,
        1,
      ),
    ).toEqual([]);
    expect(manquesAvantSoumission(COMPLET, null, 1)).toHaveLength(3);
  });
});

describe("validation de la création d'un dossier", () => {
  const ok = {
    stagiaire_ids: ["s1"],
    entreprise_id: "e1",
    formation_id: "f1",
    formation_modalite: "mixte",
    mode_financement: "opco",
  };
  it("accepte une demande complète", () => {
    expect(validerCreationDossier(ok)).toEqual({ ok: true, valeurs: ok });
  });
  it("refuse 0 apprenant, plus de 8, un doublon, des champs manquants ou inconnus", () => {
    const msg = (x: unknown) => {
      const r = validerCreationDossier(x);
      return r.ok ? null : r.message;
    };
    expect(msg({ ...ok, stagiaire_ids: [] })).toBe("Sélectionnez au moins un apprenant.");
    expect(msg({ ...ok, stagiaire_ids: Array.from({ length: 9 }, (_, i) => `s${i}`) })).toBe(
      "Un dossier compte 8 apprenants au plus.",
    );
    expect(msg({ ...ok, stagiaire_ids: ["s1", "s1"] })).toBe(
      "Un apprenant est sélectionné deux fois.",
    );
    expect(msg({ ...ok, entreprise_id: "" })).toBe("Sélectionnez l'entreprise.");
    expect(msg({ ...ok, formation_id: undefined })).toBe("Sélectionnez la formation.");
    expect(msg({ ...ok, formation_modalite: "x" })).toBe("Choisissez la modalité de la formation.");
    expect(msg({ ...ok, mode_financement: "x" })).toBe("Choisissez le mode de financement.");
    expect(msg(null)).toBe("Sélectionnez au moins un apprenant.");
  });
  it("la liste des apprenants d'un dossier compte de 1 à 8 distincts", () => {
    expect(validerListeStagiaires(["a", "b"]).ok).toBe(true);
    expect(validerListeStagiaires([]).ok).toBe(false);
    expect(validerListeStagiaires(["a", "a"]).ok).toBe(false);
    expect(validerListeStagiaires("a").ok).toBe(false);
  });
});

describe("validation de la saisie d'un dossier (PATCH)", () => {
  it("ne laisse passer que les champs de saisie : jamais le sous-statut, l'identité ni les dates d'étape", () => {
    const r = validerSaisieDossier({
      formation_titre: "  Nouveau titre ",
      sous_statut: "archive",
      of_id: "autre",
      formateur_id: "autre",
      dossier_reference: "ADF-0",
      coffre_ouvert: true,
      motif_renvoi: "x",
      motif_refus: "x",
      valide_le: "2026-01-01",
      termine_le: "2026-01-01",
      archive_le: "2026-01-01",
      maj_le: "2026-01-01",
    });
    expect(r).toEqual({ ok: true, valeurs: { formation_titre: "Nouveau titre" } });
    for (const interdit of [
      "sous_statut",
      "of_id",
      "formateur_id",
      "dossier_reference",
      "coffre_ouvert",
      "motif_renvoi",
      "motif_refus",
      "valide_le",
      "termine_le",
      "archive_le",
      "entreprise_id",
      "formateur_cout_horaire",
      "questionnaire_positionnement",
      "questionnaire_acquis",
    ])
      expect(CHAMPS_DOSSIER_MODIFIABLES).not.toContain(interdit);
  });
  it("applique les bornes et formats de l'ancien schéma", () => {
    const champs = (x: unknown) => {
      const r = validerSaisieDossier(x);
      return r.ok ? {} : r.champs;
    };
    expect(champs({ formation_date_debut: "02/11/2026" })).toHaveProperty("formation_date_debut");
    expect(champs({ formation_date_debut: "" })).toEqual({});
    expect(champs({ formation_prix_unitaire_ht: 1.5 })).toHaveProperty(
      "formation_prix_unitaire_ht",
    );
    expect(champs({ formation_prix_unitaire_ht: -1 })).toHaveProperty("formation_prix_unitaire_ht");
    expect(champs({ formation_prix_unitaire_ht: null })).toEqual({});
    expect(champs({ formation_duree_heures_total: 2001 })).toHaveProperty(
      "formation_duree_heures_total",
    );
    expect(champs({ formation_modalite: "hybride" })).toHaveProperty("formation_modalite");
    expect(champs({ mode_financement: "cpf" })).toHaveProperty("mode_financement");
    expect(champs({ formation_lien_visio: "pas un lien" })).toHaveProperty("formation_lien_visio");
    expect(champs({ formation_lien_visio: "javascript:alert(1)" })).toHaveProperty(
      "formation_lien_visio",
    );
    expect(champs({ formation_lien_visio: "https://visio.fr/x" })).toEqual({});
    expect(champs({ signature_lieu: "x".repeat(121) })).toHaveProperty("signature_lieu");
    expect(champs({ formation_titre: 12 })).toHaveProperty("formation_titre");
    expect(validerSaisieDossier(undefined)).toEqual({ ok: true, valeurs: {} });
  });
});

describe("validation du planning", () => {
  const s = { date: "2026-11-02", heure_debut: "09:00", heure_fin: "12:00" };
  it("accepte un planning valide et vide", () => {
    expect(validerSeances([s])).toEqual({ ok: true, valeurs: [s] });
    expect(validerSeances([])).toEqual({ ok: true, valeurs: [] });
  });
  it("refuse : pas un tableau, plus de 20 séances, formats, fin avant début", () => {
    expect(validerSeances("x").ok).toBe(false);
    expect(validerSeances(Array.from({ length: 21 }, () => s))).toMatchObject({ ok: false });
    expect(validerSeances([{ ...s, date: "2/11" }]).ok).toBe(false);
    expect(validerSeances([{ ...s, heure_debut: "9h" }]).ok).toBe(false);
    expect(validerSeances([{ ...s, heure_fin: "08:00" }])).toMatchObject({
      ok: false,
      message: "L'heure de fin doit suivre l'heure de début.",
    });
  });
});

const FORMATION: FormationCatalogue = {
  id: "f1",
  formation_titre: "Soudure",
  formation_objectifs: "O",
  formation_niveau: "N",
  formation_prerequis: "P",
  public_vise: "Tous",
  programme: "Prog",
  formation_duree_heures_total: 14,
  formation_duree_jours: 2,
  formation_duree_heures_presentiel: 10,
  formation_duree_heures_distanciel: 4,
  formation_lieu_nom: "",
  formation_lieu_adresse: "",
  formation_lieu_siret: "",
  formation_lien_visio: "https://visio.fr",
  formation_opco: "OPCO-F",
  formation_prix_unitaire_ht: 120000,
};
const ENTREPRISE: EntrepriseCreation = {
  id: "e1",
  entreprise_nom: "ACME",
  entreprise_adresse: "2 rue Y",
  entreprise_siret: "999",
  entreprise_opco: "",
};

describe("pré-remplissage d'un dossier (F-DOS-03)", () => {
  it("présentiel : lieu de l'entreprise (intra), heures reportées, pas de lien visio, financeur de la formation", () => {
    const v = valeursInitialesDossier({
      formation: FORMATION,
      entreprise: ENTREPRISE,
      modalite: "presentiel",
      financement: "opco",
    });
    expect(v).toMatchObject({
      formation_public_vise: "Tous",
      formation_programme: "Prog",
      formation_duree_heures_presentiel: 14,
      formation_duree_heures_distanciel: null,
      formation_lieu_nom: "ACME",
      formation_lieu_adresse: "2 rue Y",
      formation_lieu_siret: "999",
      formation_lien_visio: "",
      formation_opco: "OPCO-F",
      formation_prix_unitaire_ht: 120000,
      formateur_cout_horaire: null,
    });
  });
  it("distanciel : aucun lieu, lien visio ; mixte : répartition du catalogue ; financement direct : pas d'OPCO", () => {
    const d = valeursInitialesDossier({
      formation: FORMATION,
      entreprise: ENTREPRISE,
      modalite: "distanciel",
      financement: "entreprise",
    });
    expect(d).toMatchObject({
      formation_lieu_nom: "",
      formation_lieu_adresse: "",
      formation_lien_visio: "https://visio.fr",
      formation_duree_heures_distanciel: 14,
      formation_duree_heures_presentiel: null,
      formation_opco: "",
    });
    const m = valeursInitialesDossier({
      formation: {
        ...FORMATION,
        formation_lieu_nom: "Salle",
        formation_lieu_adresse: "3 rue Z",
        formation_lieu_siret: "777",
      },
      entreprise: { ...ENTREPRISE, entreprise_opco: "OPCO-E" },
      modalite: "mixte",
      financement: "faf",
    });
    expect(m).toMatchObject({
      formation_duree_heures_presentiel: 10,
      formation_duree_heures_distanciel: 4,
      formation_lieu_nom: "Salle",
      formation_lieu_siret: "777",
      formation_opco: "OPCO-E",
    });
  });
  it("le modèle d'outil de la formation prime, sinon le plus récent sans formation", () => {
    const modeles = [
      { formation_id: "autre", n: 1 },
      { formation_id: null, n: 2 },
      { formation_id: "f1", n: 3 },
    ];
    expect(choisirModele(modeles, "f1")?.n).toBe(3);
    expect(choisirModele(modeles.slice(0, 2), "f1")?.n).toBe(2);
    expect(choisirModele(modeles.slice(0, 1), "f1")).toBeNull();
  });
  it("la recréation reprend le lieu, le financeur, le prix et le lieu de signature, rien d'autre", () => {
    const r = reprisesDeLAncien({
      formation_lieu_nom: "A",
      formation_lieu_adresse: "B",
      formation_lieu_siret: "C",
      formation_lien_visio: "D",
      formation_opco: "E",
      signature_lieu: "F",
      formation_prix_unitaire_ht: 5,
      sous_statut: "refus_financement",
      motif_refus: "non",
    });
    expect(Object.keys(r).sort()).toEqual(
      [
        "formation_lieu_nom",
        "formation_lieu_adresse",
        "formation_lieu_siret",
        "formation_lien_visio",
        "formation_opco",
        "signature_lieu",
        "formation_prix_unitaire_ht",
      ].sort(),
    );
  });
});

const piece = (code: string, o: Partial<LignePieceBrute> = {}): LignePieceBrute => ({
  id: `p-${code}`,
  code,
  stagiaire_id: null,
  statut: "en_attente",
  mode_retour: null,
  retour_le: null,
  genere_le: null,
  transmise_le: null,
  chemin_retour: null,
  ...o,
});

describe("vue d'une pièce : ce que cet acteur peut faire (peut_signer, peut_deposer)", () => {
  it("l'apprenant signe ses pièces générées, sauf recueil, positionnement et satisfactions", () => {
    expect(vuePiece(piece("02-AVT"), "apprenant", true)).toMatchObject({
      peut_signer: true,
      peut_deposer: true,
    });
    for (const c of ["00-AVT", "01-AVT", "08-FIN", "12-APR"])
      expect(vuePiece(piece(c), "apprenant", true).peut_signer).toBe(false);
  });
  it("le formateur ne signe que l'ordre de mission ; il peut déposer l'émargement papier", () => {
    expect(vuePiece(piece("04-AVT"), "formateur", true).peut_signer).toBe(true);
    expect(vuePiece(piece("02-AVT"), "formateur", true).peut_signer).toBe(false);
    expect(vuePiece(piece("06-PDT"), "formateur", true)).toMatchObject({
      peut_signer: false,
      peut_deposer: true,
    });
  });
  it("rien ne se signe ni ne se dépose sur une pièce validée ou un dossier archivé", () => {
    expect(vuePiece(piece("02-AVT", { statut: "valide" }), "apprenant", true)).toMatchObject({
      peut_signer: false,
      peut_deposer: false,
      libelle_statut: "Validé",
    });
    expect(vuePiece(piece("02-AVT"), "apprenant", false)).toMatchObject({
      peut_signer: false,
      peut_deposer: false,
    });
  });
  it("une pièce déposée (ACC) se dépose mais ne se signe pas ; une pièce sans statut affiche sa transmission", () => {
    const acc = vuePiece(piece("ACC"), "formateur", true);
    expect(definitionPiece("ACC").mode).toBe("deposee");
    expect(acc).toMatchObject({ peut_signer: false, peut_deposer: true, disponible: false });
    expect(vuePiece(piece("PRG"), "apprenant", true)).toMatchObject({
      statut: null,
      libelle_statut: "À transmettre",
    });
    expect(
      vuePiece(piece("PRG", { transmise_le: "2026-10-05" }), "apprenant", true).libelle_statut,
    ).toBe("Transmis");
  });
  it("l'apprenant ne peut déposer qu'une pièce de sa compétence ; l'admin dépose factures et ACC", () => {
    expect(vuePiece(piece("10-FIN"), "apprenant", true).peut_deposer).toBe(false);
  });
});

describe("heures réalisées", () => {
  const seances = [
    { id: "a", heure_debut: "09:00", heure_fin: "12:00" },
    { id: "b", heure_debut: "13:00", heure_fin: "17:30" },
  ];
  it("somme des séances émargées par le stagiaire (pas celles du formateur)", () => {
    const r = heuresRealisees({
      stagiaire_ids: ["s1", "s2"],
      seances,
      emargements: [
        { seance_id: "a", stagiaire_id: "s1", signataire: "stagiaire" },
        { seance_id: "b", stagiaire_id: "s1", signataire: "stagiaire" },
        { seance_id: "a", stagiaire_id: "s2", signataire: "formateur" },
      ],
      feuilles: [],
      duree_totale: 14,
    });
    expect(r).toEqual({ s1: 7.5, s2: 0 });
  });
  it("feuille papier validée par dépôt : durée prévue ; par signature : seulement les émargements", () => {
    const base = { stagiaire_ids: ["s1"], seances, emargements: [], duree_totale: 14 };
    expect(
      heuresRealisees({
        ...base,
        feuilles: [{ stagiaire_id: "s1", statut: "valide", mode_retour: "depot" }],
      }),
    ).toEqual({ s1: 14 });
    expect(
      heuresRealisees({
        ...base,
        feuilles: [{ stagiaire_id: "s1", statut: "valide", mode_retour: "signature" }],
      }),
    ).toEqual({ s1: 0 });
    expect(
      heuresRealisees({
        ...base,
        duree_totale: null,
        feuilles: [{ stagiaire_id: "s1", statut: "valide", mode_retour: "depot" }],
      }),
    ).toEqual({ s1: 0 });
  });
});

describe("relance : documents attendus de l'apprenant", () => {
  it("liste les pièces suivies, en attente, validables par l'apprenant — jamais l'accord", () => {
    const r = documentsEnAttenteDe(
      [
        { code: "PRE", stagiaire_id: "s1", statut: "en_attente" },
        { code: "02-AVT", stagiaire_id: null, statut: "en_attente" },
        { code: "ACC", stagiaire_id: null, statut: "en_attente" },
        { code: "04-AVT", stagiaire_id: null, statut: "en_attente" },
        { code: "05-AVT", stagiaire_id: "s2", statut: "en_attente" },
        { code: "09-FIN", stagiaire_id: "s1", statut: "valide" },
      ],
      "s1",
    );
    expect(r).toEqual([definitionPiece("PRE").libelle, definitionPiece("02-AVT").libelle]);
  });
});

describe("questionnaires en ligne", () => {
  it("chaque type porte sa pièce et s'ouvre à son étape", () => {
    expect(TYPES_EVALUATION).toHaveLength(5);
    expect(CONFIG_EVALUATIONS.acquis.code).toBe("07-FIN");
    expect(questionnaireOuvert("brouillon", "recueil")).toBe(true);
    expect(questionnaireOuvert("accord_financement", "acquis")).toBe(false);
    expect(questionnaireOuvert("formation_debutee", "acquis")).toBe(true);
    expect(questionnaireOuvert("fin_dossier_incomplet", "satisfaction_chaud")).toBe(true);
    expect(questionnaireOuvert("fin_dossier_incomplet", "satisfaction_froid")).toBe(false);
    expect(questionnaireOuvert("fin_dossier_complet", "satisfaction_froid")).toBe(true);
    for (const t of TYPES_EVALUATION) {
      expect(questionnaireOuvert("archive", t)).toBe(false);
      expect(questionnaireOuvert("refus_financement", t)).toBe(false);
      expect(aAtteint("archive", CONFIG_EVALUATIONS[t].ouvertDes)).toBe(true);
    }
  });
  it("formulaires fixes : recueil et satisfactions ; QCM pour positionnement et acquis", () => {
    expect(formulaireDe("recueil")).not.toBeNull();
    expect(formulaireDe("satisfaction_chaud")).not.toBeNull();
    expect(formulaireDe("satisfaction_froid")).not.toBeNull();
    expect(formulaireDe("positionnement")).toBeNull();
    expect(formulaireDe("acquis")).toBeNull();
  });
  it("état d'un formulaire : la pièce validée prime, puis la ligne d'envoi (instants comparés, pas des chaînes)", () => {
    const maintenant = "2026-10-05T12:00:00.000Z";
    const f = (statut: string, expire_le: string) => ({ statut, expire_le });
    expect(statutFormulaire({ pieceValidee: true, formulaire: null, maintenant })).toBe("valide");
    expect(statutFormulaire({ pieceValidee: false, formulaire: null, maintenant })).toBe(
      "non_envoye",
    );
    expect(
      statutFormulaire({ pieceValidee: false, formulaire: f("complet", "2020-01-01"), maintenant }),
    ).toBe("valide");
    expect(
      statutFormulaire({
        pieceValidee: false,
        formulaire: f("en_cours", "2020-01-01"),
        maintenant,
      }),
    ).toBe("en_cours");
    expect(
      statutFormulaire({
        pieceValidee: false,
        formulaire: f("envoye", "2026-10-05T11:59:59+00:00"),
        maintenant,
      }),
    ).toBe("expire");
    expect(
      statutFormulaire({
        pieceValidee: false,
        formulaire: f("envoye", "2026-10-05T12:00:01+00:00"),
        maintenant,
      }),
    ).toBe("envoye");
  });
});

describe("colonnes écrites par une transition", () => {
  const T = "2026-10-05T10:00:00.000Z";
  it("toute transition écrit le sous-statut et maj_le ; chaque action ajoute ses propres dates et motifs", () => {
    expect(colonnesDeTransition("demander_paiement", "demande_paiement", T)).toEqual({
      sous_statut: "demande_paiement",
      maj_le: T,
    });
    expect(colonnesDeTransition("valider_dossier", "dossier_valide", T)).toMatchObject({
      valide_le: T,
      motif_renvoi: "",
    });
    expect(
      colonnesDeTransition("renvoyer_en_brouillon", "brouillon", T, "  Corriger  "),
    ).toMatchObject({
      motif_renvoi: "Corriger",
    });
    expect(
      colonnesDeTransition("enregistrer_refus", "refus_financement", T, " Refusé "),
    ).toMatchObject({
      motif_refus: "Refusé",
    });
    expect(colonnesDeTransition("enregistrer_refus", "refus_financement", T)).toMatchObject({
      motif_refus: "",
    });
    expect(colonnesDeTransition("terminer_formation", "fin_dossier_incomplet", T)).toMatchObject({
      termine_le: T,
    });
  });
  it("chaque action du noyau est décrite (aucune colonne de pipeline écrite hors de cette fonction)", () => {
    for (const a of Object.keys(REGLES) as Action[]) {
      const cols = colonnesDeTransition(a, "brouillon", T, "m");
      expect(Object.keys(cols)).toContain("sous_statut");
      expect(Object.keys(cols)).not.toContain("of_id");
      expect(Object.keys(cols)).not.toContain("formateur_id");
      expect(Object.keys(cols)).not.toContain("archive_le");
    }
  });
});
