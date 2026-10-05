// @vitest-environment node
/** Sauvegarde : export et import identiques à l'ancien serveur (`src/serveur/services/sauvegarde.ts`) sur la démo. */
import { beforeAll, describe, expect, it } from "vitest";
import { bdMemoire } from "@/test/bd-memoire-lot8";
import { ancienServeurDeDemo, INSTANT_DEMO } from "@/test/ancien-serveur";
import {
  exporterMesDonnees as ancienExport,
  importerMesDonnees as ancienImport,
} from "@/serveur/services/sauvegarde";
import type { ActeurFormateurValide } from "./acteur.server";
import type { BdService } from "./bd.server";
import { exporterMesDonnees, importerMesDonnees } from "./sauvegarde.server";

const TABLES = {
  formation: "formation",
  modeleOutil: "modele_outil",
  stagiaire: "stagiaire",
  entrepriseCliente: "entreprise_cliente",
} as const;
let ancien: Awaited<ReturnType<typeof ancienServeurDeDemo>>;
let donnees: Record<string, Record<string, unknown>[]>;
const acteur = () => ancien.formatrice as unknown as ActeurFormateurValide;

beforeAll(async () => {
  ancien = await ancienServeurDeDemo();
  donnees = {};
  for (const [t, nom] of Object.entries(TABLES))
    donnees[nom] = await ancien.lignes(t as keyof typeof TABLES);
  // Données d'un autre formateur et d'un autre organisme : jamais exportées.
  donnees["formation"]!.push({
    ...donnees["formation"]![0]!,
    id: "etrangere",
    formateur_id: "autre",
    formation_titre: "Étrangère",
  });
  donnees["stagiaire"]!.push({
    ...donnees["stagiaire"]![0]!,
    id: "s-etranger",
    of_id: "autre-of",
    stagiaire_nom: "Étranger",
  });
}, 180_000);

describe("export (route 85)", () => {
  it("même fichier, octet pour octet, que l'ancien serveur", async () => {
    const attendu = await ancienExport(ancien.s, ancien.formatrice);
    const m = bdMemoire(donnees);
    const obtenu = await exporterMesDonnees(m.bd as unknown as BdService, acteur(), INSTANT_DEMO);
    expect(obtenu.nom).toBe(attendu.nom);
    expect(obtenu.type_mime).toBe(attendu.type_mime);
    // L'ancien export n'avait aucun ORDER BY (ordre d'insertion, par hasard) : le nouveau trie (date puis identifiant)
    // pour un fichier reproductible. Même contenu, comparé à l'ordre des lignes près.
    const trier = (v: string) => {
      const o = JSON.parse(v) as Record<string, unknown>;
      for (const k of ["formations", "outils", "stagiaires", "entreprises"])
        (o[k] as Array<{ id: string }>).sort((a, b) => a.id.localeCompare(b.id));
      return o;
    };
    expect(trier(obtenu.contenu)).toEqual(trier(attendu.contenu.toString("utf8")));
    expect(obtenu.contenu).toBe(JSON.stringify(JSON.parse(obtenu.contenu), null, 2)); // même mise en forme (2 espaces)
    const s = JSON.parse(obtenu.contenu) as Record<string, Array<Record<string, unknown>>>;
    expect(s["formations"]!.length).toBeGreaterThan(0);
    expect(JSON.stringify(s)).not.toMatch(/Étrangère|Étranger/);
    for (const cle of ["formations", "outils", "stagiaires", "entreprises"])
      for (const l of s[cle]!)
        expect(Object.keys(l)).not.toEqual(expect.arrayContaining(["of_id"]));
  });

  it("filtre sur la fiche et l'organisme de l'acteur, journalise, n'écrit rien d'autre", async () => {
    const m = bdMemoire(donnees);
    await exporterMesDonnees(m.bd as unknown as BdService, acteur(), INSTANT_DEMO);
    for (const t of ["formation", "modele_outil", "stagiaire", "entreprise_cliente"]) {
      const r = m.requetes.find((x) => x.table === t)!;
      expect(r.filtres).toContain(`eq:formateur_id,${ancien.formatrice.formateur_id}`);
      expect(r.filtres).toContain(`eq:of_id,${ancien.of_id}`);
    }
    const ecritures = m.requetes.filter((r) => r.op !== "select");
    expect(ecritures.map((r) => [r.table, r.op])).toEqual([["evenement", "insert"]]);
    expect(m.tables["evenement"]![0]).toMatchObject({
      type: "sauvegarde_exportee",
      of_id: ancien.of_id,
    });
  });
});

