// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, moi } from "@/test/faux-supabase";
import { bdMemoire, ecritures, type Ligne, type Tables } from "@/test/bd-memoire";

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

const {
  creerDossier,
  definirStagiaires,
  inviterApprenantDossier,
  relancerApprenantDossier,
  recreerDossier,
  lireFinancesDossier,
} = await import("./dossiers.functions");
const { brancherPortsLots, reinitialiserPortsLots } = await import("./serveur/ports-lots.server");

type Acteur = Record<string, unknown> | null;
const appeler = (fn: unknown, acteur: Acteur, data?: unknown) =>
  (
    fn as (e: unknown) => Promise<{
      ok: boolean;
      code?: string;
      statut?: number;
      message?: string;
      details?: Record<string, unknown>;
      donnees?: unknown;
    }>
  )({
    data,
    context: {
      supabase: { rpc: vi.fn(async () => moi(acteur)) },
      userId: (acteur?.["utilisateur_id"] as string) ?? "inconnu",
    },
  });

const stagiaire = (id: string, extra: Ligne = {}): Ligne => ({
  id,
  of_id: "of1",
  formateur_id: "f1",
  utilisateur_id: null,
  stagiaire_prenom: `P${id}`,
  stagiaire_nom: `N${id}`,
  stagiaire_email: `${id}@x.fr`,
  stagiaire_poste: "Soudeur",
  ...extra,
});
const DOSSIER: Ligne = {
  id: "d1",
  of_id: "of1",
  dossier_reference: "ADF-2026-0001",
  formateur_id: "f1",
  entreprise_id: "e1",
  formation_id: "fo1",
  sous_statut: "brouillon",
  mode_financement: "opco",
  formation_titre: "Soudure",
  formation_modalite: "presentiel",
  formation_duree_heures_total: 14,
  formation_prix_unitaire_ht: 120000,
};
function monter(extra: Tables = {}) {
  const tables: Tables = {
    dossier_formation: [{ ...DOSSIER }],
    stagiaire: [stagiaire("s1"), stagiaire("s2"), stagiaire("s9", { formateur_id: "f9" })],
    stagiaire_dossier: [{ dossier_id: "d1", stagiaire_id: "s1", poste_occupe: "", rang: 1 }],
    entreprise_cliente: [
      { id: "e1", of_id: "of1", formateur_id: "f1", entreprise_nom: "Acme", entreprise_siret: "9" },
    ],
    formation: [
      {
        id: "fo1",
        of_id: "of1",
        formateur_id: "f1",
        formation_titre: "Soudure",
        formation_objectifs: "Souder",
        formation_programme: "J1",
        formation_duree_heures_total: 14,
        formation_prix_unitaire_ht: 120000,
        formation_modalite: "presentiel",
      },
    ],
    organisme_formation: [
      {
        id: "of1",
        of_nom: "Mon OF",
        portage_commission_pourcentage: 10,
        tva_pourcentage: 20,
        delai_paiement_jours: 30,
      },
    ],
    piece_dossier: [],
    ...extra,
  };
  // Défaut SQL de `sous_statut` : le serveur ne l'écrit pas à la création.
  const bd = bdMemoire(tables, {
    avantEcriture: (a) => {
      const v = a.valeurs as Ligne | undefined;
      if (a.op === "insert" && a.table === "dossier_formation" && v && !v["sous_statut"])
        v["sous_statut"] = "brouillon";
    },
  });
  etat.bd = bd.bd;
  return bd;
}

const FORMATEUR = ACTEURS.formateurValide as Acteur;
const ADMIN = ACTEURS.admin as Acteur;
const APPRENANT = ACTEURS.apprenant as Acteur;
const CANDIDAT = ACTEURS.candidat as Acteur;
const CORPS = {
  stagiaire_ids: ["s1"],
  entreprise_id: "e1",
  formation_id: "fo1",
  formation_modalite: "presentiel",
  mode_financement: "opco",
};

