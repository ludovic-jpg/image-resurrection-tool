// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CHAMPS_OF_OBLIGATOIRES as DU_SERVICE,
  champsOfManquants as manquantsDuService,
} from "@/serveur/services/organisme";
import { CHAMPS_OF_OBLIGATOIRES, champsOfManquants } from "./organisme";

const complet = Object.fromEntries(CHAMPS_OF_OBLIGATOIRES.map((c) => [c, "renseigné"]));

describe("champsOfManquants (version pure)", () => {
  it("garde les mêmes champs obligatoires, dans le même ordre, que le service Node", () => {
    expect([...CHAMPS_OF_OBLIGATOIRES]).toEqual([...DU_SERVICE]);
  });

  it("ne signale rien quand tous les champs sont renseignés", () => {
    expect(champsOfManquants(complet)).toEqual([]);
  });

  it("signale tous les champs d'un organisme vide, avec leurs libellés lisibles", () => {
    expect(champsOfManquants({})).toEqual([
      "Raison sociale",
      "Adresse",
      "SIRET",
      "Numéro de déclaration d'activité",
      "Région de la DREETS",
      "Prénom du représentant légal",
      "Nom du représentant légal",
      "E-mail pédagogie",
      "Tribunal compétent",
    ]);
  });

  it("traite une valeur faite d'espaces, null ou absente comme vide", () => {
    expect(
      champsOfManquants({ ...complet, of_siret: "   ", of_nom: null, of_adresse: undefined }),
    ).toEqual(["Raison sociale", "Adresse", "SIRET"]);
  });

  it("donne le même résultat que le service Node sur une série de cas", () => {
    const cas: Array<Record<string, unknown>> = [
      {},
      complet,
      { ...complet, of_siret: "" },
      { ...complet, of_email_pedagogie: "  ", of_tribunal_competent: null },
      { of_nom: "Skills4mation", of_siret: "123 456 789 00012" },
    ];
    for (const of of cas) expect(champsOfManquants(of)).toEqual(manquantsDuService(of));
  });
});
