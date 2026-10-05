// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, aFiltre, fauxBd, moi, type Appel } from "@/test/faux-supabase";
import { ErreurApi } from "../erreur";
import { echec, succes } from "@/lib/resultat";

const h = vi.hoisted(() => ({ bd: null as unknown }));
vi.mock("../bd", () => ({
  bd: new Proxy({}, { get: (_c, p) => (h.bd as Record<string | symbol, unknown>)[p] }),
}));
const lireBpfServeur = vi.fn();
const exporterBpfServeur = vi.fn();
const exporterSauvegarde = vi.fn();
const importerSauvegarde = vi.fn();
const supprimerCompte = vi.fn();
vi.mock("@/lib/bpf.functions", () => ({
  lireBpf: (...a: unknown[]) => lireBpfServeur(...a),
  exporterBpfCsv: (...a: unknown[]) => exporterBpfServeur(...a),
}));
vi.mock("@/lib/sauvegarde.functions", () => ({
  exporterMesDonnees: (...a: unknown[]) => exporterSauvegarde(...a),
  importerMesDonnees: (...a: unknown[]) => importerSauvegarde(...a),
}));
vi.mock("@/lib/rgpd.functions", () => ({
  supprimerMonCompte: (...a: unknown[]) => supprimerCompte(...a),
}));

const { aiguiller, routesEnregistrees } = await import("../aiguilleur");