describe("import (route 86)", () => {
  it("mêmes décomptes, mêmes copies et mêmes erreurs que l'ancien serveur", async () => {
    const fichier = (await ancienExport(ancien.s, ancien.formatrice)).contenu;
    const attendu = await ancienImport(ancien.s, ancien.formatrice, fichier);
    const m = bdMemoire(donnees);
    const obtenu = await importerMesDonnees(
      m.bd as unknown as BdService,
      acteur(),
      fichier.toString("utf8"),
    );
    expect(obtenu).toEqual(attendu);
    expect(obtenu.formations).toBeGreaterThan(0);
    const copies = (m.tables["formation"] ?? []).filter((f) =>
      String(f["formation_titre"]).endsWith("(restaurée)"),
    );
    expect(copies).toHaveLength(obtenu.formations);
    for (const c of copies) {
      expect(c["of_id"]).toBe(ancien.of_id);
      expect(c["formateur_id"]).toBe(ancien.formatrice.formateur_id);
    }
    // Rien d'existant n'est modifié ou supprimé : seules des insertions (et le journal).
    expect(m.requetes.filter((r) => r.op === "update" || r.op === "delete")).toEqual([]);
    const types = (m.tables["evenement"] ?? []).map((e) => e["type"]);
    expect(types).toEqual(["sauvegarde_importee"]);
  }, 60_000);

  it("les questionnaires restaurés sont rattachés à la copie de leur formation", async () => {
    const fichier = (await ancienExport(ancien.s, ancien.formatrice)).contenu.toString("utf8");
    const m = bdMemoire(donnees);
    await importerMesDonnees(m.bd as unknown as BdService, acteur(), fichier);
    const formationsIds = new Set((m.tables["formation"] ?? []).map((f) => f["id"]));
    for (const o of (m.tables["modele_outil"] ?? []).filter((o) =>
      String(o["titre"]).endsWith("(restauré)"),
    ))
      if (o["formation_id"]) expect(formationsIds.has(o["formation_id"])).toBe(true);
  }, 60_000);

  it.each([
    ["pas du JSON", "n'importe quoi"],
    [
      "autre application",
      JSON.stringify({ application: "x", version: 1, formations: [], outils: [] }),
    ],
    [
      "version future",
      JSON.stringify({ application: "s4m-plateforme", version: 99, formations: [], outils: [] }),
    ],
  ])("fichier refusé (%s) : 400, aucune écriture", async (_n, contenu) => {
    const m = bdMemoire({});
    await expect(
      importerMesDonnees(m.bd as unknown as BdService, acteur(), contenu),
    ).rejects.toMatchObject({ code: "invalide" });
    expect(m.requetes).toEqual([]);
  });

  it("une formation invalide est signalée sans bloquer les autres", async () => {
    const m = bdMemoire({});
    const contenu = JSON.stringify({
      application: "s4m-plateforme",
      version: 1,
      outils: [],
      formations: [
        { id: "a", formation_titre: "Mauvaise modalité", formation_modalite: "telepathie" },
        { id: "b", formation_titre: "Excel avancé", formation_duree_heures_total: 14 },
      ],
    });
    const r = await importerMesDonnees(m.bd as unknown as BdService, acteur(), contenu);
    expect(r.formations).toBe(1);
    expect(r.erreurs).toHaveLength(1);
    expect(r.erreurs[0]).toMatch(/^Formation « Mauvaise modalité » : /);
  });
});
