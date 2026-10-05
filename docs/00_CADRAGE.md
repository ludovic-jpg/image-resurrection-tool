# Plateforme Skills4mation (S4M) — Analyse, matrice d'écart et plan d'action

Version 1 — 20 septembre 2026 — document de cadrage, **aucun code produit à ce stade**.
Ce fichier deviendra `docs/00_CADRAGE.md` dans le dépôt, et sa section 7 amorcera le `DEV_LOG.md`.

---

## 1. Pièces analysées

Le prompt contenait trois emplacements restés vides (« Coller ici… », « Lien GitHub 1 »). J'ai donc pris comme entrées ce qui se trouve dans le dossier connecté `SK4M` et dans l'archive jointe.

| Pièce | Nature | Ce que j'en retiens |
|---|---|---|
| `Nouveau développement/CahierdeschargesS4M.docx` | Cahier des charges fonctionnel (titre « Version 2 », bandeau « Version 3 » du 7/09/2026) | 9 modules, 51 exigences `F-xxx`, 8 règles de gestion `RG-01..08`, pipeline en 7 étapes et 13 sous-statuts, 10 points ouverts |
| `Nouveau développement/TableauVariablesQualiopi.xlsx` | 3 onglets : 79 variables, 13 pièces, 11 tables | Référentiel de données ; identique à la skill `conventions-s4m` |
| `conventions-s4m.zip` (skill) | Règles d'or, dictionnaire, alias, modèle de données, 6 incohérences | Sert de **contrat de nommage** pour tout le code |
| `Nouveau développement/academieformatrix.zip` — **Base A** | Espace formateur Formatrix, 8 700 lignes, TanStack Start + Supabase (Lovable Cloud) | Fonctionnel mais : **aucun test**, organisme codé en dur (`src/config/organisme.ts`), aucune signature, coffre rattaché au formateur, `.env` versionné |
| `github.com/ludovic-jpg/skills4mation` — **Base B** (dernier commit du 16/09/2026) | Application Lovable, 34 000 lignes, 66 migrations, 50 routes. Version plus récente que `Skills4mation Hub (3).zip` de l'état des lieux (23 900 lignes), que j'écarte donc | Contient déjà un kanban, un écran BPF, un espace communication, une validation admin, des automatisations — voir le bilan de santé en 1 bis. Trois briques **pures et testées** : `render.ts`, `signature.ts`, `commission.ts` |
| `Etat des lieux/*.html` (6 gabarits) | Convention, planning, convocation, émargement, recueil, sous-traitance | Tous en **anciens noms de variables** ; trois contiennent des résidus de code (`{{${varName}}`, `{{...}}`) |
| `Etat des lieux/Rapport_Expert_SK4M.docx` | Audit du 1/09/2026 | Faille à ne pas reproduire : le formateur pouvait faire avancer lui-même son dossier jusqu'au paiement |

### 1 bis. Bilan de santé de la base B (mesuré, pas supposé)

J'ai cloné le dépôt, installé ses dépendances et lancé les contrôles. Résultats :

| Contrôle | Résultat |
|---|---|
| Tests existants | 22 tests sur 3 fichiers, **tous verts** — ils ne couvrent que le rendu, les variables et la signature |
| Typage (`tsc --noEmit`) | **105 erreurs**, concentrées sur une douzaine de fichiers : BPF (28), handicap (23), veille (14), clôture du financement (23), instructions et profil (10) |
| Cause dominante | Le code lit des tables et colonnes (`heures_realisees`, `montant_encaisse`, `stagiaires_presents`, `exigences_qualite_lu_le`…) **absentes du schéma typé** de la base. Les fichiers de migration existent dans le dépôt, mais le schéma connu de l'application ne les reflète pas |
| Gabarits | 191 variables distinctes, **0 au format harmonisé** |
| Pipeline | 5 bandeaux A–E et 12 statuts, contre 7 étapes A–G et 13 sous-statuts dans le cahier des charges |
| Périmètre | Blog, catalogue public, CPF, parrainage, serveur MCP, veille, handicap, réclamations : très au-delà des 9 modules du cahier des charges |
| Hygiène | `.env` versionné dans un dépôt public (clés « publishable » uniquement, gravité faible) ; aucune CI |

