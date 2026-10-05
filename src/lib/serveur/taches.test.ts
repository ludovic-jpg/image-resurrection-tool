// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { bdMemoire, type LigneMemoire } from "@/test/bd-memoire";
import type { BdService } from "./bd.server";
import {
  envoyerFormulaireProgramme,
  executerTachesQuotidiennes,
  type EnvoyeurFormulaire,
} from "./taches.server";

const MAINTENANT = new Date("2026-10-05T01:00:00Z"); // seuil J+90 : 2026-07-07
const dossier = (id: string, surcharge: LigneMemoire = {}): LigneMemoire => ({
  id,
  of_id: "of1",
  sous_statut: "fin_dossier_complet",
  formation_date_fin: "2026-07-01",
  formation_titre: "Excel",
  formateur_id: "f1",
  ...surcharge,
});
const stagiaire = (id: string, email = `${id}@example.fr`): LigneMemoire => ({
  id,
  stagiaire_prenom: id,
  stagiaire_nom: "Nom",
  stagiaire_email: email,
});
const inscription = (dossier_id: string, stagiaire_id: string, rang = 1) => ({
  id: `${dossier_id}-${stagiaire_id}`,
  dossier_id,
  stagiaire_id,
  rang,
});

function monter(tables: Record<string, LigneMemoire[]>) {
  const m = bdMemoire(tables);
  const envois: Array<{ dossier: string; stagiaire: string; type: string; relance: boolean }> = [];
  // Comme le vrai envoi : il laisse une ligne « formulaire_apprenant » (c'est ce qui rend la tâche idempotente).
  const envoyer: EnvoyeurFormulaire = vi.fn(async (bd, e, maintenant) => {
    envois.push({
      dossier: String(e.dossier["id"]),
      stagiaire: String(e.stagiaire["id"]),
      type: e.type,
      relance: e.relance,
    });
    const { data: existant } = await bd
      .from("formulaire_apprenant")
      .select("*")
      .eq("dossier_id", e.dossier["id"])
      .eq("stagiaire_id", e.stagiaire["id"])
      .eq("type", e.type)
      .maybeSingle();
    if (existant) {
      await bd
        .from("formulaire_apprenant")
        .update({
          envois: Number((existant as LigneMemoire)["envois"]) + 1,
          envoye_le: maintenant.toISOString(),
        })
        .eq("id", (existant as LigneMemoire)["id"]);
    } else {
      await bd.from("formulaire_apprenant").insert({
        dossier_id: e.dossier["id"],
        stagiaire_id: e.stagiaire["id"],
        type: e.type,
        statut: "envoye",
        envois: 1,
        envoye_le: maintenant.toISOString(),
        expire_le: new Date(maintenant.getTime() + 45 * 86_400_000).toISOString(),
      });
    }
  });
  const lancer = (maintenant = MAINTENANT) =>
    executerTachesQuotidiennes(m.bd as unknown as BdService, {
      maintenant,
      envoyer,
      appUrl: "https://app.example",
    });
  return { ...m, envois, envoyer, lancer };
}

describe("tâche quotidienne : satisfaction à froid J+90", () => {
  const base = () => ({
    dossier_formation: [
      dossier("d-du"),
      dossier("d-trop-recent", { formation_date_fin: "2026-07-08" }),
      dossier("d-archive", { sous_statut: "archive" }),
      dossier("d-incomplet", { sous_statut: "fin_dossier_incomplet" }),
      dossier("d-sans-date", { formation_date_fin: "" }),
    ],
    stagiaire: [stagiaire("s1"), stagiaire("s2"), stagiaire("s3", "")],
    stagiaire_dossier: [
      inscription("d-du", "s1"),
      inscription("d-du", "s2", 2),
      inscription("d-du", "s3", 3),
      inscription("d-trop-recent", "s1"),
      inscription("d-archive", "s1"),
    ],
    formulaire_apprenant: [],
    piece_dossier: [],
  });

  it("envoie à chaque stagiaire ayant une adresse, des dossiers dus seulement", async () => {
    const t = monter(base());
    expect(await t.lancer()).toEqual({ froid: 2, relances: 0, echecs: 0 });
    expect(t.envois).toEqual([
      { dossier: "d-du", stagiaire: "s1", type: "satisfaction_froid", relance: false },
      { dossier: "d-du", stagiaire: "s2", type: "satisfaction_froid", relance: false },
    ]);
  });

  it("idempotente : relancée le même jour, elle n'envoie rien de plus", async () => {
    const t = monter(base());
    await t.lancer();
    expect(await t.lancer()).toEqual({ froid: 0, relances: 0, echecs: 0 });
    expect(t.envois).toHaveLength(2);
  });

  it("pas de nouvel envoi si la pièce 12-APR est déjà validée", async () => {
    const tables = base();
    (tables as Record<string, LigneMemoire[]>)["piece_dossier"] = [
      { id: "p1", dossier_id: "d-du", stagiaire_id: "s1", code: "12-APR", statut: "valide" },
    ];
    const t = monter(tables);
    expect((await t.lancer()).froid).toBe(1);
    expect(t.envois.map((e) => e.stagiaire)).toEqual(["s2"]);
  });

  it("un envoi refusé est compté et journalisé sans arrêter les suivants", async () => {
    const t = monter(base());
    (t.envoyer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("refus"));
    const r = await t.lancer();
    expect(r).toEqual({ froid: 1, relances: 0, echecs: 1 });
    const evts = t.tables["evenement"] ?? [];
    expect(evts).toHaveLength(1);
    expect(evts[0]).toMatchObject({ type: "formulaire_non_envoye", acteur_role: "systeme" });
  });
});

