// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, aFiltre, fauxBd, moi, type Appel } from "@/test/faux-supabase";

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

const { soumettreCandidature, deciderCandidature } = await import("./candidatures.functions");

type Acteur = Record<string, unknown>;
const contexte = (acteur: Acteur | null) => ({
  supabase: { rpc: vi.fn(async () => moi(acteur)) },
  userId: (acteur?.["utilisateur_id"] as string) ?? "inconnu",
});
// Les fonctions serveur sont appelées comme le fait TanStack : { data, context }. Le middleware est simulé.
const appeler = (fn: unknown, acteur: Acteur | null, data?: unknown) =>
  (fn as (e: unknown) => Promise<{ ok: boolean; [k: string]: unknown }>)({
    data,
    context: contexte(acteur),
  });

const FICHE_COMPLETE = {
  id: "f2",
  of_id: "of1",
  statut_candidature: "brouillon",
  formateur_prenom: "Paul",
  formateur_nom: "Candidat",
  formateur_email: "paul@of.fr",
  formateur_telephone: "06 00 00 00 00",
  parcours: "20 ans de métier",
};

function scenario(
  options: {
    fiche?: Record<string, unknown> | null;
    pieces?: string[];
    admins?: string[];
    majVide?: boolean;
  } = {},
) {
  const fiche = options.fiche === undefined ? FICHE_COMPLETE : options.fiche;
  const faux = fauxBd((a: Appel) => {
    if (a.table === "formateur" && a.op === "select") return { data: fiche ? [fiche] : [] };
    if (a.table === "formateur" && a.op === "update")
      return { data: options.majVide ? [] : [{ id: (fiche as { id: string }).id }] };
    if (a.table === "piece_formateur")
      return { data: (options.pieces ?? ["cv", "identite", "diplome"]).map((type) => ({ type })) };
    if (a.table === "organisme_formation") return { data: [{ of_nom: "Mon OF" }] };
    if (a.table === "utilisateur")
      return { data: (options.admins ?? ["admin@of.fr"]).map((email) => ({ email })) };
    return undefined;
  });
  etat.bd = faux.bd;
  return faux;
}
const ecritures = (appels: Appel[], table: string, op: Appel["op"]) =>
  appels.filter((a) => a.table === table && a.op === op);

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("APP_URL", "https://app.exemple.fr");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("soumettreCandidature (route 23)", () => {
  it("refuse tout autre rôle qu'un formateur, sans toucher à la base", async () => {
    for (const a of [ACTEURS.admin, ACTEURS.apprenant]) {
      const { appels } = scenario();
      const r = await appeler(soumettreCandidature, a);
      expect(r).toMatchObject({ ok: false, code: "interdit", statut: 403 });
      expect(appels).toHaveLength(0);
    }
  });

  it("une candidature incomplète renvoie la liste des manques et n'écrit rien", async () => {
    const { appels } = scenario({ pieces: ["cv"] });
    const r = await appeler(soumettreCandidature, ACTEURS.candidat);
    expect(r).toMatchObject({
      ok: false,
      code: "invalide",
      message: "Votre candidature est incomplète.",
      details: { manques: ["Pièce d'identité", "Diplômes et titres"] },
    });
    expect(ecritures(appels, "formateur", "update")).toHaveLength(0);
    expect(ecritures(appels, "evenement", "insert")).toHaveLength(0);
  });

  it("refuse une candidature déjà soumise ou validée", async () => {
    scenario({ fiche: { ...FICHE_COMPLETE, statut_candidature: "soumise" } });
    expect(await appeler(soumettreCandidature, ACTEURS.candidat)).toMatchObject({
      ok: false,
      code: "conflit",
    });
    scenario({ fiche: { ...FICHE_COMPLETE, statut_candidature: "validee" } });
    expect(await appeler(soumettreCandidature, ACTEURS.candidat)).toMatchObject({
      ok: false,
      message: "Votre candidature est déjà validée.",
    });
  });

  it("soumet : statut, journal et un e-mail consigné par administrateur actif", async () => {
    const { appels } = scenario({ admins: ["a1@of.fr", "a2@of.fr"] });
    const r = await appeler(soumettreCandidature, ACTEURS.candidat);
    expect(r).toEqual({ ok: true, donnees: { formateur_id: "f2" } });

    const [maj] = ecritures(appels, "formateur", "update");
    expect(maj!.valeurs).toMatchObject({ statut_candidature: "soumise", motif_decision: "" });
    // Filtré sur l'ancien statut (anti double soumission) et sur la fiche de l'acteur reconstruit.
    expect(aFiltre(maj!, "eq", "statut_candidature", "brouillon")).toBe(true);
    expect(aFiltre(maj!, "eq", "id", "f2")).toBe(true);

    const [journal] = ecritures(appels, "evenement", "insert");
    expect(journal!.valeurs).toMatchObject({
      of_id: "of1",
      acteur_id: "u-cand",
      acteur_role: "formateur",
      type: "candidature_soumise",
    });

    const courriers = ecritures(appels, "courrier", "insert");
    expect(courriers.map((c) => (c.valeurs as { destinataire: string }).destinataire)).toEqual([
      "a1@of.fr",
      "a2@of.fr",
    ]);
    expect(courriers[0]!.valeurs).toMatchObject({
      type: "candidature_soumise",
      statut: "journalise",
      sujet: "Nouvelle candidature de formateur — Paul Candidat",
    });
    expect((courriers[0]!.valeurs as { corps_html: string }).corps_html).toContain(
      "https://app.exemple.fr/admin/candidatures",
    );
  });

  it("l'identité vient du jeton : un identifiant glissé dans l'appel est ignoré", async () => {
    const { appels } = scenario();
    await appeler(soumettreCandidature, ACTEURS.candidat, {
      formateur_id: "f-autre",
      of_id: "of9",
    });
    const [lecture] = appels.filter((a) => a.table === "formateur" && a.op === "select");
    expect(aFiltre(lecture!, "eq", "id", "f2")).toBe(true);
    expect(aFiltre(lecture!, "eq", "of_id", "of1")).toBe(true);
  });

  it("si la fiche a changé entre-temps (mise à jour vide) : conflit, ni journal ni e-mail", async () => {
    const { appels } = scenario({ majVide: true });
    expect(await appeler(soumettreCandidature, ACTEURS.candidat)).toMatchObject({
      ok: false,
      code: "conflit",
    });
    expect(ecritures(appels, "evenement", "insert")).toHaveLength(0);
    expect(ecritures(appels, "courrier", "insert")).toHaveLength(0);
  });

  it("fiche introuvable : « introuvable »", async () => {
    scenario({ fiche: null });
    expect(await appeler(soumettreCandidature, ACTEURS.candidat)).toMatchObject({
      ok: false,
      code: "introuvable",
    });
  });
});