**Mon diagnostic de « plein de choses ne fonctionnent pas ».** Hypothèse forte, que je ne peux pas vérifier sans accès à la base : les commits « Vague 1 à 4 » ont été poussés depuis l'extérieur de Lovable avec leurs migrations, mais ces migrations n'ont jamais été appliquées à la base Lovable Cloud (Lovable n'applique que celles qu'il crée lui-même). Les écrans concernés interrogent donc des tables qui n'existent pas. C'est une **dérive entre le code et une base distante que tu ne pilotes pas** — et c'est précisément la classe de panne qu'une application locale, dont les migrations se rejouent au démarrage et dans les tests, rend impossible.

---

## 2. Matrice d'écart — existant contre nouveau besoin

Légende : **R** réutilisé tel quel · **A** adapté / refactorisé · **N** à créer.

| Module du cahier des charges | Existant exploitable | Écart | Verdict |
|---|---|---|---|
| **M1 Postulation formateur** (F-ONB-01..04) | A : `profil.tsx`, table `pieces_formateur`, enum `statut_candidature`, `admin.tsx` · B : `admin-candidatures.functions.ts` | Pas de notification de décision, pas de suppression de compte, liste des pièces non figée | **A** |
| **M2 Mes formations** (F-FORM-01..02) | A : `GenerateurProgramme.tsx`, `programme-schema.ts`, exports PDF et Word | Champs à réaligner sur `formation_*` ; duplication absente | **A** (forte réutilisation) |
| **M3 Outils pédagogiques** (F-OUT-01..05) | A : questionnaires positionnement/acquis, `config/recueil.ts`, coffre, partage par jeton | Coffre lié au formateur et non à la formation ; ouverture automatique à l'Accord absente | **A** |
| **M4.1 Fiche apprenant** (F-COM-01..02) | A : table `apprenants` | Alignement `stagiaire_*` / `entreprise_*` ; répertoire d'entreprises inexistant | **A** |
| **M4.2 Communication apprenant** (F-COM-03..10) | A : `dossier.$jeton.tsx`, dépôt de documents, e-mails d'étape · B : `_app.apprenant.index.tsx`, `PiecesPanel`, `EnvoisPanel`, `visibilite.ts` | B gère 4 statuts de pièce liés à Tally, pas le statut binaire du cahier des charges ; Accord multi-acteurs absent | **A** écrans, **N** modèle de pièce |
| **M4.3 Communication avec l'OF** (F-OF-01..05) | B : `_app.espace.communication.tsx`, `OrdreMissionCard`, `FactureReelleCard` | Pas de statut de pièce partagé avec le pipeline ; déclenchement ODM à revoir selon RG-06 | **A** |
| **M5 Création de dossier** (F-DOS-01..07) | A : `DossiersApprenants.tsx` · B : `DossierWizard.tsx` (910 lignes, jugé trop lourd) | Ordre imposé des étapes, pré-remplissage par le référentiel, verrou RG-02, e-mail entreprise | **N**, on ne reprend pas l'assistant de B |
| **M6 Pipeline « Mes dossiers »** (F-CRM-01..07) | B : `KanbanDossiers.tsx` (glisser-déposer), `kanban-config.ts`, `crm.ts`, `roles-guard.ts` | Étapes et sous-statuts différents du cahier des charges ; règles de transition dans l'écran et non dans un noyau testé | **A** écran, **N** machine à états |
| **M7 Génération et archivage** (F-ARCH-01..05) | B : `render.ts` + 3 fichiers de tests, archivage Drive · 6 gabarits HTML | Gabarits à migrer vers les variables harmonisées ; 7 pièces sans gabarit HTML (01, 07, 08, 09, 10, 11, 12) ; arborescence « Pièces de départ / Retour » | **A** moteur, **N** gabarits manquants |
| **M8 Page BPF** (F-BPF-01..02) | B : `_app.admin.bpf.tsx` — 28 erreurs de typage, tables absentes du schéma | Logique d'agrégation à extraire dans le noyau et à tester ; export fichier | **A** |
| **M9 Compte et RGPD** (F-RGPD-01..03) | A : page politique de confidentialité | Suppression avec conservation des dossiers | **N** |
| **Transverse : multi-organismes** | A code l'organisme en dur (SIRET compris) ; B fige « SKILLS4MATION » dans le texte des gabarits | Table `organisme_formation`, identité = configuration | **N** |
| **Transverse : signature** | B : empreinte SHA-256 + certificat horodaté, testé | Ajouter le tracé manuscrit (souris / doigt), lieu et date | **A** |
| **Transverse : qualité** | A : 0 test · B : 22 tests sur le seul moteur de rendu · aucune CI | Tests par module, CI GitHub Actions, `.env.example` | **N** |

