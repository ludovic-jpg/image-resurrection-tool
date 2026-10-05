// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { urlApplication, variable } from "./config.server";

afterEach(() => vi.unstubAllEnvs());

describe("configuration du serveur", () => {
  it("traite une variable vide ou absente comme non définie, et rogne les espaces", () => {
    vi.stubEnv("RESEND_API_KEY", "  ");
    expect(variable("RESEND_API_KEY")).toBeUndefined();
    vi.stubEnv("RESEND_API_KEY", " re_abc ");
    expect(variable("RESEND_API_KEY")).toBe("re_abc");
  });
  it("APP_URL sans « / » final ; sans APP_URL ni requête : chaîne vide, pas d'exception", async () => {
    vi.stubEnv("APP_URL", "https://app.exemple.fr//");
    expect(await urlApplication()).toBe("https://app.exemple.fr");
    vi.stubEnv("APP_URL", "");
    expect(await urlApplication()).toBe("");
  });
});
