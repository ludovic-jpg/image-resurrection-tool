// @vitest-environment node
/**
 * Retour de pièces, signature, intégrité et émargement : refus par rôle, cloisonnement (404), empreinte scellée
 * au retour, contrôle d'intégrité (intacte / altérée), horodatage posé par le serveur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTEURS, fauxBd, type Appel } from "@/test/faux-supabase";
import { NOMENCLATURE } from "@/domaine/referentiel/pieces";
import type { Acteur } from "./acteur.server";
import { ErreurMetier } from "./erreurs.server";
import { sha256Hex } from "./hacheur.server";
import {
  deposerRetour,
  emarger,
  regenererPiece,
  signerPiece,
  verifierIntegritePiece,
} from "./pieces-retours.server";

const OCTETS = new Uint8Array([1, 2, 3]); // contenu renvoyé par le faux stockage
const CHEMIN = "of1/dossiers/ADF-2026-0001/Retour/doc_signe.html";

const apprenant = ACTEURS.apprenant as unknown as Acteur;
const formateur = ACTEURS.formateurValide as unknown as Acteur;
const admin = ACTEURS.admin as unknown as Acteur;
const autreFormateur = { ...ACTEURS.formateurValide, formateur_id: "f9" } as unknown as Acteur;

const signable = NOMENCLATURE.find(
  (d) =>
    d.mode === "generee" &&
    d.suiviStatut &&
    d.valideePar.includes("apprenant") &&
    d.espace === "apprenant",
)!.code;
const deposable = NOMENCLATURE.find(
  (d) => d.mode === "deposee" && d.suiviStatut && d.valideePar.includes("formateur"),
)!.code;

const dossier = (sous = "brouillon") => ({
  id: "d1",
  of_id: "of1",
  dossier_reference: "ADF-2026-0001",
  formateur_id: "f1",
  entreprise_id: "e1",
  sous_statut: sous,
  mode_financement: "opco",
  formation_titre: "Menuiserie",
});
const piece = (surcharge: Record<string, unknown> = {}) => ({
  id: "p1",
  dossier_id: "d1",
  code: signable,
  stagiaire_id: "s1",
  statut: "a_signer",
  chemin_depart: null,
  chemin_retour: null,
  empreinte_retour: null,
  ...surcharge,
});

function monde(
  options: {
    sous?: string;
    piece?: Record<string, unknown>;
    signatures?: unknown[];
    seance?: unknown;
  } = {},
) {
  return fauxBd((a: Appel) => {
    if (a.op === "update" || a.op === "upsert") return { data: [{ id: "x" }] };
    if (a.op !== "select") return undefined;
    switch (a.table) {
      case "piece_dossier":
        return { data: [piece(options.piece)] };
      case "dossier_formation":
        return { data: [dossier(options.sous)] };
      case "stagiaire_dossier":
        return { data: [{ stagiaire_id: "s1", poste_occupe: "", rang: 1, id: "l1" }] };
      case "stagiaire":
        return {
          data: [
            {
              id: "s1",
              of_id: "of1",
              stagiaire_prenom: "Anne",
              stagiaire_nom: "Martin",
              stagiaire_email: "a@x.fr",
            },
          ],
        };
      case "signature":
        return { data: options.signatures ?? [] };
      case "seance":
        return { data: options.seance ? [options.seance] : [] };
      default:
        return undefined;
    }
  });
}
const ecritures = (appels: Appel[], table?: string) =>
  appels.filter((a) => a.op !== "select" && (!table || a.table === table));
const refus = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurMetier);
    return e as ErreurMetier;
  }
  throw new Error("Une ErreurMetier était attendue");
};
const TRACE = "data:image/png;base64," + "A".repeat(800);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("intégrité (route 110)", () => {
  it("fichier intact : l'empreinte recalculée égale l'empreinte scellée", async () => {
    const { bd, stockage } = monde({
      piece: { chemin_retour: CHEMIN, empreinte_retour: await sha256Hex(OCTETS) },
    });
    stockage.list.mockResolvedValue({ data: [{ name: "doc_signe.html" }], error: null } as never);
    const r = await verifierIntegritePiece(bd as never, formateur, "p1");
    expect(r).toMatchObject({ retournee: true, integre: true });
  });

  it("fichier modifié après coup : non intègre", async () => {
    const { bd, stockage } = monde({
      piece: { chemin_retour: CHEMIN, empreinte_retour: await sha256Hex("autre contenu") },
    });
    stockage.list.mockResolvedValue({ data: [{ name: "doc_signe.html" }], error: null } as never);
    expect((await verifierIntegritePiece(bd as never, formateur, "p1")).integre).toBe(false);
  });

  it("fichier disparu : non intègre", async () => {
    const { bd } = monde({
      piece: { chemin_retour: CHEMIN, empreinte_retour: await sha256Hex(OCTETS) },
    });
    expect((await verifierIntegritePiece(bd as never, formateur, "p1")).integre).toBe(false);
  });

  it("pièce non retournée : rien à vérifier", async () => {
    const { bd } = monde();
    expect(await verifierIntegritePiece(bd as never, formateur, "p1")).toEqual({
      retournee: false,
      integre: null,
      preuve: null,
    });
  });

  it("renvoie la preuve SANS le tracé de signature", async () => {
    const { bd, stockage } = monde({
      piece: { chemin_retour: CHEMIN, empreinte_retour: await sha256Hex(OCTETS) },
      signatures: [
        {
          zone: "apprenant",
          signataire_nom: "Anne Martin",
          trace_png: TRACE,
          horodatage: "2026-10-05T10:00:00.000Z",
          empreinte_document: "e".repeat(64),
          adresse_ip: "203.0.113.9",
        },
      ],
    });
    stockage.list.mockResolvedValue({ data: [{ name: "doc_signe.html" }], error: null } as never);
    const r = await verifierIntegritePiece(bd as never, formateur, "p1");
    expect(r.preuve).toMatchObject({ signataire_nom: "Anne Martin", adresse_ip: "203.0.113.9" });
    expect(JSON.stringify(r)).not.toContain("trace_png");
  });

  it("dossier d'un autre formateur : introuvable (404), jamais interdit", async () => {
    const { bd } = monde();
    expect((await refus(verifierIntegritePiece(bd as never, autreFormateur, "p1"))).code).toBe(
      "introuvable",
    );
  });
});

describe("signature en ligne (route 111) : refus par rôle", () => {
  it("l'administrateur ne signe pas (403) ; rien d'écrit", async () => {
    const { bd, appels } = monde();
    const e = await refus(
      signerPiece(bd as never, admin, "p1", { trace_png: TRACE, lieu: "Lyon", consentement: true }),
    );
    expect(e.code).toBe("interdit");
    expect(ecritures(appels)).toHaveLength(0);
  });

  it("un formateur ne signe pas la pièce d'un apprenant (403)", async () => {
    const { bd, appels } = monde();
    const e = await refus(
      signerPiece(bd as never, formateur, "p1", {
        trace_png: TRACE,
        lieu: "Lyon",
        consentement: true,
      }),
    );
    expect(e.code).toBe("interdit");
    expect(ecritures(appels)).toHaveLength(0);
  });

  it("un apprenant ne voit pas la pièce d'un autre apprenant : introuvable (404)", async () => {
    const { bd } = monde({ piece: { stagiaire_id: "s2" } });
    const e = await refus(
      signerPiece(bd as never, apprenant, "p1", {
        trace_png: TRACE,
        lieu: "Lyon",
        consentement: true,
      }),
    );
    expect(e.code).toBe("introuvable");
  });

  it("pièce déjà validée : conflit (409)", async () => {
    const { bd } = monde({ piece: { statut: "valide" } });
    const e = await refus(
      signerPiece(bd as never, apprenant, "p1", {
        trace_png: TRACE,
        lieu: "Lyon",
        consentement: true,
      }),
    );
    expect(e.code).toBe("conflit");
  });

  it("dossier archivé : conflit (409)", async () => {
    const { bd } = monde({ sous: "archive" });
    const e = await refus(
      signerPiece(bd as never, apprenant, "p1", {
        trace_png: TRACE,
        lieu: "Lyon",
        consentement: true,
      }),
    );
    expect(e.code).toBe("conflit");
  });

  it("sans consentement ni lieu : invalide (400), rien d'écrit", async () => {
    const { bd, appels } = monde();
    const e = await refus(
      signerPiece(bd as never, apprenant, "p1", {
        trace_png: TRACE,
        lieu: "",
        consentement: false,
      }),
    );
    expect(e.code).toBe("invalide");
    expect(ecritures(appels)).toHaveLength(0);
  });
});

describe("dépôt et régénération", () => {
  it("l'apprenant ne régénère pas (403)", async () => {
    const { bd } = monde();
    expect((await refus(regenererPiece(bd as never, apprenant, "p1"))).code).toBe("interdit");
  });

  it("une pièce validée ne se régénère pas (409)", async () => {
    const { bd } = monde({ piece: { statut: "valide" } });
    expect((await refus(regenererPiece(bd as never, formateur, "p1"))).code).toBe("conflit");
  });

  it("dépôt : fichier refusé (extension) avant toute écriture", async () => {
    const { bd, appels } = monde({ piece: { code: deposable, stagiaire_id: null } });
    const e = await refus(
      deposerRetour(bd as never, formateur, "p1", { nom: "virus.exe", contenu: OCTETS }),
    );
    expect(e.code).toBe("invalide");
    expect(ecritures(appels)).toHaveLength(0);
  });

  it("dépôt : l'empreinte scellée est celle du fichier ARCHIVÉ, et la pièce passe à « valide »", async () => {
    const { bd, appels, stockage } = monde({ piece: { code: deposable, stagiaire_id: null } });
    await deposerRetour(bd as never, formateur, "p1", { nom: "retour.pdf", contenu: OCTETS });
    expect(stockage.upload).toHaveBeenCalledTimes(1);
    const maj = appels.find(
      (a) =>
        a.table === "piece_dossier" &&
        a.op === "update" &&
        (a.valeurs as { statut?: string }).statut,
    )!;
    expect(maj.valeurs).toMatchObject({
      statut: "valide",
      empreinte_retour: await sha256Hex(OCTETS),
      mode_retour: "depot",
      retour_par: "u-form",
    });
  });
});

describe("émargement (route 114)", () => {
  const SEANCE = { id: "se1", dossier_id: "d1", date: "2026-11-02" };

  it("l'apprenant émarge pour lui-même ; l'horodatage vient du serveur, pas du corps", async () => {
    const { bd, appels } = monde({ sous: "formation_debutee", seance: SEANCE });
    await emarger(bd as never, apprenant, "se1", {
      trace_png: TRACE,
      stagiaire_id: "s2",
      horodatage: "1999-01-01T00:00:00Z",
    } as never);
    const ecriture = appels.find((a) => a.table === "emargement" && a.op === "upsert")!;
    const lignes = ecriture.valeurs as Array<Record<string, unknown>>;
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      stagiaire_id: "s1",
      signataire: "stagiaire",
      seance_id: "se1",
    });
    expect(String(lignes[0]!["horodatage"]).startsWith("1999")).toBe(false);
    expect(ecriture.options).toMatchObject({ ignoreDuplicates: true });
  });

  it("l'administrateur n'émarge pas (403)", async () => {
    const { bd, appels } = monde({ sous: "formation_debutee", seance: SEANCE });
    const e = await refus(emarger(bd as never, admin, "se1", { trace_png: TRACE }));
    expect(e.code).toBe("interdit");
    expect(ecritures(appels, "emargement")).toHaveLength(0);
  });

  it("formation non démarrée : conflit (409)", async () => {
    const { bd } = monde({ sous: "brouillon", seance: SEANCE });
    expect((await refus(emarger(bd as never, apprenant, "se1", { trace_png: TRACE }))).code).toBe(
      "conflit",
    );
  });

  it("séance d'un autre dossier ou inconnue : introuvable (404)", async () => {
    const { bd } = monde({ sous: "formation_debutee" });
    expect((await refus(emarger(bd as never, apprenant, "se1", { trace_png: TRACE }))).code).toBe(
      "introuvable",
    );
    const autre = monde({ sous: "formation_debutee", seance: SEANCE });
    expect(
      (await refus(emarger(autre.bd as never, autreFormateur, "se1", { trace_png: TRACE }))).code,
    ).toBe("introuvable");
  });

  it("tracé invalide : invalide (400), rien d'écrit", async () => {
    const { bd, appels } = monde({ sous: "formation_debutee", seance: SEANCE });
    const e = await refus(emarger(bd as never, apprenant, "se1", { trace_png: "n'importe quoi" }));
    expect(e.code).toBe("invalide");
    expect(ecritures(appels, "emargement")).toHaveLength(0);
  });
});
