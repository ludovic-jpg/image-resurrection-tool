// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fauxBd } from "@/test/faux-supabase";
import { journaliser } from "./journal.server";

describe("journal", () => {
  it("écrit dans `evenement` l'id et le rôle de l'acteur, sans autre champ de l'acteur", async () => {
    const { bd, appels } = fauxBd();
    await journaliser(bd as never, {
      of_id: "of1",
      acteur: { utilisateur_id: "u1", role: "admin", nom: "Alice", email: "a@b.fr" } as never,
      type: "candidature_validee",
      libelle: "Candidature validée",
      detail: { formateur_id: "f1" },
    });
    expect(appels).toHaveLength(1);
    expect(appels[0]).toMatchObject({
      table: "evenement",
      op: "insert",
      valeurs: {
        of_id: "of1",
        dossier_id: null,
        acteur_id: "u1",
        acteur_role: "admin",
        type: "candidature_validee",
        detail: { formateur_id: "f1" },
      },
    });
    expect(JSON.stringify(appels[0]!.valeurs)).not.toContain("a@b.fr");
  });

  it("note une action sans utilisateur comme venant du « systeme »", async () => {
    const { bd, appels } = fauxBd();
    await journaliser(bd as never, { of_id: "of1", acteur: "systeme", type: "t", libelle: "l" });
    expect(appels[0]!.valeurs).toMatchObject({ acteur_id: null, acteur_role: "systeme" });
  });

  it("lève une exception si l'écriture échoue : pas d'action sans trace", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { bd } = fauxBd(() => ({ error: { message: "rls" } }));
    await expect(
      journaliser(bd as never, { of_id: "of1", acteur: "systeme", type: "t", libelle: "l" }),
    ).rejects.toThrow(/Journal/);
    spy.mockRestore();
  });
});
