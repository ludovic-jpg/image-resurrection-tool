// @vitest-environment node
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, fauxBd, moi, type Appel } from "@/test/faux-supabase";
import { creerChiffreur } from "./serveur/chiffrement.server";

const etat = vi.hoisted(() => ({ bd: null as unknown }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validation: { parse(x: unknown): unknown } | undefined;
    const b = {
      middleware: () => b,
      validator: (v: { parse(x: unknown): unknown }) => ((validation = v), b),
      handler:
        (fn: (a: { data: unknown; context: unknown }) => unknown) =>
        (entree?: { data?: unknown; context?: unknown }) =>
          fn({
            data: validation ? validation.parse(entree?.data) : entree?.data,
            context: entree?.context,
          }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return etat.bd;
  },
}));

const { enregistrerReglages, etatConfiguration } = await import("./reglages.functions");

type Acteur = Record<string, unknown>;
const appeler = (fn: unknown, acteur: Acteur, data?: unknown) =>
  (fn as (e: unknown) => Promise<{ ok: boolean; [k: string]: unknown }>)({
    data,
    context: {
      supabase: { rpc: vi.fn(async () => moi(acteur)) },
      userId: acteur["utilisateur_id"],
    },
  });

const CLE = randomBytes(32).toString("hex");
const ecritures = (appels: Appel[], table: string, op: Appel["op"]) =>
  appels.filter((a) => a.table === table && a.op === op);

