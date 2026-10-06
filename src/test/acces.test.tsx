import { QueryClient } from "@tanstack/react-query";
import { createRouter, isRedirect, rootRouteId } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Le client Supabase est simulé : aucun appel réseau pendant les tests.
const getUser = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: () => getUser() } },
}));

import { routeTree } from "@/routeTree.gen";
import { Route as RouteProtegee } from "@/routes/_authenticated/route";
import { messageConnexion, messageInscription } from "@/client/auth/messages";

function routeur() {
  return createRouter({ routeTree, context: { queryClient: new QueryClient() } });
}

describe("Carte des routes publiques", () => {
  it.each([
    "/",
    "/connexion",
    "/inscription",
    "/mot-de-passe-oublie",
    "/reinitialisation",
    "/tableau-de-bord",
  ])("%s correspond à une page", (chemin) => {
    const correspondances = routeur().matchRoutes(chemin);
    expect(correspondances.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("une adresse inconnue n'ouvre aucune page", () => {
    const correspondances = routeur().matchRoutes("/page-inexistante");
    expect(correspondances.at(-1)?.routeId).toBe(rootRouteId);
  });
});

describe("Garde de l'espace connecté", () => {
  const beforeLoad = RouteProtegee.options.beforeLoad as unknown as () => Promise<unknown>;

  beforeEach(() => getUser.mockReset());

  it("renvoie vers /connexion sans session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const erreur = await beforeLoad().catch((e: unknown) => e);
    expect(isRedirect(erreur)).toBe(true);
    expect((erreur as { options: { to: string } }).options.to).toBe("/connexion");
  });

  it("renvoie vers /connexion si Supabase signale une erreur", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: new Error("jeton expiré") });
    const erreur = await beforeLoad().catch((e: unknown) => e);
    expect(isRedirect(erreur)).toBe(true);
  });

  it("laisse passer un utilisateur connecté et transmet son profil", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.fr" } }, error: null });
    await expect(beforeLoad()).resolves.toEqual({ user: { id: "u1", email: "a@b.fr" } });
  });
});

describe("Messages d'erreur d'authentification", () => {
  it("distingue l'e-mail non confirmé d'un mauvais mot de passe", () => {
    expect(messageConnexion({ code: "email_not_confirmed" })).toMatch(/pas encore confirmée/);
    expect(messageConnexion({ code: "invalid_credentials" })).toMatch(/incorrect/);
  });

  it("explique un refus de l'organisme (trigger d'inscription)", () => {
    expect(messageInscription({ code: "unexpected_failure" })).toMatch(/organisme/);
  });

  it("ne laisse jamais passer de message technique en anglais", () => {
    const inconnu = { code: "quelque_chose", message: "Database error saving new user" };
    expect(messageConnexion(inconnu)).not.toMatch(/Database/);
    expect(messageInscription(inconnu)).not.toMatch(/Database/);
  });
});