const echecApi = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurApi);
    return e as ErreurApi;
  }
  throw new Error("Une ErreurApi était attendue");
};
const ecritures: Appel[] = [];
function monter(
  acteur: Record<string, unknown> | null,
  repondre: (a: Appel) => { data?: unknown } | undefined = () => undefined,
) {
  const faux = fauxBd((a) => {
    if (a.op !== "select") ecritures.push(a);
    return repondre(a) as never;
  });
  faux.bd.rpc.mockImplementation(async () => moi(acteur));
  (faux.bd as unknown as Record<string, unknown>)["auth"] = {
    signOut: vi.fn(async () => ({ error: null })),
  };
  h.bd = faux.bd;
  return faux;
}
beforeEach(() => {
  vi.resetAllMocks();
  ecritures.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("couverture du lot 8", () => {
  it("enregistre les routes 84, 85, 86, 9, 115 et 116", () => {
    const reelles = routesEnregistrees().map((r) => r.replace(/\\\//g, "/"));
    for (const r of [
      "GET ^/archives$",
      "GET ^/sauvegarde/export$",
      "POST ^/sauvegarde/import$",
      "POST ^/compte/suppression$",
      "GET ^/bpf$",
      "GET ^/bpf/export$",
    ])
      expect(reelles).toContain(r);
  });
});

describe("routes 115 et 116 : BPF", () => {
  it("115 sans exercice : l'exercice est laissé au serveur", async () => {
    monter(ACTEURS.admin);
    lireBpfServeur.mockResolvedValue(succes({ exercice: 2026 }));
    expect(await aiguiller("GET", "/bpf")).toEqual({ exercice: 2026 });
    expect(lireBpfServeur).toHaveBeenCalledWith({ data: { exercice: undefined } });
  });
  it("115 avec ?exercice=2025", async () => {
    monter(ACTEURS.admin);
    lireBpfServeur.mockResolvedValue(succes({ exercice: 2025 }));
    await aiguiller("GET", "/bpf?exercice=2025");
    expect(lireBpfServeur).toHaveBeenCalledWith({ data: { exercice: 2025 } });
  });
  it.each(["abc", "1800", "2026.5", "9999"])(
    "115 exercice %s : 400 sans appeler le serveur",
    async (v) => {
      monter(ACTEURS.admin);
      expect((await echecApi(aiguiller("GET", `/bpf?exercice=${v}`))).statut).toBe(400);
      expect(lireBpfServeur).not.toHaveBeenCalled();
    },
  );
  it("115 : le refus du serveur (apprenant) devient un 403 en français", async () => {
    monter(ACTEURS.apprenant);
    lireBpfServeur.mockResolvedValue(
      echec("interdit", "Cette action n'est pas permise pour votre rôle."),
    );
    const e = await echecApi(aiguiller("GET", "/bpf"));
    expect(e.statut).toBe(403);
    expect(e.message).toBe("Cette action n'est pas permise pour votre rôle.");
  });
  it("116 renvoie le fichier du serveur tel quel ; l'exercice est obligatoire", async () => {
    monter(ACTEURS.admin);
    const fichier = { nom: "bpf-2026.csv", contenu: "﻿a;b", type_mime: "text/csv; charset=utf-8" };
    exporterBpfServeur.mockResolvedValue(succes(fichier));
    expect(await aiguiller("GET", "/bpf/export?exercice=2026")).toEqual(fichier);
    expect((await echecApi(aiguiller("GET", "/bpf/export"))).statut).toBe(400);
  });
  it("aucune écriture directe depuis le client", async () => {
    monter(ACTEURS.admin);
    lireBpfServeur.mockResolvedValue(succes({}));
    await aiguiller("GET", "/bpf");
    expect(ecritures).toEqual([]);
  });
});

describe("route 84 : archives", () => {
  const lignes = (a: Appel) =>
    a.table === "formation"
      ? a.filtres.some((f) => f[0] === "in")
        ? { data: [{ id: "fo1", formation_titre: "Excel" }] }
        : { data: [{ id: "fo1", formation_titre: "Excel", archivee: true, cree_le: "2026-10-01" }] }
      : a.table === "coffre_fichier"
        ? {
            data: [
              {
                id: "c1",
                nom_fichier: "a.pdf",
                formation_id: "fo1",
                supprime_le: "2026-10-03",
                taille: 5,
              },
            ],
          }
        : { data: [] };

  it("six listes, filtrées sur la fiche du formateur et sur archive_le / supprime_le", async () => {
    const { appels } = monter(ACTEURS.formateurValide, lignes);
    const r = (await aiguiller("GET", "/archives")) as Record<string, unknown[]>;
    expect(Object.keys(r)).toEqual([
      "formations",
      "outils",
      "fichiers",
      "stagiaires",
      "entreprises",
      "positionnements",
    ]);
    expect(r["formations"]).toHaveLength(1);
    expect(r["fichiers"]).toEqual([
      {
        id: "c1",
        nom: "a.pdf",
        formation: "Excel",
        formation_id: "fo1",
        depuis: "2026-10-03",
        taille: 5,
      },
    ]);
    for (const t of [
      "formation",
      "modele_outil",
      "coffre_fichier",
      "stagiaire",
      "entreprise_cliente",
      "positionnement_vue",
    ]) {
      const a = appels.find((x) => x.table === t)!;
      expect(aFiltre(a, "eq", "formateur_id", "f1")).toBe(true);
    }
    expect(
      aFiltre(
        appels.find((x) => x.table === "formation")!,
        "eq",
        "archivee",
        true,
      ),
    ).toBe(true);
    expect(
      aFiltre(
        appels.find((x) => x.table === "coffre_fichier")!,
        "not",
        "supprime_le",
        "is",
        null,
      ),
    ).toBe(true);
  });
  it("refuse l'administrateur, l'apprenant et le formateur non validé (403), et l'absence de session (401)", async () => {
    for (const a of [ACTEURS.admin, ACTEURS.apprenant, ACTEURS.candidat]) {
      monter(a);
      expect((await echecApi(aiguiller("GET", "/archives"))).statut).toBe(403);
    }
    monter(null);
    expect((await echecApi(aiguiller("GET", "/archives"))).statut).toBe(401);
  });
  it("lecture seule", async () => {
    monter(ACTEURS.formateurValide, lignes);
    await aiguiller("GET", "/archives");
    expect(ecritures).toEqual([]);
  });
});

describe("routes 85 et 86 : sauvegarde", () => {
  it("85 renvoie le fichier du serveur", async () => {
    monter(ACTEURS.formateurValide);
    const f = { nom: "sauvegarde.json", contenu: "{}", type_mime: "application/json" };
    exporterSauvegarde.mockResolvedValue(succes(f));
    expect(await aiguiller("GET", "/sauvegarde/export")).toEqual(f);
  });
  it("86 transmet le contenu du fichier, et seulement lui (jamais d'identifiant)", async () => {
    monter(ACTEURS.formateurValide);
    importerSauvegarde.mockResolvedValue(succes({ formations: 1, outils: 0, erreurs: [] }));
    const corps = new FormData();
    corps.set("fichier", new File(['{"a":1}'], "s.json", { type: "application/json" }));
    corps.set("formateur_id", "f-pirate");
    expect(await aiguiller("POST", "/sauvegarde/import", corps)).toEqual({
      formations: 1,
      outils: 0,
      erreurs: [],
    });
    expect(importerSauvegarde).toHaveBeenCalledWith({ data: { contenu: '{"a":1}' } });
  });
  it("86 sans fichier, ou fichier trop gros : 400 sans appeler le serveur", async () => {
    monter(ACTEURS.formateurValide);
    expect((await echecApi(aiguiller("POST", "/sauvegarde/import", new FormData()))).statut).toBe(
      400,
    );
    const gros = new FormData();
    gros.set("fichier", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "gros.json"));
    expect((await echecApi(aiguiller("POST", "/sauvegarde/import", gros))).statut).toBe(400);
    expect(importerSauvegarde).not.toHaveBeenCalled();
  });
  it("86 : un refus du serveur est restitué (403)", async () => {
    monter(ACTEURS.admin);
    importerSauvegarde.mockResolvedValue(echec("interdit", "Réservé aux formateurs."));
    const corps = new FormData();
    corps.set("fichier", new File(["{}"], "s.json"));
    expect((await echecApi(aiguiller("POST", "/sauvegarde/import", corps))).statut).toBe(403);
  });
});

describe("route 9 : suppression de compte", () => {
  it("ne transmet que la phrase et le mot de passe, puis ferme la session locale", async () => {
    const faux = monter(ACTEURS.formateurValide);
    supprimerCompte.mockResolvedValue(succes({ ok: true }));
    const r = await aiguiller("POST", "/compte/suppression", {
      phrase: "SUPPRIMER MON COMPTE",
      mot_de_passe: "mdp",
      formateur_id: "f-pirate",
      role: "admin",
    });
    expect(r).toEqual({ ok: true });
    expect(supprimerCompte).toHaveBeenCalledWith({
      data: { phrase: "SUPPRIMER MON COMPTE", mot_de_passe: "mdp" },
    });
    expect(
      (faux.bd as unknown as { auth: { signOut: ReturnType<typeof vi.fn> } }).auth.signOut,
    ).toHaveBeenCalledTimes(1);
  });
  it("refus du serveur (phrase ou mot de passe) : l'erreur remonte et la session reste ouverte", async () => {
    const faux = monter(ACTEURS.formateurValide);
    supprimerCompte.mockResolvedValue(
      echec("invalide", "Mot de passe incorrect.", {
        champs: { mot_de_passe: "Mot de passe incorrect." },
      }),
    );
    const e = await echecApi(
      aiguiller("POST", "/compte/suppression", {
        phrase: "SUPPRIMER MON COMPTE",
        mot_de_passe: "x",
      }),
    );
    expect(e.statut).toBe(400);
    expect(e.details).toEqual({ champs: { mot_de_passe: "Mot de passe incorrect." } });
    expect(
      (faux.bd as unknown as { auth: { signOut: ReturnType<typeof vi.fn> } }).auth.signOut,
    ).not.toHaveBeenCalled();
  });
  it("refus de rôle : 403", async () => {
    monter(ACTEURS.admin);
    supprimerCompte.mockResolvedValue(echec("interdit", "Réservé aux formateurs."));
    expect((await echecApi(aiguiller("POST", "/compte/suppression", {}))).statut).toBe(403);
  });
  it("aucune écriture directe depuis le client", async () => {
    monter(ACTEURS.formateurValide);
    supprimerCompte.mockResolvedValue(succes({ ok: true }));
    await aiguiller("POST", "/compte/suppression", {
      phrase: "SUPPRIMER MON COMPTE",
      mot_de_passe: "x",
    });
    expect(ecritures).toEqual([]);
  });
});
