import { describe, expect, it } from "vitest";
import { ETAPES, SOUS_STATUTS, aAtteint, estTerminal, etapeDe, type SousStatut } from "./statuts";
import { REGLES, actionsPossibles, transiter, type Action, type Acteur, type ContexteDossier } from "./transitions";
import { piecesAttendues, piecesManquantesPourCompletude, peutValider, peutVoir, vueEspace, type PieceDuDossier } from "../pieces/statut";
import { NOMENCLATURE } from "../referentiel/pieces";

const STAGIAIRES = ["s1", "s2"];

function contexte(sous_statut: SousStatut, valides: string[] = []): ContexteDossier {
  // Toutes les pièces possibles existent ; seules celles listées dans `valides` sont « Validé ».
  const pieces: PieceDuDossier[] = [...piecesAttendues("archive", STAGIAIRES), { code: "REF" as const, stagiaire_id: null }].map((p) => ({
    ...p,
    statut: valides.includes(p.code) || valides.includes("*") ? "valide" : "en_attente",
  }));
  return { sous_statut, pieces, stagiaire_ids: STAGIAIRES };
}

describe("structure du pipeline (section 8 du cahier des charges)", () => {
  it("compte 7 étapes et 13 sous-statuts, dans l'ordre du cahier des charges", () => {
    expect(ETAPES.map((e) => e.cle).join("")).toBe("ABCDEFG");
    expect(SOUS_STATUTS).toHaveLength(13);
    expect(SOUS_STATUTS.filter((s) => s.etape === "B").map((s) => s.libelle)).toEqual([
      "Dossier validé",
      "Dossier Formation déposé",
      "Accord de financement",
      "Refus de financement",
      "AF — Envoi des éléments pédagogiques à l'apprenant",
    ]);
    expect(etapeDe("fin_dossier_incomplet")).toBe("D");
  });

  it("ne considère jamais qu'un dossier refusé a « atteint » l'accord", () => {
    expect(aAtteint("formation_debutee", "accord_financement")).toBe(true);
    expect(aAtteint("dossier_depose", "accord_financement")).toBe(false);
    expect(aAtteint("refus_financement", "accord_financement")).toBe(false);
    expect(aAtteint("refus_financement", "dossier_valide")).toBe(true);
    expect(aAtteint("archive", "refus_financement")).toBe(false);
  });
});

describe("parcours nominal, de Brouillon à Archivé", () => {
  it("enchaîne les 11 transitions avec les bons acteurs et déclenche les bons effets", () => {
    const etapes: Array<[Action, Acteur, SousStatut, string[]]> = [
      ["soumettre_validation", "formateur", "en_cours_validation", ["NOTIFIER_ADMIN_DEMANDE_VALIDATION"]],
      ["valider_dossier", "admin", "dossier_valide", ["GENERER_PIECES_DE_DEPART", "EMAIL_ENTREPRISE_PIECES_FINANCEMENT"]],
      ["declarer_depot", "apprenant", "dossier_depose", ["NOTIFIER_DEPOT_DECLARE"]],
      ["enregistrer_accord", "systeme", "accord_financement", ["GENERER_ET_ENVOYER_ODM", "OUVRIR_COFFRE_AUX_APPRENANTS"]],
      ["envoyer_elements_pedagogiques", "formateur", "envoi_elements_pedagogiques", ["GENERER_CONVOCATIONS", "EMAIL_APPRENANTS_ELEMENTS_PEDAGOGIQUES"]],
      ["demarrer_formation", "formateur", "formation_debutee", ["GENERER_PIECES_DE_REALISATION"]],
      ["terminer_formation", "formateur", "fin_dossier_complet", ["GENERER_PIECES_DE_FIN", "ENVOYER_FORMULAIRES_DE_FIN", "PLANIFIER_SATISFACTION_A_FROID"]],
      ["demander_paiement", "admin", "demande_paiement", ["GENERER_FACTURE_OF"]],
      ["enregistrer_paiement", "admin", "paiement_receptionne", []],
      ["cloturer", "admin", "archive", ["ARCHIVER_EN_LECTURE_SEULE"]],
    ];
    let courant: SousStatut = "brouillon";
    for (const [action, acteur, attendu, effets] of etapes) {
      const r = transiter(contexte(courant, ["*"]), action, acteur);
      expect(r, action).toMatchObject({ ok: true, vers: attendu, effets });
      courant = attendu;
    }
    expect(estTerminal(courant)).toBe(true);
  });
});