let reprendre: ReturnType<typeof vi.fn>;
let envoyer: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("APP_URL", "https://app.exemple.fr");
  vi.spyOn(console, "error").mockImplementation(() => {});
  reprendre = vi.fn(async () => undefined);
  envoyer = vi.fn(async () => 0);
  brancherPortsLots({
    reprendrePositionnements: reprendre as never,
    envoyerFormulaires: envoyer as never,
  });
});
afterEach(() => {
  reinitialiserPortsLots();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("creerDossier (route 88)", () => {
  it("crée le dossier, ses liens, le numéro ADF-AAAA-NNNN, les pièces attendues, le journal ; renvoie id + référence", async () => {
    const s = monter();
    const r = await appeler(creerDossier, FORMATEUR, CORPS);
    expect(r.ok).toBe(true);
    const d = (r as unknown as { donnees: { id: string; dossier_reference: string } }).donnees;
    expect(d.dossier_reference).toMatch(/^ADF-\d{4}-0001$/);
    const cree = s.tables["dossier_formation"]!.find((l) => l["id"] === d.id)!;
    // Le sous-statut initial vient du défaut SQL (brouillon) : le serveur ne l'écrit pas.
    expect(cree["sous_statut"]).toBe("brouillon");
    expect(cree).toMatchObject({
      of_id: "of1",
      formateur_id: "f1",
      formation_titre: "Soudure",
    });
    expect(s.tables["stagiaire_dossier"]!.filter((l) => l["dossier_id"] === d.id)).toHaveLength(1);
    expect(
      s.tables["piece_dossier"]!.some((p) => p["dossier_id"] === d.id && p["code"] === "00-AVT"),
    ).toBe(true);
    expect(s.tables["evenement"]).toEqual([
      expect.objectContaining({ type: "dossier_cree", dossier_id: d.id }),
    ]);
    expect(reprendre).toHaveBeenCalledOnce();
    expect(envoyer.mock.calls[0]![2]).toEqual(["recueil", "positionnement"]);
  });

  it("deux créations successives : numéros distincts et consécutifs", async () => {
    monter();
    const a = await appeler(creerDossier, FORMATEUR, CORPS);
    const b = await appeler(creerDossier, FORMATEUR, CORPS);
    const ref = (r: typeof a) =>
      (r as unknown as { donnees: { dossier_reference: string } }).donnees.dossier_reference;
    expect(ref(a).endsWith("0001")).toBe(true);
    expect(ref(b).endsWith("0002")).toBe(true);
  });

  it("un incident des ports (autres lots) ne fait pas échouer la création", async () => {
    monter();
    reprendre.mockRejectedValue(new Error("lot 6 indisponible"));
    expect((await appeler(creerDossier, FORMATEUR, CORPS)).ok).toBe(true);
  });

  it("corps invalide : 400 avec les champs, rien n'est écrit", async () => {
    const s = monter();
    const r = await appeler(creerDossier, FORMATEUR, { ...CORPS, stagiaire_ids: [] });
    expect(r).toMatchObject({ ok: false, statut: 400 });
    expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
  });

  it("entreprise, formation ou apprenant d'un autre formateur : introuvable (404), rien n'est écrit", async () => {
    const s = monter();
    expect(
      await appeler(creerDossier, FORMATEUR, { ...CORPS, stagiaire_ids: ["s9"] }),
    ).toMatchObject({ ok: false, statut: 404 });
    expect(
      await appeler(creerDossier, FORMATEUR, { ...CORPS, entreprise_id: "inconnue" }),
    ).toMatchObject({ ok: false, statut: 404 });
    expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
  });

  it("refuse l'administrateur, l'apprenant, le candidat non validé et l'anonyme", async () => {
    const s = monter();
    for (const qui of [ADMIN, APPRENANT, CANDIDAT, null]) {
      const r = await appeler(creerDossier, qui, CORPS);
      expect(r.ok).toBe(false);
      expect([401, 403]).toContain(r.statut);
    }
    expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
  });
});

describe("definirStagiaires (route 93)", () => {
  it("ajoute un apprenant, retire l'autre avec ses pièces, reclasse", async () => {
    const s = monter({
      piece_dossier: [
        { dossier_id: "d1", code: "00-AVT", stagiaire_id: "s1", statut: "en_attente" },
      ],
    });
    const r = await appeler(definirStagiaires, FORMATEUR, {
      dossier_id: "d1",
      stagiaire_ids: ["s2"],
    });
    expect(r).toMatchObject({ ok: true });
    expect(s.tables["stagiaire_dossier"]!.map((l) => l["stagiaire_id"])).toEqual(["s2"]);
    expect(s.tables["piece_dossier"]!.some((p) => p["stagiaire_id"] === "s1")).toBe(false);
  });

  it("liste vide : refusée ; apprenant d'un autre formateur : 404 ; dossier d'un autre formateur : 404", async () => {
    monter();
    expect(
      await appeler(definirStagiaires, FORMATEUR, { dossier_id: "d1", stagiaire_ids: [] }),
    ).toMatchObject({ ok: false, statut: 400 });
    expect(
      await appeler(definirStagiaires, FORMATEUR, { dossier_id: "d1", stagiaire_ids: ["s9"] }),
    ).toMatchObject({ ok: false, statut: 404 });
    const autre = { ...ACTEURS.formateurValide, formateur_id: "f9" } as Acteur;
    expect(
      await appeler(definirStagiaires, autre, { dossier_id: "d1", stagiaire_ids: ["s1"] }),
    ).toMatchObject({ ok: false, statut: 404 });
  });

  it("refusé (409) une fois le dossier validé pour le formateur, mais autorisé… pas pour lui", async () => {
    const s = monter({ dossier_formation: [{ ...DOSSIER, sous_statut: "dossier_valide" }] });
    const r = await appeler(definirStagiaires, FORMATEUR, {
      dossier_id: "d1",
      stagiaire_ids: ["s2"],
    });
    expect(r).toMatchObject({ ok: false, statut: 409 });
    expect(ecritures(s.appels, "stagiaire_dossier")).toHaveLength(0);
  });

  it("refuse admin et apprenant", async () => {
    monter();
    for (const qui of [ADMIN, APPRENANT]) {
      expect(
        (await appeler(definirStagiaires, qui, { dossier_id: "d1", stagiaire_ids: ["s1"] })).ok,
      ).toBe(false);
    }
  });
});

describe("inviterApprenantDossier / relancerApprenantDossier (routes 96, 97)", () => {
  it("invite : n'enregistre que le hash du jeton, renvoie un lien, journalise", async () => {
    const s = monter();
    const r = await appeler(inviterApprenantDossier, FORMATEUR, {
      dossier_id: "d1",
      stagiaire_id: "s1",
    });
    expect(r.ok).toBe(true);
    const lien = (r as unknown as { donnees: { lien: string } }).donnees.lien;
    expect(lien).toMatch(/^https:\/\/app\.exemple\.fr\//);
    const inv = s.tables["invitation"]![0]!;
    expect(inv).toMatchObject({ role: "apprenant", stagiaire_id: "s1", of_id: "of1" });
    expect(JSON.stringify(inv)).not.toContain(lien.split(/[=/]/).pop()!);
    expect(s.tables["evenement"]!.map((e) => e["type"])).toContain("invitation");
  });

  it("l'administrateur peut inviter ; l'apprenant non ; un stagiaire non inscrit : 400", async () => {
    monter();
    expect(
      (await appeler(inviterApprenantDossier, ADMIN, { dossier_id: "d1", stagiaire_id: "s1" })).ok,
    ).toBe(true);
    expect(
      (await appeler(inviterApprenantDossier, APPRENANT, { dossier_id: "d1", stagiaire_id: "s1" }))
        .ok,
    ).toBe(false);
    expect(
      await appeler(inviterApprenantDossier, FORMATEUR, { dossier_id: "d1", stagiaire_id: "s2" }),
    ).toMatchObject({ ok: false, statut: 400 });
  });

  it("dossier d'un autre organisme : 404", async () => {
    monter();
    const autreOf = { ...ACTEURS.admin, of_id: "of2" } as Acteur;
    expect(
      await appeler(inviterApprenantDossier, autreOf, { dossier_id: "d1", stagiaire_id: "s1" }),
    ).toMatchObject({ ok: false, statut: 404 });
  });

  it("relance : courrier avec les documents en attente et journal ; sans document en attente : 409", async () => {
    const s = monter({
      piece_dossier: [
        { dossier_id: "d1", code: "00-AVT", stagiaire_id: "s1", statut: "en_attente" },
      ],
    });
    const r = await appeler(relancerApprenantDossier, FORMATEUR, {
      dossier_id: "d1",
      stagiaire_id: "s1",
    });
    expect(r.ok).toBe(true);
    expect(s.tables["courrier"]![0]).toMatchObject({
      type: "relance_apprenant",
      destinataire: "s1@x.fr",
    });
    expect(s.tables["evenement"]!.map((e) => e["type"])).toContain("relance");

    const vide = monter({
      piece_dossier: [{ dossier_id: "d1", code: "00-AVT", stagiaire_id: "s1", statut: "valide" }],
    });
    expect(
      await appeler(relancerApprenantDossier, FORMATEUR, { dossier_id: "d1", stagiaire_id: "s1" }),
    ).toMatchObject({ ok: false, statut: 409 });
    expect(vide.tables["courrier"] ?? []).toHaveLength(0);
  });

  it("relance : apprenant sans e-mail : 400 ; apprenant connecté : refusé", async () => {
    monter({ stagiaire: [stagiaire("s1", { stagiaire_email: "" })] });
    expect(
      await appeler(relancerApprenantDossier, FORMATEUR, { dossier_id: "d1", stagiaire_id: "s1" }),
    ).toMatchObject({ ok: false, statut: 400 });
    expect(
      (await appeler(relancerApprenantDossier, APPRENANT, { dossier_id: "d1", stagiaire_id: "s1" }))
        .ok,
    ).toBe(false);
  });
});

describe("recreerDossier (route 98)", () => {
  it("crée un NOUVEAU dossier (autre id, nouveau numéro) avec les mêmes apprenants ; l'ancien reste intact", async () => {
    const s = monter({
      compteur: [{ of_id: "of1", cle: `ADF-${new Date().getUTCFullYear()}`, valeur: 1 }],
      dossier_formation: [
        {
          ...DOSSIER,
          sous_statut: "refus_financement",
          motif_refus: "Non",
          signature_lieu: "Mulhouse",
        },
      ],
    });
    const r = await appeler(recreerDossier, FORMATEUR, { dossier_id: "d1" });
    expect(r.ok).toBe(true);
    const nouveau = (r as unknown as { donnees: { id: string; dossier_reference: string } })
      .donnees;
    expect(nouveau.id).not.toBe("d1");
    expect(nouveau.dossier_reference).not.toBe("ADF-2026-0001");
    expect(s.tables["dossier_formation"]!.find((l) => l["id"] === "d1")).toMatchObject({
      sous_statut: "refus_financement",
      motif_refus: "Non",
    });
    const cree = s.tables["dossier_formation"]!.find((l) => l["id"] === nouveau.id)!;
    expect(cree).toMatchObject({ sous_statut: "brouillon", signature_lieu: "Mulhouse" });
    expect(
      s.tables["stagiaire_dossier"]!.filter((l) => l["dossier_id"] === nouveau.id).map(
        (l) => l["stagiaire_id"],
      ),
    ).toEqual(["s1"]);
  });

  it("formation d'origine disparue : 409 ; autre formateur : 404 ; admin : refusé", async () => {
    monter({ dossier_formation: [{ ...DOSSIER, formation_id: null }] });
    expect(await appeler(recreerDossier, FORMATEUR, { dossier_id: "d1" })).toMatchObject({
      ok: false,
      statut: 409,
    });
    const autre = { ...ACTEURS.formateurValide, formateur_id: "f9" } as Acteur;
    expect(await appeler(recreerDossier, autre, { dossier_id: "d1" })).toMatchObject({
      ok: false,
      statut: 404,
    });
    expect((await appeler(recreerDossier, ADMIN, { dossier_id: "d1" })).ok).toBe(false);
  });
});

describe("lireFinancesDossier", () => {
  it("calcule les finances pour l'administrateur et le formateur du dossier, jamais pour l'apprenant", async () => {
    monter();
    const r = await appeler(lireFinancesDossier, FORMATEUR, { dossier_id: "d1" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify((r as unknown as { donnees: unknown }).donnees)).toMatch(/\d/);
    expect((await appeler(lireFinancesDossier, ADMIN, { dossier_id: "d1" })).ok).toBe(true);
    expect((await appeler(lireFinancesDossier, APPRENANT, { dossier_id: "d1" })).ok).toBe(false);
    const autre = { ...ACTEURS.formateurValide, formateur_id: "f9" } as Acteur;
    expect(await appeler(lireFinancesDossier, autre, { dossier_id: "d1" })).toMatchObject({
      ok: false,
      statut: 404,
    });
  });
});
