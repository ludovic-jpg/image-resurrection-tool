// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, fauxBd, moi, type Appel } from "@/test/faux-supabase";
import { ErreurApi } from "../erreur";
import { echec, succes } from "@/lib/resultat";

const h = vi.hoisted(() => ({ bd: null as unknown }));
vi.mock("../bd", () => ({
  bd: new Proxy({}, { get: (_c, p) => (h.bd as Record<string | symbol, unknown>)[p] }),
}));
const serveur = vi.hoisted(() => ({
  signer: vi.fn(),
  deposer: vi.fn(),
  externe: vi.fn(),
  regenerer: vi.fn(),
  apercu: vi.fn(),
  telecharger: vi.fn(),
  integrite: vi.fn(),
  trame: vi.fn(),
  emarger: vi.fn(),
  questionnaire: vi.fn(),
  envoyer: vi.fn(),
  lire: vi.fn(),
  brouillon: vi.fn(),
  signerForm: vi.fn(),
  pdf: vi.fn(),
}));
vi.mock("@/lib/pieces.functions", () => ({
  signerPieceDossier: (...a: unknown[]) => serveur.signer(...a),
  deposerPieceDossier: (...a: unknown[]) => serveur.deposer(...a),
  deposerPieceExterneDossier: (...a: unknown[]) => serveur.externe(...a),
  regenererPieceDossier: (...a: unknown[]) => serveur.regenerer(...a),
  apercuPieceDossier: (...a: unknown[]) => serveur.apercu(...a),
  telechargerPieceDossier: (...a: unknown[]) => serveur.telecharger(...a),
  integritePieceDossier: (...a: unknown[]) => serveur.integrite(...a),
  trameFactureDossier: (...a: unknown[]) => serveur.trame(...a),
  emargerSeance: (...a: unknown[]) => serveur.emarger(...a),
  enregistrerQuestionnaire: (...a: unknown[]) => serveur.questionnaire(...a),
}));
vi.mock("@/lib/formulaires.functions", () => ({
  envoyerFormulaireApprenant: (...a: unknown[]) => serveur.envoyer(...a),
  lireFormulaire: (...a: unknown[]) => serveur.lire(...a),
  enregistrerBrouillon: (...a: unknown[]) => serveur.brouillon(...a),
  signerFormulaire: (...a: unknown[]) => serveur.signerForm(...a),
  pdfFormulaire: (...a: unknown[]) => serveur.pdf(...a),
}));

const { aiguiller, routesEnregistrees, route } = await import("../aiguilleur");

const echecApi = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurApi);
    return e as ErreurApi;
  }
  throw new Error("Une ErreurApi était attendue");
};

