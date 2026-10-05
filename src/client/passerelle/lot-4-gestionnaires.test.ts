// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, moi, type Appel } from "@/test/faux-supabase";
import { bdMemoire, type Ligne, type Tables } from "@/test/bd-memoire";
import { echec, succes } from "@/lib/resultat";
import { ErreurApi } from "../erreur";

const h = vi.hoisted(() => ({ bd: null as unknown }));
vi.mock("../bd", () => ({
  bd: new Proxy({}, { get: (_c, p) => (h.bd as Record<string | symbol, unknown>)[p] }),
}));
const creer = vi.fn();
const stagiaires = vi.fn();
const inviter = vi.fn();
const relancer = vi.fn();
const recreer = vi.fn();
const finances = vi.fn();
const transiter = vi.fn();
vi.mock("@/lib/dossiers.functions", () => ({
  creerDossier: (...a: unknown[]) => creer(...a),
  definirStagiaires: (...a: unknown[]) => stagiaires(...a),
  inviterApprenantDossier: (...a: unknown[]) => inviter(...a),
  relancerApprenantDossier: (...a: unknown[]) => relancer(...a),
  recreerDossier: (...a: unknown[]) => recreer(...a),
  lireFinancesDossier: (...a: unknown[]) => finances(...a),
}));
vi.mock("@/lib/pipeline-transiter.functions", () => ({
  transiterDossier: (...a: unknown[]) => transiter(...a),
}));

const { aiguiller, routesEnregistrees } = await import("../aiguilleur");
await import("./lot-4");

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
const toutesLesEcritures: Appel[] = [];
let rpcAppelees: Array<{ nom: string; args: unknown }> = [];
let reponsesRpc: Record<string, unknown> = {};

const DOSSIER: Ligne = {
  id: "d1",
  of_id: "of1",
  dossier_reference: "ADF-2026-0001",
  formateur_id: "f1",
  entreprise_id: "e1",
  formation_id: "fo1",
  sous_statut: "dossier_valide",
  mode_financement: "opco",
  coffre_ouvert: false,
  motif_renvoi: "Secret interne",
  motif_refus: "",
  formation_titre: "Soudure",
  formation_prix_unitaire_ht: 120000,
  formation_prix_presentiel_ht: 90000,
  formateur_cout_horaire: 5000,
  formation_duree_heures_total: 14,
  questionnaire_positionnement: { questions: [{ corrige: "A" }] },
  questionnaire_acquis: null,
};
// La vue de l'apprenant : sans prix ni motifs ni questionnaires.
const {
  formation_prix_unitaire_ht: _a,
  formation_prix_presentiel_ht: _b,
  formateur_cout_horaire: _c,
  motif_renvoi: _d,
  questionnaire_positionnement: _e,
  entreprise_id: _f,
  ...VUE
} = DOSSIER;
void [_a, _b, _c, _d, _e, _f];

function monter(acteur: Acteur, extra: Tables = {}) {
  const tables: Tables = {
    dossier_formation: [{ ...DOSSIER }],
    dossier_formation_apprenant: [{ ...VUE }],
    stagiaire_dossier: [
      { dossier_id: "d1", stagiaire_id: "s1", poste_occupe: "Soudeur", rang: 1 },
      { dossier_id: "d1", stagiaire_id: "s2", poste_occupe: "Aide", rang: 2 },
    ],
    stagiaire: [
      {
        id: "s1",
        stagiaire_prenom: "Anne",
        stagiaire_nom: "A",
        stagiaire_email: "a@x.fr",
        utilisateur_id: "u-app",
      },
      {
        id: "s2",
        stagiaire_prenom: "Bob",
        stagiaire_nom: "B",
        stagiaire_email: "b@x.fr",
        utilisateur_id: null,
      },
    ],
    piece_dossier: [
      {
        id: "p1",
        dossier_id: "d1",
        code: "02-AVT",
        stagiaire_id: null,
        statut: "en_attente",
        chemin_depart: "x.html",
      },
      {
        id: "p2",
        dossier_id: "d1",
        code: "04-AVT",
        stagiaire_id: null,
        statut: "valide",
        chemin_depart: "odm.html",
      },
      {
        id: "p3",
        dossier_id: "d1",
        code: "11-FIN",
        stagiaire_id: null,
        statut: "valide",
        chemin_depart: "facture.html",
      },
      {
        id: "p4",
        dossier_id: "d1",
        code: "05-AVT",
        stagiaire_id: "s1",
        statut: "en_attente",
        chemin_depart: "c1.html",
      },
      {
        id: "p5",
        dossier_id: "d1",
        code: "05-AVT",
        stagiaire_id: "s2",
        statut: "en_attente",
        chemin_depart: "c2.html",
      },
    ],
    seance: [],
    evaluation: [],
    evenement: [
      {
        id: "ev1",
        dossier_id: "d1",
        type: "transition",
        libelle: "Journal interne",
        cree_le: "2026-10-01",
      },
    ],
    emargement: [],
    formateur: [
      {
        id: "f1",
        formateur_prenom: "Fred",
        formateur_nom: "F",
        formateur_email: "fred@of.fr",
        formateur_telephone: "0600",
        formateur_iban: "FR76",
      },
    ],
    formateur_public: [
      { id: "f1", formateur_prenom: "Fred", formateur_nom: "F", formateur_email: "fred@of.fr" },
    ],
    entreprise_cliente: [{ id: "e1", entreprise_nom: "Acme", entreprise_siret: "9" }],
    ...extra,
  };
  const faux = bdMemoire(tables, {
    imposer: (a) => {
      if (a.op !== "select") toutesLesEcritures.push(a);
      return undefined;
    },
  });
  faux.bd.rpc.mockImplementation(async (nom: string, args: unknown) => {
    rpcAppelees.push({ nom, args });
    if (nom === "s4m_moi") return moi(acteur);
    if (nom in reponsesRpc) return reponsesRpc[nom];
    return { data: null, error: null };
  });
  h.bd = faux.bd;
  return faux;
}

