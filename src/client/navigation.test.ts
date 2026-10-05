/** Menu principal à trois espaces — cahier des charges oral du 23/09/2026. */
import { describe, expect, it } from "vitest";
import { ESPACES_FORMATEUR, navigationPour } from "./navigation";

const ROUTES_DECLAREES = [
  "/tableau-de-bord",
  "/dossiers",
  "/dossiers/nouveau",
  "/formations",
  "/outils",
  "/repertoire",
  "/candidature",
  "/admin/candidatures",
  "/admin/organisme",
  "/bpf",
  "/courriers",
  "/coffres",
  "/positionnements",
  "/profil",
  "/archives",
];

describe("menu du formateur", () => {
  it("compte exactement trois espaces, dans l'ordre : pédagogique, apprenant, formation", () => {
    expect(ESPACES_FORMATEUR.map((e) => e.titre)).toEqual([
      "Espace pédagogique",
      "Espace apprenant",
      "Espace formation",
    ]);
  });

  it("range le générateur de conventions dans l'espace formation, et les outils pédagogiques dans l'espace pédagogique", () => {
    const ou = (vers: string) => ESPACES_FORMATEUR.find((e) => e.liens.some((l) => l.vers === vers))?.cle;
    expect(ou("/dossiers/nouveau")).toBe("formation");
    expect(ou("/dossiers")).toBe("formation");
    expect(ou("/formations")).toBe("pedagogique");
    expect(ou("/outils")).toBe("pedagogique");
    expect(ou("/repertoire")).toBe("apprenant");
    // « Modification 1 » (23/09/2026) : coffre-fort par parcours et positionnements
    expect(ou("/coffres")).toBe("pedagogique");
    expect(ou("/positionnements")).toBe("apprenant");
  });

  it("donne toujours accès au profil et aux archives (« Modification 1 »)", () => {
    const nav = navigationPour("formateur", true);
    expect(nav.personnels.map((l) => l.vers)).toEqual(["/profil", "/archives"]);
    for (const l of nav.personnels) expect(ROUTES_DECLAREES).toContain(l.vers);
  });

  it("ne mène qu'à des écrans qui existent, et chaque écran n'apparaît qu'une fois", () => {
    const liens = ESPACES_FORMATEUR.flatMap((e) => e.liens.map((l) => l.vers));
    for (const vers of liens) expect(ROUTES_DECLAREES, vers).toContain(vers);
    expect(new Set(liens).size).toBe(liens.length);
  });

  it("un formateur non validé ne voit que sa candidature (F-ONB-02)", () => {
    const nav = navigationPour("formateur", false);
    expect(nav.accueil).toBeNull();
    expect(nav.espaces.flatMap((e) => e.liens.map((l) => l.vers))).toEqual(["/candidature"]);
  });
});

describe("menus de l'admin et de l'apprenant", () => {
  it("l'admin garde ses écrans, regroupés : formation puis administration", () => {
    expect(navigationPour("admin", false).espaces.map((e) => e.cle)).toEqual(["formation", "administration"]);
  });

  it("l'apprenant n'a qu'une entrée : ses formations", () => {
    expect(navigationPour("apprenant", false).espaces.flatMap((e) => e.liens.map((l) => l.libelle))).toEqual([
      "Mes formations",
    ]);
  });
});
