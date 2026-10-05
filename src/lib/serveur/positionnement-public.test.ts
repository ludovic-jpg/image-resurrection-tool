// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aFiltre, fauxBd, type Appel } from "@/test/faux-supabase";
import { ErreurMetier } from "./erreurs.server";
import { sha256Hex } from "./hacheur.server";
import {
  enregistrerBrouillon,
  fichierPublic,
  lirePublic,
  signer,
} from "./positionnement-public.server";

const JETON = "a".repeat(64);
const MAINTENANT = new Date("2026-10-05T10:00:00Z");
const TRACE = `data:image/png;base64,${"A".repeat(700)}`;
const TEST = {
  titre: "Test d'entrée",
  questions: [
    { enonce: "Q1", propositions: ["a", "b", "c"], bonne_reponse: 1 },
    { enonce: "Q2", propositions: ["x", "y"], bonne_reponse: 0 },
    { enonce: "Q3", propositions: ["u", "v", "w", "z"], bonne_reponse: 3 },
    { enonce: "Q4", propositions: ["p", "q"], bonne_reponse: 1 },
  ],
};
const RECUEIL = {
  poste_anciennete: "Technicien, 3 ans",
  niveau_maitrise: "Intermédiaire",
  attentes: "Monter en compétence",
  besoins_principaux: "Pratique",
  handicap: "Non",
  programme_transmis: "Oui",
};
const LIGNE = {
  id: "pos1",
  of_id: "of1",
  formateur_id: "f1",
  formation_id: "fo1",
  stagiaire_id: "s1",
  statut: "envoye",
  message: "Bienvenue",
  formation_titre: "Soudure TIG",
  questionnaire: TEST,
  questions_recueil: [],
  brouillon: null,
  recueil: null,
  reponses: null,
  date_reponse: "",
  signature_lieu: "",
  signe_le: null,
  chemin_pdf: null,
  expire_le: "2026-10-20T10:00:00Z",
  archive_le: null,
  // colonnes qui ne doivent JAMAIS sortir :
  jeton_hash: "secret-hash",
  signature_png: "secret-png",
};
const SIGNATURE = {
  recueil: RECUEIL,
  reponses: [1, 0, 0, 0],
  date: "2026-10-05",
  trace_png: TRACE,
  lieu: "Rixheim",
  consentement: true,
};

function monter(ligne: Record<string, unknown> | null = LIGNE, majVide = false) {
  const faux = fauxBd((a: Appel) => {
    if (a.table === "positionnement" && a.op === "select") return { data: ligne ? [ligne] : [] };
    if (a.table === "positionnement" && a.op === "update")
      return { data: majVide ? [] : [{ id: "pos1" }] };
    if (a.table === "stagiaire")
      return {
        data: [
          {
            id: "s1",
            entreprise_id: "e1",
            stagiaire_prenom: "Anne",
            stagiaire_nom: "Martin",
            stagiaire_email: "anne@exemple.fr",
          },
        ],
      };
    if (a.table === "organisme_formation")
      return { data: [{ of_nom: "Skills4mation", couleur: "#1d6a45", of_iban: "FR76-SECRET" }] };
    if (a.table === "formateur")
      return {
        data: [
          { formateur_prenom: "Fred", formateur_nom: "Formateur", formateur_email: "fred@of.fr" },
        ],
      };
    if (a.table === "entreprise_cliente") return { data: [{ entreprise_nom: "Atelier Martin" }] };
    return undefined;
  });
  return faux;
}
const bdDe = (f: ReturnType<typeof monter>) => f.bd as never;
const ecritures = (appels: Appel[], table: string, op: Appel["op"]) =>
  appels.filter((a) => a.table === table && a.op === op);
const echecDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurMetier);
    return e as ErreurMetier;
  }
  throw new Error("Une ErreurMetier était attendue");
};

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("APP_URL", "https://app.exemple.fr");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("jetons de la page publique", () => {
  it("cherche la ligne par l'empreinte SHA-256 du jeton, jamais par le jeton lui-même", async () => {
    const f = monter();
    await lirePublic(bdDe(f), JETON, MAINTENANT);
    const requete = f.appels.find((a) => a.table === "positionnement")!;
    expect(aFiltre(requete, "eq", "jeton_hash", await sha256Hex(JETON))).toBe(true);
    expect(JSON.stringify(f.appels)).not.toContain(JETON);
  });

  it("jeton inconnu : « lien introuvable », sans détail", async () => {
    const e = await echecDe(lirePublic(bdDe(monter(null)), JETON, MAINTENANT));
    expect(e.code).toBe("introuvable");
    expect(e.message).toBe("Lien de positionnement introuvable.");
  });

  it("jeton d'un positionnement archivé : exactement la même réponse qu'un jeton inconnu", async () => {
    const inconnu = await echecDe(lirePublic(bdDe(monter(null)), JETON, MAINTENANT));
    const archive = await echecDe(
      lirePublic(bdDe(monter({ ...LIGNE, archive_le: "2026-10-01T00:00:00Z" })), JETON, MAINTENANT),
    );
    expect([archive.code, archive.message]).toEqual([inconnu.code, inconnu.message]);
  });

  it("jeton mal formé : refusé avant tout accès à la base", async () => {
    const f = monter();
    for (const j of ["", "court", "x".repeat(201)]) {
      const e = await echecDe(lirePublic(bdDe(f), j, MAINTENANT));
      expect(e.message).toBe("Lien de positionnement introuvable.");
    }
    expect(f.appels).toHaveLength(0);
  });

  it("lien expiré : message clair, rien de plus", async () => {
    const e = await echecDe(
      lirePublic(bdDe(monter({ ...LIGNE, expire_le: "2026-10-01T00:00:00Z" })), JETON, MAINTENANT),
    );
    expect(e.code).toBe("introuvable");
    expect(e.message).toBe("Ce lien a expiré. Demandez à votre formateur de vous en renvoyer un.");
  });

  it("un lien expiré ne permet ni brouillon ni signature", async () => {
    const f = monter({ ...LIGNE, expire_le: "2026-10-01T00:00:00Z" });
    await echecDe(enregistrerBrouillon(bdDe(f), JETON, {}, MAINTENANT));
    await echecDe(signer(bdDe(f), JETON, SIGNATURE, "1.2.3.4", MAINTENANT));
    expect(f.appels.filter((a) => a.op !== "select")).toEqual([]);
    expect(f.stockage.upload).not.toHaveBeenCalled();
  });

  it("déjà signé : conflit « déjà signé », même avec un lien échu", async () => {
    const f = monter({ ...LIGNE, statut: "complet", expire_le: "2026-10-01T00:00:00Z" });
    const e = await echecDe(signer(bdDe(f), JETON, SIGNATURE, "", MAINTENANT));
    expect(e.code).toBe("conflit");
    expect(e.message).toBe("Ce positionnement est déjà signé.");
    const b = await echecDe(enregistrerBrouillon(bdDe(f), JETON, {}, MAINTENANT));
    expect(b.code).toBe("conflit");
  });
});