beforeEach(() => {
  vi.resetAllMocks();
  rpcAppelees = [];
  reponsesRpc = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
  finances.mockResolvedValue(succes({ prix_ht: 120000, net_formateur: 100000 }));
});

afterAll(() => {
  // Règle du lot : le client n'écrit jamais `sous_statut` (ni les colonnes de pipeline, réservées au serveur).
  const interdits = toutesLesEcritures.filter(
    (a) =>
      a.table === "dossier_formation" &&
      JSON.stringify(a.valeurs ?? {}).match(
        /sous_statut|coffre_ouvert|archive_le|termine_le|valide_le|motif_renvoi|motif_refus/,
      ),
  );
  expect(interdits).toEqual([]);
});

describe("couverture du lot 4", () => {
  it("enregistre toutes les routes du lot", () => {
    const attendues = [
      "GET ^/dossiers$",
      "POST ^/dossiers$",
      "GET ^/dossiers/([^/]+)$",
      "PATCH ^/dossiers/([^/]+)$",
      "DELETE ^/dossiers/([^/]+)$",
      "PUT ^/dossiers/([^/]+)/seances$",
      "PUT ^/dossiers/([^/]+)/stagiaires$",
      "PATCH ^/dossiers/([^/]+)/objectifs-atteints$",
      "POST ^/dossiers/([^/]+)/actions/([^/]+)$",
      "POST ^/dossiers/([^/]+)/inviter$",
      "POST ^/dossiers/([^/]+)/relancer$",
      "POST ^/dossiers/([^/]+)/recreer$",
      "GET ^/dossiers/([^/]+)/formulaires$",
      "GET ^/formulaires$",
      "GET ^/dossiers/([^/]+)/emargement$",
      "GET ^/dossiers/([^/]+)/questionnaires/([^/]+)$",
    ];
    const reelles = routesEnregistrees().map((r) => r.replace(/\\\//g, "/"));
    for (const r of attendues) expect(reelles).toContain(r);
  });

  it("aucun fichier du client n'écrit `sous_statut` (contrôle statique)", () => {
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom)) fichiers.push(chemin);
      }
    };
    parcourir(join(process.cwd(), "src/client"));
    expect(fichiers.length).toBeGreaterThan(10);
    const fautifs = fichiers.filter((f) => {
      const code = readFileSync(f, "utf8");
      for (const m of code.matchAll(/\.(update|upsert|insert)\(/g)) {
        const fenetre = code.slice(m.index, m.index + 300);
        if (/sous_statut\s*:/.test(fenetre.split(/\)\s*\.\s*(eq|in|select|match)/)[0] ?? ""))
          return true;
      }
      return /rpc\(\s*["'][^"']*sous_statut/.test(code);
    });
    expect(fautifs).toEqual([]);
  });
});

