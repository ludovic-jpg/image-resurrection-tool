// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxBd, aFiltre, type Appel } from "@/test/faux-supabase";
import {
  ERREUR_SANS_EXPEDITEUR,
  INFO_CLE_ABSENTE,
  INFO_ENVOI_COUPE,
  envoiReelConfigure,
  envoyerCourrier,
  expliquerErreurResend,
} from "./courrier.server";

const MESSAGE = {
  of_id: "of1",
  type: "candidature_decision",
  destinataire: "paul@exemple.fr",
  sujet: "Bonjour",
  corps_html: "<p>Salut</p>",
};

function bdAvecReglages(reglages: Record<string, string>) {
  return fauxBd((a: Appel) =>
    a.table === "reglage" && a.op === "select"
      ? { data: Object.entries(reglages).map(([cle, valeur]) => ({ cle, valeur })) }
      : undefined,
  );
}
const ligneCourrier = (appels: Appel[]) =>
  appels.find((a) => a.table === "courrier" && a.op === "insert")!;

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("COURRIER_EXPEDITEUR", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("courrier sans clé d'envoi", () => {
  it("n'envoie rien mais enregistre le courrier (statut « journalise »)", async () => {
    const appeler = vi.fn();
    const { bd, appels } = fauxBd();
    const r = await envoyerCourrier(bd as never, MESSAGE, { fetch: appeler as never });
    expect(envoiReelConfigure()).toBe(false);
    expect(appeler).not.toHaveBeenCalled();
    expect(r).toMatchObject({ statut: "journalise", erreur: "", info: INFO_CLE_ABSENTE });
    expect(ligneCourrier(appels).valeurs).toMatchObject({
      id: r.id,
      of_id: "of1",
      type: "candidature_decision",
      destinataire: "paul@exemple.fr",
      statut: "journalise",
      erreur: "",
      pieces_jointes: [],
    });
  });
});

describe("courrier avec clé Resend", () => {
  beforeEach(() => vi.stubEnv("RESEND_API_KEY", "re_test_123"));

  it("envoie par l'API Resend avec l'expédition de l'organisme et enregistre « envoye »", async () => {
    const appeler = vi.fn(async () => new Response("{}", { status: 200 }));
    const { bd, appels } = bdAvecReglages({ courrier_expediteur: "Mon OF <no-reply@of.fr>" });
    const r = await envoyerCourrier(bd as never, MESSAGE, { fetch: appeler as never });
    expect(r.statut).toBe("envoye");
    const [url, init] = appeler.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer re_test_123");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Mon OF <no-reply@of.fr>",
      to: ["paul@exemple.fr"],
      subject: "Bonjour",
      html: "<p>Salut</p>",
    });
    expect(ligneCourrier(appels).valeurs).toMatchObject({ statut: "envoye", erreur: "" });
    const lecture = appels.find((a) => a.table === "reglage")!;
    expect(aFiltre(lecture, "eq", "of_id", "of1")).toBe(true);
  });

  it("retombe sur COURRIER_EXPEDITEUR quand l'organisme n'a pas réglé d'expéditeur", async () => {
    vi.stubEnv("COURRIER_EXPEDITEUR", "defaut@plateforme.fr");
    const appeler = vi.fn(async () => new Response("{}", { status: 200 }));
    await envoyerCourrier(bdAvecReglages({}).bd as never, MESSAGE, { fetch: appeler as never });
    expect(
      JSON.parse((appeler.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
        .from,
    ).toBe("defaut@plateforme.fr");
  });

  it("sans aucune adresse d'expédition : échec avec un message qui dit quoi renseigner", async () => {
    const appeler = vi.fn();
    const { bd, appels } = bdAvecReglages({});
    const r = await envoyerCourrier(bd as never, MESSAGE, { fetch: appeler as never });
    expect(appeler).not.toHaveBeenCalled();
    expect(r).toMatchObject({ statut: "echec", erreur: ERREUR_SANS_EXPEDITEUR });
    expect(ligneCourrier(appels).valeurs).toMatchObject({ statut: "echec" });
  });

  it("un organisme qui a coupé l'envoi : rien ne part, courrier consigné", async () => {
    const appeler = vi.fn();
    const { bd } = bdAvecReglages({ courrier_actif: "non", courrier_expediteur: "x@of.fr" });
    const r = await envoyerCourrier(bd as never, MESSAGE, { fetch: appeler as never });
    expect(appeler).not.toHaveBeenCalled();
    expect(r).toMatchObject({ statut: "journalise", info: INFO_ENVOI_COUPE });
  });

  it("un refus de l'API devient un échec expliqué en français, sans faire échouer l'appelant", async () => {
    const appeler = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "The of.fr domain is not verified" }), {
          status: 403,
        }),
    );
    const { bd, appels } = bdAvecReglages({ courrier_expediteur: "x@of.fr" });
    const r = await envoyerCourrier(bd as never, MESSAGE, { fetch: appeler as never });
    expect(r.statut).toBe("echec");
    expect(r.erreur).toMatch(/domaine de l'adresse d'expédition n'est pas vérifié/);
    expect(ligneCourrier(appels).valeurs).toMatchObject({ statut: "echec" });
  });

  it("une panne réseau devient un échec, pas une exception", async () => {
    const appeler = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await envoyerCourrier(
      bdAvecReglages({ courrier_expediteur: "x@of.fr" }).bd as never,
      MESSAGE,
      {
        fetch: appeler as never,
      },
    );
    expect(r).toMatchObject({ statut: "echec" });
    expect(r.erreur).toMatch(/Envoi impossible/);
  });

  it("joint les pièces relues dans l'archive de l'organisme, en base64", async () => {
    const appeler = vi.fn(async () => new Response("{}", { status: 200 }));
    const archive = {
      lire: vi.fn(async () => new Uint8Array([104, 105])),
    };
    const { bd } = bdAvecReglages({ courrier_expediteur: "x@of.fr" });
    await envoyerCourrier(
      bd as never,
      { ...MESSAGE, pieces_jointes: [{ nom: "convention.pdf", chemin: "of1/dossiers/ADF/a.pdf" }] },
      { fetch: appeler as never, archive: archive as never },
    );
    expect(archive.lire).toHaveBeenCalledWith("of1/dossiers/ADF/a.pdf");
    const corps = JSON.parse(
      (appeler.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(corps.attachments).toEqual([{ filename: "convention.pdf", content: "aGk=" }]);
  });

  it("une pièce jointe d'un autre organisme fait échouer l'envoi, jamais fuiter le fichier", async () => {
    const appeler = vi.fn();
    const { bd, stockage } = bdAvecReglages({ courrier_expediteur: "x@of.fr" });
    const r = await envoyerCourrier(
      bd as never,
      { ...MESSAGE, pieces_jointes: [{ nom: "secret.pdf", chemin: "of2/dossiers/ADF/a.pdf" }] },
      { fetch: appeler as never },
    );
    expect(r.statut).toBe("echec");
    expect(appeler).not.toHaveBeenCalled();
    expect(stockage.download).not.toHaveBeenCalled();
  });

  it("ne lève pas si l'enregistrement du courrier échoue (l'action métier est déjà faite)", async () => {
    const { bd } = fauxBd((a) =>
      a.table === "courrier" ? { error: { message: "disque plein" } } : undefined,
    );
    await expect(envoyerCourrier(bd as never, MESSAGE)).resolves.toMatchObject({
      id: expect.any(String),
    });
  });
});

describe("explication des erreurs Resend", () => {
  it("traduit les cas courants et garde le message brut", () => {
    expect(expliquerErreurResend(401, '{"message":"API key is invalid"}')).toMatch(
      /RESEND_API_KEY/,
    );
    expect(expliquerErreurResend(422, "{}")).toMatch(/invalide/);
    expect(expliquerErreurResend(429, "")).toMatch(/patienter/);
    expect(expliquerErreurResend(500, "panne")).toContain("Resend a répondu 500");
    expect(expliquerErreurResend(500, "panne")).toContain("panne");
  });
});
