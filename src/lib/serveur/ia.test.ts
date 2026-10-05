// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxBd } from "@/test/faux-supabase";
import { reponseApi, simulerReseauIa } from "@/test/reponses-ia";
import { creerChiffreur } from "./chiffrement.server";
import {
  assistantPourOrganisme,
  configurationIa,
  IaAnthropic,
  MESSAGE_CLE_ILLISIBLE,
  MESSAGE_IA_DESACTIVEE,
  MESSAGE_IA_NON_CONFIGUREE,
  MODELE_IA_REPLI,
  OUTIL_RECHERCHE_WEB,
} from "./ia.server";

const CLE_HEX = "ab".repeat(32);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const n of [
    "ANTHROPIC_API_KEY",
    "IA_MODELE",
    "IA_WORKSPACE_ID",
    "IA_RECHERCHE_WEB",
    "CLE_SECRETS",
  ])
    vi.stubEnv(n, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const reglages = (lignes: Record<string, string>) =>
  fauxBd((a) =>
    a.table === "reglage"
      ? {
          data: Object.entries(lignes).map(([cle, valeur]) => ({
            cle,
            valeur,
            secret: cle === "ia_cle",
          })),
        }
      : undefined,
  ).bd as never;

describe("adaptateur Anthropic (appel HTTP direct, simulé)", () => {
  it("envoie la clé, la version, le workspace, le modèle et la consigne ; renvoie texte, usage, sources", async () => {
    const { appels } = simulerReseauIa(() => ({ ok: true }));
    const ia = new IaAnthropic({ cle: "sk-test", modele: "modele-x", workspace: "ws-1" });
    const r = await ia.rediger("consigne", "demande", { maxTokens: 123 });
    expect(JSON.parse(r.texte)).toEqual({ ok: true });
    expect(r.usage).toMatchObject({ tokens_entree: 100, tokens_sortie: 200, modele: "modele-x" });
    expect(appels).toHaveLength(1);
    expect(appels[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(appels[0]!.entetes["x-api-key"]).toBe("sk-test");
    expect(appels[0]!.entetes["anthropic-version"]).toBe("2023-06-01");
    expect(appels[0]!.entetes["anthropic-workspace-id"]).toBe("ws-1");
    expect(appels[0]!.corps).toMatchObject({ model: "modele-x", max_tokens: 123 });
    expect(appels[0]!.corps["tools"]).toBeUndefined(); // pas de recherche web sans la demander
  });

  it("n'active la recherche web que si la configuration ET la demande l'autorisent", async () => {
    const { appels } = simulerReseauIa(() => ({ ok: true }));
    await new IaAnthropic({ cle: "k", modele: "m", rechercheWeb: true }).rediger("c", "d", {
      recherche: true,
      maxRecherches: 3,
    });
    await new IaAnthropic({ cle: "k", modele: "m", rechercheWeb: false }).rediger("c", "d", {
      recherche: true,
    });
    expect(appels[0]!.corps["tools"]).toEqual([
      expect.objectContaining({ type: OUTIL_RECHERCHE_WEB, name: "web_search", max_uses: 3 }),
    ]);
    expect(appels[1]!.corps["tools"]).toBeUndefined();
  });

  it("reprend une réponse mise en pause et relève les sources", async () => {
    let n = 0;
    const faux = vi.fn(async () => {
      n++;
      return n === 1
        ? reponseApi({}, { stop_reason: "pause_turn", content: [{ type: "text", text: "…" }] })
        : new Response(
            JSON.stringify({
              content: [
                { type: "text", text: "{}", citations: [{ url: "https://a.fr", title: "A" }] },
              ],
              stop_reason: "end_turn",
              usage: {},
            }),
            { status: 200 },
          );
    });
    const r = await new IaAnthropic({ cle: "k", modele: "m" }, faux as never).rediger("c", "d");
    expect(faux).toHaveBeenCalledTimes(2);
    expect(r.sources).toEqual([{ url: "https://a.fr", titre: "A" }]);
  });

  it("traduit les refus de l'API en messages français, sans recopier le corps d'erreur", async () => {
    const reponse = (status: number, message: string) =>
      vi.fn(
        async () => new Response(JSON.stringify({ error: { type: "x", message } }), { status }),
      );
    const essayer = (f: ReturnType<typeof reponse>) =>
      new IaAnthropic({ cle: "k", modele: "m-inconnu" }, f as never, 1000, 1).rediger("c", "d");
    await expect(essayer(reponse(401, "SECRET-COMPTE"))).rejects.toThrow(/Clé d'API IA refusée/);
    await expect(essayer(reponse(400, "model: not found"))).rejects.toThrow(
      /Modèle IA inconnu \(« m-inconnu »\)/,
    );
    await expect(essayer(reponse(400, "needs workspace"))).rejects.toThrow(/workspace/);
    const rejet = await essayer(reponse(401, "SECRET-COMPTE")).catch((e: Error) => e.message);
    expect(rejet).not.toContain("SECRET-COMPTE");
  });

  it("réessaie trois fois sur 429 / 5xx puis abandonne", async () => {
    const faux = vi.fn(async () => new Response("{}", { status: 529 }));
    await expect(
      new IaAnthropic({ cle: "k", modele: "m" }, faux as never, 1000, 1).rediger("c", "d"),
    ).rejects.toThrow(/saturé|erreur \(529\)/);
    expect(faux).toHaveBeenCalledTimes(3);
  });

  it("refuse une réponse coupée ou vide", async () => {
    const coupee = vi.fn(async () => reponseApi({}, { stop_reason: "max_tokens" }));
    await expect(
      new IaAnthropic({ cle: "k", modele: "m" }, coupee as never).rediger("c", "d"),
    ).rejects.toThrow(/coupée/);
    const vide = vi.fn(
      async () => new Response(JSON.stringify({ content: [], stop_reason: "end_turn" })),
    );
    await expect(
      new IaAnthropic({ cle: "k", modele: "m" }, vide as never).rediger("c", "d"),
    ).rejects.toThrow(/réponse vide/);
  });
});

describe("configuration : réglages de l'organisme, puis secrets du serveur", () => {
  it("sans aucune clé : message français clair, pas d'exception, aucun appel réseau", async () => {
    const { faux } = simulerReseauIa();
    const c = await configurationIa(reglages({}), "of1");
    expect(c).toEqual({ disponible: false, message: MESSAGE_IA_NON_CONFIGUREE });
    const ia = await assistantPourOrganisme(reglages({}), "of1");
    expect(ia.disponible).toBe(false);
    await expect(ia.rediger("c", "d")).rejects.toThrow(/n'est pas configuré/);
    expect(faux).not.toHaveBeenCalled();
  });

  it("clé du serveur : modèle lu dans IA_MODELE, workspace, recherche web activée par défaut", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-serveur");
    vi.stubEnv("IA_MODELE", "modele-du-secret");
    vi.stubEnv("IA_WORKSPACE_ID", "ws-serveur");
    const c = await configurationIa(reglages({}), "of1");
    expect(c).toEqual({
      disponible: true,
      config: {
        cle: "sk-serveur",
        modele: "modele-du-secret",
        workspace: "ws-serveur",
        rechercheWeb: true,
      },
    });
  });

  it("IA_RECHERCHE_WEB=non coupe la recherche web", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk");
    vi.stubEnv("IA_RECHERCHE_WEB", "non");
    const c = await configurationIa(reglages({}), "of1");
    expect(c.disponible && c.config.rechercheWeb).toBe(false);
  });

  it("sans IA_MODELE ni réglage : repli documenté", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk");
    const c = await configurationIa(reglages({}), "of1");
    expect(c.disponible && c.config.modele).toBe(MODELE_IA_REPLI);
  });

  it("clé chiffrée de l'organisme : déchiffrée avec CLE_SECRETS, prioritaire sur celle du serveur", async () => {
    vi.stubEnv("CLE_SECRETS", CLE_HEX);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-serveur");
    vi.stubEnv("IA_MODELE", "modele-du-secret");
    const scelle = await (await creerChiffreur(CLE_HEX)).chiffrer("sk-organisme");
    const c = await configurationIa(
      reglages({
        ia_cle: scelle,
        ia_modele: "modele-organisme",
        ia_recherche_web: "non",
        ia_workspace: "ws-org",
      }),
      "of1",
    );
    expect(c).toEqual({
      disponible: true,
      config: {
        cle: "sk-organisme",
        modele: "modele-organisme",
        workspace: "ws-org",
        rechercheWeb: false,
      },
    });
  });

  it("modèle d'organisme vide : le secret IA_MODELE s'applique à la clé de l'organisme", async () => {
    vi.stubEnv("CLE_SECRETS", CLE_HEX);
    vi.stubEnv("IA_MODELE", "modele-du-secret");
    const scelle = await (await creerChiffreur(CLE_HEX)).chiffrer("sk-organisme");
    const c = await configurationIa(reglages({ ia_cle: scelle, ia_modele: "" }), "of1");
    expect(c.disponible && c.config.modele).toBe("modele-du-secret");
  });

  it("l'organisme peut désactiver l'assistant, même si le serveur a une clé", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-serveur");
    const c = await configurationIa(reglages({ ia_active: "non" }), "of1");
    expect(c).toEqual({ disponible: false, message: MESSAGE_IA_DESACTIVEE });
  });

  it("clé d'organisme illisible : le serveur prend le relais, sinon message dédié", async () => {
    vi.stubEnv("CLE_SECRETS", CLE_HEX);
    const autre = await (await creerChiffreur("cd".repeat(32))).chiffrer("sk-perdue");
    expect(await configurationIa(reglages({ ia_cle: autre }), "of1")).toEqual({
      disponible: false,
      message: MESSAGE_CLE_ILLISIBLE,
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-serveur");
    const c = await configurationIa(reglages({ ia_cle: autre }), "of1");
    expect(c.disponible && c.config.cle).toBe("sk-serveur");
  });

  it("ne lit que les réglages de l'organisme de l'acteur", async () => {
    const faux = fauxBd(() => ({ data: [] }));
    await configurationIa(faux.bd as never, "of-42");
    const lecture = faux.appels.find((a) => a.table === "reglage")!;
    expect(lecture.filtres).toContainEqual(["eq", "of_id", "of-42"]);
  });
});
