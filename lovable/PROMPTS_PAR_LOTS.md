# Prompts Lovable, lot par lot

**Mode d'emploi.** Un prompt à la fois, dans l'ordre. Après chaque prompt : tester le parcours indiqué (« Recette du lot »)
avec les comptes de démonstration, noter l'écart, le faire corriger **avant** d'enchaîner. Ne jamais coller deux lots
d'un coup : Lovable mélange alors les responsabilités et casse ce qui marchait.

Principe directeur, répété dans chaque prompt : **on ne réécrit pas les écrans**. Les 19 fichiers d'écrans de `src/client/ecrans`
appellent le serveur par un seul point, `src/client/api.ts`. On remplace l'intérieur de ce point par un aiguilleur vers
Supabase, route par route, en suivant `lovable/CARTE_DES_ROUTES.md`.

Comptes (mot de passe `demonstration-s4m`) : `admin@` · `formatrice@` · `formateur2@` · `apprenante@` · `candidat@` (`@demo.example`).

---

## Lot 0 — Mise en place (sans fonctionnalité nouvelle)

```
Contexte : ce projet vient d'un dépôt GitHub existant (Skills4mation). Lis lovable/KNOWLEDGE.md, lovable/MODELE_DE_DONNEES.md
et lovable/CARTE_DES_ROUTES.md avant toute modification.

Objectif du lot 0 : que l'interface démarre dans l'aperçu Lovable, branchée sur Supabase, sans encore porter de route.

1. Le serveur Node (src/serveur, Hono, Drizzle, PGlite) n'est plus exécuté. Ne le supprime pas : il sert de référence et
   de source des types importés par src/client/api.ts.
2. package.json : le script "dev" lance uniquement Vite (renomme l'ancien en "dev:local"). Retire de vite.config.ts le
   proxy /api. Adapte le port et l'hôte du serveur de dev à ce dont l'aperçu Lovable a besoin, sans toucher au reste.
3. Crée src/client/supabase.ts : client Supabase unique (URL et clé anon publiques du projet connecté). Aucune clé
   service_role dans le front.
4. Vérifie que les deux migrations de supabase/migrations/ sont appliquées au projet Supabase connecté
   (sinon applique-les telles quelles, dans l'ordre, sans les modifier). Ne crée aucune table toi-même.
5. Dans src/client/api.ts, garde l'objet `api`, `ErreurApi` et toutes les fonctions de format, mais remplace la fonction
   interne `appel()` par un aiguilleur : une table { "METHODE /chemin/:param" → gestionnaire }. Pour l'instant aucune
   entrée : toute route non portée lève ErreurApi("Cette fonction arrive dans un prochain lot.", 501, "non_porte", null).
   Les écrans ne changent pas.

Critères d'acceptation : l'aperçu affiche l'écran de connexion sans erreur de compilation ; aucun appel réseau vers /api ;
npm run typecheck passe.
```

**Recette du lot** : l'aperçu s'ouvre sur `/connexion`. La console ne montre aucune erreur rouge au chargement.

---

## Lot 1 — Authentification, session, profil

```
Lis lovable/KNOWLEDGE.md et la section 1.1 (routes 1 à 9) de lovable/CARTE_DES_ROUTES.md.

Objectif : se connecter avec Supabase Auth et retrouver l'acteur (rôle, organisme) exactement comme avant.

1. Porte dans l'aiguilleur de src/client/api.ts les routes d'authentification : connexion et déconnexion par
   supabase.auth (signInWithPassword / signOut), « moi » par la fonction SQL s4m_moi(), changement de mot de passe par
   supabase.auth.updateUser. Respecte la forme de réponse attendue par src/client/session.ts (type Moi).
2. Inscription et invitation : le compte naît par supabase.auth.signUp ; pour une invitation, le jeton est passé dans
   options.data.invitation. C'est le trigger SQL sur auth.users qui crée le profil (utilisateur, formateur ou lien
   apprenant) : ne le duplique jamais, ne crée jamais de profil à la main. L'Edge Function auth-compte ne sert qu'à ce
   que la carte lui attribue (routes 1, 5, 6). Mot de passe ≥ 10 caractères.
3. Une réponse 401 renvoie vers /connexion?retour=… comme aujourd'hui.
4. Règle 3bis (multi-rôles) : en développement uniquement (import.meta.env.DEV), ajoute dans l'en-tête un petit
   sélecteur « Changer de compte de démo » qui déconnecte puis connecte l'un des 5 comptes de démonstration.
   Il ne doit jamais apparaître en production.

Critères d'acceptation : chacun des 5 comptes de démo se connecte et voit le menu de son rôle ; un mauvais mot de passe
donne un message en français ; la déconnexion ramène à /connexion.
```