describe("tâche quotidienne : relance unique J+7", () => {
  const formulaire = (id: string, surcharge: LigneMemoire = {}): LigneMemoire => ({
    id,
    dossier_id: "d1",
    stagiaire_id: "s1",
    type: "recueil",
    statut: "envoye",
    envois: 1,
    envoye_le: "2026-09-27T10:00:00Z",
    expire_le: "2026-11-10T10:00:00Z",
    ...surcharge,
  });
  const tables = (formulaires: LigneMemoire[]) => ({
    dossier_formation: [
      dossier("d1", { sous_statut: "dossier_valide", formation_date_fin: "2026-12-01" }),
    ],
    stagiaire: [stagiaire("s1"), stagiaire("s2")],
    stagiaire_dossier: [],
    formulaire_apprenant: formulaires,
    piece_dossier: [],
  });

  it("relance une fois un formulaire resté sans réponse depuis plus de 7 jours", async () => {
    const t = monter(tables([formulaire("a")]));
    expect(await t.lancer()).toEqual({ froid: 0, relances: 1, echecs: 0 });
    expect(t.envois).toEqual([{ dossier: "d1", stagiaire: "s1", type: "recueil", relance: true }]);
    // deuxième exécution : le compteur d'envois est passé à 2, plus de relance
    expect(await t.lancer()).toEqual({ froid: 0, relances: 0, echecs: 0 });
  });

  it("ne relance ni le récent, ni le déjà relancé, ni l'expiré, ni le terminé", async () => {
    const t = monter(
      tables([
        formulaire("recent", { envoye_le: "2026-09-29T10:00:00Z" }),
        formulaire("relance", { envois: 2 }),
        formulaire("expire", { expire_le: "2026-10-04T10:00:00Z" }),
        formulaire("complet", { statut: "complet" }),
      ]),
    );
    expect(await t.lancer()).toEqual({ froid: 0, relances: 0, echecs: 0 });
    expect(t.envois).toEqual([]);
  });

  it("relance aussi un formulaire en cours de saisie", async () => {
    const t = monter(tables([formulaire("en-cours", { statut: "en_cours" })]));
    expect((await t.lancer()).relances).toBe(1);
  });

  it("une relance qui n'a plus lieu d'être (erreur métier) est ignorée sans faire échouer la tâche", async () => {
    const { conflit } = await import("./erreurs.server");
    const t = monter(tables([formulaire("a")]));
    (t.envoyer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(conflit("déjà validé"));
    expect(await t.lancer()).toEqual({ froid: 0, relances: 0, echecs: 0 });
  });
});

describe("tâche quotidienne : aucune suppression", () => {
  it("ne supprime ni ne purge rien (l'ancien code n'avait pas de purge)", async () => {
    const t = monter({
      dossier_formation: [dossier("d-du")],
      stagiaire: [stagiaire("s1")],
      stagiaire_dossier: [inscription("d-du", "s1")],
      formulaire_apprenant: [],
      piece_dossier: [],
    });
    await t.lancer();
    expect(t.requetes.filter((r) => r.op === "delete")).toEqual([]);
  });
});

describe("envoi par défaut", () => {
  it("refuse un dossier archivé et une fiche sans adresse", async () => {
    const m = bdMemoire({});
    const bd = m.bd as unknown as BdService;
    await expect(
      envoyerFormulaireProgramme(
        bd,
        {
          dossier: dossier("d", { sous_statut: "archive" }),
          stagiaire: stagiaire("s"),
          type: "satisfaction_froid",
          relance: false,
        },
        MAINTENANT,
        "https://app.example",
      ),
    ).rejects.toMatchObject({ code: "conflit" });
    await expect(
      envoyerFormulaireProgramme(
        bd,
        {
          dossier: dossier("d"),
          stagiaire: stagiaire("s", ""),
          type: "satisfaction_froid",
          relance: false,
        },
        MAINTENANT,
        "https://app.example",
      ),
    ).rejects.toMatchObject({ code: "invalide" });
    expect(m.requetes.filter((r) => r.op !== "select")).toEqual([]);
  });
});
