# Skills4mation (S4M) — Connaissance du projet pour Lovable

> À coller dans **Project settings → Knowledge** du projet Lovable. Ces règles priment sur toute demande ponctuelle.

## Ce qu'est l'application
Plateforme de **portage de formateurs indépendants** sous la certification Qualiopi d'un organisme de formation (OF).
Elle gère tout le cycle d'un dossier de formation : candidature du formateur → catalogue de formations → positionnement
de l'apprenant → dossier → pipeline de financement → pièces générées, signées, archivées → paiement → archivage → BPF.
Multi-organismes : l'identité de l'OF est une configuration, jamais une constante. Langue : **français uniquement**.

## Rôles (trois, pas un de plus)
- **admin** : l'OF. Voit et pilote tout son organisme, valide les candidatures et les dossiers.
- **formateur** : ne voit que SES formations, stagiaires, dossiers, coffre. Doit avoir une candidature validée pour créer.
- **apprenant** : ne voit que l'espace « Communication Apprenant » de ses dossiers et ses pièces individuelles. Jamais
  l'ODM (04-AVT), les factures, les finances, le journal, ni les données bancaires. Il lit les vues
  `dossier_formation_apprenant`, `formateur_public` et `organisme_public`, jamais les tables complètes.
  Le formateur lit aussi `organisme_public` ; la table `organisme_formation` complète est réservée à l'admin.
Un utilisateur introuvable par cloisonnement reçoit « introuvable », jamais « interdit ».

## Architecture (ne pas en dévier)
- Interface : React 19 + Vite + Tailwind v4 + TanStack Router + TanStack Query. **Les écrans de `src/client/ecrans` sont
  conservés** ; ils parlent au serveur uniquement via `src/client/api.ts` (`api.get/post/patch/put/suppr/fichier(chemin)`).
- Serveur : **Supabase** (Auth, Postgres + RLS, Storage, Edge Functions Deno). Plus de serveur Node, plus de Hono, plus
  de Drizzle, plus de PGlite. Le dossier `src/serveur` reste dans le dépôt **comme référence et source des types** : ne pas
  le supprimer, ne pas l'exécuter.
- Le schéma de référence est dans `supabase/migrations/` (`…000000_s4m_initial.sql` puis `…000100_s4m_rpc.sql`). **Ne jamais créer, renommer ni
  supprimer une table ou une colonne sans nouvelle migration** ; ne jamais lire une table qui n'existe pas dans ce fichier.
- La correspondance route par route est dans `lovable/CARTE_DES_ROUTES.md` ; le modèle de données dans
  `lovable/MODELE_DE_DONNEES.md`. Les consulter avant chaque tâche.

## Le noyau métier est sacré
`src/domaine` contient toutes les règles du cahier des charges (variables, pièces, pipeline, signature, BPF). Il est
**pur** : aucun import de React, Supabase, réseau ou `node:`. Ne jamais y ajouter de dépendance technique, ne jamais
réécrire une règle ailleurs. Les Edge Functions en utilisent une copie générée dans `supabase/functions/_shared/domaine`
(script `node scripts/preparer-edge-functions.mjs`, à relancer après toute modification du noyau ou de `gabarits/`).

## Règles qui ne se négocient pas
1. **Pipeline** : un sous-statut ne change JAMAIS par un `update` côté client. Tout passe par l'Edge Function
   `pipeline-transiter`, qui appelle `transiter()` du noyau (rôle, étape, garde, motif) puis exécute les effets.
   Sept étapes A→G, treize sous-statuts (`src/domaine/pipeline/statuts.ts`). « Refus de financement » et « archivé » sont
   terminaux : dossier en lecture seule.
2. **Une seule ligne de vérité par pièce** (`piece_dossier`) : aucun écran ne recopie un statut de pièce.
3. **Signature** : horodatage, IP et empreinte SHA-256 calculés **côté serveur** (Edge `signature-signer`). Le HTML
   archivé est la référence scellée. Ne jamais modifier le rendu d'un gabarit sans mesurer l'effet sur les empreintes.
4. **Écritures sensibles = Edge Function avec service_role** : pipeline, génération de pièces, signature, émargement,
   factures, compteurs, journal `evenement`, `version_objet`, courriers, IA, routes publiques par jeton. La clé
   `service_role` n'apparaît JAMAIS dans le code du navigateur.
5. **RLS activée sur toutes les tables.** Toute nouvelle table : RLS + politiques basées sur `s4m_of_id()`,
   `s4m_role()`, `s4m_formateur_id()`, `s4m_est_admin()` dans la même migration.
6. Montants en **centimes entiers** ; dates en texte ISO `AAAA-MM-JJ` ; horodatages `timestamptz`.
7. Colonnes = **noms des variables harmonisées Qualiopi** (`of_siret`, `formation_titre`…) : ne pas les renommer.
8. Fichiers : Storage, buckets privés `archive`, `coffre`, `supports`, chemins `<of_id>/...`. Téléversement direct du
   navigateur vers un préfixe temporaire, puis déplacement par l'Edge Function concernée.
9. Une action n'est proposée à l'écran que si le serveur l'autorise (`actions`, `bloqueePar`, `peut_signer`,
   `peut_deposer`) : l'interface ne devine rien.
10. Erreurs : message lisible en français pour l'utilisateur, détail technique dans les journaux uniquement. Format de
    réponse d'erreur des Edge Functions : `{ erreur, code, details }` avec 400/401/403/404/409.

## Pièces (nomenclature)
Codes `00-AVT` à `12-APR`, plus `PRE` (positionnement), `PRG` (programme), `ACC` (accord), `REF` (refus). Définitions
et qui signe / qui dépose : `src/domaine/referentiel/pieces.ts`. Gabarits HTML : `gabarits/` (balises `{{variable}}`).

## IA
Uniquement dans l'espace pédagogique (enjeux, parcours, QCM, programme, plan de support), via l'Edge `ia-assistant`.
**Jamais** pour les conventions ni les pièces. Clé Anthropic dans les secrets Supabase ou chiffrée par organisme.
Toute proposition IA est validée par le formateur avant enregistrement.

## Design
Conserver `src/client/styles.css` (tokens `--color-*`, Inter + Poppins, accent vert profond). Ne pas installer shadcn par
défaut ni changer de palette. Interface sobre, lisible, mobile correct.

## Tests et comptes de démonstration
Projet de test uniquement : `supabase/seed_demo.sql`. Mot de passe commun `demonstration-s4m` :
admin@demo.example · formatrice@demo.example · formateur2@demo.example · apprenante@demo.example · candidat@demo.example.
Après chaque changement touchant les droits, tester le parcours croisé admin ↔ formateur ↔ apprenant.
