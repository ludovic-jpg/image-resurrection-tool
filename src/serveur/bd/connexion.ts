/**
 * Connexion à la base. Deux pilotes, un seul schéma, les mêmes migrations :
 *  - `postgres://…`            → serveur PostgreSQL (production) ;
 *  - chemin de dossier          → PGlite, PostgreSQL embarqué : aucun serveur, aucun Docker ;
 *  - `memoire`                  → PGlite en mémoire (tests).
 * Les migrations sont rejouées à chaque démarrage : le code et le schéma ne peuvent plus diverger
 * (cause première des écrans cassés de l'ancienne application).
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migrerPglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migrerPostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export type BaseDeDonnees = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Connexion {
  bd: BaseDeDonnees;
  fermer: () => Promise<void>;
}

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export async function ouvrirBase(url: string = "memoire"): Promise<Connexion> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const client = postgres(url, { max: 10 });
    const bd = drizzlePostgres(client, { schema });
    await migrerPostgres(bd, { migrationsFolder: MIGRATIONS });
    return { bd: bd as unknown as BaseDeDonnees, fermer: () => client.end() };
  }
  if (url !== "memoire") mkdirSync(url, { recursive: true });
  const client = url === "memoire" ? new PGlite() : new PGlite(url);
  const bd = drizzlePglite(client, { schema });
  await migrerPglite(bd, { migrationsFolder: MIGRATIONS });
  return { bd: bd as unknown as BaseDeDonnees, fermer: () => client.close() };
}
