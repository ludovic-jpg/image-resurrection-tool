// @vitest-environment node
/**
 * Page publique d'un formulaire (routes 14 à 17) : authentification par le jeton seul, sans compte.
 * Jeton invalide, inconnu, expiré, déjà utilisé ; aucune donnée sensible vers l'apprenant ; aucune création de compte.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aFiltre, fauxBd, type Appel } from "@/test/faux-supabase";
import { ErreurMetier } from "./erreurs.server";
import { sha256Hex } from "./hacheur.server";
import {
  enregistrerBrouillonPublic,
  inviterSiSansCompte,
  lireFormulairePublic,
  parJeton,
  signerFormulairePublic,
  telechargerPdfPublic,
} from "./formulaires-public.server";
import type { LigneDossier, LigneStagiaire } from "./pieces-donnees.server";

const JETON = "a".repeat(40);
const DANS_LE_FUTUR = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
const DANS_LE_PASSE = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

const QCM_AVEC_CORRIGE = {
  titre: "Positionnement",
  questions: [{ enonce: "Q1", propositions: ["a", "b"], bonne_reponse: 1 }],
};

const DOSSIER = {
  id: "d1",
  of_id: "of1",
  dossier_reference: "ADF-2026-0001",
  formateur_id: "f1",
  entreprise_id: "e1",
  sous_statut: "brouillon",
  mode_financement: "opco",
  formation_titre: "Menuiserie",
  formation_date_debut: "2026-11-01",
  formation_date_fin: "2026-11-05",
  questionnaire_positionnement: QCM_AVEC_CORRIGE,
  questionnaire_acquis: null,
};
const STAGIAIRE = {
  id: "s1",
  of_id: "of1",
  utilisateur_id: null,
  stagiaire_prenom: "Anne",
  stagiaire_nom: "Martin",
  stagiaire_email: "anne@exemple.fr",
};
const formulaire = (surcharge: Record<string, unknown> = {}) => ({
  id: "fa1",
  of_id: "of1",
  dossier_id: "d1",
  stagiaire_id: "s1",
  type: "positionnement",
  statut: "envoye",
  brouillon: null,
  expire_le: DANS_LE_FUTUR,
  signe_le: null,
  jeton_hash: "ne-doit-jamais-sortir",
  ...surcharge,
});

function monde(options: { f?: Record<string, unknown> | null; piece?: unknown } = {}) {
  const f = options.f === undefined ? formulaire() : options.f;
  const faux = fauxBd((a: Appel) => {
    if (a.op !== "select" && a.op !== "update") return undefined;
    switch (a.table) {
      case "formulaire_apprenant":
        return a.op === "update" ? { data: f ? [{ id: "fa1" }] : [] } : { data: f ? [f] : [] };
      case "stagiaire":
        return { data: [STAGIAIRE] };
      case "dossier_formation":
        return { data: [DOSSIER] };
      case "organisme_formation":
        return {
          data: [{ id: "of1", of_nom: "Mon OF", couleur: "#1d6a45", of_iban: "FR76SECRET" }],
        };
      case "formateur":
        return {
          data: [{ formateur_prenom: "Fred", formateur_nom: "F", formateur_email: "fred@of.fr" }],
        };
      case "piece_dossier":
        return { data: options.piece ? [options.piece] : [] };
      default:
        return undefined;
    }
  });
  return faux;
}
const ecritures = (appels: Appel[]) => appels.filter((a) => a.op !== "select");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const refus = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurMetier);
    return e as ErreurMetier;
  }
  throw new Error("Une ErreurMetier était attendue");
};

describe("jeton du lien", () => {
  it("un jeton mal formé n'atteint même pas la base", async () => {
    const { bd, appels } = monde();
    const e = await refus(parJeton(bd as never, "court"));
    expect(e.code).toBe("introuvable");
    expect(appels).toHaveLength(0);
  });

  it("la recherche se fait par le HACHAGE SHA-256, jamais par le jeton en clair", async () => {
    const { bd, appels } = monde();
    await parJeton(bd as never, JETON);
    const lecture = appels.find((a) => a.table === "formulaire_apprenant")!;
    expect(aFiltre(lecture, "eq", "jeton_hash", await sha256Hex(JETON))).toBe(true);
    expect(JSON.stringify(appels)).not.toContain(JETON);
  });

  it("jeton inconnu ou remplacé par un renvoi : introuvable (404)", async () => {
    const { bd } = monde({ f: null });
    const e = await refus(parJeton(bd as never, JETON));
    expect(e.code).toBe("introuvable");
    expect(e.message).toMatch(/n'est plus valable/);
  });

  it("lien expiré : introuvable, avec un message qui le dit", async () => {
    const { bd } = monde({ f: formulaire({ expire_le: DANS_LE_PASSE }) });
    const e = await refus(parJeton(bd as never, JETON));
    expect(e.code).toBe("introuvable");
    expect(e.message).toMatch(/expiré/);
  });

  it("un formulaire déjà signé reste lisible après l'échéance (pour retélécharger le document)", async () => {
    const { bd } = monde({ f: formulaire({ statut: "complet", expire_le: DANS_LE_PASSE }) });
    await expect(parJeton(bd as never, JETON)).resolves.toBeDefined();
  });
});

describe("lecture (route 14) : rien de sensible vers l'apprenant", () => {
  it("ni corrigé de QCM, ni jeton haché, ni coordonnées bancaires, ni courriel du formateur", async () => {
    const { bd } = monde();
    const vue = await lireFormulairePublic(bd as never, JETON);
    const texte = JSON.stringify(vue);
    expect(texte).not.toContain("bonne_reponse");
    expect(texte).not.toContain("ne-doit-jamais-sortir");
    expect(texte).not.toContain("jeton_hash");
    expect(texte).not.toContain("SECRET");
    expect(texte).not.toContain("fred@of.fr");
    expect(vue.questionnaire?.questions[0]).toEqual({
      enonce: "Q1",
      propositions: ["a", "b"],
    });
    expect(vue.formateur).toBe("Fred F");
    expect(vue.apprenant.prenom).toBe("Anne");
    expect(vue.statut).toBe("envoye");
  });
});

describe("brouillon (route 15)", () => {
  it("enregistre le brouillon et passe en « en cours », sans jamais toucher un formulaire signé", async () => {
    const { bd, appels } = monde();
    await enregistrerBrouillonPublic(bd as never, JETON, { reponses: [1], date: "", lieu: "Lyon" });
    const maj = appels.find((a) => a.table === "formulaire_apprenant" && a.op === "update")!;
    expect(maj.valeurs).toMatchObject({ statut: "en_cours" });
    expect(aFiltre(maj, "neq", "statut", "complet")).toBe(true);
  });

  it("déjà signé : conflit (409), rien d'écrit", async () => {
    const { bd, appels } = monde({ f: formulaire({ statut: "complet" }) });
    const e = await refus(enregistrerBrouillonPublic(bd as never, JETON, { reponses: [] }));
    expect(e.code).toBe("conflit");
    expect(ecritures(appels)).toHaveLength(0);
  });

  it("corps illisible : invalide (400)", async () => {
    const { bd, appels } = monde();
    const e = await refus(enregistrerBrouillonPublic(bd as never, JETON, { reponses: "x" }));
    expect(e.code).toBe("invalide");
    expect(ecritures(appels)).toHaveLength(0);
  });
});

describe("signature (route 16)", () => {
  it("déjà utilisé : refuse une seconde signature (409), rien d'écrit", async () => {
    const { bd, appels } = monde({ f: formulaire({ statut: "complet" }) });
    const e = await refus(signerFormulairePublic(bd as never, JETON, {}, "203.0.113.9"));
    expect(e.code).toBe("conflit");
    expect(ecritures(appels)).toHaveLength(0);
  });

  it("formulaire fermé par l'étape du dossier : conflit", async () => {
    const f = formulaire({ type: "acquis" });
    const { bd } = monde({ f });
    const e = await refus(signerFormulairePublic(bd as never, JETON, {}, ""));
    expect(e.code).toBe("conflit");
  });

  it("signature absente ou sans consentement, réponses incomplètes : invalide, AUCUNE écriture", async () => {
    const { bd, appels } = monde();
    const e = await refus(
      signerFormulairePublic(
        bd as never,
        JETON,
        { reponses: [], date: "2026-10-05", trace_png: "", lieu: "", consentement: false },
        "203.0.113.9",
      ),
    );
    expect(e.code).toBe("invalide");
    expect(e.message).toMatch(/incomplet/);
    expect(ecritures(appels)).toHaveLength(0);
  });

  it("lien expiré : introuvable avant toute lecture du corps", async () => {
    const { bd, appels } = monde({ f: formulaire({ expire_le: DANS_LE_PASSE }) });
    const e = await refus(signerFormulairePublic(bd as never, JETON, {}, ""));
    expect(e.code).toBe("introuvable");
    expect(ecritures(appels)).toHaveLength(0);
  });
});

describe("document signé (route 17)", () => {
  it("avant la signature : conflit ; après : URL signée de 60 s", async () => {
    const sans = monde({ piece: { id: "p1", chemin_retour: null } });
    const e = await refus(telechargerPdfPublic(sans.bd as never, JETON));
    expect(e.code).toBe("conflit");

    const avec = monde({
      f: formulaire({ statut: "complet" }),
      piece: { id: "p1", chemin_retour: "of1/dossiers/ADF/Retour/doc_signe.html" },
    });
    const r = await telechargerPdfPublic(avec.bd as never, JETON);
    expect(r).toMatchObject({ url: "https://stockage.test/signe", nom: "doc_signe.html" });
    expect(avec.stockage.createSignedUrl).toHaveBeenCalledWith(
      "of1/dossiers/ADF/Retour/doc_signe.html",
      60,
      expect.anything(),
    );
  });
});

describe("apprenant sans compte : invitation, jamais de compte créé", () => {
  const d = DOSSIER as unknown as LigneDossier;
  const st = STAGIAIRE as unknown as LigneStagiaire;

  function mondeInvitation(options: { invitations?: unknown[]; comptes?: unknown[] } = {}) {
    return fauxBd((a: Appel) => {
      if (a.table === "invitation" && a.op === "select") return { data: options.invitations ?? [] };
      if (a.table === "utilisateur" && a.op === "select") return { data: options.comptes ?? [] };
      return undefined;
    });
  }

  it("insère une ligne `invitation` (rôle apprenant, fiche, e-mail de la fiche) et envoie le lien", async () => {
    const { bd, appels } = mondeInvitation();
    const r = await inviterSiSansCompte(
      bd as never,
      d,
      st,
      "Mon OF",
      "Fred F",
      "https://app.exemple.fr",
    );
    expect(r).toBe("invitation_envoyee");
    const ins = appels.find((a) => a.table === "invitation" && a.op === "insert")!;
    expect(ins.valeurs).toMatchObject({
      of_id: "of1",
      email: "anne@exemple.fr",
      role: "apprenant",
      stagiaire_id: "s1",
    });
    // Seul le HACHAGE est stocké : le jeton en clair ne figure que dans le lien envoyé.
    const brut = (ins.valeurs as { jeton_hash: string }).jeton_hash;
    expect(brut).toMatch(/^[0-9a-f]{64}$/);
    expect(appels.some((a) => a.table === "courrier" && a.op === "insert")).toBe(true);
    // Jamais de création de compte ni de profil.
    expect(appels.filter((a) => a.table === "utilisateur" && a.op !== "select")).toHaveLength(0);
    expect(appels.filter((a) => a.table === "stagiaire" && a.op !== "select")).toHaveLength(0);
  });

  it("ne fait rien si l'apprenant a déjà un compte, une invitation valable, ou pas d'adresse", async () => {
    const a1 = mondeInvitation();
    expect(
      await inviterSiSansCompte(
        a1.bd as never,
        d,
        { ...st, utilisateur_id: "u1" },
        "O",
        "F",
        "https://x",
      ),
    ).toBe("deja_un_compte");
    const a2 = mondeInvitation({ comptes: [{ id: "u9" }] });
    expect(await inviterSiSansCompte(a2.bd as never, d, st, "O", "F", "https://x")).toBe(
      "deja_un_compte",
    );
    const a3 = mondeInvitation({ invitations: [{ jeton_hash: "h" }] });
    expect(await inviterSiSansCompte(a3.bd as never, d, st, "O", "F", "https://x")).toBe(
      "deja_invite",
    );
    const a4 = mondeInvitation();
    expect(
      await inviterSiSansCompte(
        a4.bd as never,
        d,
        { ...st, stagiaire_email: " " },
        "O",
        "F",
        "https://x",
      ),
    ).toBe("sans_adresse");
    for (const a of [a1, a2, a3, a4])
      expect(a.appels.filter((x) => x.op !== "select")).toHaveLength(0);
  });

  it("ne lève jamais : la signature est déjà enregistrée", async () => {
    const { bd } = fauxBd((a: Appel) =>
      a.table === "invitation" && a.op === "insert" ? { error: { message: "panne" } } : undefined,
    );
    expect(await inviterSiSansCompte(bd as never, d, st, "O", "F", "https://x")).toBe("echec");
  });
});
