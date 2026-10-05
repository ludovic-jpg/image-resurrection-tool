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

const { transiterDossier } = await import("./pipeline-transiter.functions");
const { brancherPortsLots, reinitialiserPortsLots } = await import("./serveur/ports-lots.server");

type Acteur = Record<string, unknown> | null;
type Retour = {
  ok: boolean;
  statut?: number;
  code?: string;
  message?: string;
  donnees?: { dossier_id: string; sous_statut: string };
};
const appeler = (acteur: Acteur, data: unknown) =>
  (transiterDossier as unknown as (e: unknown) => Promise<Retour>)({
    data,
    context: {
      supabase: { rpc: vi.fn(async () => moi(acteur)) },
      userId: (acteur?.["utilisateur_id"] as string) ?? "inconnu",
    },
  });

const DOSSIER: Ligne = {
  id: "d1",
  of_id: "of1",
  dossier_reference: "ADF-2026-0001",
  formateur_id: "f1",
  entreprise_id: "e1",
  sous_statut: "dossier_valide",
  formation_titre: "Soudure",
};
function monter(statut: string, pieces: Ligne[] = []) {
  const tables: Tables = {
    dossier_formation: [{ ...DOSSIER, sous_statut: statut }],
    stagiaire_dossier: [{ dossier_id: "d1", stagiaire_id: "s1", rang: 1 }],
    stagiaire: [
      {
        id: "s1",
        of_id: "of1",
        utilisateur_id: "u-app",
        stagiaire_prenom: "A",
        stagiaire_nom: "B",
        stagiaire_email: "a@x.fr",
      },
    ],
    piece_dossier: pieces,
    organisme_formation: [{ id: "of1", of_nom: "OF" }],
    formateur: [{ id: "f1", formateur_email: "fred@of.fr" }],
    utilisateur: [
      { email: "admin@of.fr", of_id: "of1", role: "admin", actif: true, supprime_le: null },
    ],
  };
  const bd = bdMemoire(tables);
  etat.bd = bd.bd;
  return bd;
}
const DEPOT = [{ dossier_id: "d1", code: "02-AVT", stagiaire_id: null, statut: "valide" }];

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  brancherPortsLots({
    genererPieces: (async () => []) as never,
    envoyerFormulaires: (async () => 0) as never,
  });
});
afterEach(() => {
  reinitialiserPortsLots();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("transiterDossier (route 95)", () => {
  it("l'apprenant du dossier déclare le dépôt : le sous-statut change, et seulement lui", async () => {
    const s = monter("dossier_valide", DEPOT);
    const r = await appeler(ACTEURS.apprenant as Acteur, {
      dossier_id: "d1",
      action: "declarer_depot",
    });
    expect(r).toMatchObject({
      ok: true,
      donnees: { dossier_id: "d1", sous_statut: "dossier_depose" },
    });
    expect(s.tables["dossier_formation"]![0]!["sous_statut"]).toBe("dossier_depose");
  });

  it("l'acteur vient de la session : un `role`/`acteur` glissé dans le corps est ignoré", async () => {
    const s = monter("en_cours_validation");
    const r = await appeler(ACTEURS.formateurValide as Acteur, {
      dossier_id: "d1",
      action: "valider_dossier",
      role: "admin",
      acteur: { role: "admin" },
    });
    expect(r).toMatchObject({ ok: false, statut: 403 });
    expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
  });

  it("l'apprenant ne peut déclencher que le dépôt ; le reste est refusé sans écriture", async () => {
    const s = monter("en_cours_validation");
    const r = await appeler(ACTEURS.apprenant as Acteur, {
      dossier_id: "d1",
      action: "valider_dossier",
    });
    expect(r).toMatchObject({ ok: false, statut: 403 });
    expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
  });

  it("une action réservée au système (accord, réévaluation) est refusée à tout rôle", async () => {
    for (const [statut, action] of [
      ["dossier_depose", "enregistrer_accord"],
      ["fin_dossier_incomplet", "reevaluer_completude"],
    ] as const)
      for (const qui of [ACTEURS.admin, ACTEURS.formateurValide, ACTEURS.apprenant]) {
        const s = monter(statut, [
          { dossier_id: "d1", code: "ACC", stagiaire_id: null, statut: "valide" },
        ]);
        const r = await appeler(qui as Acteur, { dossier_id: "d1", action });
        expect(r.ok).toBe(false);
        expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
      }
  });

  it("action inconnue : 400 ; corps invalide : refus de validation", async () => {
    monter("brouillon");
    expect(
      await appeler(ACTEURS.admin as Acteur, { dossier_id: "d1", action: "supprimer_tout" }),
    ).toMatchObject({ ok: false, statut: 400 });
    expect(
      await appeler(ACTEURS.admin as Acteur, { dossier_id: "d1", action: "toString" }),
    ).toMatchObject({ ok: false, statut: 400 });
    expect(() => appeler(ACTEURS.admin as Acteur, { action: "cloturer" })).toThrow();
  });

  it("garde non satisfaite : 400 avec le message du noyau, sous-statut inchangé", async () => {
    const s = monter("dossier_valide", []);
    const r = await appeler(ACTEURS.formateurValide as Acteur, {
      dossier_id: "d1",
      action: "declarer_depot",
    });
    expect(r).toMatchObject({ ok: false, statut: 400 });
    expect(r.message).toMatch(/convention de formation doit être signée/i);
    expect(s.tables["dossier_formation"]![0]!["sous_statut"]).toBe("dossier_valide");
  });

  it("motif obligatoire pour le renvoi en brouillon", async () => {
    const s = monter("en_cours_validation");
    expect(
      (
        await appeler(ACTEURS.admin as Acteur, {
          dossier_id: "d1",
          action: "renvoyer_en_brouillon",
        })
      ).message,
    ).toMatch(/motif/i);
    expect(s.tables["dossier_formation"]![0]!["sous_statut"]).toBe("en_cours_validation");
    const ok = await appeler(ACTEURS.admin as Acteur, {
      dossier_id: "d1",
      action: "renvoyer_en_brouillon",
      motif: "Programme manquant",
    });
    expect(ok).toMatchObject({ ok: true, donnees: { sous_statut: "brouillon" } });
  });

  it("dossier d'un autre organisme, d'un autre formateur ou d'un apprenant non inscrit : 404", async () => {
    monter("dossier_valide", DEPOT);
    for (const qui of [
      { ...ACTEURS.admin, of_id: "of2" },
      { ...ACTEURS.formateurValide, formateur_id: "f9" },
      { ...ACTEURS.apprenant, stagiaire_id: "s9" },
    ])
      expect(
        await appeler(qui as Acteur, { dossier_id: "d1", action: "declarer_depot" }),
      ).toMatchObject({ ok: false, statut: 404 });
  });

  it("anonyme : 401", async () => {
    monter("dossier_valide");
    expect(await appeler(null, { dossier_id: "d1", action: "declarer_depot" })).toMatchObject({
      ok: false,
      statut: 401,
    });
  });
});
