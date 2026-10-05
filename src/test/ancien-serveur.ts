/**
 * L'ANCIEN serveur Node (`src/serveur`), monté en mémoire sur PGlite avec le jeu de démonstration, pour comparer ses
 * réponses à celles du nouveau code sur les mêmes données (tests du lot 8 : BPF, CSV, sauvegarde, archives).
 *
 * Le schéma est recréé depuis `src/serveur/bd/schema.ts` (les migrations Drizzle d'origine ne sont plus dans le dépôt).
 * Jamais importé par l'application. Environnement de test : Node.
 */
import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/serveur/bd/schema";
import { semer } from "@/serveur/bd/semence";
import { ChiffreurAesGcm } from "@/serveur/ports/chiffrement";
import { HorlogeFixe } from "@/serveur/ports/divers";
import type { Acteur, Services } from "@/serveur/services/socle";

export const INSTANT_DEMO = new Date("2026-10-05T10:00:00Z");

export async function ancienServeurDeDemo() {
  const client = new PGlite();
  const bd = drizzle(client, { schema });
  await (await pushSchema(schema as never, bd as never)).apply();
  const fichiers = new Map<string, Buffer>();
  const s = {
    bd,
    archive: {
      ecrire: async (c: string, b: Buffer | string) => (fichiers.set(c, Buffer.from(b)), c),
      lire: async (c: string) => fichiers.get(c)!,
      existe: async (c: string) => fichiers.has(c),
      supprimer: async (c: string) => void fichiers.delete(c),
    },
    courrier: { envoyer: async () => ({ id: "x", statut: "journalise", erreur: "" }) },
    pdf: { convertir: async () => null, fermer: async () => {}, disponible: false },
    horloge: new HorlogeFixe(INSTANT_DEMO),
    appUrl: "http://localhost",
    secrets: new ChiffreurAesGcm(Buffer.alloc(32, 1)),
  } as unknown as Services;
  await semer(s);

  const lignes = async (table: keyof typeof schema): Promise<Record<string, unknown>[]> =>
    (await bd.select().from(schema[table] as never)) as Record<string, unknown>[];
  const formateurs = await lignes("formateur");
  const sophie = formateurs.find((f) => f["formateur_nom"] === "Lambert")!;
  const of_id = String(sophie["of_id"]);
  const admin: Acteur = {
    utilisateur_id: "u-admin",
    of_id,
    role: "admin",
    formateur_id: null,
    formateur_valide: false,
    stagiaire_id: null,
    nom: "Claire Exemple",
    email: "admin@demo.example",
  };
  const formatrice: Acteur = {
    utilisateur_id: String(sophie["utilisateur_id"]),
    of_id,
    role: "formateur",
    formateur_id: String(sophie["id"]),
    formateur_valide: true,
    stagiaire_id: null,
    nom: "Sophie Lambert",
    email: String(sophie["formateur_email"]),
  };
  return { s, bd, lignes, admin, formatrice, of_id };
}