describe("deciderCandidature (route 27)", () => {
  const SOUMISE = { ...FICHE_COMPLETE, statut_candidature: "soumise" };

  it("un formateur (validé ou candidat) reçoit un 403 français propre, sans accès à la base", async () => {
    for (const a of [ACTEURS.formateurValide, ACTEURS.candidat, ACTEURS.apprenant]) {
      const { appels } = scenario({ fiche: SOUMISE });
      const r = await appeler(deciderCandidature, a, { formateur_id: "f2", validee: true });
      expect(r).toEqual({
        ok: false,
        code: "interdit",
        statut: 403,
        message: "Cette action est réservée à l'administrateur de l'organisme.",
        details: null,
      });
      expect(appels).toHaveLength(0);
    }
  });

  it("valide : statut, date, journal, e-mail au candidat", async () => {
    const { appels } = scenario({ fiche: SOUMISE });
    const r = await appeler(deciderCandidature, ACTEURS.admin, {
      formateur_id: "f2",
      validee: true,
    });
    expect(r).toMatchObject({ ok: true, donnees: { formateur_id: "f2", statut: "validee" } });
    const [maj] = ecritures(appels, "formateur", "update");
    expect(maj!.valeurs).toMatchObject({ statut_candidature: "validee", motif_decision: "" });
    expect(aFiltre(maj!, "eq", "statut_candidature", "soumise")).toBe(true);
    const [journal] = ecritures(appels, "evenement", "insert");
    expect(journal!.valeurs).toMatchObject({
      acteur_id: "u-admin",
      acteur_role: "admin",
      type: "candidature_validee",
      libelle: "Candidature de Paul Candidat validée",
    });
    const [courrier] = ecritures(appels, "courrier", "insert");
    expect(courrier!.valeurs).toMatchObject({
      type: "candidature_decision",
      destinataire: "paul@of.fr",
      sujet: "Votre candidature est validée",
      formateur_id: "f2",
    });
  });

  it("rejette avec motif ; sans motif : erreur de champ et aucune écriture", async () => {
    const { appels } = scenario({ fiche: SOUMISE });
    const sans = await appeler(deciderCandidature, ACTEURS.admin, {
      formateur_id: "f2",
      validee: false,
      motif: "  ",
    });
    expect(sans).toMatchObject({
      ok: false,
      code: "invalide",
      message: "Un motif est obligatoire pour rejeter une candidature.",
      details: { champs: { motif: expect.any(String) } },
    });
    expect(ecritures(appels, "formateur", "update")).toHaveLength(0);

    const avec = await appeler(deciderCandidature, ACTEURS.admin, {
      formateur_id: "f2",
      validee: false,
      motif: " Pièces illisibles ",
    });
    expect(avec).toMatchObject({ ok: true, donnees: { statut: "refusee" } });
    expect(ecritures(appels, "formateur", "update")[0]!.valeurs).toMatchObject({
      statut_candidature: "refusee",
      motif_decision: "Pièces illisibles",
    });
    const [courrier] = ecritures(appels, "courrier", "insert");
    expect((courrier!.valeurs as { corps_html: string }).corps_html).toContain("Pièces illisibles");
  });

  it("une candidature d'un autre organisme est « introuvable » (filtre sur l'OF de l'admin)", async () => {
    const { appels } = scenario({ fiche: null });
    const r = await appeler(deciderCandidature, ACTEURS.admin, {
      formateur_id: "f-ailleurs",
      validee: true,
    });
    expect(r).toMatchObject({ ok: false, code: "introuvable", statut: 404 });
    const [lecture] = appels.filter((a) => a.table === "formateur");
    expect(aFiltre(lecture!, "eq", "of_id", "of1")).toBe(true);
  });

  it("seule une candidature soumise reçoit une décision", async () => {
    scenario({ fiche: FICHE_COMPLETE });
    expect(
      await appeler(deciderCandidature, ACTEURS.admin, { formateur_id: "f2", validee: true }),
    ).toMatchObject({
      ok: false,
      code: "conflit",
      message: "Seule une candidature soumise peut recevoir une décision.",
    });
  });

  it("deux décisions simultanées : la seconde est refusée (mise à jour vide)", async () => {
    const { appels } = scenario({ fiche: SOUMISE, majVide: true });
    expect(
      await appeler(deciderCandidature, ACTEURS.admin, { formateur_id: "f2", validee: true }),
    ).toMatchObject({
      ok: false,
      code: "conflit",
    });
    expect(ecritures(appels, "evenement", "insert")).toHaveLength(0);
  });

  it("rejette une entrée mal formée avant tout traitement", () => {
    scenario({ fiche: SOUMISE });
    expect(() =>
      appeler(deciderCandidature, ACTEURS.admin, { formateur_id: "", validee: "oui" }),
    ).toThrow();
  });
});