**Lecture d'ensemble.** Côté écrans, presque tout le cahier des charges a un ancêtre dans A ou B : la réutilisation d'interface sera forte. Côté règles, c'est l'inverse : le statut des pièces, les transitions du pipeline, les déclencheurs automatiques et l'agrégation BPF sont dispersés dans les écrans et les fonctions serveur, sans test, et divergent du cahier des charges. Le travail consiste donc à **écrire le noyau de règles une fois, testé, puis à y rebrancher les écrans existants** — pas à tout réécrire, et pas à réparer B fichier par fichier.

---

## 3. Trois décisions d'architecture qui structurent tout le reste

**D1 — Un noyau métier pur, sans base de données ni écran.** Variables, nomenclature des pièces, machine à états du pipeline, règles RG-01..08, rendu des gabarits, preuve de signature, calculs BPF : tout cela s'écrit en TypeScript sans aucune dépendance technique. C'est testable à 100 % en quelques secondes, et c'est la partie qui doit ne jamais casser. L'interface et la base viennent se brancher dessus.

**D2 — Une seule source de vérité par pièce.** Le cahier des charges demande une « synchronisation bidirectionnelle » des statuts entre l'espace de communication, le dossier et l'OPP (F-COM-08, F-OF-04, RG-03). Je ne synchronise rien : il existe **une** ligne `piece_dossier` par pièce et par dossier, et les trois écrans lisent cette même ligne. La désynchronisation devient impossible par construction, au lieu d'être un bug à surveiller.

**D3 — Les transitions de statut sont décidées côté serveur, par rôle.** Chaque passage d'un sous-statut à un autre est une fonction du noyau qui reçoit l'acteur et refuse ce qui ne lui revient pas (le formateur ne valide pas son propre dossier, ne déclare pas le paiement). Cela corrige la faille relevée par l'audit du 1er septembre, et chaque refus est couvert par un test.

---

## 4. Pile technique proposée

Le choix dépend d'un arbitrage que je ne peux pas faire à ta place (je te pose la question dans la conversation). Voici les deux options et ma recommandation.

### Option A — Locale autonome (recommandée)

