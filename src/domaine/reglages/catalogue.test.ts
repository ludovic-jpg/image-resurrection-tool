import { describe, expect, it } from "vitest";
import { ecrituresReglages, estSecret, validerReglages } from "./catalogue";

describe("validation des réglages", () => {
  it("retient uniquement les clés connues présentes", () => {
    expect(validerReglages({ smtp_hote: " smtp.x.fr ", pirate: "1" })).toEqual({
      ok: true,
      valeurs: { smtp_hote: "smtp.x.fr" },
    });
  });
  it("ne rogne pas le mot de passe", () => {
    expect(validerReglages({ smtp_mot_de_passe: " a b " })).toEqual({
      ok: true,
      valeurs: { smtp_mot_de_passe: " a b " },
    });
  });
  it("refuse un port invalide, un oui/non invalide, un texte trop long, un non-texte", () => {
    const r = validerReglages({
      smtp_port: "46x5",
      courrier_actif: "peut-être",
      ia_modele: "m".repeat(101),
      ia_workspace: 12,
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.champs).sort()).toEqual([
        "courrier_actif",
        "ia_modele",
        "ia_workspace",
        "smtp_port",
      ]);
  });
  it("accepte un port vide (champ non renseigné)", () => {
    expect(validerReglages({ smtp_port: "" }).ok).toBe(true);
  });
});

describe("écritures de réglages", () => {
  it("ignore un secret vide, efface avec « - », écrit les autres clés", () => {
    const e = ecrituresReglages({
      ia_cle: "",
      smtp_mot_de_passe: "-",
      ia_modele: "claude-sonnet-5-5",
      courrier_actif: "oui",
    });
    expect(e).toEqual([
      { cle: "smtp_mot_de_passe", secret: true, clair: "" },
      { cle: "ia_modele", secret: false, clair: "claude-sonnet-5-5" },
      { cle: "courrier_actif", secret: false, clair: "oui" },
    ]);
  });
  it("marque secrètes exactement la clé d'IA et le mot de passe SMTP", () => {
    expect(["ia_cle", "smtp_mot_de_passe", "smtp_hote"].map(estSecret)).toEqual([
      true,
      true,
      false,
    ]);
  });
  it("une clé secrète non vide est écrite en clair ici (le chiffrement vient après)", () => {
    expect(ecrituresReglages({ ia_cle: "sk-abc" })).toEqual([
      { cle: "ia_cle", secret: true, clair: "sk-abc" },
    ]);
  });
});
