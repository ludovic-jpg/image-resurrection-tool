import { describe, expect, it, vi } from "vitest";
import type { BdService } from "./bd.server";
import { ENTETE_SECRET_CRON, secretCronValide, traiterAppelCron } from "./cron.server";

const SECRET = "secret-de-test-0123456789";
const bd = {} as BdService;
const requete = (entetes: Record<string, string> = {}, methode = "POST") =>
  new Request("https://app.example/api/taches-quotidiennes", { method: methode, headers: entetes });
const resultat = { froid: 2, relances: 1, echecs: 0 };

describe("appel planifié de la tâche quotidienne", () => {
  it("en-tête absent : 401, la tâche ne tourne pas", async () => {
    const executer = vi.fn();
    const r = await traiterAppelCron(requete(), { secret: SECRET, executer, bd });
    expect(r.status).toBe(401);
    expect(executer).not.toHaveBeenCalled();
  });

  it.each(["faux", "", SECRET.slice(0, -1), SECRET + "x", SECRET.toUpperCase()])(
    "secret faux (%j) : 401, la tâche ne tourne pas",
    async (valeur) => {
      const executer = vi.fn();
      const r = await traiterAppelCron(requete({ [ENTETE_SECRET_CRON]: valeur }), {
        secret: SECRET,
        executer,
        bd,
      });
      expect(r.status).toBe(401);
      expect(executer).not.toHaveBeenCalled();
    },
  );

  it("le jeton Bearer ne remplace pas l'en-tête x-cron-secret", async () => {
    const executer = vi.fn();
    const r = await traiterAppelCron(requete({ authorization: `Bearer ${SECRET}` }), {
      secret: SECRET,
      executer,
      bd,
    });
    expect(r.status).toBe(401);
    expect(executer).not.toHaveBeenCalled();
  });

  it("CRON_SECRET non défini : 503 même avec un en-tête, jamais d'exécution", async () => {
    const executer = vi.fn();
    for (const secret of [undefined, "", "   "]) {
      const r = await traiterAppelCron(requete({ [ENTETE_SECRET_CRON]: "" }), {
        secret,
        executer,
        bd,
      });
      expect(r.status).toBe(503);
      const r2 = await traiterAppelCron(requete({ [ENTETE_SECRET_CRON]: "x" }), {
        secret,
        executer,
        bd,
      });
      expect(r2.status).toBe(503);
    }
    expect(executer).not.toHaveBeenCalled();
  });

  it("bon secret : 200 avec le décompte, la tâche tourne une fois", async () => {
    const executer = vi.fn(async () => resultat);
    const r = await traiterAppelCron(requete({ [ENTETE_SECRET_CRON]: SECRET }), {
      secret: SECRET,
      executer,
      bd,
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, ...resultat });
    expect(executer).toHaveBeenCalledTimes(1);
  });

  it("méthode GET : 405, pas d'exécution", async () => {
    const executer = vi.fn();
    const r = await traiterAppelCron(requete({ [ENTETE_SECRET_CRON]: SECRET }, "GET"), {
      secret: SECRET,
      executer,
      bd,
    });
    expect(r.status).toBe(405);
    expect(executer).not.toHaveBeenCalled();
  });

  it("panne de la tâche : 500 sans détail ni secret", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const executer = vi.fn(async () => {
      throw new Error("connexion refusée " + SECRET);
    });
    const r = await traiterAppelCron(requete({ [ENTETE_SECRET_CRON]: SECRET }), {
      secret: SECRET,
      executer,
      bd,
    });
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain(SECRET);
  });

  it("les réponses ne sont pas mises en cache", async () => {
    const r = await traiterAppelCron(requete(), { secret: SECRET, bd });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("comparaison du secret", () => {
  it("vrai seulement pour le secret exact", async () => {
    expect(await secretCronValide(SECRET, SECRET)).toBe(true);
    expect(await secretCronValide(null, SECRET)).toBe(false);
    expect(await secretCronValide("autre", SECRET)).toBe(false);
  });
});
