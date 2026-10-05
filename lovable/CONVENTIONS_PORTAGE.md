# Conventions de portage des lots 2 à 8

Ce fichier s'applique à tout lot porté depuis `s4mfinal`. Il complète `lovable/KNOWLEDGE.md`, `lovable/CARTE_DES_ROUTES.md` (qui dit, route par route, la cible : Client + RLS, RPC SQL ou fonction serveur) et `lovable/PROMPTS_PAR_LOTS.md`.

## 1. Où mettre quoi

| Cible dans la carte | Où le code va | Comment |
|---|---|---|
| Client + RLS, RPC SQL | `src/client/passerelle/lot-N-<nom>.ts` | `route("GET", "/chemin/:id", gestionnaire)` avec `import { route } from "../registre"` et le client `bd` de `../bd` |
| « Edge Function » | `src/lib/<nom>.functions.ts` (fonction serveur TanStack) + un gestionnaire dans le module du lot qui l'appelle | voir §2 |
| Règle métier pure (calcul, validation, texte) | `src/domaine/<sujet>/` | aucun import de React, Supabase, réseau ou `node:` ; un test à côté |
| Code serveur partagé (acteur, journal, courrier, hachage, archive) | `src/lib/serveur/*.server.ts` | importé seulement par des `*.functions.ts`, jamais par le client |

Chaque lot ajoute UNE ligne d'import dans `src/client/passerelle/index.ts` et ne modifie pas les fichiers des autres lots. Les écrans (`src/client/ecrans`) ne se réécrivent pas : on adapte l'intérieur du gestionnaire pour renvoyer exactement la forme que renvoyait le service de `src/serveur/services/` (les types de `src/client/api.ts` font foi, `npx tsc --noEmit` le vérifie).

## 2. Fonctions serveur TanStack (équivalent des Edge Functions)

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const maFonction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])          // omis pour les routes publiques par jeton
  .validator(z.object({ /* … */ }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server"); // JAMAIS en tête de fichier
    /* … */
  });
```

- Le client « service » (`supabaseAdmin`) contourne la RLS : on l'utilise seulement pour les écritures sensibles listées dans `KNOWLEDGE.md` (pipeline, pièces, signature, émargement, factures, compteurs, journal, versions, courriers, IA, routes publiques par jeton).
- **L'acteur ne vient jamais du corps de la requête.** Il se reconstruit depuis le jeton de session (voir `src/lib/serveur/acteur.server.ts`, créé au lot 3), exactement comme `s4m_moi()`.
- Runtime : Cloudflare Workers. Pas de `node:fs`, pas de Buffer sans polyfill, pas de Chromium. Hachage par `crypto.subtle`.
- Une erreur métier se renvoie en résultat typé (`{ ok: false, code, message }`), que le gestionnaire du lot convertit en `ErreurApi(message, statut, code, details)`. Messages en français lisible ; détail technique dans les journaux seulement.
- « Introuvable » plutôt que « interdit » pour tout objet cloisonné.

## 3. Types de base

`src/integrations/supabase/types.ts` est généré à partir de la base connectée : tant que les migrations de `supabase/migrations/` ne sont pas appliquées, il est vide. Les requêtes passent donc par `bd` (client non typé) et les formes de réponse se calent sur `src/client/api.ts`. N'édite jamais `types.ts`, `client.ts`, `client.server.ts`, `auth-middleware.ts` ni `routeTree.gen.ts` à la main.

## 4. Tests obligatoires

- Chaque règle pure : un test dans `src/domaine/...` (`// @vitest-environment node` si besoin du système de fichiers).
- Chaque gestionnaire : un test dans `src/client/passerelle/lot-N-<nom>.test.ts` qui simule `../bd` et les fonctions serveur (voir `src/client/aiguilleur.test.ts`) et vérifie : la forme de la réponse, le refus du mauvais rôle, aucun champ sensible renvoyé à l'apprenant, l'absence de tout `update` direct d'un sous-statut côté client.
- Les tests de comportement de `s4mfinal` (`tests/integration/*.test.ts`) servent de modèle de ce qu'il faut vérifier. Ils ne se rejouent pas tels quels : ils parlent à Hono et PGlite.

## 5. Vérification avant de déclarer un lot terminé

```bash
npx tsc --noEmit            # 0 erreur
npx vitest run              # tout vert
npx eslint src/client src/domaine src/lib src/routes   # 0 erreur
npx vite build              # build OK
```

Un lot n'est « terminé » que si ces quatre commandes passent et que le compte rendu dit, route par route de la carte, ce qui est porté, ce qui ne l'est pas et pourquoi.

## 6. Git

Une branche par lot, nommée `reprise/lot-N-<nom>`, créée depuis la branche de base indiquée. Jamais de force push, jamais de modification de l'historique publié, jamais de commit sur `main`. Message de commit en français, avec les deux lignes finales d'attribution de la session.