describe("route 87 : GET /dossiers", () => {
  it("renvoie les cartes de la RPC, avec les étapes et sous-statuts du noyau", async () => {
    monter(ACTEURS.formateurValide);
    reponsesRpc["s4m_lister_dossiers"] = { data: { dossiers: [{ id: "d1" }] }, error: null };
    const r = (await aiguiller("GET", "/dossiers")) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(["dossiers", "etapes", "sous_statuts"]);
    expect(r["dossiers"]).toEqual([{ id: "d1" }]);
    expect((r["sous_statuts"] as unknown[]).length).toBeGreaterThan(10);
  });

  it("refuse le formateur non validé (403) et l'absence de session (401)", async () => {
    monter(ACTEURS.candidat);
    expect((await echecApi(aiguiller("GET", "/dossiers"))).statut).toBe(403);
    monter(null);
    expect((await echecApi(aiguiller("GET", "/dossiers"))).statut).toBe(401);
  });
});

describe("route 89 : GET /dossiers/:id", () => {
  it("formateur : forme complète, actions, pièces signables, finances et journal", async () => {
    monter(ACTEURS.formateurValide);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lecture libre de la réponse JSON
    const r = (await aiguiller("GET", "/dossiers/d1")) as Record<string, any>;
    expect(r["dossier_reference"]).toBe("ADF-2026-0001");
    expect(r["sous_statut"]).toBe("dossier_valide");
    expect(r["finances"]).toEqual({ prix_ht: 120000, net_formateur: 100000 });
    expect(r["actions"].map((a: { action: string }) => a.action)).toContain("declarer_depot");
    expect(r["formation"]["formation_prix_unitaire_ht"]).toBe(120000);
    expect(r["stagiaires"]).toHaveLength(2);
    const convention = r["pieces"].find((p: { code: string }) => p.code === "02-AVT");
    expect(convention).toHaveProperty("peut_signer");
    expect(convention).toHaveProperty("peut_deposer");
    // La garde du noyau : déposer la demande est bloqué tant que la convention n'est pas signée.
    const depot = r["actions"].find((a: { action: string }) => a.action === "declarer_depot");
    expect(depot.bloqueePar).toMatch(/convention de formation doit être signée/i);
  });

  it("apprenant : lit la vue sans prix, ne voit ni ODM 04-AVT, ni factures, ni finances, ni journal, ni coordonnées bancaires, ni les autres apprenants", async () => {
    monter(ACTEURS.apprenant);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lecture libre de la réponse JSON
    const r = (await aiguiller("GET", "/dossiers/d1")) as Record<string, any>;
    const texte = JSON.stringify(r);
    expect(r["finances"]).toBeNull();
    expect(finances).not.toHaveBeenCalled();
    expect(r["formation"]["formation_prix_unitaire_ht"]).toBeNull();
    expect(r["formation"]["formateur_cout_horaire"]).toBeNull();
    expect(r["motif_renvoi"]).toBe("");
    expect(r["pieces"].map((p: { code: string }) => p.code)).not.toContain("04-AVT");
    expect(r["pieces"].map((p: { code: string }) => p.code)).not.toContain("11-FIN");
    expect(texte).not.toContain("Journal interne");
    expect(texte).not.toContain("Secret interne");
    expect(texte).not.toContain("FR76");
    expect(texte).not.toContain("0600");
    expect(texte).not.toContain("corrige");
    expect(r["stagiaires"].map((s: { id: string }) => s.id)).toEqual(["s1"]);
    // Il ne lit jamais la table brute ni les vues internes.
    const tables = h.bd as { from: { mock: { calls: string[][] } } };
    const lues = tables.from.mock.calls.map((c) => c[0]);
    expect(lues).toContain("dossier_formation_apprenant");
    expect(lues).toContain("formateur_public");
    for (const interdite of [
      "dossier_formation",
      "formateur",
      "entreprise_cliente",
      "evenement",
      "facture_of",
      "facture_formateur",
    ])
      expect(lues).not.toContain(interdite);
    // Les seules actions offertes à l'apprenant : les siennes.
    for (const a of r["actions"]) expect(a.action).toBe("declarer_depot");
  });

  it("dossier cloisonné (RLS : aucune ligne) : 404 « introuvable »", async () => {
    monter(ACTEURS.formateurValide, { dossier_formation: [] });
    const e = await echecApi(aiguiller("GET", "/dossiers/d1"));
    expect([e.statut, e.code, e.message]).toEqual([404, "introuvable", "Dossier introuvable."]);
  });
});

