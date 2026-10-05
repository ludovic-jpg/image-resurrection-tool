# Guide de reprise de s4mfinal dans Lovable

Ce guide se suit dans l'ordre. Compte une demi-journée pour les étapes 1 à 6, puis un lot de prompts par session.

## 0. Ce que contient le kit (branche `lovable-kit`)

| Fichier | Rôle |
|---|---|
| `lovable/KNOWLEDGE.md` | Texte à coller dans *Project Knowledge* de Lovable : règles du projet |
| `lovable/PROMPTS_PAR_LOTS.md` | Les prompts à donner à Lovable, lot 0 à lot 9, avec la recette de chaque lot |
| `lovable/CARTE_DES_ROUTES.md` | Les 116 routes de l'ancienne API et ce que chacune devient (client + RLS, fonction SQL, Edge Function) |
| `lovable/MODELE_DE_DONNEES.md` | Les tables, qui lit et qui écrit, les choix faits par rapport à la version Node |
| `supabase/migrations/20261005000000_s4m_initial.sql` | La base pour Supabase : tables, RLS, fonctions d'aide, buckets |
| `supabase/migrations/20261005000100_s4m_rpc.sql` | Fonctions SQL appelées par l'interface, triggers de versions et de journal, vues sans secret |
| `supabase/admin_production.sql` | Gabarit pour créer l'organisme réel et son premier admin en production |
| `supabase/seed_demo.sql` | Données et comptes de démonstration (**projet de test seulement**) |
| `supabase/tests/rls_test.mjs` | 185 vérifications des droits, rejouables (`node supabase/tests/rls_test.mjs`) |
| `supabase/functions/_shared/` | Noyau métier et gabarits déjà copiés au format Deno, prêts pour les Edge Functions |
| `scripts/preparer-edge-functions.mjs` | Régénère `_shared/` après toute modification du noyau ou des gabarits |

## 1. Avant tout : sécurité

1. Révoque la clé Anthropic qui a circulé dans un Word (console Anthropic → API Keys). Crée-en une neuve, que tu
   déclareras seulement dans Supabase (étape 5).
2. Le fichier `.env.example` versionné contient le mot de passe du compte pilote. Ne le réutilise nulle part.

## 2. Créer le projet Supabase

