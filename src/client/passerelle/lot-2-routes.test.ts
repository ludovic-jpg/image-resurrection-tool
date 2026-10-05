// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connecter, type FausseBd } from "./lot-2-faux-bd";

vi.mock("../bd", async () => ({ bd: (await import("./lot-2-faux-bd")).creerFausseBd() }));
const { bd } = (await import("../bd")) as unknown as { bd: FausseBd };
const { aiguiller } = await import("../aiguilleur");

/** Les routes portées par le lot 2, numérotées comme dans `lovable/CARTE_DES_ROUTES.md`. */
const ROUTES: Array<[number, string, string]> = [
  [18, "GET", "/referentiel"],
  [28, "GET", "/admin/organisme"],
  [29, "PATCH", "/admin/organisme"],
  [35, "GET", "/formations"],
  [36, "POST", "/formations/f/restaurer"],
  [37, "GET", "/versions/formation/f"],
  [38, "POST", "/versions/v/restaurer"],
  [39, "POST", "/formations"],
  [40, "GET", "/formations/f"],
  [41, "PATCH", "/formations/f"],
  [42, "POST", "/formations/f/dupliquer"],
  [43, "DELETE", "/formations/f"],
  [44, "GET", "/formations/f/coffre"],
  [45, "POST", "/formations/f/coffre"],
  [46, "PATCH", "/coffre/c"],
  [47, "DELETE", "/coffre/c"],
  [48, "POST", "/coffre/c/restaurer"],
  [49, "DELETE", "/coffre/c/definitif"],
  [50, "GET", "/coffres-parcours"],
  [51, "GET", "/coffres-parcours/f"],
  [52, "GET", "/coffres-parcours/f/programme"],
  [54, "GET", "/outils/o/document"],
  [55, "GET", "/coffre/c/telecharger"],
  [56, "GET", "/coffres"],
  [66, "GET", "/outils"],
  [67, "POST", "/outils/o/restaurer"],
  [68, "POST", "/outils"],
  [69, "PUT", "/outils/o"],
  [70, "DELETE", "/outils/o"],
  [71, "GET", "/entreprises"],
  [72, "POST", "/entreprises/e/archiver"],
  [73, "POST", "/stagiaires/s/archiver"],
  [74, "POST", "/entreprises"],
  [75, "PATCH", "/entreprises/e"],
  [76, "GET", "/stagiaires"],
  [77, "POST", "/stagiaires"],
  [78, "PATCH", "/stagiaires/s"],
];

beforeEach(() => bd.reinitialiser());

describe("couverture du lot 2", () => {
  it.each(ROUTES)("la route %i (%s %s) est enregistrée", async (_n, methode, chemin) => {
    connecter(bd, null); // sans session : chaque gestionnaire doit répondre 401, pas « non porté »
    try {
      await aiguiller(methode, chemin, {});
    } catch (e) {
      expect((e as { code: string }).code).not.toBe("non_porte");
    }
  });

  it("refuse tout appel sans session par 401, sauf le référentiel embarqué", async () => {
    connecter(bd, null);
    for (const [n, methode, chemin] of ROUTES.filter(([n]) => n !== 18)) {
      await expect(aiguiller(methode, chemin, {}), `route ${n}`).rejects.toMatchObject({
        statut: 401,
      });
    }
    expect(bd.from).not.toHaveBeenCalled();
  });
});
