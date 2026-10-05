// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, fauxBd, moi } from "@/test/faux-supabase";

const etat = vi.hoisted(() => ({ bd: null as unknown }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return etat.bd;
  },
}));

const {
  agirEnTantQue,
  gardeAdmin,
  gardeApprenant,
  gardeFormateur,
  gardeFormateurValide,
  gardeInterne,
  gardeRoles,
  reconstruireActeur,
} = await import("./acteur.server");
const { ErreurMetier, interdit } = await import("./erreurs.server");

const contexte = (reponse: unknown, userId = "u-admin") => {
  const rpc = vi.fn(async () => reponse);
  return { supabase: { rpc } as never, userId, rpc };
};

beforeEach(() => {
  etat.bd = fauxBd().bd;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("reconstruction de l'acteur", () => {
  it("lit s4m_moi() avec le client portant le jeton et renvoie les champs de l'Acteur", async () => {
    const ctx = contexte(moi(ACTEURS.admin));
    const a = await reconstruireActeur(ctx);
    expect(ctx.rpc).toHaveBeenCalledWith("s4m_moi");
    expect(a).toEqual(ACTEURS.admin);
  });

  it("refuse un compte sans profil actif", async () => {
    await expect(reconstruireActeur(contexte(moi(null)))).rejects.toMatchObject({
      code: "non_authentifie",
    });
  });

  it("refuse un profil qui n'est pas celui du jeton vérifié", async () => {
    await expect(reconstruireActeur(contexte(moi(ACTEURS.admin), "u-autre"))).rejects.toMatchObject(
      {
        code: "non_authentifie",
      },
    );
  });

  it("refuse un rôle inconnu et une erreur de la base", async () => {
    await expect(
      reconstruireActeur(contexte(moi({ ...ACTEURS.admin, role: "super" }))),
    ).rejects.toBeInstanceOf(ErreurMetier);
    await expect(
      reconstruireActeur(contexte({ data: null, error: { message: "jwt expired" } })),
    ).rejects.toMatchObject({ code: "non_authentifie" });
  });
});

describe("gardes de rôle (résultat typé)", () => {
  const a = ACTEURS;
  const code = (r: { ok: boolean }) => (r.ok ? "ok" : (r as unknown as { code: string }).code);

  it("admin : seulement l'administrateur, avec un message français", () => {
    expect(code(gardeAdmin(a.admin))).toBe("ok");
    for (const x of [a.formateurValide, a.candidat, a.apprenant]) {
      const r = gardeAdmin(x);
      expect(r).toMatchObject({
        ok: false,
        code: "interdit",
        statut: 403,
        message: "Cette action est réservée à l'administrateur de l'organisme.",
      });
    }
  });

  it("formateur : candidat compris ; formateur validé : candidat refusé", () => {
    expect(code(gardeFormateur(a.candidat))).toBe("ok");
    expect(code(gardeFormateur(a.formateurValide))).toBe("ok");
    expect(code(gardeFormateur(a.admin))).toBe("interdit");
    expect(code(gardeFormateur(a.apprenant))).toBe("interdit");
    expect(code(gardeFormateurValide(a.formateurValide))).toBe("ok");
    const refus = gardeFormateurValide(a.candidat);
    expect(refus).toMatchObject({ ok: false, statut: 403 });
    expect((refus as { message: string }).message).toMatch(/candidature doit être validée/);
    expect(code(gardeFormateurValide(a.admin))).toBe("interdit");
  });

  it("formateur sans fiche : refusé", () => {
    expect(code(gardeFormateur({ ...a.formateurValide, formateur_id: null }))).toBe("interdit");
  });

  it("apprenant : seulement un apprenant inscrit à une fiche", () => {
    expect(code(gardeApprenant(a.apprenant))).toBe("ok");
    expect(code(gardeApprenant({ ...a.apprenant, stagiaire_id: null }))).toBe("interdit");
    expect(code(gardeApprenant(a.formateurValide))).toBe("interdit");
  });

  it("interne : admin ou formateur validé, ni candidat ni apprenant", () => {
    expect(code(gardeInterne(a.admin))).toBe("ok");
    expect(code(gardeInterne(a.formateurValide))).toBe("ok");
    expect(code(gardeInterne(a.candidat))).toBe("interdit");
    expect(code(gardeInterne(a.apprenant))).toBe("interdit");
  });

  it("liste de rôles", () => {
    const g = gardeRoles("admin", "apprenant");
    expect([a.admin, a.apprenant, a.formateurValide].map((x) => code(g(x)))).toEqual([
      "ok",
      "ok",
      "interdit",
    ]);
  });
});

describe("agirEnTantQue", () => {
  it("exécute l'action avec l'acteur reconstruit et le client « service »", async () => {
    const action = vi.fn(async ({ acteur }) => acteur.nom);
    const r = await agirEnTantQue(contexte(moi(ACTEURS.admin)), gardeAdmin, action);
    expect(r).toEqual({ ok: true, donnees: "Alice Admin" });
    expect(action.mock.calls[0]![0].bd).toBe(etat.bd);
  });

  it("refuse le mauvais rôle SANS exécuter l'action ni charger le client service", async () => {
    const action = vi.fn();
    const r = await agirEnTantQue(
      contexte(moi(ACTEURS.formateurValide), "u-form"),
      gardeAdmin,
      action,
    );
    expect(r).toMatchObject({ ok: false, code: "interdit", statut: 403 });
    expect(action).not.toHaveBeenCalled();
  });

  it("convertit une erreur métier en échec typé, une panne en message générique", async () => {
    const ctx = contexte(moi(ACTEURS.admin));
    const m = await agirEnTantQue(ctx, gardeAdmin, async () => {
      throw interdit("Non.");
    });
    expect(m).toMatchObject({ ok: false, code: "interdit", message: "Non." });
    const p = await agirEnTantQue(ctx, gardeAdmin, async () => {
      throw new Error("connexion à db.interne:5432 refusée");
    });
    expect(p).toMatchObject({ ok: false, code: "interne", statut: 500 });
    expect(JSON.stringify(p)).not.toContain("5432");
  });

  it("renvoie un 401 français si le jeton ne correspond à aucun profil", async () => {
    const r = await agirEnTantQue(contexte(moi(null)), gardeAdmin, async () => 1);
    expect(r).toMatchObject({ ok: false, code: "non_authentifie", statut: 401 });
  });
});
