# Skills4mation (S4M) : dossiers de formation

Application de suivi des dossiers de formation (portage Qualiopi) : de la candidature du formateur à l'archivage du dossier, avec trois rôles (admin de l'organisme, formateur, apprenant).

**Application en ligne** : https://image-resurrection-tool.lovable.app

Construite avec [Lovable](https://lovable.dev) (TanStack Start, React, Tailwind) et Lovable Cloud (Supabase) pour l'authentification et les données.

## État du projet

Reprise par lots, suivie dans [`roadmap.md`](roadmap.md). Aujourd'hui : accueil, connexion, inscription, invitation, réinitialisation du mot de passe et premier espace protégé. Les écrans et le noyau métier d'origine sont conservés dans [`docs/reference-implementation`](docs/reference-implementation) comme référence de la reprise ; ils ne sont pas compilés.

## Lancer en local

Le dépôt utilise [Bun](https://bun.sh) (`bun.lock`).

```sh
bun install
bun run dev        # serveur de développement
bun run lint       # ESLint + Prettier
bun run test       # tests Vitest
bun run build      # build de production
npx tsc --noEmit   # contrôle des types
```

Le fichier `.env` ne contient que l'URL et la clé **publique** (publishable) du projet : aucune clé secrète ne doit y entrer.

## Base de données

- `supabase/migrations/` : schéma, droits d'accès (RLS) et fonctions, à appliquer dans l'ordre.
- `supabase/seed_demo.sql` : données de démonstration, **réservé à un projet de test** (comptes à mot de passe connu).
- `supabase/admin_production.sql` : gabarit de création de l'organisme et du premier administrateur en production.
- `supabase/tests/rls_test.mjs` : test d'isolation des droits.

## Documentation

Cadrage, architecture, recette et guides dans [`docs/`](docs/) et [`lovable/`](lovable/).
