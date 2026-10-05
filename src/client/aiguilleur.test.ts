// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
};
const rpc = vi.fn();
vi.mock("./bd", () => ({ bd: { auth, rpc, from: vi.fn() } }));
const lireInvitation = vi.fn();
vi.mock("@/lib/auth-compte.functions", () => ({ lireInvitation }));

const { aiguiller, route, routesEnregistrees } = await import("./aiguilleur");
const { ErreurApi } = await import("./erreur");

const echec = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as InstanceType<typeof ErreurApi>;
  }
  throw new Error("Une erreur était attendue");
};

beforeEach(() => vi.resetAllMocks());

describe("aiguilleur", () => {
  it("répond 501 « non_porte » pour une route d'un lot à venir", async () => {
    const e = await echec(aiguiller("GET", "/formations"));
    expect(e).toBeInstanceOf(ErreurApi);
    expect([e.statut, e.code]).toEqual([501, "non_porte"]);
  });

  it("extrait et décode les paramètres de chemin et la requête", async () => {
    let vu: unknown;
    route(
      "GET",
      "/essai/:id/sous/:nom",
      async (c) => (vu = { p: c.params, q: c.requete.get("x") }),
    );
    await aiguiller("GET", "/essai/a%20b/sous/z?x=1");
    expect(vu).toEqual({ p: { id: "a b", nom: "z" }, q: "1" });
  });

  it("n'aiguille que la bonne méthode", async () => {
    const e = await echec(aiguiller("DELETE", "/auth/moi"));
    expect(e.statut).toBe(501);
    expect(routesEnregistrees().some((r) => r.startsWith("GET ") && r.includes("moi"))).toBe(true);
  });
});

describe("lot 0 : session", () => {
  it("renvoie « pas d'acteur » sans session, sans interroger la base", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await aiguiller("GET", "/auth/moi")).toEqual({ acteur: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lit l'acteur par s4m_moi() quand une session existe", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "x" } } });
    rpc.mockResolvedValue({ data: { acteur: { role: "admin" } }, error: null });
    expect(await aiguiller("GET", "/auth/moi")).toEqual({ acteur: { role: "admin" } });
    expect(rpc).toHaveBeenCalledWith("s4m_moi");
  });
});

describe("lot 1 : authentification", () => {
  it("connexion : message français et 401 sur un mauvais mot de passe", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const e = await echec(
      aiguiller("POST", "/auth/connexion", { email: " A@B.fr ", mot_de_passe: "x" }),
    );
    expect([e.statut, e.message]).toEqual([401, "Adresse e-mail ou mot de passe incorrect."]);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@b.fr", password: "x" });
  });

  it("inscription : refuse un mot de passe trop court sans appeler Supabase", async () => {
    const e = await echec(
      aiguiller("POST", "/auth/inscription", {
        prenom: "A",
        nom: "B",
        email: "a@b.fr",
        mot_de_passe: "court",
      }),
    );
    expect(e.statut).toBe(400);
    expect(e.details?.champs?.["mot_de_passe"]).toMatch(/au moins 10 caractères/);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("inscription : ne transmet jamais de rôle ni d'organisme, même si le corps en contient", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    await aiguiller("POST", "/auth/inscription", {
      prenom: "A",
      nom: "B",
      email: "A@b.fr",
      mot_de_passe: "long-mot-de-passe",
      role: "admin",
      of_id: "x",
    });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "a@b.fr",
      password: "long-mot-de-passe",
      options: { data: { prenom: "A", nom: "B" } },
    });
  });

  it("invitation : l'e-mail vient de l'invitation et le jeton voyage dans les métadonnées", async () => {
    lireInvitation.mockResolvedValue({ ok: true, email: "eleve@exemple.fr", prenom: "Eli" });
    auth.signUp.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
    await aiguiller("POST", "/auth/invitation/jeton-de-test-0123456789", {
      mot_de_passe: "long-mot-de-passe",
      email: "pirate@x.fr",
    });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "eleve@exemple.fr",
      password: "long-mot-de-passe",
      options: { data: { invitation: "jeton-de-test-0123456789" } },
    });
  });

  it("invitation expirée : 404 et aucun compte créé", async () => {
    lireInvitation.mockResolvedValue({ ok: false, code: "invitation_invalide" });
    const e = await echec(
      aiguiller("POST", "/auth/invitation/jeton-de-test-0123456789", {
        mot_de_passe: "long-mot-de-passe",
      }),
    );
    expect([e.statut, e.code]).toEqual([404, "invitation_invalide"]);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("mot de passe : exige l'ancien, puis ferme toutes les sessions", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { email: "a@b.fr" } } });
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: "bad" } });
    const e = await echec(
      aiguiller("POST", "/compte/mot-de-passe", {
        ancien: "faux",
        nouveau: "nouveau-mot-de-passe",
      }),
    );
    expect(e.details?.champs?.["ancien"]).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();

    auth.signInWithPassword.mockResolvedValueOnce({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    expect(
      await aiguiller("POST", "/compte/mot-de-passe", {
        ancien: "bon",
        nouveau: "nouveau-mot-de-passe",
      }),
    ).toEqual({ ok: true });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("aperçu de suppression : réservé au formateur", async () => {
    rpc.mockResolvedValue({ data: { acteur: { role: "apprenant" } }, error: null });
    const e = await echec(aiguiller("GET", "/compte/suppression"));
    expect(e.statut).toBe(403);
  });
});
