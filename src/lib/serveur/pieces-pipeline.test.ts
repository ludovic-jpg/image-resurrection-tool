// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxBd } from "@/test/faux-supabase";
import { reagirAuPipeline } from "./pieces-pipeline.server";

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("point de branchement avec le pipeline (lot 4)", () => {
  it("n'exécute aucune transition : journalise la réaction en attente", async () => {
    const { bd, appels } = fauxBd();
    const r = await reagirAuPipeline(bd as never, { id: "d1", of_id: "of1" }, "enregistrer_accord");
    expect(r).toEqual({ declenchee: false });
    expect(appels.filter((a) => a.table === "dossier_formation")).toHaveLength(0);
    expect(appels.some((a) => a.table === "evenement" && a.op === "insert")).toBe(true);
  });
});