1. <https://supabase.com> → *New project*. Région **Europe (Frankfurt ou Paris)** pour le RGPD. Note le mot de passe de la base.
2. *Authentication → Sign In / Providers → Email* : laisse l'e-mail activé et règle *Minimum password length* sur
   **10** (règle de l'application). Les libellés du tableau de bord Supabase évoluent : cherche « password length ».
3. *SQL Editor* → colle tout `supabase/migrations/20261005000000_s4m_initial.sql` → *Run*, puis de même
   `supabase/migrations/20261005000100_s4m_rpc.sql` (**dans cet ordre**). Chaque script doit se terminer sans erreur. S'il bloque sur un objet déjà existant, tu n'es pas sur un projet vierge : recommence sur un projet neuf.
4. Toujours dans *SQL Editor*, colle `supabase/seed_demo.sql` → *Run*. Cela crée l'organisme de démonstration et les
   cinq comptes (mot de passe `demonstration-s4m`).

## 3. Créer le projet Lovable et y faire entrer le code

Lovable fonctionne avec **son propre** dépôt GitHub, qu'il synchronise dans les deux sens. Il faut donc verser le code
de s4mfinal dans le dépôt créé par Lovable. Méthode sûre :

1. Dans Lovable : *New project* (n'importe quel premier prompt, par exemple « Projet vide »).
2. *Settings → GitHub → Connect* : Lovable crée un dépôt (par exemple `ludovic-jpg/s4m-lovable`). Note son nom.
3. Verser le code : donne-moi le nom de ce dépôt et je remplace son contenu par celui de la branche `lovable-kit`
   (historique conservé dans s4mfinal). Si tu préfères le faire seul :
   ```bash
   git clone https://github.com/ludovic-jpg/s4mfinal && cd s4mfinal && git checkout lovable-kit
   git push --force https://github.com/ludovic-jpg/<depot-lovable>.git lovable-kit:main
   ```
4. Revenir dans Lovable : il récupère le nouveau code en quelques secondes.

Si Lovable propose entre-temps un bouton d'import direct d'un dépôt, tu peux l'utiliser avec la branche `lovable-kit` :
le résultat est le même.

## 4. Brancher Supabase dans Lovable

*Integrations → Supabase → Connect* et choisis le projet de l'étape 2. Ne demande pas à Lovable de créer des tables : les
migrations sont déjà passées.

## 5. Déclarer les secrets (Supabase → Edge Functions → Secrets)

| Secret | Valeur |
|---|---|
| `IA_WORKSPACE_ID` | seulement si ta clé Anthropic n'est rattachée à aucun workspace (identifiant `wrkspc_…`) |
| `APP_URL` | l'adresse de l'application Lovable (aperçu d'abord, domaine final ensuite) |
| `CLE_SECRETS` | 64 caractères hexadécimaux (générer : `openssl rand -hex 32`) ; à conserver précieusement |
| `ANTHROPIC_API_KEY` | ta nouvelle clé (étape 1) |
| `IA_MODELE` | modèle par défaut (vérifier le nom exact sur docs.claude.com le jour même) |
| `IA_RECHERCHE_WEB` | `oui` |
| `RESEND_API_KEY`, `COURRIER_EXPEDITEUR` | quand tu voudras que les e-mails partent vraiment ; vide = rien ne part, tout est journalisé |
| `PDF_SERVICE_URL`, `PDF_API_KEY` | facultatif (service Gotenberg) ; vide = pièces en HTML imprimable |
| `CRON_SECRET` | une chaîne aléatoire, pour la tâche quotidienne (lot 8) |

La liste complète et la correspondance avec l'ancien `.env` sont dans `CARTE_DES_ROUTES.md`, section 4.

## 6. Préparer Lovable

1. *Project settings → Knowledge* : colle `lovable/KNOWLEDGE.md`.
2. Ouvre `lovable/PROMPTS_PAR_LOTS.md` et donne le **lot 0**. Teste, puis lot 1, et ainsi de suite.

## 7. Règles de conduite pendant les lots

- Un lot à la fois ; on ne passe au suivant qu'après la recette du lot.
- Si Lovable propose de « créer une table » ou de « simplifier la sécurité », refuse : renvoie-le à `KNOWLEDGE.md`.
- Toute modification de `src/domaine` ou de `gabarits/` : relancer `node scripts/preparer-edge-functions.mjs` (ou le
  demander à Lovable), sinon les Edge Functions travaillent sur une ancienne copie des règles.
- Toute nouvelle table ou colonne : nouvelle migration dans `supabase/migrations/`, avec sa RLS.

## 8. Mise en ligne

Projet Supabase de production distinct de celui de test : les deux migrations seules (**pas** de `seed_demo.sql`). Le
premier admin se crée avec `supabase/admin_production.sql` (remplacer les valeurs entre chevrons) : le rôle admin doit
être posé **au moment de la création** du compte. N'utilise pas le bouton *Add user* du tableau de bord : sans ce rôle,
le compte serait créé comme simple formateur candidat.
*Authentication → URL configuration* : URL du site = domaine final. Puis les points bloquants de `docs/SUITE_ET_TODO.md`
(H-11, H-12, H-13) doivent être tranchés avant d'accueillir de vrais apprenants.

## Ce qui reste à décider ou à vérifier

- Les droits ont été prouvés sur une base PostgreSQL de test qui imite Supabase (185 vérifications). Une seule chose
  ne peut se prouver que sur le vrai Supabase : que les Edge Functions en mode service soient bien reconnues comme
  telles par la fonction `s4m_est_service()`. Premier test du lot 3 : une écriture de journal par une Edge Function
  doit réussir, la même depuis le navigateur doit échouer.

- Le portage des Edge Functions (lots 3 à 8) est du travail réel : la carte et le noyau le cadrent, mais chaque lot
  doit être testé. Estimation : 8 à 12 sessions Lovable.
- Le rendu des gabarits dans Deno doit produire **exactement** le même HTML que la version Node, sinon les empreintes
  des pièces déjà signées ne se vérifient plus. Sans dossier réel signé à reprendre, le risque est nul.
- Reprise des données de l'ancienne base locale : non incluse (à faire sur export, si tu en as besoin).
