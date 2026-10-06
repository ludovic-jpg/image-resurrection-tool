import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      ".wrangler",
      // Code de référence importé de s4mfinal : conservé tel quel, jamais exécuté.
      "docs/reference-implementation/**",
      // Fichiers générés par Lovable / outillage : ne pas les reformater.
      "src/routeTree.gen.ts",
      "src/integrations/**",
      "src/components/ui/**",
      "supabase/functions/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
  {
    // Lovable n'exécute pas Prettier : la mise en forme reste signalée (avertissement) sans faire échouer la CI.
    // `npm run format` remet tout d'aplomb. Les vraies erreurs (hooks, imports…) restent bloquantes.
    rules: { "prettier/prettier": "warn" },
  },
);