**Recette** : connecte-toi successivement avec les 5 comptes via le sélecteur. Le candidat ne doit voir que « Ma candidature ».

---

## Lot 2 — Lectures et saisies simples (Client + RLS)

```
Lis lovable/KNOWLEDGE.md et lovable/CARTE_DES_ROUTES.md (toutes les lignes dont la cible est « Client + RLS » ou
« RPC SQL » dans les sections 1.3, 1.5, 1.7, 1.8, 1.10).

Objectif : porter dans l'aiguilleur de src/client/api.ts les routes Client + RLS et RPC SQL de ces sections :
référentiel, organisme (lecture et mise à jour par l'admin), formations (liste, fiche, création, modification,
versions, duplication par s4m_dupliquer_formation), outils, coffres de parcours (lecture), répertoire (entreprises,
stagiaires).

Règles : requêtes supabase-js directes ; c'est la RLS qui cloisonne, ne filtre pas « à la main » à la place.
Chaque gestionnaire renvoie exactement la forme que renvoyait le service de src/serveur indiqué dans la carte (les types
de api.ts te le disent). Les téléversements passent par Storage (bucket et chemin <of_id>/... indiqués dans la carte).
Aucun écran ne doit être réécrit ; si un écran attend un champ calculé, calcule-le dans le gestionnaire en réutilisant
le noyau src/domaine.

Critères d'acceptation : la formatrice voit ses 2 formations, le formateur2 ne voit que la sienne ; l'admin voit les 3
et peut modifier l'organisme ; créer puis modifier une formation crée une version consultable.
```

**Recette** : formatrice ↔ formateur2 ↔ admin sur Formations et Répertoire. Aucune donnée d'un formateur chez l'autre.

---

## Lot 3 — Socle des Edge Functions, candidatures, réglages, e-mails

```
Lis la section 2 (Edge Functions, partie « Toutes partagent _shared ») et la section 3 de lovable/CARTE_DES_ROUTES.md.

1. Le dossier supabase/functions/_shared/domaine et le fichier _shared/gabarits.generes.ts existent déjà : ils sont
   GÉNÉRÉS par node scripts/preparer-edge-functions.mjs. Ne les modifie pas à la main.
2. Crée dans supabase/functions/_shared : acteur.ts (JWT → acteur reconstruit depuis la base, jamais depuis le corps
   de la requête), bd.ts (client service_role), erreurs.ts (format { erreur, code, details }), journal.ts,
   hacheur.ts (SHA-256 par crypto.subtle), archive.ts (port Archive sur Storage), courrier.ts (port Courrier sur l'API
   Resend ; sans RESEND_API_KEY, rien ne part mais tout est enregistré dans la table courrier, comme le mode
   « boîte locale » d'avant). Recopie la logique depuis src/serveur/services/socle.ts, ports/archive.ts, ports/courrier.ts
   et services/courriels.ts (16 modèles d'e-mail).
3. Crée les Edge Functions candidatures, reglages (secrets chiffrés AES-GCM avec CLE_SECRETS, même format « v1: »)
   et courriels-envoyer. Branche-les dans l'aiguilleur.

Critères d'acceptation : le candidat (dont la candidature de démo est en brouillon complet) la soumet ; l'admin la voit, la valide ; un courrier apparaît dans
« Boîte d'envoi » ; un formateur ne peut pas appeler « decider » (réponse 403 propre).
```

**Recette** : candidat → soumet ; admin → valide ; candidat → peut maintenant créer une formation.

---

## Lot 4 — Dossiers et pipeline

```
Lis la section 1.13 et les fiches « dossiers » et « pipeline-transiter » de lovable/CARTE_DES_ROUTES.md, puis
docs/ARCHITECTURE.md (D3, tableau des transitions).

1. Porte les lectures de dossiers (s4m_lister_dossiers, lecture d'un dossier). lireDossier renvoie aussi `actions`
   (avec bloqueePar) et, par pièce, peut_signer / peut_deposer : calcule-les avec le noyau (transitions.ts,
   pieces/statut.ts), comme le faisait src/serveur/services/dossiers.ts.
2. Crée l'Edge Function dossiers (créer, ajouter des stagiaires, inviter, relancer, recréer).
3. Crée l'Edge Function pipeline-transiter : elle reconstruit l'acteur, appelle transiter() du noyau, et seulement si
   le noyau l'autorise, écrit le nouveau sous-statut et exécute les effets (génération des pièces de départ,
   e-mail à l'entreprise, ODM, ouverture du coffre…), en reprenant src/serveur/services/pipeline.ts.
   Aucun update de sous-statut ailleurs.

Critères d'acceptation : la formatrice crée un dossier, demande sa validation ; l'admin le renvoie avec motif puis le
valide ; les pièces de départ apparaissent ; un formateur ne peut pas valider son propre dossier ; l'apprenante voit
le dossier sans ODM ni facture.
```

