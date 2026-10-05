import { describe, expect, it, vi } from "vitest";
import { bdMemoire } from "@/test/bd-memoire";
import type { ActeurFormateur } from "./acteur.server";
import type { BdService } from "./bd.server";
import { gardeFormateur } from "./acteur.server";
import { supprimerCompteFormateur } from "./rgpd.server";

const PHRASE = "SUPPRIMER MON COMPTE";
const acteur: ActeurFormateur = {
  utilisateur_id: "u-form",
  of_id: "of-1",
  role: "formateur",
  formateur_id: "f-1",
  formateur_valide: true,
  stagiaire_id: null,
  nom: "Lambert Sophie",
  email: "sophie@example.fr",
};

function monter(
  effacement = {
    of_id: "of-1",
    archive: ["of-1/candidatures/f-1/cv.pdf", "autre-of/intrus.pdf"],
    coffre: ["of-1/formation/f.pdf"],
    comptes_apprenants: ["u-app-1", "u-app-2"],
  },
) {
  const ordre: string[] = [];
  const m = bdMemoire(
    {},
    {
      rpc: {
        s4m_effacer_donnees_formateur: async () => {
          ordre.push("rpc");
          return { data: effacement, error: null };
        },
      },
    },
  );
  m.bd.auth.admin.getUserById.mockResolvedValue({
    data: { user: { email: "sophie@example.fr" } },
    error: null,
  });
  m.bd.auth.admin.deleteUser.mockImplementation(async (id: string) => {
    ordre.push(`auth:${id}`);
    return { error: null };
  });
  const pages = [[{ name: "cv.pdf" }, { name: "lettre.pdf" }], []];
  m.stockage.list.mockImplementation(async () => ({ data: pages.shift() ?? [], error: null }));
  m.stockage.remove.mockImplementation(async (...a: unknown[]) => {
    ordre.push(`storage:${(a[0] as string[]).join("|")}`);
    return { data: [], error: null };
  });
  const verifier = vi.fn(async (_e: string, mdp: string) => mdp === "bon-mot-de-passe");
  const lancer = (phrase: unknown, mot_de_passe: unknown) =>
    supprimerCompteFormateur(
      m.bd as unknown as BdService,
      acteur,
      { phrase, mot_de_passe },
      { verifierMotDePasse: verifier },
    );
  return { ...m, ordre, verifier, lancer };
}
const rienTouche = (m: ReturnType<typeof monter>) => {
  expect(m.bd.rpc).not.toHaveBeenCalled();
  expect(m.stockage.remove).not.toHaveBeenCalled();
  expect(m.bd.auth.admin.deleteUser).not.toHaveBeenCalled();
};

describe("suppression de compte : refus avant toute écriture", () => {
  it.each(["", "supprimer mon compte", "SUPPRIMER", undefined, "SUPPRIMER MON COMPTE !"])(
    "phrase %j refusée",
    async (phrase) => {
      const m = monter();
      await expect(m.lancer(phrase, "bon-mot-de-passe")).rejects.toMatchObject({
        code: "invalide",
      });
      expect(m.verifier).not.toHaveBeenCalled();
      rienTouche(m);
    },
  );

  it.each(["mauvais", "", undefined, 42])("mot de passe %j refusé", async (mdp) => {
    const m = monter();
    const e = await m.lancer(PHRASE, mdp).catch((x) => x);
    expect(e).toMatchObject({
      code: "invalide",
      details: { champs: { mot_de_passe: expect.any(String) } },
    });
    rienTouche(m);
  });

  it("compte Auth introuvable : 404, rien touché", async () => {
    const m = monter();
    m.bd.auth.admin.getUserById.mockResolvedValue({
      data: { user: null },
      error: { message: "not found" },
    });
    await expect(m.lancer(PHRASE, "bon-mot-de-passe")).rejects.toMatchObject({
      code: "introuvable",
    });
    rienTouche(m);
  });

  it("le mot de passe est vérifié sur l'adresse du compte Auth, pas sur un champ du corps", async () => {
    const m = monter();
    await m.lancer(PHRASE, "bon-mot-de-passe");
    expect(m.verifier).toHaveBeenCalledWith("sophie@example.fr", "bon-mot-de-passe");
  });
});

