# Analyse du 23/09/2026 : cahier des charges oral, attentes et écarts

Ce document confronte ce que tu as dicté le 23 septembre 2026 au code de la plateforme tel qu'il était le
21 septembre (commit `bd29d6f`). Il consigne ensuite ce qui a été développé, puis ce qui reste à trancher.
Le cahier des charges écrit (`docs/sources/CahierdeschargesS4M.docx`) reste la référence. Le cahier oral le
**complète** et, sur un point, le **précise** (qui déclare la demande de financement déposée).

---

## 1. Ce que j'ai analysé

| Source | Emplacement | Rôle dans l'analyse |
|---|---|---|
| **Plateforme S4M** | `Downloads/Sk4m2309/s4m-plateforme`, commit du 21/09/2026 | **La base analysée et modifiée.** 10 700 lignes, 182 tests verts, 5 parcours navigateur verts au départ |
| Cahier des charges écrit | `docs/sources/CahierdeschargesS4M.docx` | 9 modules, 51 exigences, 8 règles de gestion |
| Exemple de convention et signature | `Sk4m2309/exemple-convention.pdf`, `15-signature.png` | Contrôle de forme |
| Académie Formatrix | `academieformatrix` (branche `feature/main-menu-apprenant`) | **Inspiration pédagogique uniquement** : génération par IA de programmes, de QCM et de supports. Rien n'y a été modifié |
| Ancien « Skills4mation Hub » (Lovable) | `Documents/Projects/skills4mation` | Réserve d'idées déjà écartée le 20/09. Seule idée reprise : la case « je confirme avoir déposé la demande » |

> **Pour éviter la confusion :** Skills4mation est la plateforme de portage complet (ce dépôt). Formatrix est un
> espace pédagogique ; son code n'a servi que d'inspiration pour l'espace pédagogique.

---

## 2. Le cahier des charges oral, phrase par phrase

