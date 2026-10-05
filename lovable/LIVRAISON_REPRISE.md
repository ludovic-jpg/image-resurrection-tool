# Livraison de la reprise (lots 0 à 8) — état et recette

Branche : `reprise/integration` (lots 0 à 8 fusionnés). Quatre contrôles verts : `tsc` 0 erreur, 1185 tests, eslint 0 erreur, build OK.

## Ce qui est vérifié, et ce qui ne l'est pas

Tout a été vérifié **avec des simulations** (faux client Supabase, PGlite, mémoire). **Rien n'a été exécuté contre la vraie base Lovable Cloud** : RLS, RPC `s4m_*`, triggers, Storage, `pg_cron`, Resend et Anthropic restent à tester.

## À faire avant la première recette

1. Appliquer les migrations de `supabase/migrations/` à Lovable Cloud (dont `20261006000800_lot8_rgpd.sql` et `20261006000801_lot8_tache_quotidienne.sql`), puis régénérer `src/integrations/supabase/types.ts`.
2. Définir les secrets : `CLE_SECRETS`, `RESEND_API_KEY`, `COURRIER_EXPEDITEUR`, `APP_URL`, `ANTHROPIC_API_KEY`, `IA_MODELE`, `IA_WORKSPACE_ID`, `IA_RECHERCHE_WEB`, `CRON_SECRET`, `PDF_SERVICE_URL` (optionnel). Secrets Vault : `s4m_cron_secret`, `s4m_app_url`.
3. Décisions juridiques ouvertes : H-11, H-12, H-13 (bloquantes pour la production, cf. `docs/HYPOTHESES.md`).
4. Changer ou retirer le mot de passe pilote affiché dans le README de `s4mfinal`.

## Points connus à traiter (non faits)

- Raccords entre lots non branchés : ports de `ports-lots` (lot 4) en stubs ; `reagirAuPipeline` (lot 5) ne fait que journaliser ; `reprendrePositionnements` (lot 6) et les envois de formulaires planifiés (lot 5) ne sont appelés par rien.
- Liens de téléchargement `<a href>` des écrans (pièces, supports, exports) qui contournent l'aiguilleur : seuls ZIP, BPF et sauvegarde ont un écouteur de clic.
- Trou en base : un candidat peut passer lui-même de brouillon à soumise (migration à écrire).
- `numeroSuivant` non atomique (RPC ou migration nécessaire).
- Lien présent dans `courrier.corps_html` à relire (fuite possible).
- `sauvegarde.server.ts` importe `@/client/passerelle/lot-2-schemas` : à déplacer hors du client.
- « PDF » = HTML imprimable (pas de Chromium sur Workers), sauf si `PDF_SERVICE_URL` (Gotenberg) est défini.
- Vocabulaire SMTP de l'écran e-mail remplacé par Resend.
- `@ts-ignore` sur des routes absentes de `routeTree.gen.ts` (fichier généré).

## Règle de registre

Si une route est enregistrée par deux lots, le dernier import de `src/client/passerelle/index.ts` l'emporte.
