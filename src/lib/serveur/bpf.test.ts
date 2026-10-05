// @vitest-environment node
/**
 * BPF et export CSV : le nouveau code (lecture Supabase + noyau) doit rendre EXACTEMENT ce que rendait l'ancien serveur
 * (`src/serveur/services/bpf.ts`) sur les mêmes données — ici le jeu de démonstration complet, rejoué sur PGlite.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { bdMemoire } from "@/test/bd-memoire";
import { ancienServeurDeDemo } from "@/test/ancien-serveur";
import { exporterBpfCsv as ancienCsv, lireBpf as ancienBpf } from "@/serveur/services/bpf";
import type { Acteur } from "./acteur.server";
import type { BdService } from "./bd.server";
import { chargerLignesRealisees, exporterBpfCsv, lireBpf } from "./bpf.server";

const TABLES = [
  "organismeFormation",
  "formateur",
  "entrepriseCliente",
  "stagiaire",
  "dossierFormation",
  "stagiaireDossier",
  "seance",
  "emargement",
  "pieceDossier",
] as const;
const NOMS: Record<(typeof TABLES)[number], string> = {
  organismeFormation: "organisme_formation",
  formateur: "formateur",
  entrepriseCliente: "entreprise_cliente",
  stagiaire: "stagiaire",
  dossierFormation: "dossier_formation",
  stagiaireDossier: "stagiaire_dossier",
  seance: "seance",
  emargement: "emargement",
  pieceDossier: "piece_dossier",
};

let ancien: Awaited<ReturnType<typeof ancienServeurDeDemo>>;
let bd: BdService;
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

beforeAll(async () => {
  ancien = await ancienServeurDeDemo();
  const donnees: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) donnees[NOMS[t]] = await ancien.lignes(t);
  bd = bdMemoire(donnees).bd as unknown as BdService;
}, 180_000);

const acteur = (a: unknown) => a as Acteur;

describe("BPF — identique à l'ancien serveur sur les données de démonstration", () => {
  it("l'administrateur : exercices, totaux, répartitions et lignes", async () => {
    const attendu = json(await ancienBpf(ancien.s, ancien.admin));
    const obtenu = await lireBpf(bd, acteur(ancien.admin));
    expect(attendu.bpf.totaux.nb_actions).toBeGreaterThan(0); // la comparaison porte sur du réel
    expect(obtenu).toEqual(attendu);
  });

  it("le formateur : seulement ses dossiers, même résultat", async () => {
    const attendu = json(await ancienBpf(ancien.s, ancien.formatrice));
    expect(await lireBpf(bd, acteur(ancien.formatrice))).toEqual(attendu);
  });

  it("un exercice demandé, y compris sans réalisé", async () => {
    for (const exercice of [2026, 2025, 2030]) {
      const attendu = json(await ancienBpf(ancien.s, ancien.admin, exercice));
      expect(await lireBpf(bd, acteur(ancien.admin), exercice)).toEqual(attendu);
    }
  });

  it("export CSV : même contenu octet pour octet, même nom de fichier", async () => {
    const attendu = await ancienCsv(ancien.s, ancien.admin, 2026);
    const obtenu = await exporterBpfCsv(bd, acteur(ancien.admin), 2026);
    expect(obtenu.nom).toBe(attendu.nom);
    expect(obtenu.contenu).toBe(attendu.contenu);
    expect(obtenu.contenu.startsWith("﻿")).toBe(true);
    expect(obtenu.type_mime).toBe("text/csv; charset=utf-8");
    const duFormateur = await ancienCsv(ancien.s, ancien.formatrice, 2026);
    expect((await exporterBpfCsv(bd, acteur(ancien.formatrice), 2026)).contenu).toBe(
      duFormateur.contenu,
    );
  });

  it("un apprenant est refusé", async () => {
    await expect(
      lireBpf(bd, acteur({ ...ancien.admin, role: "apprenant", stagiaire_id: "s1" })),
    ).rejects.toMatchObject({ code: "interdit" });
  });

  it("ne lit que les dossiers réalisés de l'organisme (filtre posé côté base)", async () => {
    const faux = bdMemoire({ dossier_formation: [] });
    await chargerLignesRealisees(faux.bd as unknown as BdService, acteur(ancien.formatrice));
    const requete = faux.requetes.find((r) => r.table === "dossier_formation")!;
    expect(requete.filtres).toContain(`eq:of_id,${ancien.of_id}`);
    expect(requete.filtres).toContain(`eq:formateur_id,${ancien.formatrice.formateur_id}`);
    expect(requete.filtres.some((f) => f.startsWith("in:sous_statut"))).toBe(true);
  });

  it("n'écrit rien", async () => {
    const faux = bdMemoire({ dossier_formation: [] });
    await lireBpf(faux.bd as unknown as BdService, acteur(ancien.admin));
    expect(faux.requetes.every((r) => r.op === "select")).toBe(true);
  });
});