function monter(
  acteur: Record<string, unknown> | null,
  repondre: (a: Appel) => { data?: unknown; error?: unknown } | undefined = () => undefined,
) {
  const faux = fauxBd((a) => repondre(a) as never);
  faux.bd.rpc.mockImplementation(async (nom: string) =>
    nom === "s4m_moi" ? moi(acteur) : { data: null, error: null },
  );
  h.bd = faux.bd;
  return faux;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("couverture du lot 5", () => {
  it("enregistre toutes les routes du périmètre", () => {
    const routes = routesEnregistrees().map((r) => r.replace(/\\\//g, "/"));
    for (const r of [
      "GET ^/public/formulaire/([^/]+)$",
      "PUT ^/public/formulaire/([^/]+)/brouillon$",
      "POST ^/public/formulaire/([^/]+)/signer$",
      "GET ^/public/formulaire/([^/]+)/pdf$",
      "POST ^/dossiers/([^/]+)/pieces-externes/([^/]+)$",
      "GET ^/dossiers/([^/]+)/formulaires$",
      "POST ^/dossiers/([^/]+)/formulaires/envoyer$",
      "GET ^/dossiers/([^/]+)/formulaires/([^/]+)/([^/]+)/invitation$",
      "GET ^/formulaires$",
      "GET ^/dossiers/([^/]+)/emargement$",
      "GET ^/dossiers/([^/]+)/trame-facture$",
      "GET ^/dossiers/([^/]+)/questionnaires/([^/]+)$",
      "POST ^/dossiers/([^/]+)/questionnaires/([^/]+)$",
      "GET ^/pieces/([^/]+)/apercu$",
      "GET ^/pieces/([^/]+)/telecharger$",
      "GET ^/pieces/([^/]+)/integrite$",
      "POST ^/pieces/([^/]+)/signer$",
      "POST ^/pieces/([^/]+)/deposer$",
      "POST ^/pieces/([^/]+)/regenerer$",
      "POST ^/seances/([^/]+)/emarger$",
    ])
      expect(routes, r).toContain(r);
  });
});

describe("transport vers les fonctions serveur", () => {
  it("111 : le corps ne transporte que le tracé, le lieu et le consentement (jamais l'acteur)", async () => {
    serveur.signer.mockResolvedValue(succes({ piece: { id: "p1", statut: "valide" } }));
    const r = await aiguiller("POST", "/pieces/p1/signer", {
      trace_png: "T",
      lieu: "Lyon",
      consentement: true,
      role: "admin",
      utilisateur_id: "autre",
    });
    expect(r).toEqual({ id: "p1", statut: "valide" });
    expect(serveur.signer).toHaveBeenCalledWith({
      data: { piece_id: "p1", trace_png: "T", lieu: "Lyon", consentement: true },
    });
  });

  it("un refus du serveur devient une ErreurApi avec son statut", async () => {
    serveur.regenerer.mockResolvedValue(echec("interdit", "Cette action ne vous est pas permise."));
    const e = await echecApi(aiguiller("POST", "/pieces/p1/regenerer", {}));
    expect([e.statut, e.message]).toEqual([403, "Cette action ne vous est pas permise."]);
  });

  it("un jeton de session expiré donne un 401 français", async () => {
    serveur.integrite.mockRejectedValue(new Error("Unauthorized: jeton expiré"));
    expect((await echecApi(aiguiller("GET", "/pieces/p1/integrite"))).statut).toBe(401);
  });

  it("112 : dépôt sans fichier refusé (400), fichier transmis en FormData avec l'identifiant", async () => {
    expect((await echecApi(aiguiller("POST", "/pieces/p1/deposer", {}))).statut).toBe(400);
    serveur.deposer.mockResolvedValue(succes({ piece: { id: "p1" } }));
    const form = new FormData();
    form.set("fichier", new File([new Uint8Array([1])], "a.pdf"));
    await aiguiller("POST", "/pieces/p1/deposer", form);
    const envoye = serveur.deposer.mock.calls[0]![0].data as FormData;
    expect(envoye.get("piece_id")).toBe("p1");
    expect(envoye.get("fichier")).toBeInstanceOf(File);
  });

  it("99 : la pièce externe est déposée, puis le dossier relu (route 87 du lot 4)", async () => {
    // Le dernier enregistrement l'emporte : on remplace la lecture du dossier par un dossier factice.
    route("GET", "/dossiers/:id", async () => ({ id: "d1", relu: true }));
    serveur.externe.mockResolvedValue(succes({ piece: { id: "p9" } }));
    const form = new FormData();
    form.set("fichier", new File([new Uint8Array([1])], "accord.pdf"));
    expect(await aiguiller("POST", "/dossiers/d1/pieces-externes/ACC", form)).toEqual({
      id: "d1",
      relu: true,
    });
    const envoye = serveur.externe.mock.calls[0]![0].data as FormData;
    expect([envoye.get("dossier_id"), envoye.get("code")]).toEqual(["d1", "ACC"]);
  });

  it("109 : version retour ou départ selon la requête", async () => {
    serveur.telecharger.mockResolvedValue(succes({ url: "u", nom: "n", type_mime: "t" }));
    await aiguiller("GET", "/pieces/p1/telecharger?version=retour");
    await aiguiller("GET", "/pieces/p1/telecharger");
    expect(serveur.telecharger.mock.calls.map((c) => c[0].data.version)).toEqual([
      "retour",
      "depart",
    ]);
  });

  it("101 : type inconnu refusé (400) sans appeler le serveur", async () => {
    expect(
      (await echecApi(aiguiller("POST", "/dossiers/d1/formulaires/envoyer", { type: "x" }))).statut,
    ).toBe(400);
    expect(serveur.envoyer).not.toHaveBeenCalled();
  });

  it("14 à 17 : appelées par leur jeton, sans session", async () => {
    serveur.lire.mockResolvedValue(succes({ ok: 1 }));
    serveur.brouillon.mockResolvedValue(succes({ enregistre_le: "x" }));
    serveur.signerForm.mockResolvedValue(succes({ statut: "complet" }));
    serveur.pdf.mockResolvedValue(succes({ url: "u", nom: "n", type_mime: "t" }));
    const jeton = "j".repeat(40);
    await aiguiller("GET", `/public/formulaire/${jeton}`);
    await aiguiller("PUT", `/public/formulaire/${jeton}/brouillon`, { reponses: [] });
    await aiguiller("POST", `/public/formulaire/${jeton}/signer`, { lieu: "x" });
    await aiguiller("GET", `/public/formulaire/${jeton}/pdf`);
    expect(serveur.lire).toHaveBeenCalledWith({ data: { jeton } });
    expect(serveur.signerForm).toHaveBeenCalledWith({ data: { jeton, corps: { lieu: "x" } } });
  });
});

describe("Client + RLS", () => {
  it("104 : séances et pointages visibles, durée calculée, dossier cloisonné = 404", async () => {
    monter(ACTEURS.apprenant, (a) => {
      if (a.table === "seance")
        return {
          data: [
            {
              id: "se1",
              dossier_id: "d1",
              date: "2026-11-02",
              heure_debut: "09:00",
              heure_fin: "12:30",
            },
          ],
        };
      if (a.table === "emargement")
        return {
          data: [
            {
              seance_id: "se1",
              stagiaire_id: "s1",
              signataire: "stagiaire",
              horodatage: "2026-11-02T08:00:00+00:00",
            },
          ],
        };
      return undefined;
    });
    const r = (await aiguiller("GET", "/dossiers/d1/emargement")) as Array<Record<string, unknown>>;
    expect(r[0]).toMatchObject({ id: "se1", duree_heures: 3.5 });
    expect(r[0]!["signatures"]).toEqual([
      { stagiaire_id: "s1", signataire: "stagiaire", horodatage: "2026-11-02T08:00:00.000Z" },
    ]);
    expect(JSON.stringify(r)).not.toContain("trace_png");

    const faux = monter(ACTEURS.formateurValide, () => ({ data: [] }));
    faux.bd.rpc.mockImplementation(async (nom: string) =>
      nom === "s4m_moi" ? moi(ACTEURS.formateurValide) : { data: false, error: null },
    );
    expect((await echecApi(aiguiller("GET", "/dossiers/dX/emargement"))).statut).toBe(404);
  });

  it("106 : RPC s4m_questionnaire ; la définition des champs fixes vient du noyau", async () => {
    const faux = monter(ACTEURS.apprenant);
    faux.bd.rpc.mockImplementation(async (nom: string) =>
      nom === "s4m_moi"
        ? moi(ACTEURS.apprenant)
        : {
            data: {
              type: "recueil",
              ouvert: true,
              formulaire: null,
              questionnaire: null,
              reponses: null,
              score: null,
              date: null,
            },
            error: null,
          },
    );
    const r = (await aiguiller("GET", "/dossiers/d1/questionnaires/recueil")) as Record<
      string,
      unknown
    >;
    expect(r["formulaire"]).not.toBeNull();
    expect(faux.bd.rpc).toHaveBeenCalledWith("s4m_questionnaire", {
      p_dossier_id: "d1",
      p_type: "recueil",
      p_stagiaire_id: null,
    });
    expect((await echecApi(aiguiller("GET", "/dossiers/d1/questionnaires/inconnu"))).statut).toBe(
      400,
    );
  });

  it("106 : une exception « introuvable » de la RPC devient un 404", async () => {
    const faux = monter(ACTEURS.apprenant);
    faux.bd.rpc.mockImplementation(async (nom: string) =>
      nom === "s4m_moi"
        ? moi(ACTEURS.apprenant)
        : { data: null, error: { message: "Dossier introuvable." } },
    );
    expect((await echecApi(aiguiller("GET", "/dossiers/d1/questionnaires/recueil"))).statut).toBe(
      404,
    );
  });

  it("103 : refusée à l'apprenant (403) ; l'organisme lit la vue sans jeton ni brouillon", async () => {
    monter(ACTEURS.apprenant);
    expect((await echecApi(aiguiller("GET", "/formulaires"))).statut).toBe(403);
    const faux = monter(ACTEURS.admin, (a) =>
      a.table === "formulaire_apprenant_vue"
        ? {
            data: [
              {
                id: "fa1",
                dossier_id: "d1",
                type: "recueil",
                statut: "envoye",
                envois: 1,
                expire_le: "x",
              },
            ],
          }
        : undefined,
    );
    const r = (await aiguiller("GET", "/formulaires?dossier_id=d1")) as Array<
      Record<string, unknown>
    >;
    expect(r[0]).toMatchObject({ id: "fa1", libelle: expect.any(String) });
    expect(Object.keys(r[0]!)).not.toContain("jeton_hash");
    expect(Object.keys(r[0]!)).not.toContain("expire_le");
    expect(faux.bd.from).toHaveBeenCalledWith("formulaire_apprenant_vue");
  });

  it("100 : état par stagiaire et type, lu par la vue (sans jeton) ; l'apprenant ne voit que sa fiche", async () => {
    const faux = monter(ACTEURS.apprenant, (a) => {
      if (a.table === "dossier_formation_apprenant")
        return { data: [{ sous_statut: "brouillon" }] };
      if (a.table === "stagiaire_dossier")
        return { data: [{ stagiaire_id: "s1" }, { stagiaire_id: "s2" }] };
      if (a.table === "formulaire_apprenant_vue")
        return {
          data: [
            {
              stagiaire_id: "s1",
              type: "recueil",
              statut: "complet",
              envois: 2,
              envoye_le: "x",
              expire_le: "2020-01-01",
              signe_le: "y",
              invitation: true,
            },
          ],
        };
      if (a.table === "piece_dossier") return { data: [] };
      return undefined;
    });
    const r = (await aiguiller("GET", "/dossiers/d1/formulaires")) as Array<
      Record<string, unknown>
    >;
    expect(new Set(r.map((l) => l["stagiaire_id"]))).toEqual(new Set(["s1"]));
    expect(r.find((l) => l["type"] === "recueil")).toMatchObject({
      statut: "valide",
      envois: 2,
      invitation: true,
      ouvert: true,
    });
    expect(faux.bd.from).not.toHaveBeenCalledWith("formulaire_apprenant");
    expect(JSON.stringify(r)).not.toContain("jeton");
  });

  it("102 : URL signée de 60 s du document d'invitation, 404 si absent", async () => {
    const faux = monter(ACTEURS.formateurValide, (a) =>
      a.table === "formulaire_apprenant"
        ? { data: [{ chemin_invitation: "of1/dossiers/ADF/Pièces de départ/invitation.pdf" }] }
        : undefined,
    );
    const r = await aiguiller("GET", "/dossiers/d1/formulaires/s1/recueil/invitation");
    expect(r).toMatchObject({ url: "https://stockage.test/signe", nom: "invitation.pdf" });
    expect(faux.stockage.createSignedUrl).toHaveBeenCalledWith(
      "of1/dossiers/ADF/Pièces de départ/invitation.pdf",
      60,
      expect.anything(),
    );
    const lecture = (faux.bd.from as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(lecture).toBeGreaterThan(0);
    monter(ACTEURS.formateurValide, () => ({ data: [] }));
    expect(
      (await echecApi(aiguiller("GET", "/dossiers/d1/formulaires/s1/recueil/invitation"))).statut,
    ).toBe(404);
  });
});