| Couche | Choix | Pourquoi |
|---|---|---|
| Langage | TypeScript strict, Node 22 | Déjà celui des deux bases ; installé sur ta machine |
| Interface | React 19, TanStack Router + Query, Tailwind 4, shadcn/ui | **Réutilisation directe** des composants de A et B |
| API | Hono + Zod | Minuscule, stable, testable sans réseau ; Zod déjà utilisé dans A et B |
| Base | PostgreSQL : **PGlite** en local (Postgres embarqué, un simple dossier, ni Docker ni installation), Postgres managé UE en production | Même SQL partout ; pas de migration de dialecte le jour de la mise en ligne |
| Accès données | Drizzle ORM + migrations versionnées | Schéma typé, lisible, revu dans Git |
| Authentification | better-auth (e-mail + mot de passe, lien d'invitation, rôles) | On ne fabrique pas sa propre sécurité de session |
| Fichiers | Port « archive » : dossier local `archive/<dossier_reference>/Pièces de départ` et `/Retour` ; adaptateur Drive ou S3 plus tard | F-ARCH-02..05 satisfaits en local dès le premier jour |
| E-mails | Port « courrier » : boîte d'envoi locale journalisée ; adaptateur SMTP plus tard | Traçabilité exigée en section 9 du cahier des charges, et rien ne part par accident pendant le développement |
| PDF | Gabarits HTML → PDF via Chromium (Playwright) | Respecte ta décision « gabarits HTML propres » ; un seul gabarit sert à l'écran et au PDF |
| Tests | Vitest (unitaires et intégration), Playwright (parcours complets) | Exécutables ici et dans GitHub Actions |
| CI | GitHub Actions : lint, typage, tests, build à chaque push | |

**Ce que tu perds avec A :** le « Joker » Lovable. Lovable ne sait intervenir que sur sa propre pile (TanStack Start + Supabase). Le code d'interface reste portable, pas l'inverse.

### Option B — Continuité Supabase

Repartir du dépôt B tel qu'il est (TanStack Start + Supabase), faire tourner Supabase en local via Docker, rejouer les 66 migrations, corriger les 105 erreurs, élaguer ce qui sort du cahier des charges, puis réaligner pièces, pipeline et variables. Réutilisation maximale ; Joker Lovable conservé. En contrepartie : Docker Desktop obligatoire sur ton poste, versions bêta épinglées par Lovable (`nitro` bêta, `vite` 8), et **je ne peux pas exécuter les tests d'intégration dans mon environnement** (pas de démon Docker), ce qui affaiblit le point 3 de ton protocole.

**Ma recommandation : A.** Ton critère premier est la fiabilité prouvée par des tests exécutés ; A est la seule option où je peux les faire tourner réellement à chaque module. Le noyau métier (D1) est de toute façon identique dans les deux cas, donc ce choix reste réversible pendant les trois premiers jalons.

---

## 5. Plan d'action par jalons

Chaque jalon suit ton protocole : spécification et critères → code → tests exécutés → entrée au `DEV_LOG.md` → « merged ». Un jalon = une branche Git = idéalement une session de travail.

| # | Jalon | Exigences couvertes | Critère de sortie (extrait) |
|---|---|---|---|
| **J0** | Socle du dépôt : arborescence, outillage, CI, `README`, `.gitignore`, `.env.example`, `DEV_LOG.md` | — | `npm test` et la CI passent sur un dépôt vide de fonctionnalités |
| **J1** | Noyau « variables et pièces » : dictionnaire des 79 variables et table d'alias générés depuis le classeur, nomenclature des 13 pièces, champs calculés | Annexe, F-DOS-03 | Aucun nom hors règles de nommage ; tout alias pointe vers une variable existante |
| **J2** | Moteur de gabarits : rendu `{{variable}}`, groupes répétables avec masquage des lignes vides, détection des variables orphelines ; migration des 6 gabarits HTML | F-ARCH-01 | Zéro ancien nom, zéro donnée réelle en dur, zéro balise restante après rendu |
| **J3** | Base de données multi-organismes : 11 tables du modèle + `piece_dossier` + journal d'événements ; jeu de données de démonstration | Transverse | Migrations rejouables ; deux organismes étanches l'un à l'autre |
| **J4** | Comptes et rôles (admin, formateur, apprenant) + postulation et validation du formateur | F-ONB-01..03, sécurité §9 | Un formateur ne lit jamais les données d'un autre (testé) |
| **J5** | Mes formations, outils pédagogiques, coffre-fort par formation | F-FORM-01..02, F-OUT-01..04 | Duplication d'une formation ; coffre rattaché à la formation |
| **J6** | Fiche apprenant, répertoire d'entreprises, création de dossier pré-remplie | F-COM-01..02, F-DOS-01..05, RG-02 | Soumission impossible sans recueil ni positionnement |
| **J7** | Machine à états du pipeline + écran « Mes dossiers » en colonnes | F-CRM-01..07, F-DOS-07, RG-07 | Toutes les transitions interdites sont refusées, par rôle |
| **J8** | Pièces à statut et deux espaces de communication ; Accord multi-acteurs ; déclencheurs | F-COM-03..10, F-OF-01..05, RG-03, RG-06, RG-08, F-OUT-05 | Le dépôt de l'Accord génère l'ODM et ouvre le coffre |
| **J9** | Signature : tracé manuscrit, lieu, date, empreinte SHA-256, certificat de preuve | F-COM-06..07, F-OF-03 | Un document modifié après signature est détecté |
| **J10** | Génération automatique à la validation, archivage « Pièces de départ / Retour », e-mails journalisés, relance | F-ARCH-01..05, F-DOS-06, F-CRM-06, RG-04, RG-05 | Valider un dossier produit les pièces et l'e-mail entreprise, une seule fois |
| **J11** | Page BPF : export par exercice | F-BPF-01..02 | Totaux recalculés et vérifiés sur le jeu de démonstration |
| **J12** | Suppression de compte et conservation des dossiers | F-ONB-04, F-RGPD-01..03, RG-01 | Données personnelles effacées, dossiers archivés intacts |
| **J13** | Parcours complet de bout en bout, accessibilité, documentation, version 1.0 | Tout | Un dossier va de « Brouillon » à « Archivé » dans un test automatisé |

Les jalons J1, J2, J7 et J9 sont du noyau pur : ils avancent vite, ne dépendent d'aucune décision en suspens, et sécurisent 80 % du risque.

---

## 6. Points à trancher — et ce qu'ils bloquent

Aucun ne bloque J0 à J3. Là où une réponse manque, je rends la règle **paramétrable** plutôt que de deviner, et je le note au journal.

| Point ouvert | Bloque | Hypothèse par défaut si tu ne tranches pas |
|---|---|---|
| Deux SIRET, deux TVA, tribunal, ICPF B02267, n° Qualiopi (skill) | Rien techniquement : ce sont des données de configuration de l'OF | Champs vides, génération refusée tant que les champs obligatoires de l'OF ne sont pas remplis |
| Signature de la convocation (skill) | J8 | Le cahier des charges dit « Oui » (tableau 6.4.2) : je suis le cahier des charges |
| Nature du « Pré-dossier » (CdC n° 1) | J8 | Synthèse Recueil + Positionnement, signée une fois |
| Déclenchement de l'ODM (n° 2) | J8 | Automatique au dépôt de l'Accord, conformément à RG-06 |
| Accord : document unique ou par espace (n° 3) | J8 | Document unique partagé (cohérent avec D2) |
| Facture S4M côté formateur (n° 4) | J8 | Consultation seule |
| Coffre : tout ou éléments marqués (n° 5) | J5 | Éléments marqués « partageable » uniquement |
| Pièces de candidature (n° 6) | J4 | Liste de A : CV, diplôme, identité, casier, autre — configurable |
| Stockage cloud (n° 7) | Mise en production seulement | Archive locale, adaptateur plus tard |
| Contenu du BPF (n° 8) | J11 | Rubriques du Cerfa 10443 listées en F-BPF-02 |
| Durées de conservation (n° 9) | J12 | 10 ans partout, paramétrable |
| Anonymisation ou dissociation (n° 10) | J12 | Dissociation du compte + effacement des champs identifiants du formateur |
| Un ou plusieurs apprenants par dossier | J6 | Le modèle porte 1 à 8 stagiaires (référentiel) ; l'écran aussi |
| Satisfaction à chaud et à froid | Hors J0–J13 | Gabarits générés en J10, circuit d'enquête à cadrer ensuite |

Une tension à signaler : le cahier des charges (§9) demande une signature « à valeur probante », et tu as retenu un tracé manuscrit sans prestataire. Les deux sont conciliables au niveau « signature électronique simple » (tracé + horodatage + empreinte du document + certificat). Ce n'est ni une signature avancée ni qualifiée ; je ne suis pas juriste, et ce point mérite un avis avant mise en production sur les conventions.

---

## 7. Premières entrées du journal

- **2026-09-20 — Sécurité.** Le fichier `.env` de la base A est versionné, et le dépôt `academieformatrix` est public. Il ne contient que des clés « publishable » Supabase, conçues pour être exposées, donc gravité faible ; mais le `.gitignore` ne couvre pas `.env`. Corrigé d'office dans le nouveau dépôt (`.env` ignoré, `.env.example` fourni).
- **2026-09-20 — Réutilisation.** Reprise prévue de `render.ts`, `signature.ts`, `commission.ts` et des 22 tests verts de la base B malgré l'abandon de l'application : ce sont des fonctions pures, indépendantes de ce qui était instable.
- **2026-09-20 — Non-reprise.** De la base B ne sont pas repris : `DossierWizard.tsx`, le catalogue en dur de 5 150 lignes, et tout ce qui sort des 9 modules du cahier des charges (blog, catalogue public, CPF, parrainage, MCP, veille, réclamations). Ces fonctions restent dans le dépôt B pour plus tard.
- **2026-09-20 — Source de référence.** Le dépôt GitHub `skills4mation` (16/09) remplace l'archive `Skills4mation Hub (3).zip` comme base B.
- **2026-09-20 — Incohérence documentaire.** Le cahier des charges porte « Version 2 » en titre et « Version 3 » en bandeau ; « Attestation de réalisation » (CdC) et « Attestation de formation » (nomenclature) désignent la même pièce 09-FIN.
