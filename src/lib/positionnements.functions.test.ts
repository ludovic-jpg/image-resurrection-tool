// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, fauxBd, moi, type Appel } from "@/test/faux-supabase";

const etat = vi.hoisted(() => ({ bd: null as unknown, middlewares: 0, requete: null as unknown }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validation: { parse(x: unknown): unknown } | undefined;
    const b = {
      middleware: () => {
        etat.middlewares++;
        return b;
      },
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
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => etat.requete }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return etat.bd;
  },
}));

const { inviterAuPositionnement, relancerPositionnement, lienPdfPositionnement } =
  await import("./positionnements.functions");
const nbMiddlewaresAuth = etat.middlewares;
const { lirePositionnementPublic, enregistrerBrouillonPublic, signerPositionnementPublic } =
  await import("./public-positionnement.functions");
const nbMiddlewaresTotal = etat.middlewares;

type Acteur = Record<string, unknown>;
const contexte = (acteur: Acteur | null) => ({
  supabase: { rpc: vi.fn(async () => moi(acteur)) },
  userId: (acteur?.["utilisateur_id"] as string) ?? "inconnu",
});
type Retour = { ok: boolean; [k: string]: unknown };
const appeler = (fn: unknown, acteur: Acteur | null, data?: unknown) =>
  (fn as (e: unknown) => Promise<Retour>)({ data, context: contexte(acteur) });
const sansSession = (fn: unknown, data: unknown) =>
  (fn as (e: unknown) => Promise<Retour>)({ data });
const ecritures = (appels: Appel[]) => appels.filter((a) => a.op !== "select");

const ENTREE = { stagiaire_id: "s1", formation_id: "fo1", message: "" };

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("APP_URL", "https://app.exemple.fr");
  vi.spyOn(console, "error").mockImplementation(() => {});
  etat.requete = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("refus par rôle (fonctions du formateur)", () => {
  it("inviter : l'admin, l'apprenant et le candidat reçoivent un 403 et rien n'est écrit", async () => {
    for (const acteur of [ACTEURS.admin, ACTEURS.apprenant, ACTEURS.candidat]) {
      const faux = fauxBd();
      etat.bd = faux.bd;
      const r = await appeler(inviterAuPositionnement, acteur, ENTREE);
      expect(r).toMatchObject({ ok: false, code: "interdit", statut: 403 });
      expect(faux.appels).toHaveLength(0);
    }
  });

  it("relancer : l'admin reçoit « la relance est faite par le formateur », l'apprenant et le candidat 403", async () => {
    for (const acteur of [ACTEURS.admin, ACTEURS.apprenant, ACTEURS.candidat]) {
      const faux = fauxBd();
      etat.bd = faux.bd;
      const r = await appeler(relancerPositionnement, acteur, { id: "pos1" });
      expect(r).toMatchObject({ ok: false, code: "interdit", statut: 403 });
      expect(faux.appels).toHaveLength(0);
    }
    const r = await appeler(relancerPositionnement, ACTEURS.admin, { id: "pos1" });
    expect(r).toMatchObject({ message: "La relance est faite par le formateur." });
  });

  it("lien du document : l'apprenant reçoit un 403", async () => {
    const faux = fauxBd();
    etat.bd = faux.bd;
    expect(await appeler(lienPdfPositionnement, ACTEURS.apprenant, { id: "pos1" })).toMatchObject({
      ok: false,
      statut: 403,
    });
    expect(faux.appels).toHaveLength(0);
  });

  it("session absente ou profil inactif : 401 (rien n'est lu)", async () => {
    const faux = fauxBd();
    etat.bd = faux.bd;
    expect(await appeler(inviterAuPositionnement, null, ENTREE)).toMatchObject({
      ok: false,
      statut: 401,
    });
    expect(faux.appels).toHaveLength(0);
  });

  it("l'acteur ne vient jamais du corps : un of_id, un formateur_id ou un rôle glissés dans le corps sont ignorés", async () => {
    const faux = fauxBd((a) => {
      if (a.table === "stagiaire") return { data: [] };
      return undefined;
    });
    etat.bd = faux.bd;
    const r = await appeler(inviterAuPositionnement, ACTEURS.formateurValide, {
      ...ENTREE,
      of_id: "of-autre",
      formateur_id: "f-autre",
      role: "admin",
    });
    expect(r).toMatchObject({ ok: false, code: "introuvable" });
    const lecture = faux.appels[0]!;
    expect(JSON.stringify(lecture.filtres)).toContain('"of1"');
    expect(JSON.stringify(lecture.filtres)).toContain('"f1"');
    expect(JSON.stringify(lecture.filtres)).not.toContain("autre");
  });

  it("relancer : un positionnement d'un autre formateur est introuvable (404), jamais interdit", async () => {
    const faux = fauxBd(() => ({ data: [] }));
    etat.bd = faux.bd;
    expect(
      await appeler(relancerPositionnement, ACTEURS.formateurValide, { id: "pos-autrui" }),
    ).toMatchObject({
      ok: false,
      code: "introuvable",
      statut: 404,
    });
    expect(ecritures(faux.appels)).toEqual([]);
  });
});