| # | Ce que tu as dit (reformulé) | État le 21/09 | Écart | Décision |
|---|---|---|---|---|
| O-01 | Un premier menu à **trois espaces** : pédagogique, apprenant, formation | Menu plat de 6 entrées, pipeline en page d'accueil | **Manquant** | Menu d'accueil à trois espaces, et rail latéral regroupé par espace |
| O-02 | L'espace pédagogique reprend les fonctionnalités de Formatrix | Formations, outils QCM et coffre-fort présents. **Aucune IA** (« hors périmètre ») | **Partiel** | Assistant IA pour les brouillons de programme et de QCM (voir O-12) |
| O-03 | Espace formation : **générateur de conventions** à onglets, commençant par l'apprenant, pré-remplis, **qu'on peut reprendre**, puis l'entreprise, puis le financement… | Assistant en 5 étapes, dans l'ordre F-DOS-02, pré-rempli. Pas de retour libre sur une étape, pas de correction de fiche sur place | **Partiel** | Onglets cliquables, « Reprendre la fiche » (apprenant, entreprise), récapitulatif avant création |
| O-04 | On **invite l'apprenant** sur une page dédiée, qui commence par le **recueil des besoins** et le **test de positionnement** | Invitation présente (F-COM-05). La page de l'apprenant commençait par « Mes documents », les questionnaires venaient ensuite | **Partiel** | Page de l'apprenant découpée en étapes ; la première est l'étape préliminaire |
| O-05 | Constituer le dossier exige **trois conditions** : recueil, positionnement, dossier enregistré | RG-02 (recueil et positionnement) et la liste des manques (dates, planning, lieu…) déjà contrôlés côté serveur | **Conforme** | Testé de nouveau, phrase par phrase |
| O-06 | Le dossier est **validé par l'équipe administrative** | Réservé à l'admin (correctif de l'audit du 01/09) | **Conforme** | — |
| O-07 | Demande de financement : on remet la **convention, le planning, le parcours de formation** | Convention et planning présents. **Le programme n'existait pas**, alors que la convention écrit « le programme détaillé figure en annexe » | **Manquant, avec un risque Qualiopi** | Nouvelle pièce « 2 ter — Programme de formation » (`PRG`), générée à la validation et jointe à l'e-mail envoyé à l'entreprise. Programme obligatoire pour soumettre |
| O-08 | L'apprenant peut **télécharger, signer en ligne, redéposer** ; la pièce passe alors à « Validé » | Conforme (F-COM-06/07) | **Conforme** | — |
| O-09 | Il coche **« j'affirme avoir déposé la demande de financement »** ; la section **change de couleur** | La déclaration « dossier déposé » était réservée au formateur et à l'admin | **Manquant** | L'apprenant déclare depuis son espace, une fois la convention signée. La section passe au vert, le formateur reçoit un e-mail, le journal garde l'auteur |
| O-10 | Si l'accord arrive, une **section « Accord de financement » est produite automatiquement** | La pièce « Accord » était visible dès la validation, sans étape dédiée | **Partiel** | La section n'apparaît dans l'espace de l'apprenant qu'après sa déclaration |
| O-11 | L'accord peut être chargé par **l'apprenant, le formateur et l'organisme** | Conforme (RG-06). Le dépôt déclenche l'ordre de mission et ouvre le coffre-fort | **Conforme** | — |
| O-12 | **IA importante** sur le support pédagogique ; **pas ailleurs** : tout doit être **exact** | Aucune IA | **Manquant** | IA limitée à l'espace pédagogique, en brouillons relus par le formateur. Un **test de garde** fait échouer la CI si l'IA est branchée ailleurs |

**Bilan :** 4 exigences conformes, 4 partielles, 4 manquantes. Les 8 écarts sont traités dans ce livrable (section 3).

---

## 3. Ce qui a été développé

### 3.1 Noyau métier (`src/domaine`), pur et testé

- **`parcours/apprenant.ts`** (nouveau) traduit l'état du dossier en cinq sections : étape préliminaire, constitution et validation, demande de financement, accord de financement, formation. Chaque section porte un état (`a_faire`, `en_attente`, `termine`, `refuse`, `a_venir`) qui fixe sa couleur. Cette fonction ne décide rien : c'est le pipeline qui décide.
- **`pipeline/transitions.ts`** : l'action `declarer_depot` est ouverte à l'apprenant. Elle est **gardée** : la convention doit être signée, quel que soit le rôle. Elle déclenche un nouvel effet, `NOTIFIER_DEPOT_DECLARE`.
- **`referentiel/pieces.ts`** : nouvelle pièce `PRG`, « Programme de formation », ordre « 2 ter », transmise sans statut comme le planning.
- **`referentiel/variables.ts`** : deux variables ajoutées (`formation_programme`, `formation_public_vise`), marquées `ajout: true`.
- **`pedagogie/propositions.ts`** (nouveau) : consignes envoyées à l'IA et **validation stricte** de ses réponses (nombre exact de questions, 4 propositions, une bonne réponse, 3 à 8 objectifs). Une réponse mal formée est refusée, jamais « réparée ».

### 3.2 Serveur

- **Migration `drizzle/0001_programme_annexe.sql`** : le programme est **figé dans le dossier** à sa création, comme le reste de la formation. Une modification ultérieure du catalogue ne réécrit donc pas une convention signée.
- **`ports/ia.ts`** + **`services/pedagogie-ia.ts`** : l'assistant IA (API Claude d'Anthropic) est facultatif. Sans `ANTHROPIC_API_KEY` ni `IA_MODELE`, il est désactivé et les boutons disparaissent. Seule la description de la **formation** lui est envoyée, **jamais** de données d'apprenant, d'entreprise ou de prix.
- **`services/dossiers.ts`** : `lireDossier` renvoie le parcours de chaque apprenant, et à l'apprenant **ses** actions, c'est-à-dire la seule déclaration de dépôt.
- **`services/pipeline.ts`** : le programme est généré avec les pièces de départ, marqué « Transmis » et joint à l'e-mail envoyé à l'entreprise. Il est aussi exigé avant la soumission.
- **Nouvelles routes :** `GET /api/ia/etat`, `POST /api/ia/qcm`, `POST /api/ia/programme`.

### 3.3 Interface

