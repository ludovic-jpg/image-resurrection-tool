/**
 * Parcours de l'apprenant — cahier des charges oral du 23/09/2026.
 * Chaque test cite la phrase du cahier des charges qu'il vérifie.
 */
import { describe, expect, it } from "vitest";
import type { PieceDuDossier } from "../pieces/statut";
import type { SousStatut } from "../pipeline/statuts";
import type { CodePiece } from "../referentiel/pieces";
import { sectionsParcours, sectionVisible, type CleSection, type EntreeParcours } from "./apprenant";

const piece = (
  code: CodePiece,
  statut: "en_attente" | "valide" = "en_attente",
  stagiaire_id: string | null = null,
): PieceDuDossier => ({ code, statut, stagiaire_id });

function entree(sous_statut: SousStatut, surcharge: Partial<EntreeParcours> = {}): EntreeParcours {
  return {
    sous_statut,
    pieces: [],
    recueil_renseigne: false,
    positionnement_renseigne: false,
    positionnement_prevu: true,
    ...surcharge,
  };
}

const etat = (e: EntreeParcours, cle: CleSection) => sectionsParcours(e).find((s) => s.cle === cle)!;

describe("ordre des sections : l'espace « évolue avec le temps »", () => {
  it("présente toujours les cinq étapes dans l'ordre du parcours", () => {
    expect(sectionsParcours(entree("brouillon")).map((s) => s.cle)).toEqual([
      "preliminaire",
      "constitution",
      "financement",
      "accord",
      "realisation",
    ]);
  });
});

describe("« on peut inviter un apprenant […] qui commence par le recueil des besoins et le test de positionnement »", () => {
  it("à l'invitation, seule l'étape préliminaire attend l'apprenant ; tout le reste est à venir", () => {
    const s = sectionsParcours(entree("brouillon"));
    expect(s.map((x) => x.etat)).toEqual(["a_faire", "a_venir", "a_venir", "a_venir", "a_venir"]);
    expect(s[0]!.message).toContain("recueil des besoins");
  });

  it("recueil fait, positionnement manquant : il reste le test", () => {
    expect(etat(entree("brouillon", { recueil_renseigne: true }), "preliminaire")).toMatchObject({
      etat: "a_faire",
      message: expect.stringContaining("test de positionnement"),
    });
  });

  it("« si l'apprenant répond », l'étape préliminaire est close et la constitution du dossier s'ouvre", () => {
    const e = entree("brouillon", { recueil_renseigne: true, positionnement_renseigne: true });
    expect(etat(e, "preliminaire").etat).toBe("termine");
    expect(etat(e, "constitution").etat).toBe("en_attente");
  });

  it("sans test de positionnement prévu pour la formation, le recueil suffit", () => {
    expect(
      etat(entree("brouillon", { recueil_renseigne: true, positionnement_prevu: false }), "preliminaire")
        .etat,
    ).toBe("termine");
  });
});

describe("« le faire valider par l'équipe administrative »", () => {
  it("dossier soumis : en attente de l'organisme ; validé : étape close", () => {
    expect(
      etat(
        entree("en_cours_validation", { recueil_renseigne: true, positionnement_renseigne: true }),
        "constitution",
      ),
    ).toMatchObject({ etat: "en_attente", message: expect.stringContaining("équipe administrative") });
    expect(etat(entree("dossier_valide"), "constitution").etat).toBe("termine");
  });
});

describe("« on remet à l'apprenant l'ensemble des pièces : convention, planning, parcours de formation »", () => {
  const pieces = [
    piece("PRE", "en_attente", "s1"),
    piece("02-AVT"),
    piece("03-AVT"),
    piece("PRG"),
    piece("ACC"),
  ];

  it("après validation, la section financement liste pré-dossier, convention, planning et programme — pas l'accord", () => {
    const f = etat(entree("dossier_valide", { pieces }), "financement");
    expect(f).toMatchObject({ etat: "a_faire", pieces: ["PRE", "02-AVT", "03-AVT", "PRG"] });
  });

  it("tant que la convention n'est pas signée, le message invite à la signer ; ensuite, à déposer la demande", () => {
    expect(etat(entree("dossier_valide", { pieces }), "financement").message).toContain(
      "signez la convention",
    );
    const signees = pieces.map((p) => (p.code === "02-AVT" ? { ...p, statut: "valide" as const } : p));
    expect(etat(entree("dossier_valide", { pieces: signees }), "financement").message).toContain("confirmez");
  });

  it("« il coche […] j'affirme avoir déposé la demande » : la section change d'état (et donc de couleur)", () => {
    expect(etat(entree("dossier_valide", { pieces }), "financement").etat).toBe("a_faire");
    expect(etat(entree("dossier_depose", { pieces }), "financement").etat).toBe("termine");
  });
});

describe("« si on obtient l'accord, une section supplémentaire est produite automatiquement »", () => {
  it("la section Accord reste masquée tant que la demande n'est pas déclarée déposée", () => {
    const accord = etat(entree("dossier_valide", { pieces: [piece("ACC")] }), "accord");
    expect(accord.etat).toBe("a_venir");
    expect(sectionVisible(accord)).toBe(false);
  });

  it("elle apparaît dès la déclaration, et invite l'apprenant — ou le formateur, ou l'organisme — à déposer l'accord", () => {
    const accord = etat(entree("dossier_depose", { pieces: [piece("ACC")] }), "accord");
    expect(sectionVisible(accord)).toBe(true);
    expect(accord).toMatchObject({
      etat: "a_faire",
      pieces: ["ACC"],
      message: expect.stringContaining("formateur ou l'organisme"),
    });
  });

  it("l'accord reçu clôt la section et ouvre la réalisation de la formation", () => {
    const e = entree("accord_financement", {
      pieces: [piece("ACC", "valide"), piece("05-AVT", "en_attente", "s1")],
    });
    expect(etat(e, "accord").etat).toBe("termine");
    expect(etat(e, "financement").etat).toBe("termine");
    expect(etat(e, "realisation")).toMatchObject({ etat: "a_faire", pieces: ["05-AVT"] });
  });

  it("un accord déposé AVANT la déclaration compte aussi : la demande était forcément partie", () => {
    const e = entree("accord_financement", { pieces: [piece("ACC", "valide")] });
    expect(etat(e, "financement").etat).toBe("termine");
  });

  it("un refus de financement est affiché comme tel, et ferme la suite", () => {
    const e = entree("refus_financement");
    expect(etat(e, "accord").etat).toBe("refuse");
    expect(etat(e, "realisation").etat).toBe("a_venir");
  });
});

describe("fin de parcours", () => {
  it("dossier complet puis archivé : toutes les sections sont closes", () => {
    const e = entree("archive", { recueil_renseigne: true, positionnement_renseigne: true });
    expect(sectionsParcours(e).map((s) => s.etat)).toEqual([
      "termine",
      "termine",
      "termine",
      "termine",
      "termine",
    ]);
  });
});