describe("fonctions publiques : aucune authentification", () => {
  it("n'enregistrent aucun middleware d'authentification (les fonctions du formateur en ont tous un)", () => {
    expect(nbMiddlewaresAuth).toBe(3);
    expect(nbMiddlewaresTotal).toBe(nbMiddlewaresAuth);
  });

  it("jeton inconnu : 404 clair, sans session et sans appel à s4m_moi", async () => {
    const faux = fauxBd(() => ({ data: [] }));
    etat.bd = faux.bd;
    const jeton = "z".repeat(64);
    for (const [fn, data] of [
      [lirePositionnementPublic, { jeton }],
      [enregistrerBrouillonPublic, { jeton, reponses: {} }],
      [signerPositionnementPublic, { jeton, reponses: {} }],
    ] as const) {
      expect(await sansSession(fn, data)).toMatchObject({
        ok: false,
        code: "introuvable",
        statut: 404,
        message: "Lien de positionnement introuvable.",
      });
    }
    expect(faux.bd.rpc).not.toHaveBeenCalled();
    expect(ecritures(faux.appels)).toEqual([]);
  });

  it("la signature consigne l'adresse IP de la requête (Cloudflare), jamais celle du corps", async () => {
    etat.requete = {
      headers: new Headers({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "10.0.0.1" }),
    };
    const TEST = {
      titre: "T",
      questions: [{ enonce: "Q", propositions: ["a", "b"], bonne_reponse: 0 }],
    };
    const faux = fauxBd((a) => {
      if (a.table === "positionnement" && a.op === "select")
        return {
          data: [
            {
              id: "pos1",
              of_id: "of1",
              formateur_id: "f1",
              stagiaire_id: "s1",
              statut: "envoye",
              formation_titre: "TIG",
              questionnaire: TEST,
              questions_recueil: [],
              expire_le: "2099-01-01T00:00:00Z",
              archive_le: null,
            },
          ],
        };
      if (a.table === "positionnement") return { data: [{ id: "pos1" }] };
      if (a.table === "stagiaire")
        return {
          data: [
            {
              id: "s1",
              entreprise_id: null,
              stagiaire_prenom: "A",
              stagiaire_nom: "B",
              stagiaire_email: "a@b.fr",
            },
          ],
        };
      return undefined;
    });
    etat.bd = faux.bd;
    const r = await sansSession(signerPositionnementPublic, {
      jeton: "z".repeat(64),
      reponses: {
        recueil: {
          poste_anciennete: "x",
          niveau_maitrise: "Débutant",
          attentes: "x",
          besoins_principaux: "x",
          handicap: "Non",
          programme_transmis: "Oui",
        },
        reponses: [0],
        date: "2026-10-05",
        trace_png: `data:image/png;base64,${"A".repeat(700)}`,
        lieu: "Rixheim",
        consentement: true,
        adresse_ip: "6.6.6.6",
      },
    });
    expect(r).toMatchObject({ ok: true, donnees: { statut: "complet" } });
    const evt = faux.appels.find((a) => a.table === "evenement")!;
    expect((evt.valeurs as { detail: { adresse_ip: string } }).detail.adresse_ip).toBe(
      "198.51.100.9",
    );
  });
});