describe("gardes métier", () => {
  it("RG-02 : pas de demande de validation sans recueil ET positionnement, pour chaque apprenant", () => {
    expect(transiter(contexte("brouillon"), "soumettre_validation", "formateur")).toMatchObject({ ok: false, code: "garde" });
    expect(transiter(contexte("brouillon", ["00-AVT"]), "soumettre_validation", "formateur")).toMatchObject({
      ok: false,
      motif: expect.stringContaining("test de positionnement"),
    });
    const partiel = contexte("brouillon", ["00-AVT", "01-AVT"]);
    const premier = partiel.pieces.find((p) => p.code === "01-AVT" && p.stagiaire_id === "s2")!;
    (premier as PieceDuDossier).statut = "en_attente";
    expect(transiter(partiel, "soumettre_validation", "formateur").ok).toBe(false);
    expect(transiter(contexte("brouillon", ["00-AVT", "01-AVT"]), "soumettre_validation", "formateur").ok).toBe(true);
  });

  it("RG-06 : l'accord ne s'enregistre que si le document est déposé — depuis « validé » comme depuis « déposé »", () => {
    expect(transiter(contexte("dossier_valide"), "enregistrer_accord", "systeme")).toMatchObject({ ok: false, code: "garde" });
    expect(transiter(contexte("dossier_valide", ["ACC"]), "enregistrer_accord", "systeme").ok).toBe(true);
    expect(transiter(contexte("dossier_depose", ["ACC"]), "enregistrer_accord", "systeme").ok).toBe(true);
  });

  it("RG-07 : un refus exige son justificatif, archive le dossier et le fige", () => {
    expect(transiter(contexte("dossier_depose"), "enregistrer_refus", "formateur")).toMatchObject({ ok: false, code: "garde" });
    expect(transiter(contexte("dossier_depose", ["REF"]), "enregistrer_refus", "formateur")).toMatchObject({
      ok: true,
      vers: "refus_financement",
      effets: ["ARCHIVER_EN_LECTURE_SEULE"],
    });
    for (const action of Object.keys(REGLES) as Action[]) {
      expect(transiter(contexte("refus_financement", ["*"]), action, "admin"), action).toMatchObject({ ok: false, code: "terminal" });
    }
    expect(actionsPossibles(contexte("refus_financement", ["*"]), "admin")).toEqual([]);
  });

  it("étape D : incomplet tant qu'une pièce requise manque, puis bascule seul à complet", () => {
    const incomplet = contexte("formation_debutee", ["PRE", "02-AVT", "ACC", "04-AVT", "05-AVT", "06-PDT", "07-FIN"]);
    expect(transiter(incomplet, "terminer_formation", "formateur")).toMatchObject({ ok: true, vers: "fin_dossier_incomplet" });
    expect(piecesManquantesPourCompletude(incomplet.pieces, STAGIAIRES).map((p) => p.code)).toEqual(["09-FIN", "09-FIN"]);
    expect(transiter(contexte("fin_dossier_incomplet", ["*"]), "reevaluer_completude", "systeme")).toMatchObject({ ok: true, vers: "fin_dossier_complet" });
    // Sans changement, la réévaluation ne déclenche rien.
    expect(transiter(contexte("fin_dossier_complet", ["*"]), "reevaluer_completude", "systeme")).toMatchObject({ ok: true, vers: "fin_dossier_complet", effets: [] });
    expect(transiter(contexte("fin_dossier_incomplet"), "demander_paiement", "admin")).toMatchObject({ ok: false, code: "statut" });
  });

  it("exige un motif pour renvoyer un dossier, et la facture du formateur pour archiver", () => {
    expect(transiter(contexte("en_cours_validation"), "renvoyer_en_brouillon", "admin")).toMatchObject({ ok: false, code: "motif" });
    expect(transiter(contexte("en_cours_validation"), "renvoyer_en_brouillon", "admin", { motif: "SIRET manquant" }).ok).toBe(true);
    expect(transiter(contexte("paiement_receptionne"), "cloturer", "admin")).toMatchObject({ ok: false, code: "garde" });
  });
});

