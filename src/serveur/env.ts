/** Charge le fichier `.env` s'il existe (Node ≥ 20.12), sans dépendance. À importer en premier. */
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
