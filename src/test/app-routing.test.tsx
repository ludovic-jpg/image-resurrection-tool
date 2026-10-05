import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
function routeurDeTest() {
  return createRouter({ routeTree, context: { queryClient: new QueryClient() } });
}

describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const matches = routeurDeTest().matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it.each(["/connexion", "/inscription", "/mot-de-passe-oublie", "/reinitialiser", "/invitation"])(
    "matches the public access page %s",
    (chemin) => {
      const matches = routeurDeTest().matchRoutes(chemin);

      expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
    },
  );

  it("keeps the invitation token from the URL", () => {
    const matches = routeurDeTest().matchRoutes("/invitation", { jeton: "abc123" });

    expect(matches.at(-1)?.search).toMatchObject({ jeton: "abc123" });
  });
});
