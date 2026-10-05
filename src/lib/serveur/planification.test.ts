// @vitest-environment node
/**
 * Planification quotidienne (migration 20261006000801) : la fonction SQL est exécutée sur PGlite, avec des doublures
 * minimales des extensions Supabase (pg_cron, pg_net, Vault) qui ne sont pas disponibles ici. On vérifie donc la
 * logique (heure de Paris, secrets absents, en-tête, idempotence), pas les extensions elles-mêmes.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/20261006000801_lot8_tache_quotidienne.sql", "utf8");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema cron; create table cron.job(jobid serial, jobname text, schedule text, command text);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
      insert into cron.job(jobname, schedule, command) values (n, s, c) returning jobid::bigint $$;
    create function cron.unschedule(n text) returns boolean language sql as $$
      with d as (delete from cron.job where jobname = n returning 1) select count(*) > 0 from d $$;
    create schema net; create table net.appels(url text, headers jsonb, body jsonb, delai int);
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$
      insert into net.appels values (url, headers, body, timeout_milliseconds) returning 1::bigint $$;
    create schema vault; create table vault.secrets(name text, decrypted_secret text);
    create view vault.decrypted_secrets as select * from vault.secrets;
  `);
  await db.exec(SQL.replace(/create extension if not exists \w+;/g, ""));
}, 60_000);
afterAll(async () => db.close());

const lancer = (instant: string) =>
  db.query(`select public.s4m_lancer_taches_quotidiennes('${instant}'::timestamptz)`);
const appels = async () =>
  (await db.query<{ url: string; headers: Record<string, string> }>("select * from net.appels"))
    .rows;
const vider = () => db.exec("delete from net.appels; delete from vault.secrets");

describe("fichier de migration", () => {
  it("ne contient aucun secret en clair (ni valeur de secret, ni URL réelle)", () => {
    const code = SQL.split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/Bearer|eyJ[A-Za-z0-9_-]{10,}|[0-9a-f]{32,}|https?:\/\//i);
    expect(SQL).toContain("vault.decrypted_secrets");
  });
});

describe("s4m_lancer_taches_quotidiennes", () => {
  it("sans secrets Vault : ne fait rien", async () => {
    await vider();
    await lancer("2026-07-15T01:00:00Z");
    expect(await appels()).toEqual([]);
  });

  it("secrets renseignés : un appel POST avec x-cron-secret, à 03h00 Paris l'été (01:00 UTC)", async () => {
    await vider();
    await db.exec(
      "insert into vault.secrets values ('s4m_cron_secret','valeur-secrete'), ('s4m_app_url','https://app.example/')",
    );
    await lancer("2026-07-15T01:00:00Z");
    const a = await appels();
    expect(a).toHaveLength(1);
    expect(a[0]!.url).toBe("https://app.example/api/taches-quotidiennes");
    expect(a[0]!.headers["x-cron-secret"]).toBe("valeur-secrete");
  });

  it("à 03h00 Paris l'hiver (02:00 UTC) ; et jamais à l'autre passage (un seul appel par nuit)", async () => {
    await db.exec("delete from net.appels");
    await lancer("2026-01-15T01:00:00Z"); // 02h Paris : non
    await lancer("2026-01-15T02:00:00Z"); // 03h Paris : oui
    expect(await appels()).toHaveLength(1);
    await db.exec("delete from net.appels");
    await lancer("2026-07-15T02:00:00Z"); // 04h Paris : non
    expect(await appels()).toHaveLength(0);
  });

  it("nuits de changement d'heure : exactement un appel", async () => {
    for (const [jour, bons] of [
      ["2026-03-29", "01:00"],
      ["2026-10-25", "02:00"],
    ] as const) {
      await db.exec("delete from net.appels");
      for (const h of ["01:00", "02:00"]) await lancer(`${jour}T${h}:00Z`);
      expect(await appels(), jour + " " + bons).toHaveLength(1);
    }
  });

  it("n'est pas exécutable par un client", async () => {
    await db.exec("set role authenticated");
    await expect(lancer("2026-07-15T01:00:00Z")).rejects.toThrow();
    await db.exec("reset role");
  });
});

describe("planification", () => {
  it("un travail à 01:00 et 02:00 UTC, et rejouer la migration n'en crée pas un second", async () => {
    await db.exec(SQL.replace(/create extension if not exists \w+;/g, ""));
    const jobs = (
      await db.query<{ schedule: string; command: string }>(
        "select * from cron.job where jobname = 's4m-taches-quotidiennes'",
      )
    ).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      schedule: "0 1,2 * * *",
      command: "select public.s4m_lancer_taches_quotidiennes()",
    });
  });
});