beforeEach(() => {
  vi.stubEnv("CLE_SECRETS", CLE);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("enregistrerReglages (route 31)", () => {
  it("refuse tout autre rôle que l'administrateur, sans écrire", async () => {
    for (const a of [ACTEURS.formateurValide, ACTEURS.candidat, ACTEURS.apprenant]) {
      const { bd, appels } = fauxBd();
      etat.bd = bd;
      const r = await appeler(enregistrerReglages, a, { ia_cle: "sk-secret" });
      expect(r).toMatchObject({ ok: false, code: "interdit", statut: 403 });
      expect(appels).toHaveLength(0);
    }
  });

  it("chiffre les secrets (format v1:, relisible) et n'écrit jamais le clair", async () => {
    const { bd, appels } = fauxBd();
    etat.bd = bd;
    const r = await appeler(enregistrerReglages, ACTEURS.admin, {
      ia_cle: "sk-ant-TRES-SECRET",
      smtp_mot_de_passe: "mdp-smtp-SECRET",
      ia_modele: "claude-sonnet-5-5",
      courrier_actif: "oui",
    });
    // L'ordre suit le catalogue des réglages, pas l'ordre d'envoi.
    expect(r["ok"]).toBe(true);
    expect([...(r["donnees"] as { cles: string[] }).cles].sort()).toEqual([
      "courrier_actif",
      "ia_cle",
      "ia_modele",
      "smtp_mot_de_passe",
    ]);
    const [upsert] = ecritures(appels, "reglage", "upsert");
    expect(upsert!.options).toEqual({ onConflict: "of_id,cle" });
    const lignes = upsert!.valeurs as Array<{
      cle: string;
      valeur: string;
      secret: boolean;
      of_id: string;
    }>;
    expect(lignes.every((l) => l.of_id === "of1")).toBe(true);
    const parCle = Object.fromEntries(lignes.map((l) => [l.cle, l]));
    expect(parCle["ia_cle"]).toMatchObject({ secret: true });
    expect(parCle["ia_cle"]!.valeur.startsWith("v1:")).toBe(true);
    expect(parCle["ia_modele"]).toMatchObject({ secret: false, valeur: "claude-sonnet-5-5" });
    const chiffreur = await creerChiffreur(CLE);
    expect(await chiffreur.dechiffrer(parCle["ia_cle"]!.valeur)).toBe("sk-ant-TRES-SECRET");
    expect(await chiffreur.dechiffrer(parCle["smtp_mot_de_passe"]!.valeur)).toBe("mdp-smtp-SECRET");
    // Nulle part dans ce qui part en base (réglages, journal) ne figure le clair.
    expect(JSON.stringify(appels)).not.toContain("TRES-SECRET");
    expect(JSON.stringify(appels)).not.toContain("mdp-smtp-SECRET");
  });

  it("le journal ne reçoit que les noms des clés modifiées", async () => {
    const { bd, appels } = fauxBd();
    etat.bd = bd;
    await appeler(enregistrerReglages, ACTEURS.admin, { smtp_hote: "smtp.x.fr", ia_cle: "sk-xx" });
    const [journal] = ecritures(appels, "evenement", "insert");
    expect(journal!.valeurs).toMatchObject({
      type: "reglages_modifies",
      acteur_role: "admin",
      detail: { cles: ["ia_cle", "smtp_hote"] },
    });
  });

  it("sans CLE_SECRETS, refuse d'écrire un secret avec un message qui nomme le secret à définir", async () => {
    vi.stubEnv("CLE_SECRETS", "");
    const { bd, appels } = fauxBd();
    etat.bd = bd;
    const r = await appeler(enregistrerReglages, ACTEURS.admin, {
      ia_cle: "sk-xx",
      ia_modele: "m",
    });
    expect(r).toMatchObject({ ok: false, code: "indisponible", statut: 503 });
    expect(r["message"]).toEqual(expect.stringContaining("CLE_SECRETS"));
    expect(ecritures(appels, "reglage", "upsert")).toHaveLength(0);
  });

  it("sans CLE_SECRETS, les réglages sans secret et l'effacement d'un secret restent possibles", async () => {
    vi.stubEnv("CLE_SECRETS", "");
    const { bd, appels } = fauxBd();
    etat.bd = bd;
    const r = await appeler(enregistrerReglages, ACTEURS.admin, {
      ia_modele: "m",
      smtp_mot_de_passe: "-",
    });
    expect(r["ok"]).toBe(true);
    const lignes = ecritures(appels, "reglage", "upsert")[0]!.valeurs as Array<{
      cle: string;
      valeur: string;
      secret: boolean;
    }>;
    expect(lignes).toEqual([
      expect.objectContaining({ cle: "ia_modele", valeur: "m", secret: false }),
      expect.objectContaining({ cle: "smtp_mot_de_passe", valeur: "", secret: true }),
    ]);
  });

  it("un secret vide est ignoré (« laisser inchangé »)", async () => {
    const { bd, appels } = fauxBd();
    etat.bd = bd;
    const r = await appeler(enregistrerReglages, ACTEURS.admin, { ia_cle: "", smtp_port: "465" });
    expect(r).toEqual({ ok: true, donnees: { cles: ["smtp_port"] } });
    expect((ecritures(appels, "reglage", "upsert")[0]!.valeurs as unknown[]).length).toBe(1);
  });

  it("rien à modifier : aucune écriture, aucun journal", async () => {
    const { bd, appels } = fauxBd();
    etat.bd = bd;
    expect(await appeler(enregistrerReglages, ACTEURS.admin, { ia_cle: "" })).toEqual({
      ok: true,
      donnees: { cles: [] },
    });
    expect(appels).toHaveLength(0);
  });

  it("valeurs invalides : erreurs par champ, rien d'écrit", async () => {
    const { bd, appels } = fauxBd();
    etat.bd = bd;
    const r = await appeler(enregistrerReglages, ACTEURS.admin, {
      smtp_port: "46x",
      courrier_actif: "peut-être",
    });
    expect(r).toMatchObject({
      ok: false,
      code: "invalide",
      details: { champs: { smtp_port: "Port invalide.", courrier_actif: expect.any(String) } },
    });
    expect(appels).toHaveLength(0);
  });
});

describe("etatConfiguration", () => {
  it("refuse un non-administrateur", async () => {
    etat.bd = fauxBd().bd;
    expect(await appeler(etatConfiguration, ACTEURS.formateurValide)).toMatchObject({
      ok: false,
      statut: 403,
    });
  });

  it("dit seulement si chaque secret est défini, sans jamais en révéler la valeur", async () => {
    etat.bd = fauxBd().bd;
    vi.stubEnv("RESEND_API_KEY", "re_VALEUR_SECRETE");
    vi.stubEnv("COURRIER_EXPEDITEUR", "");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const r = await appeler(etatConfiguration, ACTEURS.admin);
    expect(r).toEqual({
      ok: true,
      donnees: {
        cle_secrets: true,
        envoi_reel: true,
        expediteur_par_defaut: false,
        app_url: false,
        ia_defaut_serveur: false,
      },
    });
    expect(JSON.stringify(r)).not.toContain("VALEUR_SECRETE");
    expect(JSON.stringify(r)).not.toContain(CLE);
  });
});
