// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, aFiltre, fauxBd, moi, type Appel } from "@/test/faux-supabase";
import { ErreurApi } from "../erreur";
import { echec, succes } from "@/lib/resultat";

const h = vi.hoisted(() => ({ bd: null as unknown }));
// `bd` est un relais vers le faux client du test en cours ; `auth` n'est pas utilisé par les routes du lot 3.
vi.mock("../bd", () => ({
  bd: new Proxy({}, { get: (_c, p) => (h.bd as Record<string | symbol, unknown>)[p] }),
}));
const soumettre = vi.fn();
const decider = vi.fn();
const enregistrer = vi.fn();
const etatConfig = vi.fn();
const test = vi.fn();
const renvoyer = vi.fn();
vi.mock("@/lib/candidatures.functions", () => ({
  soumettreCandidature: (...a: unknown[]) => soumettre(...a),
  deciderCandidature: (...a: unknown[]) => decider(...a),
}));
vi.mock("@/lib/reglages.functions", () => ({
  enregistrerReglages: (...a: unknown[]) => enregistrer(...a),
  etatConfiguration: (...a: unknown[]) => etatConfig(...a),
}));
vi.mock("@/lib/courriels-envoyer.functions", () => ({
  envoyerCourrielTest: (...a: unknown[]) => test(...a),
  renvoyerCourrier: (...a: unknown[]) => renvoyer(...a),
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

type Acteur = Record<string, unknown> | null;
const toutesLesRequetes: Appel[] = [];
function monter(
  acteur: Acteur,
  repondre: (a: Appel) => { data?: unknown; error?: unknown } | undefined = () => undefined,
) {
  const faux = fauxBd((a) => {
    toutesLesRequetes.push(a);
    return repondre(a) as never;
  });
  faux.bd.rpc.mockImplementation(async () => moi(acteur));
  h.bd = faux.bd;
  return faux;
}

const FICHE = {
  id: "f2",
  of_id: "of1",
  statut_candidature: "brouillon",
  formateur_prenom: "Paul",
  formateur_nom: "Candidat",
  formateur_telephone: "06",
  parcours: "x",
};
const PIECES = [
  {
    id: "p1",
    formateur_id: "f2",
    type: "cv",
    nom_fichier: "cv.pdf",
    chemin: "of1/candidatures/f2/cv_a_cv.pdf",
    expire_le: "",
  },
  {
    id: "p2",
    formateur_id: "f2",
    type: "attestation",
    nom_fichier: "urssaf.pdf",
    chemin: "of1/candidatures/f2/u.pdf",
    expire_le: "2020-01-01",
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  // Règle du lot : aucun `update` direct du statut de candidature depuis le client.
  const interdits = toutesLesRequetes.filter(
    (a) =>
      a.op === "update" &&
      a.table === "formateur" &&
      JSON.stringify(a.valeurs ?? {}).match(
        /statut_candidature|motif_decision|decidee_le|soumise_le/,
      ),
  );
  expect(interdits).toEqual([]);
});

describe("couverture du lot 3", () => {
  it("enregistre les routes du lot et laisse les routes 28 et 29 (lot 2) non portées", async () => {
    const attendues = [
      "GET ^/candidature$",
      "PATCH ^/candidature$",
      "POST ^/candidature/pieces$",
      "DELETE ^/candidature/pieces/([^/]+)$",
      "POST ^/candidature/soumettre$",
      "GET ^/pieces-formateur/([^/]+)$",
      "GET ^/admin/candidatures$",
      "GET ^/admin/candidatures/([^/]+)$",
      "POST ^/admin/candidatures/([^/]+)/decision$",
      "GET ^/admin/reglages$",
      "PATCH ^/admin/reglages$",
      "POST ^/admin/reglages/test-courriel$",
      "GET ^/courriers$",
      "POST ^/courriers/([^/]+)/renvoyer$",
    ];
    const reelles = routesEnregistrees().map((r) => r.replace(/\\\//g, "/"));
    for (const r of attendues) expect(reelles).toContain(r);
    monter(ACTEURS.admin);
    for (const [m, c] of [
      ["GET", "/admin/organisme"],
      ["PATCH", "/admin/organisme"],
    ] as const) {
      const e = await echecApi(aiguiller(m, c, {}));
      expect([e.statut, e.code]).toEqual([501, "non_porte"]);
    }
  });
});

describe("route 19 : GET /candidature", () => {
  const faux = (acteur: Acteur) =>
    monter(acteur, (a) =>
      a.table === "formateur"
        ? { data: [FICHE] }
        : a.table === "piece_formateur"
          ? { data: PIECES }
          : undefined,
    );

  it("renvoie la fiche, les pièces, les types, les manques et les échéances calculés", async () => {
    const { appels } = faux(ACTEURS.candidat);
    const r = (await aiguiller("GET", "/candidature")) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(["echeances", "formateur", "manques", "pieces", "types"]);
    expect((r["types"] as unknown[]).length).toBe(7);
    expect(r["manques"]).toEqual(["Pièce d'identité", "Diplômes et titres"]);
    expect(r["echeances"]).toEqual([
      { id: "p2", nom_fichier: "urssaf.pdf", expire_le: "2020-01-01", expiree: true },
    ]);
    // La fiche lue est celle de l'acteur reconstruit par la base.
    expect(
      aFiltre(
        appels.find((a) => a.table === "formateur")!,
        "eq",
        "id",
        "f2",
      ),
    ).toBe(true);
  });

  it("refuse l'administrateur et l'apprenant (403), et l'absence de session (401)", async () => {
    for (const a of [ACTEURS.admin, ACTEURS.apprenant]) {
      faux(a);
      expect((await echecApi(aiguiller("GET", "/candidature"))).statut).toBe(403);
    }
    faux(null);
    expect((await echecApi(aiguiller("GET", "/candidature"))).statut).toBe(401);
  });
});

describe("route 20 : PATCH /candidature", () => {
  const faux = (statut: string) =>
    monter(ACTEURS.candidat, (a) => {
      if (a.table === "formateur" && a.op === "select" && a.fin)
        return { data: [{ ...FICHE, statut_candidature: statut, id: "f2" }] };
      if (a.table === "formateur" && a.op === "update") return { data: [{ id: "f2" }] };
      if (a.table === "formateur") return { data: [FICHE] };
      return { data: [] };
    });

  it("ne transmet que les champs de profil validés : jamais de statut, de décision ni d'organisme", async () => {
    const { appels } = faux("brouillon");
    await aiguiller("PATCH", "/candidature", {
      formateur_telephone: " 07 ",
      statut_candidature: "validee",
      motif_decision: "ok",
      decidee_le: "2026-01-01",
      of_id: "of9",
    });
    const maj = appels.find((a) => a.op === "update")!;
    expect(maj.valeurs).toEqual({ formateur_telephone: "07" });
    expect(aFiltre(maj, "eq", "id", "f2")).toBe(true);
  });

  it("refuse la modification d'une candidature en cours d'étude (409, message français)", async () => {
    const { appels } = faux("soumise");
    const e = await echecApi(aiguiller("PATCH", "/candidature", { formateur_telephone: "07" }));
    expect([e.statut, e.code]).toEqual([409, "conflit"]);
    expect(e.message).toMatch(/en cours d'étude/);
    expect(appels.some((a) => a.op === "update")).toBe(false);
  });

  it("après validation : le nom et le prénom sont figés, le reste se modifie", async () => {
    const { appels } = faux("validee");
    const e = await echecApi(aiguiller("PATCH", "/candidature", { formateur_nom: "Autre" }));
    expect(e.statut).toBe(400);
    expect(e.message).toMatch(/ne se modifient que par l'organisme/);
    await aiguiller("PATCH", "/candidature", { formateur_nom: "Candidat", formateur_bio: "Bio" });
    expect(appels.filter((a) => a.op === "update").at(-1)!.valeurs).toEqual({
      formateur_bio: "Bio",
    });
  });

  it("champs invalides : 400 avec le détail par champ", async () => {
    faux("brouillon");
    const e = await echecApi(aiguiller("PATCH", "/candidature", { formateur_linkedin: "nope" }));
    expect([e.statut, e.code]).toEqual([400, "invalide"]);
    expect(e.details?.champs?.["formateur_linkedin"]).toBe("Adresse de profil invalide.");
  });

  it("une règle SQL du trigger remonte en français (409)", async () => {
    monter(ACTEURS.candidat, (a) => {
      if (a.op === "update")
        return {
          error: { code: "P0001", message: "Votre candidature est en cours d'étude : attendez." },
        };
      return { data: [FICHE] };
    });
    const e = await echecApi(aiguiller("PATCH", "/candidature", { formateur_bio: "x" }));
    expect([e.statut, e.message]).toEqual([
      409,
      "Votre candidature est en cours d'étude : attendez.",
    ]);
  });
});

describe("routes 21 et 22 : pièces de candidature", () => {
  const faux = (statut = "brouillon") =>
    monter(ACTEURS.candidat, (a) => {
      if (a.table === "formateur") return { data: [{ ...FICHE, statut_candidature: statut }] };
      if (a.table === "piece_formateur" && a.op === "select" && a.fin) return { data: [PIECES[0]] };
      if (a.table === "piece_formateur" && a.op === "delete") return { data: [{ id: "p1" }] };
      if (a.table === "piece_formateur") return { data: PIECES };
      return undefined;
    });
  const formulaire = (nom: string, taille = 10, type = "cv", expire = "") => {
    const f = new FormData();
    f.set("fichier", new File([new Uint8Array(taille)], nom, { type: "application/pdf" }));
    f.set("type", type);
    f.set("expire_le", expire);
    return f;
  };

  it("dépôt : fichier envoyé sous <of>/candidatures/<formateur>/, puis ligne, puis candidature à jour", async () => {
    const { appels, stockage, bd } = faux();
    const r = (await aiguiller("POST", "/candidature/pieces", formulaire("Mon CV é.pdf"))) as {
      pieces: unknown[];
    };
    expect(r.pieces).toHaveLength(2);
    expect(bd.storage.from).toHaveBeenCalledWith("archive");
    const [chemin, , options] = stockage.upload.mock.calls[0] as unknown as [
      string,
      File,
      { upsert: boolean },
    ];
    expect(chemin).toMatch(/^of1\/candidatures\/f2\/cv_[0-9a-f]{8}_Mon CV e\.pdf$/);
    expect(options.upsert).toBe(false);
    const ligne = appels.find((a) => a.table === "piece_formateur" && a.op === "insert")!;
    expect(ligne.valeurs).toMatchObject({
      formateur_id: "f2",
      type: "cv",
      nom_fichier: "Mon CV é.pdf",
      chemin,
      taille: 10,
    });
  });

  it("refuse extension interdite, fichier vide, type inconnu, absence de fichier, candidature en étude", async () => {
    const { stockage } = faux();
    expect(
      (await echecApi(aiguiller("POST", "/candidature/pieces", formulaire("virus.exe")))).statut,
    ).toBe(400);
    expect(
      (await echecApi(aiguiller("POST", "/candidature/pieces", formulaire("a.pdf", 0)))).message,
    ).toMatch(/vide/);
    expect(
      (await echecApi(aiguiller("POST", "/candidature/pieces", formulaire("a.pdf", 5, "zzz"))))
        .message,
    ).toMatch(/inconnu/);
    expect((await echecApi(aiguiller("POST", "/candidature/pieces", {}))).message).toMatch(
      /Aucun fichier/,
    );
    faux("soumise");
    expect(
      (await echecApi(aiguiller("POST", "/candidature/pieces", formulaire("a.pdf")))).statut,
    ).toBe(409);
    expect(stockage.upload).not.toHaveBeenCalled();
  });

  it("si la ligne ne s'enregistre pas, le fichier envoyé est retiré", async () => {
    const f = monter(ACTEURS.candidat, (a) => {
      if (a.table === "formateur") return { data: [FICHE] };
      if (a.table === "piece_formateur" && a.op === "insert")
        return { error: { message: "rls", code: "42501" } };
      return undefined;
    });
    // L'erreur Supabase brute remonte (api.ts la traduit en « introuvable » via erreurInconnue).
    await expect(
      aiguiller("POST", "/candidature/pieces", formulaire("a.pdf")),
    ).rejects.toMatchObject({
      code: "42501",
    });
    expect(f.stockage.remove).toHaveBeenCalledTimes(1);
  });

  it("suppression : la ligne d'abord, puis le fichier ; une pièce d'autrui est introuvable", async () => {
    const { appels, stockage } = faux();
    await aiguiller("DELETE", "/candidature/pieces/p1");
    expect(appels.findIndex((a) => a.op === "delete")).toBeGreaterThan(-1);
    expect(stockage.remove).toHaveBeenCalledWith(["of1/candidatures/f2/cv_a_cv.pdf"]);
    const sel = appels.find((a) => a.table === "piece_formateur" && a.fin)!;
    expect(aFiltre(sel, "eq", "formateur_id", "f2")).toBe(true);

    monter(ACTEURS.candidat, (a) =>
      a.table === "piece_formateur" && a.fin ? { data: [] } : undefined,
    );
    expect((await echecApi(aiguiller("DELETE", "/candidature/pieces/pX"))).statut).toBe(404);
  });

  it("refuse l'apprenant", async () => {
    monter(ACTEURS.apprenant);
    expect((await echecApi(aiguiller("DELETE", "/candidature/pieces/p1"))).statut).toBe(403);
  });
});

describe("route 23 : POST /candidature/soumettre", () => {
  it("passe par la fonction serveur puis renvoie la candidature à jour", async () => {
    soumettre.mockResolvedValue(succes({ formateur_id: "f2" }));
    monter(ACTEURS.candidat, (a) =>
      a.table === "formateur"
        ? { data: [{ ...FICHE, statut_candidature: "soumise" }] }
        : { data: [] },
    );
    const r = (await aiguiller("POST", "/candidature/soumettre", {})) as {
      formateur: { statut_candidature: string };
    };
    expect(soumettre).toHaveBeenCalledTimes(1);
    expect(r.formateur.statut_candidature).toBe("soumise");
  });

  it("convertit le refus du serveur en ErreurApi, manques compris", async () => {
    soumettre.mockResolvedValue(
      echec("invalide", "Votre candidature est incomplète.", { manques: ["Téléphone"] }),
    );
    monter(ACTEURS.candidat);
    const e = await echecApi(aiguiller("POST", "/candidature/soumettre", {}));
    expect([e.statut, e.code, e.details?.manques]).toEqual([400, "invalide", ["Téléphone"]]);
  });

  it("un jeton absent ou expiré donne un 401 français", async () => {
    soumettre.mockRejectedValue(new Error("Unauthorized: No authorization header provided"));
    monter(ACTEURS.candidat);
    const e = await echecApi(aiguiller("POST", "/candidature/soumettre", {}));
    expect([e.statut, e.code, e.message]).toEqual([
      401,
      "non_connecte",
      "Votre session a expiré. Reconnectez-vous.",
    ]);
  });
});

describe("route 24 : GET /pieces-formateur/:id", () => {
  it("renvoie un lien temporaire nommé d'après le fichier", async () => {
    const f = monter(ACTEURS.admin, (a) =>
      a.table === "piece_formateur"
        ? { data: [{ chemin: "of1/candidatures/f2/cv.pdf", nom_fichier: "Mon CV.pdf" }] }
        : undefined,
    );
    expect(await aiguiller("GET", "/pieces-formateur/p1")).toEqual({
      url: "https://stockage.test/signe",
      nom: "Mon CV.pdf",
    });
    expect(f.stockage.createSignedUrl).toHaveBeenCalledWith("of1/candidatures/f2/cv.pdf", 60, {
      download: "Mon CV.pdf",
    });
  });
  it("pièce cloisonnée par la RLS : introuvable ; apprenant : 403", async () => {
    monter(ACTEURS.formateurValide, () => ({ data: [] }));
    expect((await echecApi(aiguiller("GET", "/pieces-formateur/pX"))).statut).toBe(404);
    monter(ACTEURS.apprenant);
    expect((await echecApi(aiguiller("GET", "/pieces-formateur/p1"))).statut).toBe(403);
  });
});

describe("routes 25 et 26 : candidatures côté administrateur", () => {
  it("liste : réservée à l'administrateur, limitée à son organisme, tri de l'ancien serveur", async () => {
    const { appels } = monter(ACTEURS.admin, () => ({ data: [FICHE] }));
    expect(await aiguiller("GET", "/admin/candidatures")).toEqual([FICHE]);
    const a = appels.find((x) => x.table === "formateur")!;
    expect(aFiltre(a, "eq", "of_id", "of1")).toBe(true);
    expect(a.filtres.filter((f) => f[0] === "order").map((f) => f[1])).toEqual([
      "soumise_le",
      "cree_le",
    ]);
    for (const role of [ACTEURS.formateurValide, ACTEURS.candidat, ACTEURS.apprenant]) {
      monter(role, () => ({ data: [FICHE] }));
      const e = await echecApi(aiguiller("GET", "/admin/candidatures"));
      expect([e.statut, e.code]).toEqual([403, "interdit"]);
    }
  });

  it("détail : fiche, pièces et types ; introuvable si cloisonné ; 403 pour un formateur", async () => {
    monter(ACTEURS.admin, (a) => (a.table === "formateur" ? { data: [FICHE] } : { data: PIECES }));
    const r = (await aiguiller("GET", "/admin/candidatures/f2")) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(["formateur", "pieces", "types"]);
    monter(ACTEURS.admin, () => ({ data: [] }));
    expect((await echecApi(aiguiller("GET", "/admin/candidatures/fX"))).statut).toBe(404);
    monter(ACTEURS.formateurValide, () => ({ data: [FICHE] }));
    expect((await echecApi(aiguiller("GET", "/admin/candidatures/f2"))).statut).toBe(403);
  });
});

describe("route 27 : POST /admin/candidatures/:id/decision", () => {
  it("transmet la décision à la fonction serveur (pas à la base) puis renvoie le détail", async () => {
    decider.mockResolvedValue(
      succes({ formateur_id: "f2", statut: "validee", courrier: "journalise" }),
    );
    const { appels } = monter(ACTEURS.admin, (a) =>
      a.table === "formateur" ? { data: [FICHE] } : { data: PIECES },
    );
    const r = (await aiguiller("POST", "/admin/candidatures/f2/decision", {
      validee: true,
      motif: "Bienvenue",
    })) as {
      formateur: unknown;
    };
    expect(decider).toHaveBeenCalledWith({
      data: { formateur_id: "f2", validee: true, motif: "Bienvenue" },
    });
    expect(r.formateur).toBeTruthy();
    expect(appels.some((a) => a.op === "update")).toBe(false);
  });

  it("« validee » doit valoir exactement true : tout autre corps est un rejet", async () => {
    decider.mockResolvedValue(
      echec("invalide", "Un motif est obligatoire pour rejeter une candidature."),
    );
    monter(ACTEURS.admin);
    await echecApi(aiguiller("POST", "/admin/candidatures/f2/decision", { validee: "true" }));
    expect(decider).toHaveBeenCalledWith({
      data: { formateur_id: "f2", validee: false, motif: "" },
    });
  });

  it("un formateur qui décide reçoit le 403 français du serveur", async () => {
    decider.mockResolvedValue(
      echec("interdit", "Cette action est réservée à l'administrateur de l'organisme."),
    );
    monter(ACTEURS.formateurValide);
    const e = await echecApi(
      aiguiller("POST", "/admin/candidatures/f2/decision", { validee: true }),
    );
    expect([e.statut, e.code, e.message]).toEqual([
      403,
      "interdit",
      "Cette action est réservée à l'administrateur de l'organisme.",
    ]);
  });
});

describe("routes 30, 31, 32 : réglages", () => {
  const VUE = {
    of_id: "of1",
    ia_modele: "claude-sonnet-5",
    ia_workspace: "",
    ia_recherche_web: "oui",
    ia_active: "oui",
    smtp_hote: "smtp.x.fr",
    smtp_port: "465",
    smtp_securise: "oui",
    smtp_utilisateur: "u",
    courrier_expediteur: "",
    courrier_actif: "non",
    ia_cle_definie: true,
    smtp_mot_de_passe_defini: false,
  };

  it("30 : lit la vue sans secret, ajoute les constantes du noyau et l'état de l'IA par défaut", async () => {
    etatConfig.mockResolvedValue(succes({ ia_defaut_serveur: true }));
    const { appels } = monter(ACTEURS.admin, () => ({ data: [VUE] }));
    const r = (await aiguiller("GET", "/admin/reglages")) as Record<string, unknown>;
    expect(appels.some((a) => a.table === "reglage_vue")).toBe(true);
    expect(appels.some((a) => a.table === "reglage")).toBe(false);
    expect(r["of_id"]).toBeUndefined();
    expect(r).toMatchObject({
      ia_cle_definie: true,
      smtp_mot_de_passe_defini: false,
      ia_defaut_serveur: true,
      smtp_hote: "smtp.x.fr",
    });
    expect((r["modeles"] as unknown[]).length).toBe(3);
    expect(Object.keys(r["prereglages"] as object)).toEqual(["gmail", "brevo", "ovh", "ionos"]);
    expect(Object.keys(r)).not.toContain("ia_cle");
    expect(Object.keys(r)).not.toContain("smtp_mot_de_passe");
  });

  it("30 : si l'état du serveur est indisponible, l'écran s'affiche quand même", async () => {
    etatConfig.mockRejectedValue(new Error("boom"));
    monter(ACTEURS.admin, () => ({ data: [VUE] }));
    expect(
      ((await aiguiller("GET", "/admin/reglages")) as Record<string, unknown>)["ia_defaut_serveur"],
    ).toBe(false);
  });

  it("30 : refuse tout autre rôle (403)", async () => {
    for (const role of [ACTEURS.formateurValide, ACTEURS.apprenant]) {
      monter(role, () => ({ data: [VUE] }));
      expect((await echecApi(aiguiller("GET", "/admin/reglages"))).statut).toBe(403);
    }
  });

  it("31 : confie l'écriture (et les secrets) au serveur, puis relit la vue", async () => {
    enregistrer.mockResolvedValue(succes({ cles: ["ia_cle"] }));
    etatConfig.mockResolvedValue(succes({ ia_defaut_serveur: false }));
    const { appels } = monter(ACTEURS.admin, () => ({ data: [VUE] }));
    const r = (await aiguiller("PATCH", "/admin/reglages", { ia_cle: "sk-xx" })) as Record<
      string,
      unknown
    >;
    expect(enregistrer).toHaveBeenCalledWith({ data: { ia_cle: "sk-xx" } });
    expect(r["ia_cle_definie"]).toBe(true);
    expect(appels.some((a) => a.table === "reglage" && a.op !== "select")).toBe(false);
  });

  it("31 : les erreurs de champ et le secret CLE_SECRETS manquant arrivent à l'écran", async () => {
    enregistrer.mockResolvedValue(
      echec("invalide", "Certains réglages sont invalides.", {
        champs: { smtp_port: "Port invalide." },
      }),
    );
    monter(ACTEURS.admin);
    const e = await echecApi(aiguiller("PATCH", "/admin/reglages", { smtp_port: "x" }));
    expect([e.statut, e.details?.champs?.["smtp_port"]]).toEqual([400, "Port invalide."]);
    enregistrer.mockResolvedValue(echec("indisponible", "… secret CLE_SECRETS …"));
    expect((await echecApi(aiguiller("PATCH", "/admin/reglages", { ia_cle: "x" }))).statut).toBe(
      503,
    );
  });

  it("32 : renvoie le résultat du test d'envoi tel que l'écran l'attend", async () => {
    test.mockResolvedValue(
      succes({
        id: "c1",
        statut: "journalise",
        erreur: "",
        info: "…",
        actif: false,
        destinataire: "admin@of.fr",
      }),
    );
    monter(ACTEURS.admin);
    expect(await aiguiller("POST", "/admin/reglages/test-courriel", {})).toMatchObject({
      statut: "journalise",
      actif: false,
      destinataire: "admin@of.fr",
    });
    test.mockResolvedValue(
      echec("interdit", "Cette action est réservée à l'administrateur de l'organisme."),
    );
    expect((await echecApi(aiguiller("POST", "/admin/reglages/test-courriel", {}))).statut).toBe(
      403,
    );
  });
});

describe("routes 33 et 34 : boîte d'envoi", () => {
  it("33 : liste les courriers visibles par la RLS, du plus récent au plus ancien, 200 au plus", async () => {
    const { appels } = monter(ACTEURS.formateurValide, () => ({ data: [{ id: "c1" }] }));
    expect(await aiguiller("GET", "/courriers")).toEqual([{ id: "c1" }]);
    const a = appels.find((x) => x.table === "courrier")!;
    expect(a.filtres).toEqual([
      ["order", "cree_le", { ascending: false }],
      ["limit", 200],
    ]);
  });

  it("33 : refuse l'apprenant (403)", async () => {
    monter(ACTEURS.apprenant, () => ({ data: [{ id: "c1" }] }));
    const e = await echecApi(aiguiller("GET", "/courriers"));
    expect([e.statut, e.message]).toEqual([403, "Réservé au formateur et à l'organisme."]);
  });

  it("34 : renvoie via la fonction serveur et transmet statut et erreur", async () => {
    renvoyer.mockResolvedValue(
      succes({ id: "c2", statut: "echec", erreur: "Clé refusée", info: "" }),
    );
    monter(ACTEURS.admin);
    expect(await aiguiller("POST", "/courriers/c1/renvoyer", {})).toMatchObject({
      statut: "echec",
      erreur: "Clé refusée",
    });
    expect(renvoyer).toHaveBeenCalledWith({ data: { courrier_id: "c1" } });
  });

  it("34 : courrier cloisonné ou rôle refusé : erreurs 404 / 403 du serveur", async () => {
    monter(ACTEURS.admin);
    renvoyer.mockResolvedValue(echec("introuvable", "Courrier introuvable."));
    expect((await echecApi(aiguiller("POST", "/courriers/cX/renvoyer", {}))).statut).toBe(404);
    renvoyer.mockResolvedValue(echec("interdit", "Cette action ne vous est pas permise."));
    expect((await echecApi(aiguiller("POST", "/courriers/c1/renvoyer", {}))).statut).toBe(403);
  });
});
