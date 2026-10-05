import { describe, expect, it } from "vitest";
import {
  aSatisfactionFroidDue,
  CONFIG_FORMULAIRES,
  estARelancer,
  formulaireOuvert,
  seuilFroid,
  seuilRelance,
} from "./formulaires-programmes";

const MAINTENANT = new Date("2026-10-05T01:00:00Z");

describe("satisfaction à froid, J+90", () => {
  it("seuil : 90 jours avant aujourd'hui (date ISO)", () => {
    expect(seuilFroid(MAINTENANT)).toBe("2026-07-07");
  });
  it("due : formation terminée depuis 90 jours ou plus, dossier non archivé", () => {
    for (const sous_statut of ["fin_dossier_complet", "demande_paiement", "paiement_receptionne"]) {
      expect(
        aSatisfactionFroidDue({ sous_statut, formation_date_fin: "2026-07-07" }, MAINTENANT),
      ).toBe(true);
      expect(
        aSatisfactionFroidDue({ sous_statut, formation_date_fin: "2026-07-08" }, MAINTENANT),
      ).toBe(false);
    }
  });
  it("jamais pour un dossier incomplet, archivé, refusé ou sans date de fin", () => {
    for (const sous_statut of [
      "fin_dossier_incomplet",
      "archive",
      "refus_financement",
      "formation_debutee",
    ])
      expect(
        aSatisfactionFroidDue({ sous_statut, formation_date_fin: "2026-01-01" }, MAINTENANT),
      ).toBe(false);
    expect(
      aSatisfactionFroidDue(
        { sous_statut: "fin_dossier_complet", formation_date_fin: "" },
        MAINTENANT,
      ),
    ).toBe(false);
  });
});

describe("relance unique, J+7", () => {
  const f = {
    statut: "envoye",
    envois: 1,
    envoye_le: "2026-09-28T01:00:00Z",
    expire_le: "2026-11-01T00:00:00Z",
  };
  it("seuil : 7 jours avant maintenant", () => {
    expect(seuilRelance(MAINTENANT).toISOString()).toBe("2026-09-28T01:00:00.000Z");
  });
  it("relance un formulaire envoyé ou en cours, une seule fois, avant expiration", () => {
    expect(estARelancer(f, MAINTENANT)).toBe(true);
    expect(estARelancer({ ...f, statut: "en_cours" }, MAINTENANT)).toBe(true);
  });
  it.each([
    ["déjà relancé", { envois: 2 }],
    ["trop récent", { envoye_le: "2026-09-28T01:00:01Z" }],
    ["jamais envoyé", { envoye_le: null }],
    ["expiré", { expire_le: "2026-10-05T01:00:00Z" }],
    ["déjà complet", { statut: "complet" }],
  ])("ne relance pas : %s", (_n, surcharge) => {
    expect(estARelancer({ ...f, ...surcharge }, MAINTENANT)).toBe(false);
  });
});

describe("ouverture des formulaires", () => {
  it("à froid : seulement une fois le dossier complet, et pas archivé", () => {
    expect(formulaireOuvert("fin_dossier_incomplet", "satisfaction_froid")).toBe(false);
    expect(formulaireOuvert("fin_dossier_complet", "satisfaction_froid")).toBe(true);
    expect(formulaireOuvert("archive", "satisfaction_froid")).toBe(false);
  });
  it("recueil : dès le brouillon ; jamais sur un dossier refusé", () => {
    expect(formulaireOuvert("brouillon", "recueil")).toBe(true);
    expect(formulaireOuvert("refus_financement", "recueil")).toBe(false);
  });
  it("la pièce de la satisfaction à froid est 12-APR", () => {
    expect(CONFIG_FORMULAIRES.satisfaction_froid.code).toBe("12-APR");
  });
});