describe("routes 90, 91, 92, 94 : saisie sous RLS", () => {
  it("PATCH : n'écrit que les champs modifiables, jamais le statut ni l'organisme", async () => {
    const s = monter(ACTEURS.formateurValide, {
      dossier_formation: [{ ...DOSSIER, sous_statut: "brouillon" }],
    });
    await aiguiller("PATCH", "/dossiers/d1", {
      signature_lieu: "Mulhouse",
      sous_statut: "archive",
      of_id: "of9",
      coffre_ouvert: true,
    });
    const maj = s.appels.find((a) => a.op === "update")!;
    expect(maj.valeurs).toEqual({ signature_lieu: "Mulhouse" });
    expect(JSON.stringify(maj.valeurs)).not.toMatch(/sous_statut|of_id|coffre/);
  });

  it("PATCH : dossier figé pour le formateur (validé) : 409 sans écriture", async () => {
    const s = monter(ACTEURS.formateurValide);
    const e = await echecApi(aiguiller("PATCH", "/dossiers/d1", { signature_lieu: "X" }));
    expect(e.statut).toBe(409);
    expect(s.appels.some((a) => a.op === "update")).toBe(false);
  });

  it("PATCH et DELETE : l'apprenant ne passe pas (404 : la table n'est pas lisible pour lui)", async () => {
    monter(ACTEURS.apprenant, { dossier_formation: [] });
    expect(
      (await echecApi(aiguiller("PATCH", "/dossiers/d1", { signature_lieu: "X" }))).statut,
    ).toBe(404);
    expect((await echecApi(aiguiller("DELETE", "/dossiers/d1"))).statut).toBe(404);
  });

  it("DELETE : un brouillon se supprime ; un dossier validé : 409", async () => {
    const s = monter(ACTEURS.formateurValide, {
      dossier_formation: [{ ...DOSSIER, sous_statut: "brouillon" }],
    });
    expect(await aiguiller("DELETE", "/dossiers/d1")).toEqual({ ok: true });
    expect(s.appels.some((a) => a.op === "delete" && a.table === "dossier_formation")).toBe(true);
    const t = monter(ACTEURS.formateurValide);
    expect((await echecApi(aiguiller("DELETE", "/dossiers/d1"))).statut).toBe(409);
    expect(t.appels.some((a) => a.op === "delete")).toBe(false);
  });

  it("PUT séances : validées puis confiées à la RPC ; séance incohérente : 400 sans RPC", async () => {
    monter(ACTEURS.formateurValide, {
      dossier_formation: [{ ...DOSSIER, sous_statut: "brouillon" }],
    });
    await aiguiller("PUT", "/dossiers/d1/seances", {
      seances: [{ date: "2026-11-02", heure_debut: "09:00", heure_fin: "12:00" }],
    });
    expect(rpcAppelees.some((r) => r.nom === "s4m_definir_seances")).toBe(true);
    rpcAppelees = [];
    const e = await echecApi(
      aiguiller("PUT", "/dossiers/d1/seances", {
        seances: [{ date: "2026-11-02", heure_debut: "12:00", heure_fin: "09:00" }],
      }),
    );
    expect(e.statut).toBe(400);
    expect(rpcAppelees.some((r) => r.nom === "s4m_definir_seances")).toBe(false);
  });

  it("PATCH objectifs-atteints : réservé à l'admin et au formateur ; l'apprenant : 403", async () => {
    monter(ACTEURS.apprenant);
    expect(
      (await echecApi(aiguiller("PATCH", "/dossiers/d1/objectifs-atteints", { texte: "x" })))
        .statut,
    ).toBe(403);
    monter(ACTEURS.admin);
    expect(
      await aiguiller("PATCH", "/dossiers/d1/objectifs-atteints", { texte: "Atteints" }),
    ).toEqual({ ok: true });
    expect(rpcAppelees.find((r) => r.nom === "s4m_objectifs_atteints")!.args).toEqual({
      p_dossier_id: "d1",
      p_valeur: "Atteints",
    });
  });

  it("une règle SQL qui refuse (message de la RPC) redevient une erreur lisible", async () => {
    monter(ACTEURS.admin);
    reponsesRpc["s4m_objectifs_atteints"] = {
      data: null,
      error: { code: "P0001", message: "Dossier introuvable." },
    };
    expect(
      (await echecApi(aiguiller("PATCH", "/dossiers/d1/objectifs-atteints", { texte: "x" })))
        .statut,
    ).toBe(404);
  });
});