**Recette** : le parcours croisé complet formatrice → admin → formatrice → apprenante. C'est le cœur : ne pas passer au lot 5 tant qu'il n'est pas impeccable.

---

## Lot 5 — Pièces, signature, émargement, formulaires apprenant

```
Lis les sections 1.14 et 1.2 (routes /public/formulaire) et les fiches pieces-generer, pieces-retourner,
signature-signer, formulaires-envoyer, public-formulaire de lovable/CARTE_DES_ROUTES.md.

Crée ces cinq Edge Functions en portant src/serveur/services/generation.ts, retours.ts, evaluations.ts,
formulaires-apprenant.ts. Les gabarits viennent de _shared/gabarits.generes.ts.
PDF : le HTML archivé reste la référence scellée. Si PDF_SERVICE_URL est défini, convertir aussi en PDF (Gotenberg) ;
sinon garder le HTML imprimable (repli actuel). Pas de Chromium dans les Edge Functions.
La signature calcule horodatage, IP et SHA-256 côté serveur et scelle l'empreinte du fichier archivé.

Critères d'acceptation : l'apprenante signe une pièce depuis son espace ; « vérifier l'intégrité » répond « intacte » ;
un fichier déposé par la formatrice passe la pièce en « Validé » ; l'émargement d'une séance est enregistré.
```

---

## Lot 6 — Positionnement avant dossier

```
Fiches positionnements et public-positionnement de la carte (sections 1.11 et 1.2). Porte
src/serveur/services/positionnements.ts. La page publique /positionnement/$jeton fonctionne sans compte (verify_jwt =
false), jeton haché, IP consignée. Critères : la formatrice invite, le lien ouvert en navigation privée permet de
répondre et signer ; la formatrice voit le résultat ; la reprise dans un dossier ne se fait que si le test est identique.
```

---

## Lot 7 — Espace pédagogique : IA et supports

```
Fiches ia-assistant et supports-produire, section 1.9. Porte src/serveur/services/pedagogie-ia.ts, ports/ia.ts et
supports.ts. Modèle par défaut via le secret IA_MODELE (vérifier le nom du modèle sur docs.claude.com le jour même).
Toute proposition est montrée au formateur, jamais enregistrée sans son accord. « Produire tous les supports » boucle
module par module depuis le front (une Edge Function par module, pour respecter la durée maximale).
Porte aussi l'Edge Function coffre (route 53, téléchargement du coffre d'une formation en ZIP) et les routes 52 et 54
(documents imprimables : programme et outils), selon la carte.
PPTX : essayer npm:pptxgenjs dans l'Edge Function ; s'il échoue, générer le PPTX dans le navigateur puis le déposer
dans le bucket supports. Critère : un parcours proposé, accepté, puis un support PPTX téléchargeable.
```

---

## Lot 8 — BPF, sauvegarde, RGPD, archives, tâche quotidienne

```
Fiches bpf, sauvegarde-rgpd, taches-quotidiennes ; sections 1.12, 1.15. La tâche quotidienne est planifiée par pg_cron
+ pg_net à 03:00 Europe/Paris, protégée par l'en-tête x-cron-secret (secret CRON_SECRET). La suppression de compte
exige la phrase exacte et le mot de passe. Critère : export BPF CSV conforme à celui d'avant sur les données de démo ;
suppression d'un compte de test sans laisser de donnée personnelle.
```

---

## Lot 9 — Recette finale et mise en ligne

```
Rejoue docs/RECETTE_NARRATIVE.md de bout en bout sur l'aperçu avec les comptes de démo, puis liste chaque écart.
Ne corrige rien dans ce prompt : donne-moi seulement la liste numérotée des écarts, écran par écran.
```

Puis un prompt par écart. Avant la publication : supprimer les comptes de démonstration, créer le vrai admin, déclarer
les secrets (voir le guide), régler l'URL du site dans Supabase Auth, et retirer le sélecteur de comptes (déjà limité au mode dev).