describe("route 10 : lecture sans corrigé", () => {
  it("ne renvoie jamais la bonne réponse, ni le hash, ni la signature, ni les coordonnées bancaires", async () => {
    const r = await lirePublic(bdDe(monter()), JETON, MAINTENANT);
    const json = JSON.stringify(r);
    expect(json).not.toContain("bonne_reponse");
    expect(json).not.toContain("secret-hash");
    expect(json).not.toContain("secret-png");
    expect(json).not.toContain("FR76-SECRET");
    expect(json).not.toContain('"of_id"');
    expect(json).not.toContain("f1");
    expect(r.questionnaire?.questions).toHaveLength(4);
    expect(r.questionnaire?.questions[0]).toEqual({ enonce: "Q1", propositions: ["a", "b", "c"] });
  });

  it("a la forme de la page : organisme, formateur, apprenant, recueil, brouillon, date du jour", async () => {
    const r = await lirePublic(
      bdDe(monter({ ...LIGNE, brouillon: { reponses: [1, null], date: "2026-10-04" } })),
      JETON,
      MAINTENANT,
    );
    expect(Object.keys(r).sort()).toEqual(
      [
        "statut",
        "organisme",
        "formateur",
        "formation_titre",
        "message",
        "apprenant",
        "recueil",
        "questionnaire",
        "brouillon",
        "reponses_signees",
        "aujourdhui",
        "pdf",
      ].sort(),
    );
    expect(r.organisme).toEqual({ nom: "Skills4mation", couleur: "#1d6a45" });
    expect(r.formateur).toBe("Fred Formateur");
    expect(r.apprenant).toEqual({ prenom: "Anne", nom: "Martin", email: "anne@exemple.fr" });
    expect(r.brouillon).toEqual({ reponses: [1, null], date: "2026-10-04" });
    expect(r.reponses_signees).toBeNull();
    expect(r.aujourdhui).toBe("2026-10-05");
    expect(r.pdf).toBe(false);
    expect(r.recueil.champs.some((c) => c.id === "attentes")).toBe(true);
  });

  it("ajoute les questions du formateur au recueil", async () => {
    const r = await lirePublic(
      bdDe(monter({ ...LIGNE, questions_recueil: ["Une contrainte ?"] })),
      JETON,
      MAINTENANT,
    );
    expect(r.recueil.champs.at(-1)).toEqual({
      id: "supp_1",
      libelle: "Une contrainte ?",
      type: "texte_long",
    });
  });

  it("une fois signé : renvoie les réponses signées de l'apprenant, toujours sans corrigé", async () => {
    const r = await lirePublic(
      bdDe(
        monter({
          ...LIGNE,
          statut: "complet",
          recueil: RECUEIL,
          reponses: [1, 0, 0, 0],
          date_reponse: "2026-10-05",
          signature_lieu: "Rixheim",
          signe_le: "2026-10-05T08:00:00Z",
          chemin_pdf: "of1/positionnements/pos1/x.html",
          expire_le: "2026-09-01T00:00:00Z",
        }),
      ),
      JETON,
      MAINTENANT,
    );
    expect(r.reponses_signees).toMatchObject({ date: "2026-10-05", lieu: "Rixheim" });
    expect(r.pdf).toBe(true);
    expect(JSON.stringify(r)).not.toContain("bonne_reponse");
    expect(JSON.stringify(r)).not.toContain("score");
  });
});

describe("route 11 : brouillon", () => {
  it("enregistre et passe en « en_cours », sans jamais écraser un positionnement signé", async () => {
    const f = monter();
    const r = await enregistrerBrouillon(
      bdDe(f),
      JETON,
      { recueil: { attentes: "x" }, reponses: [1, null], date: "2026-10-05", intrus: "ignoré" },
      MAINTENANT,
    );
    expect(r).toEqual({ enregistre_le: "2026-10-05T10:00:00.000Z" });
    const [maj] = ecritures(f.appels, "positionnement", "update");
    expect(maj!.valeurs).toEqual({
      brouillon: { recueil: { attentes: "x" }, reponses: [1, null], date: "2026-10-05" },
      statut: "en_cours",
    });
    expect(aFiltre(maj!, "neq", "statut", "complet")).toBe(true);
  });

  it("refuse un brouillon illisible (400) sans rien écrire", async () => {
    const f = monter();
    const e = await echecDe(enregistrerBrouillon(bdDe(f), JETON, { reponses: [99] }, MAINTENANT));
    expect(e.code).toBe("invalide");
    expect(ecritures(f.appels, "positionnement", "update")).toEqual([]);
  });

  it("si la signature a eu lieu entre-temps, refuse (conflit)", async () => {
    const e = await echecDe(enregistrerBrouillon(bdDe(monter(LIGNE, true)), JETON, {}, MAINTENANT));
    expect(e.code).toBe("conflit");
  });
});

