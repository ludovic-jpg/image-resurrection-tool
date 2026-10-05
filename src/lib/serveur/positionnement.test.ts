// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, aFiltre, fauxBd, type Appel } from "@/test/faux-supabase";
import type { ActeurFormateurValide } from "./acteur.server";
import { ErreurMetier } from "./erreurs.server";
import { sha256Hex } from "./hacheur.server";
import { inviter, MESSAGE_SANS_TEST, relancer, urlPdf } from "./positionnement.server";
import { reprendrePositionnements } from "./reprise-positionnement.server";

const FORMATEUR = ACTEURS.formateurValide as unknown as ActeurFormateurValide;
const TEST = {
  titre: "Test d'entrée",
  questions: [
    { enonce: "Q1", propositions: ["a", "b"], bonne_reponse: 1 },
    { enonce: "Q2", propositions: ["x", "y"], bonne_reponse: 0 },
  ],
};
const STAGIAIRE = {
  id: "s1",
  stagiaire_prenom: "Anne",
  stagiaire_nom: "Martin",
  stagiaire_email: "anne@exemple.fr",
};
const FORMATION = { id: "fo1", formation_titre: "Soudure TIG" };

interface Options {
  stagiaire?: Record<string, unknown> | null;
  formation?: Record<string, unknown> | null;
  modeles?: Array<Record<string, unknown>>;
  position?: Record<string, unknown> | null;
  majVide?: boolean;
  erreurJournal?: boolean;
}
function monter(o: Options = {}) {
  const faux = fauxBd((a: Appel) => {
    if (
      a.table === "stagiaire" &&
      a.colonnes?.includes("stagiaire_email") &&
      a.colonnes.includes("id,")
    )
      return { data: o.stagiaire === null ? [] : [o.stagiaire ?? STAGIAIRE] };
    if (a.table === "stagiaire") return { data: [o.stagiaire ?? STAGIAIRE] };
    if (a.table === "formation")
      return { data: o.formation === null ? [] : [o.formation ?? FORMATION] };
    if (a.table === "modele_outil")
      return {
        data: (
          o.modeles ?? [{ formation_id: "fo1", type: "positionnement", contenu: TEST }]
        ).filter((m) => aFiltre(a, "eq", "type", m["type"])),
      };
    if (a.table === "positionnement" && a.op === "select")
      return { data: o.position === null ? [] : [o.position ?? {}] };
    if (a.table === "positionnement" && a.op === "update")
      return { data: o.majVide ? [] : [{ id: "pos1" }] };
    if (a.table === "evenement" && o.erreurJournal) return { error: { message: "refus" } };
    if (a.table === "organisme_formation") return { data: [{ of_nom: "Skills4mation" }] };
    if (a.table === "formateur")
      return { data: [{ formateur_prenom: "Fred", formateur_nom: "Formateur" }] };
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
const ENTREE = { stagiaire_id: "s1", formation_id: "fo1", message: " Bienvenue " };

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("APP_URL", "https://app.exemple.fr");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("route 80 : inviter", () => {
  it("crée un jeton de 256 bits dont SEULE l'empreinte est stockée, fige le test et envoie l'e-mail", async () => {
    const f = monter();
    const r = await inviter(bdDe(f), FORMATEUR, ENTREE);
    expect(r.test_cree).toBe(false);
    const jeton = r.lien.replace("https://app.exemple.fr/positionnement/", "");
    expect(jeton).toMatch(/^[0-9a-f]{64}$/);

    const [ligne] = ecritures(f.appels, "positionnement", "insert");
    const v = ligne!.valeurs as Record<string, unknown>;
    expect(v["jeton_hash"]).toBe(await sha256Hex(jeton));
    expect(JSON.stringify(ligne)).not.toContain(jeton);
    expect(v).toMatchObject({
      id: r.id,
      of_id: "of1",
      formateur_id: "f1",
      formation_id: "fo1",
      stagiaire_id: "s1",
      message: "Bienvenue",
      formation_titre: "Soudure TIG",
      questionnaire: TEST,
      statut: "envoye",
    });
    const duree =
      new Date(v["expire_le"] as string).getTime() - new Date(v["envoye_le"] as string).getTime();
    expect(duree).toBe(30 * 24 * 3600 * 1000);

    const [mail] = ecritures(f.appels, "courrier", "insert");
    expect(mail!.valeurs).toMatchObject({
      type: "invitation_positionnement",
      destinataire: "anne@exemple.fr",
      formateur_id: "f1",
    });
    expect((mail!.valeurs as { corps_html: string }).corps_html).toContain(r.lien);
    const [evt] = ecritures(f.appels, "evenement", "insert");
    expect(evt!.valeurs).toMatchObject({
      type: "positionnement_invite",
      acteur_id: "u-form",
      acteur_role: "formateur",
    });
  });

  it("lit la fiche et le parcours filtrés par organisme ET par formateur : sinon « introuvable »", async () => {
    const f = monter();
    await inviter(bdDe(f), FORMATEUR, ENTREE);
    for (const table of ["stagiaire", "formation"]) {
      const lecture = f.appels.find((a) => a.table === table)!;
      expect(aFiltre(lecture, "eq", "of_id", "of1")).toBe(true);
      expect(aFiltre(lecture, "eq", "formateur_id", "f1")).toBe(true);
    }
    const e1 = await echecDe(inviter(bdDe(monter({ stagiaire: null })), FORMATEUR, ENTREE));
    expect([e1.code, e1.message]).toEqual(["introuvable", "Fiche apprenant introuvable."]);
    const e2 = await echecDe(inviter(bdDe(monter({ formation: null })), FORMATEUR, ENTREE));
    expect([e2.code, e2.message]).toEqual(["introuvable", "Formation introuvable."]);
  });

  it("refuse sans test de positionnement, avec la marche à suivre, et n'écrit rien", async () => {
    const f = monter({ modeles: [] });
    const e = await echecDe(inviter(bdDe(f), FORMATEUR, ENTREE));
    expect(e).toMatchObject({ code: "invalide", message: MESSAGE_SANS_TEST });
    expect(f.appels.filter((a) => a.op !== "select")).toEqual([]);
  });

  it("refuse un test incomplet", async () => {
    const f = monter({
      modeles: [
        { formation_id: "fo1", type: "positionnement", contenu: { titre: "T", questions: [] } },
      ],
    });
    expect((await echecDe(inviter(bdDe(f), FORMATEUR, ENTREE))).code).toBe("invalide");
  });

  it("prend le test du parcours avant le test sans parcours, et ajoute les questions du recueil", async () => {
    const generique = { ...TEST, titre: "Générique" };
    const f = monter({
      modeles: [
        { formation_id: null, type: "positionnement", contenu: generique },
        { formation_id: "fo1", type: "positionnement", contenu: TEST },
        {
          formation_id: "fo1",
          type: "recueil",
          contenu: { questions_supplementaires: ["Contrainte ?"] },
        },
      ],
    });
    await inviter(bdDe(f), FORMATEUR, ENTREE);
    expect(ecritures(f.appels, "positionnement", "insert")[0]!.valeurs).toMatchObject({
      questionnaire: TEST,
      questions_recueil: ["Contrainte ?"],
    });
    const g = monter({
      modeles: [{ formation_id: null, type: "positionnement", contenu: generique }],
    });
    await inviter(bdDe(g), FORMATEUR, ENTREE);
    expect(ecritures(g.appels, "positionnement", "insert")[0]!.valeurs).toMatchObject({
      questionnaire: generique,
    });
  });

  it("refuse une fiche sans e-mail, un message trop long, des champs vides", async () => {
    const sansMail = monter({ stagiaire: { ...STAGIAIRE, stagiaire_email: "" } });
    expect((await echecDe(inviter(bdDe(sansMail), FORMATEUR, ENTREE))).message).toMatch(
      /adresse e-mail/,
    );
    const f = monter();
    expect(
      (await echecDe(inviter(bdDe(f), FORMATEUR, { ...ENTREE, message: "x".repeat(1001) }))).code,
    ).toBe("invalide");
    expect(
      (await echecDe(inviter(bdDe(f), FORMATEUR, { ...ENTREE, stagiaire_id: " " }))).message,
    ).toBe("Choisissez l'apprenant.");
    expect(
      (await echecDe(inviter(bdDe(f), FORMATEUR, { ...ENTREE, formation_id: "" }))).message,
    ).toBe("Choisissez le parcours de formation.");
    expect(f.appels).toHaveLength(0);
  });

  it("si le journal ne s'écrit pas, retire la ligne créée et n'envoie aucun e-mail", async () => {
    const f = monter({ erreurJournal: true });
    await expect(inviter(bdDe(f), FORMATEUR, ENTREE)).rejects.toThrow(/Journal/);
    expect(ecritures(f.appels, "positionnement", "delete")).toHaveLength(1);
    expect(ecritures(f.appels, "courrier", "insert")).toEqual([]);
  });
});

describe("route 81 : relancer", () => {
  const POS = {
    id: "pos1",
    of_id: "of1",
    formateur_id: "f1",
    formation_id: "fo1",
    stagiaire_id: "s1",
    formation_titre: "Soudure TIG",
    message: "",
    statut: "envoye",
    archive_le: null,
  };

  it("pose un NOUVEAU jeton (l'ancien cesse de marcher) et renvoie le lien", async () => {
    const f = monter({ position: POS });
    const r = await relancer(bdDe(f), FORMATEUR, "pos1");
    const jeton = r.lien.split("/").pop()!;
    const [maj] = ecritures(f.appels, "positionnement", "update");
    expect((maj!.valeurs as Record<string, string>)["jeton_hash"]).toBe(await sha256Hex(jeton));
    expect(Object.keys(maj!.valeurs as object).sort()).toEqual([
      "envoye_le",
      "expire_le",
      "jeton_hash",
    ]);
    expect(aFiltre(maj!, "neq", "statut", "complet")).toBe(true);
    expect(ecritures(f.appels, "courrier", "insert")[0]!.valeurs).toMatchObject({
      type: "invitation_positionnement",
      destinataire: "anne@exemple.fr",
    });
    // Le jeton en clair n'apparaît que dans le corps de l'e-mail journalisé (voir le compte rendu), nulle part ailleurs.
    const horsCourrier = f.appels.filter((a) => a.table !== "courrier");
    expect(JSON.stringify(horsCourrier)).not.toContain(jeton);
  });

  it("lit le positionnement filtré par organisme et formateur : celui d'un autre est « introuvable »", async () => {
    const f = monter({ position: null });
    const e = await echecDe(relancer(bdDe(f), FORMATEUR, "pos1"));
    expect(e.code).toBe("introuvable");
    const lecture = f.appels[0]!;
    expect(aFiltre(lecture, "eq", "of_id", "of1")).toBe(true);
    expect(aFiltre(lecture, "eq", "formateur_id", "f1")).toBe(true);
  });

  it("refuse un positionnement complet ou archivé, et une relance qui croise une signature", async () => {
    expect(
      (
        await echecDe(
          relancer(bdDe(monter({ position: { ...POS, statut: "complet" } })), FORMATEUR, "pos1"),
        )
      ).message,
    ).toBe("Ce positionnement est déjà complet.");
    expect(
      (
        await echecDe(
          relancer(
            bdDe(monter({ position: { ...POS, archive_le: "2026-10-01" } })),
            FORMATEUR,
            "pos1",
          ),
        )
      ).code,
    ).toBe("conflit");
    const f = monter({ position: POS, majVide: true });
    expect((await echecDe(relancer(bdDe(f), FORMATEUR, "pos1"))).code).toBe("conflit");
    expect(ecritures(f.appels, "courrier", "insert")).toEqual([]);
  });
});

describe("route 83 : lien du document signé", () => {
  const CHEMIN = "of1/positionnements/pos1/Positionnement Anne - TIG_ab12.html";

  it("signe un lien de 60 s pour le formateur propriétaire, avec le nom du fichier", async () => {
    const f = monter({ position: { id: "pos1", chemin_pdf: CHEMIN } });
    const r = await urlPdf(bdDe(f), FORMATEUR, "pos1");
    expect(r).toEqual({
      url: "https://stockage.test/signe",
      nom: "Positionnement Anne - TIG_ab12.html",
    });
    expect(f.stockage.createSignedUrl).toHaveBeenCalledWith(CHEMIN, 60, {
      download: "Positionnement Anne - TIG_ab12.html",
    });
    const lecture = f.appels[0]!;
    expect(aFiltre(lecture, "eq", "of_id", "of1")).toBe(true);
    expect(aFiltre(lecture, "eq", "formateur_id", "f1")).toBe(true);
  });

  it("l'admin voit tout son organisme (pas de filtre formateur) ; jamais un autre organisme", async () => {
    const f = monter({ position: { id: "pos1", chemin_pdf: CHEMIN } });
    await urlPdf(bdDe(f), ACTEURS.admin as never, "pos1");
    expect(aFiltre(f.appels[0]!, "eq", "of_id", "of1")).toBe(true);
    expect(f.appels[0]!.filtres.some((x) => x[1] === "formateur_id")).toBe(false);
  });

  it("introuvable pour un objet cloisonné ; conflit si rien n'est signé ; chemin d'un autre OF refusé", async () => {
    expect((await echecDe(urlPdf(bdDe(monter({ position: null })), FORMATEUR, "pos1"))).code).toBe(
      "introuvable",
    );
    expect(
      (
        await echecDe(
          urlPdf(bdDe(monter({ position: { id: "pos1", chemin_pdf: null } })), FORMATEUR, "pos1"),
        )
      ).code,
    ).toBe("conflit");
    const f = monter({ position: { id: "pos1", chemin_pdf: "of2/positionnements/pos1/x.html" } });
    await expect(urlPdf(bdDe(f), FORMATEUR, "pos1")).rejects.toThrow();
    expect(f.stockage.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("reprise dans un dossier", () => {
  const SIGNE = {
    id: "pos1",
    stagiaire_id: "s1",
    questionnaire: TEST,
    recueil: { attentes: "A", supp_1: "B" },
    reponses: [1, 0],
    score: 100,
    signe_le: "2026-10-01T09:00:00Z",
  };
  const DOSSIER = {
    id: "d1",
    of_id: "of1",
    formation_id: "fo1",
    questionnaire_positionnement: TEST,
  };

  function reprise(
    options: { acteur?: unknown; dossier?: typeof DOSSIER; appliquer?: () => Promise<void> } = {},
  ) {
    const faux = fauxBd((a) => (a.table === "positionnement" ? { data: [SIGNE] } : undefined));
    const appliquer = vi.fn(options.appliquer ?? (async () => undefined));
    return {
      faux,
      appliquer,
      lancer: () =>
        reprendrePositionnements(faux.bd as never, {
          acteur: (options.acteur ?? ACTEURS.formateurValide) as never,
          dossier: options.dossier ?? DOSSIER,
          stagiaire_ids: ["s1"],
          appliquer,
        }),
    };
  }

  it("reprend le recueil et le test quand le test du dossier est identique, et le journalise", async () => {
    const r = reprise();
    expect(await r.lancer()).toBe(1);
    expect(r.appliquer).toHaveBeenCalledWith(
      expect.objectContaining({
        stagiaire_id: "s1",
        recueil: { attentes: "A" },
        reprendre_test: true,
        reponses: [1, 0],
      }),
    );
    const [evt] = ecritures(r.faux.appels, "evenement", "insert");
    expect(evt!.valeurs).toMatchObject({ type: "positionnement_repris", dossier_id: "d1" });
    const lecture = r.faux.appels[0]!;
    expect(aFiltre(lecture, "eq", "statut", "complet")).toBe(true);
    expect(aFiltre(lecture, "eq", "formation_id", "fo1")).toBe(true);
    expect(aFiltre(lecture, "eq", "of_id", "of1")).toBe(true);
  });

  it("ne reprend pas le test si celui du dossier est différent", async () => {
    const autre = {
      ...TEST,
      questions: [{ ...TEST.questions[0]!, bonne_reponse: 0 }, TEST.questions[1]!],
    };
    const r = reprise({ dossier: { ...DOSSIER, questionnaire_positionnement: autre } });
    await r.lancer();
    expect(r.appliquer).toHaveBeenCalledWith(
      expect.objectContaining({ reprendre_test: false, reponses: null }),
    );
  });

  it("ne fait rien pour un autre rôle que le formateur, ni sans parcours", async () => {
    for (const r of [
      reprise({ acteur: ACTEURS.admin }),
      reprise({ dossier: { ...DOSSIER, formation_id: null as never } }),
    ]) {
      expect(await r.lancer()).toBe(0);
      expect(r.appliquer).not.toHaveBeenCalled();
      expect(r.faux.appels).toHaveLength(0);
    }
  });

  it("un écart (appliquer lève) laisse la saisie au formateur et ne casse pas la création du dossier", async () => {
    const r = reprise({ appliquer: async () => Promise.reject(new Error("pièce déjà validée")) });
    expect(await r.lancer()).toBe(0);
    expect(ecritures(r.faux.appels, "evenement", "insert")).toEqual([]);
  });
});
