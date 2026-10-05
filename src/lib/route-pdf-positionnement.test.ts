// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxBd } from "@/test/faux-supabase";

const etat = vi.hoisted(() => ({ bd: null as unknown }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (chemin: string) => (options: unknown) => ({ chemin, options }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return etat.bd;
  },
}));

type Route = {
  chemin: string;
  options: {
    server: { handlers: { GET: (c: { params: { jeton: string } }) => Promise<Response> } };
  };
};
const { Route } = (await import("@/routes/api.public.positionnement.$jeton.pdf")) as unknown as {
  Route: Route;
};
const GET = (jeton: string) => Route.options.server.handlers.GET({ params: { jeton } });

const SIGNE = {
  id: "pos1",
  of_id: "of1",
  formateur_id: "f1",
  stagiaire_id: "s1",
  statut: "complet",
  chemin_pdf: "of1/positionnements/pos1/Positionnement Zoé.html",
  expire_le: "2026-01-01T00:00:00Z",
  archive_le: null,
};
const monter = (ligne: unknown) => {
  const faux = fauxBd((a) => {
    if (a.table === "positionnement") return { data: ligne ? [ligne] : [] };
    if (a.table === "stagiaire") return { data: [{ id: "s1" }] };
    return undefined;
  });
  etat.bd = faux.bd;
  return faux;
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("route 13 : GET /api/public/positionnement/:jeton/pdf", () => {
  it("est déclarée sous /api/public/, sans middleware d'authentification", () => {
    expect(Route.chemin).toBe("/api/public/positionnement/$jeton/pdf");
    expect(Object.keys(Route.options.server.handlers)).toEqual(["GET"]);
  });

  it("sert le document en pièce jointe, hors de toute exécution de script", async () => {
    monter(SIGNE);
    const r = await GET("c".repeat(64));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(r.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Positionnement Zoe\.html"; filename\*=UTF-8''Positionnement%20Zo%C3%A9\.html$/,
    );
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("jeton inconnu ou archivé : 404 et le même message, sans rien révéler", async () => {
    monter(null);
    const inconnu = await GET("c".repeat(64));
    monter({ ...SIGNE, archive_le: "2026-10-01T00:00:00Z" });
    const archive = await GET("c".repeat(64));
    expect(inconnu.status).toBe(404);
    expect(await archive.text()).toBe(await inconnu.text());
  });

  it("pas encore signé : 409 clair", async () => {
    monter({ ...SIGNE, statut: "envoye", chemin_pdf: null, expire_le: "2099-01-01T00:00:00Z" });
    const r = await GET("c".repeat(64));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "conflit" });
  });

  it("une panne interne ne fuit aucun détail technique (500 générique)", async () => {
    etat.bd = fauxBd(() => ({ error: { message: "connexion refusée à 10.0.0.5" } })).bd;
    const r = await GET("c".repeat(64));
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("10.0.0.5");
  });
});