describe("routes 88, 93, 95, 96, 97, 98 : fonctions serveur", () => {
  it("POST /dossiers : appelle `creerDossier` avec le corps et relit la ligne sous RLS", async () => {
    monter(ACTEURS.formateurValide);
    creer.mockResolvedValue(succes({ id: "d1", dossier_reference: "ADF-2026-0001" }));
    const r = (await aiguiller("POST", "/dossiers", { formation_id: "fo1" })) as Record<
      string,
      unknown
    >;
    expect(creer).toHaveBeenCalledWith({ data: { formation_id: "fo1" } });
    expect(r["id"]).toBe("d1");
  });

  it("une erreur du serveur devient l'ErreurApi des écrans (statut, code, message, champs)", async () => {
    monter(ACTEURS.formateurValide);
    creer.mockResolvedValue(
      echec("invalide", "Choisissez une formation.", { champs: { formation_id: "Requis" } }),
    );
    const e = await echecApi(aiguiller("POST", "/dossiers", {}));
    expect([e.statut, e.code, e.message]).toEqual([400, "invalide", "Choisissez une formation."]);
  });

  it("PUT stagiaires, inviter, relancer, recréer : transmettent l'identifiant de l'URL, pas celui du corps", async () => {
    monter(ACTEURS.formateurValide);
    stagiaires.mockResolvedValue(succes({ dossier_id: "d1" }));
    await aiguiller("PUT", "/dossiers/d1/stagiaires", {
      dossier_id: "d9",
      stagiaire_ids: ["s1", "s2"],
    });
    expect(stagiaires).toHaveBeenCalledWith({
      data: { dossier_id: "d1", stagiaire_ids: ["s1", "s2"] },
    });
    inviter.mockResolvedValue(succes({ lien: "https://x" }));
    expect(
      await aiguiller("POST", "/dossiers/d1/inviter", { stagiaire_id: "s1", dossier_id: "d9" }),
    ).toEqual({ lien: "https://x" });
    expect(inviter).toHaveBeenCalledWith({ data: { dossier_id: "d1", stagiaire_id: "s1" } });
    relancer.mockResolvedValue(succes({ pieces: ["Convocation"] }));
    expect(await aiguiller("POST", "/dossiers/d1/relancer", { stagiaire_id: "s1" })).toEqual({
      pieces: ["Convocation"],
    });
    recreer.mockResolvedValue(succes({ id: "d1", dossier_reference: "ADF-2026-0002" }));
    await aiguiller("POST", "/dossiers/d1/recreer");
    expect(recreer).toHaveBeenCalledWith({ data: { dossier_id: "d1" } });
  });

  it("POST /dossiers/:id/actions/:action : l'acteur n'est pas dans l'appel (le serveur le lit dans la session) ; renvoie le dossier relu", async () => {
    monter(ACTEURS.formateurValide);
    transiter.mockResolvedValue(succes({ dossier_id: "d1", sous_statut: "dossier_depose" }));
    const r = (await aiguiller("POST", "/dossiers/d1/actions/declarer_depot", {
      role: "admin",
      motif: "Ok",
    })) as Record<string, unknown>;
    expect(transiter).toHaveBeenCalledWith({
      data: { dossier_id: "d1", action: "declarer_depot", motif: "Ok" },
    });
    expect(r["id"] ?? r["dossier_reference"]).toBeDefined();
  });

  it("refus du noyau : l'écran reçoit le message français et le statut", async () => {
    monter(ACTEURS.apprenant);
    transiter.mockResolvedValue(echec("interdit", "Cette action ne relève pas de votre rôle.", {}));
    const e = await echecApi(aiguiller("POST", "/dossiers/d1/actions/valider_dossier"));
    expect([e.statut, e.code]).toEqual([403, "interdit"]);
  });

  it("jeton absent : 401 français", async () => {
    monter(null);
    transiter.mockRejectedValue(new Error("Unauthorized: No authorization header provided"));
    const e = await echecApi(aiguiller("POST", "/dossiers/d1/actions/valider_dossier"));
    expect(e.statut).toBe(401);
  });
});

describe("routes 100, 102, 103, 104, 106 : lectures", () => {
  it("emargement et formulaires d'un dossier cloisonné : 404", async () => {
    monter(ACTEURS.formateurValide, { dossier_formation: [], dossier_formation_apprenant: [] });
    for (const chemin of ["/dossiers/d1/emargement", "/dossiers/d1/formulaires"]) {
      const e = await echecApi(aiguiller("GET", chemin));
      expect(e.statut).toBe(404);
    }
  });

  it("type de questionnaire inconnu : 400 « Formulaire inconnu. »", async () => {
    monter(ACTEURS.formateurValide);
    const e = await echecApi(aiguiller("GET", "/dossiers/d1/questionnaires/inconnu"));
    expect([e.statut, e.message]).toEqual([400, "Type de questionnaire inconnu."]);
  });
});