describe("suppression de compte : rôle", () => {
  const base = { ...acteur };
  it.each([
    ["admin", { ...base, role: "admin" as const, formateur_id: null }],
    ["apprenant", { ...base, role: "apprenant" as const, formateur_id: null, stagiaire_id: "s-1" }],
    ["formateur sans fiche", { ...base, formateur_id: null }],
  ])("%s refusé par la garde", (_n, a) => {
    const r = gardeFormateur(a);
    expect(r).toMatchObject({ ok: false, code: "interdit" });
  });
  it("formateur dont la candidature n'est pas validée : autorisé (il peut effacer sa candidature)", () => {
    expect(gardeFormateur({ ...base, formateur_valide: false }).ok).toBe(true);
  });
});

describe("suppression de compte : exécution", () => {
  it("ordre : Storage des candidatures, base atomique, fichiers restants, comptes apprenants, compte du formateur", async () => {
    const m = monter();
    expect(await m.lancer(`  ${PHRASE} `, "bon-mot-de-passe")).toEqual({ ok: true });
    expect(m.stockage.list).toHaveBeenCalledWith("of-1/candidatures/f-1", {
      limit: 100,
      offset: 0,
    });
    expect(m.ordre).toEqual([
      "storage:of-1/candidatures/f-1/cv.pdf|of-1/candidatures/f-1/lettre.pdf",
      "rpc",
      "storage:of-1/candidatures/f-1/cv.pdf", // archive restant, du bon organisme
      "storage:of-1/formation/f.pdf", // coffre
      "auth:u-app-1",
      "auth:u-app-2",
      "auth:u-form", // le formateur en dernier
    ]);
    expect(m.bd.rpc).toHaveBeenCalledWith("s4m_effacer_donnees_formateur", {
      p_formateur_id: "f-1",
      p_utilisateur_id: "u-form",
    });
  });

  it("n'efface jamais un fichier d'un autre organisme, même si la base le renvoyait", async () => {
    const m = monter();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await m.lancer(PHRASE, "bon-mot-de-passe");
    expect(m.ordre.join(" ")).not.toContain("autre-of");
  });

  it("l'acteur vient du contexte : l'identité envoyée est celle de l'acteur, jamais celle du corps", async () => {
    const m = monter();
    await supprimerCompteFormateur(
      m.bd as unknown as BdService,
      acteur,
      {
        phrase: PHRASE,
        mot_de_passe: "bon-mot-de-passe",
        formateur_id: "f-autre",
        utilisateur_id: "u-autre",
      } as never,
      { verifierMotDePasse: m.verifier },
    );
    expect(m.bd.rpc).toHaveBeenCalledWith("s4m_effacer_donnees_formateur", {
      p_formateur_id: "f-1",
      p_utilisateur_id: "u-form",
    });
  });

  it("échec du Storage : le compte et la base sont intacts", async () => {
    const m = monter();
    m.stockage.list.mockResolvedValue({ data: [], error: { message: "panne" } });
    await expect(m.lancer(PHRASE, "bon-mot-de-passe")).rejects.toThrow(/Storage/);
    rienTouche(m);
  });

  it("échec de l'effacement en base : aucun compte Auth supprimé", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = monter();
    m.bd.rpc.mockResolvedValue({ data: null, error: { message: "boum" } });
    await expect(m.lancer(PHRASE, "bon-mot-de-passe")).rejects.toThrow(/Effacement impossible/);
    expect(m.bd.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("formateur introuvable côté base : 404", async () => {
    const m = monter();
    m.bd.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "x" } });
    await expect(m.lancer(PHRASE, "bon-mot-de-passe")).rejects.toMatchObject({
      code: "introuvable",
    });
  });

  it("compte Auth du formateur non supprimé : erreur explicite (données déjà effacées)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = monter();
    m.bd.auth.admin.deleteUser.mockImplementation(async (id: string) => ({
      error: id === "u-form" ? { message: "panne" } : null,
    }));
    await expect(m.lancer(PHRASE, "bon-mot-de-passe")).rejects.toMatchObject({
      code: "indisponible",
    });
  });

  it("un compte Auth déjà supprimé (404) compte comme supprimé", async () => {
    const m = monter();
    m.bd.auth.admin.deleteUser.mockResolvedValue({
      error: { status: 404, message: "User not found" },
    });
    await expect(m.lancer(PHRASE, "bon-mot-de-passe")).resolves.toEqual({ ok: true });
  });
});
