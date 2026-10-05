import { describe, expect, it } from "vitest";
import { NOMENCLATURE, type CodePiece } from "../referentiel/pieces";
import {
  TAILLE_MAX_PIECE,
  aUnApercu,
  ciblesEmargement,
  controlePieceExterne,
  erreurFichierPiece,
  nomFichierPiece,
  reactionApresValidation,
  refusDepot,
  refusDossierFerme,
  refusEmargementFerme,
  refusRegeneration,
  refusSignature,
} from "./retours";

const signablesApprenant = NOMENCLATURE.filter(
  (d) => d.mode === "generee" && d.suiviStatut && d.valideePar.includes("apprenant"),
).map((d) => d.code);
const deposees = NOMENCLATURE.filter((d) => d.mode === "deposee").map((d) => d.code);

describe("refus de signature", () => {
  it("l'apprenant peut signer une pièce à signer, sur un dossier ouvert", () => {
    expect(signablesApprenant.length).toBeGreaterThan(0);
    expect(refusSignature(signablesApprenant[0]!, "apprenant", "a_signer", "brouillon")).toBeNull();
  });
  it("l'administrateur ne signe jamais en ligne (403)", () => {
    const r = refusSignature(signablesApprenant[0]!, "admin", "a_signer", "brouillon");
    expect(r?.code).toBe("interdit");
  });
  it("le formateur ne signe que la pièce 04-AVT", () => {
    expect(refusSignature("04-AVT", "formateur", "a_signer", "brouillon")?.code).not.toBe(
      "interdit",
    );
    const autre = signablesApprenant.find((c) => c !== "04-AVT")!;
    expect(refusSignature(autre, "formateur", "a_signer", "brouillon")?.code).toBe("interdit");
  });
  it("une pièce validée ne se signe plus (409)", () => {
    expect(refusSignature(signablesApprenant[0]!, "apprenant", "valide", "brouillon")?.code).toBe(
      "conflit",
    );
  });
  it("une pièce à déposer ne se signe pas en ligne (400)", () => {
    expect(refusSignature(deposees[0]!, "apprenant", "attendu", "brouillon")?.code).toBe(
      "invalide",
    );
  });
  it("un dossier archivé est en lecture seule (409)", () => {
    expect(refusSignature(signablesApprenant[0]!, "apprenant", "a_signer", "archive")?.code).toBe(
      "conflit",
    );
    expect(refusDossierFerme("refus_financement")?.code).toBe("conflit");
    expect(refusDossierFerme("brouillon")).toBeNull();
  });
});

describe("dépôt, régénération, aperçu", () => {
  it("un rôle qui ne valide pas la pièce ne dépose pas (403)", () => {
    const code = NOMENCLATURE.find(
      (d) => d.suiviStatut && !d.valideePar.includes("apprenant"),
    )!.code;
    expect(refusDepot(code, "apprenant", "brouillon")?.code).toBe("interdit");
  });
  it("l'apprenant ne régénère jamais ; une pièce validée fait foi", () => {
    expect(refusRegeneration("apprenant", "a_signer", "brouillon")?.code).toBe("interdit");
    expect(refusRegeneration("formateur", "valide", "brouillon")?.code).toBe("conflit");
    expect(refusRegeneration("admin", "a_signer", "brouillon")).toBeNull();
  });
  it("aperçu pour les pièces générées et la trame 10-FIN seulement", () => {
    expect(aUnApercu("10-FIN")).toBe(true);
    expect(aUnApercu(deposees.find((c) => c !== "10-FIN")!)).toBe(false);
  });
});

describe("pièce externe (route 99)", () => {
  it("une pièce générée ne se dépose pas ; un code inconnu non plus", () => {
    expect(controlePieceExterne("00-AVT", "dossier_valide", true).refus?.code).toBe("invalide");
    expect(controlePieceExterne("N'IMPORTE", "dossier_valide", true).refus?.code).toBe("invalide");
  });
  it("seul un refus de financement crée la ligne, après validation du dossier", () => {
    expect(controlePieceExterne("REF", "brouillon", false).refus?.code).toBe("conflit");
    expect(controlePieceExterne("REF", "dossier_valide", false)).toEqual({
      refus: null,
      creer: true,
    });
    expect(controlePieceExterne("ACC", "dossier_valide", false).refus?.code).toBe("conflit");
    expect(controlePieceExterne("ACC", "dossier_valide", true)).toEqual({
      refus: null,
      creer: false,
    });
  });
});

describe("réaction du pipeline", () => {
  it("l'accord fait avancer le dossier ; la dernière pièce de fin réévalue la complétude", () => {
    expect(reactionApresValidation("ACC", "dossier_valide")).toBe("enregistrer_accord");
    expect(reactionApresValidation("ACC", "brouillon")).toBeNull();
    expect(reactionApresValidation("11-FIN" as CodePiece, "fin_dossier_incomplet")).toBe(
      "reevaluer_completude",
    );
  });
});

describe("fichiers et noms", () => {
  it("refuse vide, trop gros, extension inconnue ; accepte un PDF", () => {
    expect(erreurFichierPiece({ nom: "a.pdf", taille: 0 })).toMatch(/vide/);
    expect(erreurFichierPiece({ nom: "a.pdf", taille: TAILLE_MAX_PIECE + 1 })).toMatch(/15 Mo/);
    expect(erreurFichierPiece({ nom: "a.exe", taille: 10 })).toMatch(/non accepté/);
    expect(erreurFichierPiece({ nom: "a.PDF", taille: 10 })).toBeNull();
  });
  it("nomme la pièce, suffixée du stagiaire pour une pièce individuelle", () => {
    expect(nomFichierPiece("00-AVT", null)).not.toContain("Dupont");
    expect(nomFichierPiece("00-AVT", "Jean Dupont")).toMatch(/_Jean-Dupont$/);
  });
});

describe("émargement", () => {
  const inscrits = ["s1", "s2"];
  it("l'apprenant émarge pour lui-même seulement", () => {
    const r = ciblesEmargement({ role: "apprenant", stagiaire_id: "s1" }, inscrits, "s2");
    expect(r).toEqual({ ok: true, cibles: ["s1"], signataire: "stagiaire" });
    const non = ciblesEmargement({ role: "apprenant", stagiaire_id: "s9" }, inscrits);
    expect(non.ok).toBe(false);
  });
  it("le formateur contresigne pour un inscrit ou pour toute la séance", () => {
    expect(ciblesEmargement({ role: "formateur", stagiaire_id: null }, inscrits)).toEqual({
      ok: true,
      cibles: inscrits,
      signataire: "formateur",
    });
    const r = ciblesEmargement({ role: "formateur", stagiaire_id: null }, inscrits, "s9");
    expect(r.ok).toBe(false);
  });
  it("l'administrateur n'émarge pas", () => {
    const r = ciblesEmargement({ role: "admin", stagiaire_id: null }, inscrits);
    expect(r.ok === false && r.refus.code).toBe("interdit");
  });
  it("fermé tant que la formation n'a pas démarré", () => {
    expect(refusEmargementFerme("brouillon")?.code).toBe("conflit");
    expect(refusEmargementFerme("formation_debutee")).toBeNull();
  });
});
