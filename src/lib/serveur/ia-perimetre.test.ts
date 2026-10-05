// @vitest-environment node
/**
 * Test de garde — « l'IA sur la partie support pédagogique ; sur le reste, tout doit être produit de manière très
 * exacte » (cahier des charges oral du 23/09/2026). Modèle : `tests/integration/ia-perimetre.test.ts` de s4mfinal.
 *
 * Ce test lit le code source : si demain quelqu'un (humain ou IA) branche l'assistant sur la génération des pièces, les
 * conventions, le pipeline ou les montants, la CI échoue. Une règle d'architecture devient ainsi vérifiable.
 * Il porte sur le code de l'application (`src/lib`, `src/client`, `src/domaine`, `src/routes`) ; `src/serveur`, ancien
 * serveur Node gardé comme référence, a son propre test dans s4mfinal.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(__dirname, "../../..");

function fichiers(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) return fichiers(chemin);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [chemin] : [];
  });
}

const sources = ["src/lib", "src/client", "src/domaine", "src/routes", "src/test"]
  .flatMap((d) => fichiers(join(RACINE, d)))
  .map((chemin) => ({
    chemin: relative(RACINE, chemin).replaceAll("\\", "/"),
    code: readFileSync(chemin, "utf8"),
  }));

const importe = (code: string, module: RegExp) =>
  // `from "x"`, `import "x"` (sans nom) et `import("x")` (différé).
  [...code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].some((m) =>
    module.test(m[1] ?? ""),
  );
const liste = (f: (s: (typeof sources)[number]) => boolean) =>
  sources
    .filter(f)
    .map((s) => s.chemin)
    .sort();

/** Les fichiers qui produisent ou signent les conventions, les pièces, le pipeline, les montants. */
const EXACTS =
  /domaine\/(dossier|gabarits|pipeline|referentiel|signature|bpf|candidature|courriels|formulaires|archive|calculs)\/|lib\/(serveur\/(archive|courrier|hacheur|acteur|journal|chiffrement|config|erreurs|bd)\.server|candidatures\.functions|courriels-envoyer\.functions|reglages\.functions|auth-compte\.functions)|client\/passerelle\/lot-[0-6]|client\/passerelle\/lot-8|client\/ecrans\/(Dossier|DossierPieces|Dossiers|Bpf|Archives|Courriers|Candidature|Organisme)/;

describe("périmètre de l'IA", () => {
  it("seul le service pédagogique connaît l'adaptateur IA", () => {
    expect(liste((f) => importe(f.code, /(^|\/)ia\.server$/))).toEqual([
      "src/lib/serveur/ia-pedagogie.server.ts",
    ]);
  });

  it("seules les fonctions serveur de l'assistant appellent le service pédagogique", () => {
    expect(liste((f) => importe(f.code, /ia-pedagogie\.server$/))).toEqual([
      "src/lib/pedagogie-ia.functions.ts",
    ]);
  });

  it("seul le service pédagogique utilise le module de propositions IA", () => {
    expect(liste((f) => importe(f.code, /pedagogie\/propositions$/))).toEqual([
      "src/lib/serveur/ia-pedagogie.server.ts",
    ]);
  });

  it("l'API d'Anthropic n'est appelée que par l'adaptateur IA", () => {
    expect(liste((f) => /api\.anthropic\.com/.test(f.code))).toEqual([
      "src/lib/serveur/ia.server.ts",
    ]);
  });

  it("la clé d'API IA n'est lue que par l'adaptateur IA (les réglages n'en indiquent que la présence)", () => {
    // Le nom de la variable n'apparaît que dans l'adaptateur, dans la liste des noms de `config.server.ts` et dans
    // l'indicateur « défini / non défini » des réglages.
    expect(liste((f) => /["']ANTHROPIC_API_KEY["']/.test(f.code))).toEqual([
      "src/lib/reglages.functions.ts",
      "src/lib/serveur/config.server.ts",
      "src/lib/serveur/ia.server.ts",
    ]);
    const reglages = sources.find((f) => f.chemin === "src/lib/reglages.functions.ts")!;
    expect(reglages.code).toMatch(/variable\("ANTHROPIC_API_KEY"\) !== undefined/);
    expect(reglages.code).not.toMatch(/\.rediger\(|assistantPourOrganisme|ia\.server/);
    // La clé chiffrée d'un organisme (`ia_cle`) n'est déchiffrée que par l'adaptateur.
    expect(liste((f) => /\.dechiffrer\(/.test(f.code) && /ia_cle/.test(f.code))).toEqual([
      "src/lib/serveur/ia.server.ts",
    ]);
  });

  it("aucun service de pièces, de pipeline, de dossier, de signature ou de BPF n'appelle l'IA", () => {
    const exacts = sources.filter((f) => EXACTS.test(f.chemin));
    expect(exacts.length).toBeGreaterThan(15);
    for (const f of exacts)
      expect(f.code, f.chemin).not.toMatch(
        /ia-pedagogie|ia\.server|pedagogie-ia\.functions|pedagogie\/propositions|api\.anthropic|\.rediger\(/i,
      );
  });

  it("la production de supports et l'export du coffre ne contiennent aucun appel à l'IA", () => {
    for (const nom of [
      "src/lib/serveur/supports.server.ts",
      "src/lib/serveur/support-pptx.server.ts",
      "src/lib/serveur/coffre-zip.server.ts",
      "src/lib/supports.functions.ts",
      "src/lib/coffre-zip.functions.ts",
    ]) {
      const f = sources.find((s) => s.chemin === nom)!;
      expect(f, nom).toBeDefined();
      expect(f.code, nom).not.toMatch(/ia-pedagogie|ia\.server|propositions|anthropic|rediger/i);
    }
  });
});