describe("route 12 : signature", () => {
  it("score, document, SHA-256, archive, ligne mise à jour, journal avec IP, deux e-mails", async () => {
    const f = monter();
    const r = await signer(
      bdDe(f),
      JETON,
      { ...SIGNATURE, adresse_ip: "6.6.6.6", score: 100, statut: "complet" },
      "203.0.113.7",
      MAINTENANT,
    );
    expect(r).toEqual({ statut: "complet" });

    // Archive : document HTML sous <of_id>/positionnements/<id>/, sans le corrigé
    expect(f.stockage.upload).toHaveBeenCalledTimes(1);
    const [chemin, contenu, options] = f.stockage.upload.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      { contentType: string },
    ];
    expect(chemin).toMatch(
      /^of1\/positionnements\/pos1\/Positionnement Anne Martin - Soudure TIG_[0-9a-f]{12}\.html$/,
    );
    expect(options.contentType).toBe("text/html; charset=utf-8");
    const html = new TextDecoder().decode(contenu);
    expect(html).toContain("Anne Martin");
    expect(html).toContain("Score de positionnement : 50 / 100");
    expect(html).not.toContain("bonne_reponse");

    // Ligne : score serveur (50, pas 100 envoyé par le client), empreinte du document archivé, statut complet
    const [maj] = ecritures(f.appels, "positionnement", "update");
    expect(maj!.valeurs).toMatchObject({
      statut: "complet",
      score: 50,
      date_reponse: "2026-10-05",
      signature_lieu: "Rixheim",
      signe_le: "2026-10-05T10:00:00.000Z",
      chemin_pdf: chemin,
      empreinte_pdf: await sha256Hex(html),
      brouillon: null,
      reponses: [1, 0, 0, 0],
    });
    expect(aFiltre(maj!, "neq", "statut", "complet")).toBe(true);
    expect(chemin.split("_").pop()!.slice(0, 12)).toBe((await sha256Hex(html)).slice(0, 12));

    // Journal : IP de la requête (pas celle du corps), empreinte des réponses, acteur système
    const [evt] = ecritures(f.appels, "evenement", "insert");
    expect(evt!.valeurs).toMatchObject({
      of_id: "of1",
      acteur_role: "systeme",
      acteur_id: null,
      type: "positionnement_signe",
    });
    const detail = (evt!.valeurs as { detail: Record<string, string> }).detail;
    expect(detail["adresse_ip"]).toBe("203.0.113.7");
    expect(detail["empreinte"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(evt)).not.toContain("6.6.6.6");
    expect(JSON.stringify(evt)).not.toContain("data:image/png");

    // Deux e-mails avec le document en pièce jointe : formateur puis apprenant
    const mails = ecritures(f.appels, "courrier", "insert").map(
      (a) => a.valeurs as { type: string; destinataire: string; pieces_jointes: unknown[] },
    );
    expect(mails.map((m) => [m.type, m.destinataire])).toEqual([
      ["positionnement_complet", "fred@of.fr"],
      ["positionnement_confirmation", "anne@exemple.fr"],
    ]);
    for (const m of mails)
      expect(m.pieces_jointes).toEqual([{ nom: chemin.split("/").pop(), chemin }]);
  });

  it("calcule le score sur le questionnaire figé : 100, 50 et 0", async () => {
    const cas: Array<[number[], number]> = [
      [[1, 0, 3, 1], 100],
      [[1, 0, 0, 0], 50],
      [[0, 1, 0, 0], 0],
    ];
    for (const [reponses, attendu] of cas) {
      const f = monter();
      await signer(bdDe(f), JETON, { ...SIGNATURE, reponses }, "", MAINTENANT);
      expect(ecritures(f.appels, "positionnement", "update")[0]!.valeurs).toMatchObject({
        score: attendu,
      });
    }
  });

  it("une signature incomplète est refusée avec la liste des erreurs et n'écrit RIEN", async () => {
    const f = monter();
    const e = await echecDe(
      signer(
        bdDe(f),
        JETON,
        { ...SIGNATURE, reponses: [1, 0], consentement: false, recueil: {} },
        "",
        MAINTENANT,
      ),
    );
    expect(e.code).toBe("invalide");
    expect(e.message).toBe("Le positionnement est incomplet.");
    expect(e.details?.erreurs).toEqual(
      expect.arrayContaining([
        "Test de positionnement : répondez à toutes les questions.",
        "Le consentement à la signature électronique est obligatoire.",
      ]),
    );
    expect(f.stockage.upload).not.toHaveBeenCalled();
    expect(f.appels.filter((a) => a.op !== "select")).toEqual([]);
  });

  it("les données saisies sont échappées dans le document archivé", async () => {
    const f = monter();
    await signer(
      bdDe(f),
      JETON,
      { ...SIGNATURE, recueil: { ...RECUEIL, attentes: "<script>alert(1)</script>" } },
      "",
      MAINTENANT,
    );
    const html = new TextDecoder().decode(
      (f.stockage.upload.mock.calls[0] as unknown as [string, Uint8Array])[1],
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("deux signatures simultanées : la perdante ne laisse ni écriture ni fichier", async () => {
    const f = monter(LIGNE, true);
    const e = await echecDe(signer(bdDe(f), JETON, SIGNATURE, "", MAINTENANT));
    expect(e.code).toBe("conflit");
    expect(f.stockage.remove).toHaveBeenCalledTimes(1);
    expect(ecritures(f.appels, "evenement", "insert")).toEqual([]);
    expect(ecritures(f.appels, "courrier", "insert")).toEqual([]);
  });

  it("un e-mail qui ne part pas ne défait pas la signature", async () => {
    vi.stubEnv("RESEND_API_KEY", "cle");
    vi.stubEnv("COURRIER_EXPEDITEUR", "of@exemple.fr");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const f = monter();
    await expect(signer(bdDe(f), JETON, SIGNATURE, "", MAINTENANT)).resolves.toEqual({
      statut: "complet",
    });
    vi.unstubAllGlobals();
  });

  it("sans test au parcours : signature possible, score vide", async () => {
    const f = monter({ ...LIGNE, questionnaire: null });
    await signer(bdDe(f), JETON, { ...SIGNATURE, reponses: [] }, "", MAINTENANT);
    expect(ecritures(f.appels, "positionnement", "update")[0]!.valeurs).toMatchObject({
      score: null,
    });
  });
});

describe("route 13 : document signé", () => {
  it("refuse tant que rien n'est signé", async () => {
    const e = await echecDe(fichierPublic(bdDe(monter()), JETON, MAINTENANT));
    expect(e.code).toBe("conflit");
  });

  it("sert le fichier archivé de CET organisme avec le bon type", async () => {
    const f = monter({
      ...LIGNE,
      statut: "complet",
      chemin_pdf: "of1/positionnements/pos1/Positionnement Anne.html",
      expire_le: "2026-09-01T00:00:00Z",
    });
    const r = await fichierPublic(bdDe(f), JETON, MAINTENANT);
    expect(r.nom).toBe("Positionnement Anne.html");
    expect(r.type_mime).toBe("text/html; charset=utf-8");
    expect([...r.contenu]).toEqual([1, 2, 3]);
  });

  it("n'ouvre jamais un chemin d'un autre organisme", async () => {
    const f = monter({
      ...LIGNE,
      statut: "complet",
      chemin_pdf: "of2/positionnements/pos1/x.html",
    });
    await expect(fichierPublic(bdDe(f), JETON, MAINTENANT)).rejects.toThrow();
    expect(f.stockage.download).not.toHaveBeenCalled();
  });
});