- **Menu principal** (`client/navigation.ts`, `ecrans/Accueil.tsx`, `ecrans/Cadre.tsx`) : l'accueil du formateur présente les trois espaces. Le pipeline se trouve dans « Espace formation → Mes dossiers » (`/dossiers`), et le rail latéral est groupé par espace. L'accueil de l'admin ne change pas.
- **Générateur de conventions** (`ecrans/NouveauDossier.tsx`) : onglets cliquables, « Reprendre la fiche » pour l'apprenant et l'entreprise, récapitulatif final.
- **Espace de l'apprenant** (`ecrans/Dossier.tsx`) : parcours en sections colorées et case « J'affirme avoir déposé la demande de financement ». La section Accord apparaît ensuite d'elle-même.
- **Espace du formateur** : chaque apprenant d'un dossier affiche les pastilles de son parcours, comme il le voit lui-même.
- **IA** (`ecrans/AssistantIa.tsx`) : boutons « Proposer objectifs et programme » dans une formation et « Proposer 10 questions » dans les outils. Un bandeau rappelle que c'est un brouillon à relire.

---

## 4. Résultats des contrôles (exécutés, pas supposés)

| Contrôle | Avant (21/09) | Après (23/09) |
|---|---|---|
| Typage `tsc` | ✅ | ✅ |
| Lint `eslint` | ✅ | ✅ |
| Tests unitaires et d'intégration | 182 tests, 12 fichiers | **236 tests, 17 fichiers** ✅ |
| Parcours navigateur (Playwright) | 5 | **7** ✅ |
| Build de production | ✅ | ✅ |

La nouvelle série de tests est détaillée dans [`RECETTE_23-09.md`](RECETTE_23-09.md).

---

## 5. Points d'attention et décisions qui te reviennent

| # | Sujet | Ce que j'ai fait | Ce que tu dois trancher |
|---|---|---|---|
| 1 | **« Espace support »** : tu as dit une fois « espace support » au lieu d'« espace formation » | J'ai compris « espace formation » | Confirmer |
| 2 | **Ordre des onglets du générateur** : tu as dit « apprenant, entreprise, puis financement, etc. » | J'ai gardé l'ordre écrit F-DOS-02 : apprenant, entreprise, formation, modalité, financement | Confirmer, ou demander de placer le financement en 3ᵉ position |
| 3 | **Qui signe la convention ?** (hypothèse 11, déjà ouverte) | L'apprenant la signe dans son espace, comme dans ta dictée | Juridiquement, c'est le représentant de l'entreprise qui signe : **à trancher avant la mise en production** |
| 4 | **Déclaration de dépôt avant signature** | Refusée, quel que soit le rôle | Confirmer (je le recommande : sans convention signée, pas de demande recevable) |
| 5 | **Fournisseur d'IA** | Claude (Anthropic), facultatif, désactivé par défaut. Seule la description de la formation est envoyée | À inscrire au registre RGPD si tu l'actives. Aucune donnée personnelle ne part |
| 6 | **Emplacement du code** | Le dépôt est dans `Téléchargements/Sk4m2309`, et contient une **copie en double** `s4m-plateforme/s4m-plateforme` | Déplacer le dépôt dans `Documents/Projects/s4m-plateforme` et supprimer le doublon (je ne l'ai pas supprimé sans ton accord) |
| 7 | **Nom des anciens dossiers** | Rien n'a été touché | Renommer `Documents/Projects/skills4mation` en `skills4mation-ancien-hub-lovable` pour ne plus le confondre avec la plateforme |
| 8 | **Nommage** | La table `formation` garde deux colonnes hors convention (`programme`, `public_vise`) | Dette mineure : les renommer demande une migration dédiée, sans urgence |

---

## 6. Et ensuite (proposition, dans l'ordre)

1. Trancher les points 3 et 4 ci-dessus, ainsi que les hypothèses 11, 12 et 13 de `HYPOTHESES.md` : ce sont des **bloquants de mise en production**.
2. Faire une recette manuelle d'une heure avec la liste de [`RECETTE_23-09.md`](RECETTE_23-09.md), section 3.
3. Mettre en ligne une **préproduction** en suivant [`GUIDE_LANCEMENT.md`](GUIDE_LANCEMENT.md), partie 4, avec un seul formateur pilote.
4. Seulement ensuite : supports de cours générés par IA (diaporamas, PDF), sur le modèle de Formatrix, en gardant la même règle (brouillon relu, et aucune IA hors de l'espace pédagogique).
