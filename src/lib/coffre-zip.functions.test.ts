// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { ACTEURS, aFiltre, fauxBd, moi, type Appel } from "@/test/faux-supabase";

const etat = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validation: { parse(x: unknown): unknown } | undefined;
    const b = {
      middleware: () => b,
      validator: (v: { parse(x: unknown): unknown }) => ((validation = v), b),
      handler:
        (fn: (a: { data: unknown; context: unknown }) => unknown) =>
        (entree?: { data?: unknown; context?: unknown }) =>
          fn({
            data: validation ? validation.parse(entree?.data) : entree?.data,
            context: entree?.context,
          }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return etat.service;
  },
}));

const { exporterCoffreZip } = await import("./coffre-zip.functions");
const { LIMITE_OCTETS } = await import("./serveur/coffre-zip.server");

type Retour = { ok: boolean; [k: string]: unknown };
const FORMATION = {
  id: "fo1",
  of_id: "of1",
  formateur_id: "f1",
  formation_titre: "Soudage TIG",
  formation_objectifs: "Souder",
  formation_niveau: "",
  formation_prerequis: "",
  formation_duree_heures_total: 14,
  formation_duree_jours: 2,
  formation_modalite: "presentiel",
  formation_effectif_min: null,
  formation_effectif_max: null,
  formation_prix_unitaire_ht: null,
  formation_prix_groupe_ht: null,
  mode_financement: "opco",
  formation_opco: "",
  formation_delai_acces: "",
  formation_accessibilite: "",
  formation_moyens_pedagogiques: "",
  formation_modalites_evaluation: "",
  formation_modalites_sanction: "",
  public_vise: "",
  programme: "Jour 1",
  formation_modules: [],
};
const FICHIERS = [
  {
    nom_fichier: "Cours.pptx",
    chemin: "of1/coffres/fo1/a_Cours.pptx",
    categorie: "support",
    taille: 10,
  },
  {
    nom_fichier: "Cours.pptx",
    chemin: "of1/coffres/fo1/b_Cours.pptx",
    categorie: "support",
    taille: 10,
  },
  {
    nom_fichier: "Absent.pdf",
    chemin: "of1/coffres/fo1/c_Absent.pdf",
    categorie: "ressource",
    taille: 10,
  },
];
const OUTILS = [
  {
    type: "acquis",
    titre: "Test final",
    contenu: {
      titre: "Test final",
      questions: [{ enonce: "Q1 ?", propositions: ["A", "B", "C", "D"], bonne_reponse: 2 }],
    },
  },
];

