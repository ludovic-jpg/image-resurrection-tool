/* global console */
// Prépare le code partagé des Edge Functions Supabase (Deno) à partir du dépôt.
//   1. Copie le noyau métier src/domaine -> supabase/functions/_shared/domaine
//      (sans les tests ni la fixture ; imports relatifs suffixés « .ts » comme l'exige Deno).
//   2. Embarque les gabarits HTML -> supabase/functions/_shared/gabarits.generes.ts
//      (Deno Deploy ne lit pas de fichiers hors du bundle de façon fiable).
// À relancer après toute modification de src/domaine ou de gabarits/ :  node scripts/preparer-edge-functions.mjs
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(racine, "src/domaine");
const cible = join(racine, "supabase/functions/_shared/domaine");
const EXCLUS = [/\.test\.ts$/, /\/dossier\/fixture\.ts$/];

function lister(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? lister(chemin) : [chemin];
  });
}

// Ajoute « .ts » (ou « /index.ts ») aux imports et exports relatifs qui n'ont pas d'extension.
function suffixer(code, fichier) {
  return code.replace(
    /(from\s+|import\s*\(\s*)(["'])(\.{1,2}\/[^"']+)\2/g,
    (tout, avant, q, spec) => {
      if (/\.(ts|js|json)$/.test(spec)) return tout;
      const base = resolve(dirname(fichier), spec);
      if (existsSync(base + ".ts")) return `${avant}${q}${spec}.ts${q}`;
      if (existsSync(join(base, "index.ts"))) return `${avant}${q}${spec}/index.ts${q}`;
      throw new Error(`Import introuvable « ${spec} » dans ${relative(racine, fichier)}`);
    },
  );
}

rmSync(cible, { recursive: true, force: true });
let copies = 0;
for (const fichier of lister(source)) {
  if (!fichier.endsWith(".ts") || EXCLUS.some((r) => r.test(fichier))) continue;
  const code = readFileSync(fichier, "utf8");
  if (/from\s+["']node:/.test(code))
    throw new Error(`Le noyau ne doit rien importer de node: (${relative(racine, fichier)})`);
  const dest = join(cible, relative(source, fichier));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(
    dest,
    `// FICHIER GÉNÉRÉ par scripts/preparer-edge-functions.mjs — modifier src/domaine, pas cette copie.\n${suffixer(code, fichier)}`,
  );
  copies++;
}

const gabarits = {};
const dossierGabarits = join(racine, "gabarits");
for (const fichier of lister(dossierGabarits).sort()) {
  gabarits[relative(dossierGabarits, fichier).replace(/\\/g, "/")] = readFileSync(fichier, "utf8");
}
const sortie = join(racine, "supabase/functions/_shared/gabarits.generes.ts");
writeFileSync(
  sortie,
  "// FICHIER GÉNÉRÉ par scripts/preparer-edge-functions.mjs — modifier gabarits/, pas ce fichier.\n" +
    "// Clés : chemin relatif dans gabarits/ (ex. « 02-AVT.html », « fragments/styles.css »).\n" +
    `export const GABARITS: Record<string, string> = ${JSON.stringify(gabarits, null, 2)};\n`,
);
console.log(
  `${copies} fichiers du noyau copiés ; ${Object.keys(gabarits).length} gabarits embarqués.`,
);
