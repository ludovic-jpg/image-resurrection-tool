import { describe, expect, it } from "vitest";
import { nomSupport, repereModule } from "./supports";

describe("nom et repère d'un support", () => {
  it("garde le nom de l'ancien serveur", () => {
    expect(nomSupport(2, "Les bases")).toBe("Support — Module 2 — Les bases.pptx");
  });
  it("retire les caractères interdits dans un nom de fichier et borne la longueur", () => {
    expect(nomSupport(1, 'A/B:C*D?"E<F>G|H')).toBe("Support — Module 1 — A B C D  E F G H.pptx");
    expect(nomSupport(1, "x".repeat(200)).length).toBe("Support — Module 1 — .pptx".length + 80);
  });
  it("repère le module par son rang (1 = premier)", () => {
    expect(repereModule(3)).toBe("module:3");
  });
});