function monter(
  acteur: Record<string, unknown> | null,
  options: { formation?: unknown; fichiers?: unknown[] } = {},
) {
  const formation = options.formation === undefined ? FORMATION : options.formation;
  const service = fauxBd((a: Appel) => {
    if (a.table === "formation") {
      const ok =
        formation &&
        aFiltre(a, "eq", "of_id", "of1") &&
        // Un formateur ne voit que SES formations ; l'administrateur voit celles de son organisme.
        (acteur?.["role"] !== "formateur" || aFiltre(a, "eq", "formateur_id", "f1"));
      return { data: ok ? [formation] : [] };
    }
    if (a.table === "organisme_formation")
      return { data: [{ of_nom: "Mon OF", couleur: "#1d6a45" }] };
    if (a.table === "coffre_fichier") return { data: options.fichiers ?? FICHIERS };
    if (a.table === "modele_outil") return { data: OUTILS };
    if (a.table === "positionnement") return { data: [{ chemin_pdf: "of1/dossiers/p/pos.pdf" }] };
    return undefined;
  });
  etat.service = service.bd;
  service.bd.rpc.mockImplementation(async () => moi(acteur));
  service.stockage.download.mockImplementation((async (chemin: string) =>
    chemin.endsWith("c_Absent.pdf")
      ? { data: null, error: { message: "absent" } }
      : {
          data: new Blob([new TextEncoder().encode(`contenu de ${chemin}`)]),
          error: null,
        }) as never);
  const contexte = { supabase: service.bd, userId: (acteur?.["utilisateur_id"] as string) ?? "x" };
  const appeler = (data?: unknown) =>
    (exporterCoffreZip as unknown as (e: unknown) => Promise<Retour>)({ data, context: contexte });
  return { service, appeler };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const lireZip = async (r: Retour) => {
  const d = (r as unknown as { donnees: { contenu_base64: string } }).donnees;
  return JSZip.loadAsync(Uint8Array.from(atob(d.contenu_base64), (c) => c.charCodeAt(0)));
};

describe("exporterCoffreZip (route 53)", () => {
  for (const [role, acteur] of [
    ["apprenant", ACTEURS.apprenant],
    ["candidat non validé", ACTEURS.candidat],
  ] as const) {
    it(`${role} : 403 en français, rien n'est lu dans Storage`, async () => {
      const m = monter({ ...acteur });
      expect(await m.appeler({ formation_id: "fo1" })).toMatchObject({
        ok: false,
        code: "interdit",
        statut: 403,
      });
      expect(m.service.appels).toEqual([]);
      expect(m.service.stockage.download).not.toHaveBeenCalled();
    });
  }

  it("le formateur propriétaire obtient un ZIP rangé par rubrique, avec programme, questionnaires et positionnements", async () => {
    const m = monter({ ...ACTEURS.formateurValide });
    const r = await m.appeler({ formation_id: "fo1" });
    expect(r).toMatchObject({
      ok: true,
      donnees: { nom: "Coffre-fort - Soudage TIG.zip", type_mime: "application/zip" },
    });
    const zip = await lireZip(r);
    const noms = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(noms).toEqual([
      "00 - Programme.html",
      "Positionnements signés/pos.pdf",
      "Questionnaires/Test final.html",
      "Ressource complementaire/MANQUANT - Absent.pdf.txt",
      "Support de cours/Cours (2).pptx",
      "Support de cours/Cours.pptx",
    ]);
    expect(await zip.file("Support de cours/Cours.pptx")!.async("string")).toBe(
      "contenu de of1/coffres/fo1/a_Cours.pptx",
    );
    expect(await zip.file("00 - Programme.html")!.async("string")).toContain("Soudage TIG");
    // Le questionnaire est SANS corrigé.
    const q = await zip.file("Questionnaires/Test final.html")!.async("string");
    expect(q).toContain("Q1 ?");
    expect(q).not.toContain("✔");
    // Les fichiers viennent du bucket coffre ; le PDF de positionnement du bucket archive.
    const buckets = m.service.bd.storage.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(new Set(buckets)).toEqual(new Set(["coffre", "archive"]));
  });

  it("seuls les fichiers actifs de l'organisme (hors corbeille) sont lus", async () => {
    const m = monter({ ...ACTEURS.formateurValide });
    await m.appeler({ formation_id: "fo1" });
    const lecture = m.service.appels.find((a) => a.table === "coffre_fichier")!;
    expect(lecture.filtres).toContainEqual(["is", "supprime_le", null]);
    expect(aFiltre(lecture, "eq", "of_id", "of1")).toBe(true);
  });

  it("l'administrateur exporte une formation de son organisme (sans filtre de formateur)", async () => {
    const m = monter({ ...ACTEURS.admin });
    expect(await m.appeler({ formation_id: "fo1" })).toMatchObject({ ok: true });
    const lecture = m.service.appels.find((a) => a.table === "formation")!;
    expect(lecture.filtres.some((f) => f[0] === "eq" && f[1] === "formateur_id")).toBe(false);
    expect(aFiltre(lecture, "eq", "of_id", "of1")).toBe(true);
  });

  it("le formateur est cloisonné : la formation d'un autre → 404, aucun fichier lu", async () => {
    const m = monter({ ...ACTEURS.formateurValide }, { formation: null });
    expect(await m.appeler({ formation_id: "fo-autre" })).toMatchObject({
      ok: false,
      code: "introuvable",
      statut: 404,
    });
    expect(m.service.stockage.download).not.toHaveBeenCalled();
  });

  it("un coffre trop volumineux est refusé avec un message qui propose une autre voie", async () => {
    const m = monter(
      { ...ACTEURS.formateurValide },
      { fichiers: [{ ...FICHIERS[0], taille: LIMITE_OCTETS + 1 }] },
    );
    const r = await m.appeler({ formation_id: "fo1" });
    expect(r).toMatchObject({ ok: false, code: "invalide", statut: 400 });
    expect(String(r["message"])).toMatch(/trop volumineux.*un par un/);
    expect(m.service.stockage.download).not.toHaveBeenCalled();
  });

  it("n'accepte jamais un identifiant d'organisme ou d'acteur dans le corps", async () => {
    const m = monter({ ...ACTEURS.formateurValide });
    await m.appeler({ formation_id: "fo1", of_id: "of-autre", formateur_id: "f-autre" });
    for (const a of m.service.appels) {
      expect(JSON.stringify(a.filtres)).not.toContain("of-autre");
      expect(JSON.stringify(a.filtres)).not.toContain("f-autre");
    }
  });
});