describe("cloisonnement par rôle (correctif de l'audit du 01/09/2026)", () => {
  const RESERVEES_ADMIN: Action[] = ["valider_dossier", "renvoyer_en_brouillon", "demander_paiement", "enregistrer_paiement", "cloturer"];

  it("interdit au formateur de valider son dossier ou de toucher au paiement", () => {
    for (const action of RESERVEES_ADMIN) {
      const de = REGLES[action].de[0]!;
      expect(transiter(contexte(de, ["*"]), action, "formateur", { motif: "x" }), action).toMatchObject({ ok: false, code: "role" });
    }
  });

  it("n'accorde à l'apprenant qu'une transition : affirmer avoir déposé sa demande de financement (CdC oral 23/09)", () => {
    const permises = (Object.keys(REGLES) as Action[]).filter((action) => transiter(contexte(REGLES[action].de[0]!, ["*"]), action, "apprenant", { motif: "x" }).ok);
    expect(permises).toEqual(["declarer_depot"]);
  });

  it("refuse de déclarer la demande de financement déposée tant que la convention n'est pas signée", () => {
    for (const acteur of ["apprenant", "formateur", "admin"] as const) {
      expect(transiter(contexte("dossier_valide", ["PRE"]), "declarer_depot", acteur), acteur).toMatchObject({ ok: false, code: "garde", motif: expect.stringContaining("convention") });
      expect(transiter(contexte("dossier_valide", ["02-AVT"]), "declarer_depot", acteur), acteur).toMatchObject({ ok: true, vers: "dossier_depose" });
    }
  });

  it("réserve au système l'enregistrement de l'accord : personne ne le « force » à la main", () => {
    expect(transiter(contexte("dossier_depose", ["ACC"]), "enregistrer_accord", "admin")).toMatchObject({ ok: false, code: "role" });
  });

  it("ne propose à chacun que ses propres actions, avec le blocage éventuel", () => {
    expect(actionsPossibles(contexte("brouillon"), "formateur")).toEqual([
      { action: "soumettre_validation", libelle: expect.any(String), bloqueePar: expect.stringContaining("RG-02"), motifRequis: false },
    ]);
    expect(actionsPossibles(contexte("en_cours_validation"), "formateur")).toEqual([]);
    expect(actionsPossibles(contexte("en_cours_validation"), "admin").map((a) => a.action)).toEqual(["renvoyer_en_brouillon", "valider_dossier"]);
  });
});

describe("pièces attendues et visibilité", () => {
  it("fait apparaître les pièces au fil du pipeline", () => {
    const codes = (s: SousStatut) => [...new Set(piecesAttendues(s, STAGIAIRES).map((p) => p.code))];
    expect(codes("brouillon")).toEqual(["00-AVT", "01-AVT"]);
    expect(codes("dossier_valide")).toEqual(["00-AVT", "01-AVT", "PRE", "02-AVT", "03-AVT", "PRG", "ACC"]);
    expect(codes("accord_financement")).toContain("04-AVT");
    expect(codes("accord_financement")).toContain("05-AVT");
    expect(codes("dossier_depose")).not.toContain("04-AVT");
    expect(codes("refus_financement")).not.toContain("04-AVT");
    expect(codes("archive")).toHaveLength(NOMENCLATURE.length - 1); // tout sauf le justificatif de refus
  });

  it("crée un exemplaire par stagiaire pour les pièces individuelles, un seul pour les collectives", () => {
    const pieces = piecesAttendues("dossier_valide", STAGIAIRES);
    expect(pieces.filter((p) => p.code === "PRE").map((p) => p.stagiaire_id)).toEqual(["s1", "s2"]);
    expect(pieces.filter((p) => p.code === "02-AVT")).toEqual([{ code: "02-AVT", stagiaire_id: null }]);
  });

  it("cloisonne la lecture de l'apprenant : son espace, ses pièces, jamais l'ODM ni les factures", () => {
    const moi = { role: "apprenant" as const, stagiaire_id: "s1" };
    expect(peutVoir({ code: "05-AVT", stagiaire_id: "s1" }, moi)).toBe(true);
    expect(peutVoir({ code: "05-AVT", stagiaire_id: "s2" }, moi)).toBe(false);
    expect(peutVoir({ code: "02-AVT", stagiaire_id: null }, moi)).toBe(true);
    for (const code of ["04-AVT", "10-FIN", "11-FIN", "00-AVT"] as const) expect(peutVoir({ code, stagiaire_id: null }, moi), code).toBe(false);
    const vue = vueEspace("apprenant", contexte("archive").pieces, moi).map((x) => x.def.ordre);
    expect(vue).toEqual(["1", "2", "2 bis", "2 ter", "3", "4", "5", "6", "7"]);
    expect(vueEspace("of", contexte("archive").pieces, moi)).toEqual([]);
    expect(vueEspace("of", contexte("archive").pieces, { role: "formateur" }).map((x) => x.def.code)).toEqual(["04-AVT", "10-FIN", "11-FIN"]);
  });

  it("désigne qui valide quoi", () => {
    expect(peutValider("04-AVT", "formateur")).toBe(true);
    expect(peutValider("04-AVT", "apprenant")).toBe(false);
    expect(peutValider("02-AVT", "apprenant")).toBe(true);
    expect(peutValider("03-AVT", "apprenant")).toBe(false); // planning : sans statut
    for (const role of ["admin", "formateur", "apprenant"] as const) expect(peutValider("ACC", role)).toBe(true);
  });
});
