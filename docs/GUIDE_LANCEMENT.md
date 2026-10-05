# Guide : lancer, tester et mettre en ligne la plateforme Skills4mation

Ce guide s'adresse à un utilisateur débutant ou intermédiaire. Chaque commande est à **copier telle quelle**, et
chaque étape dit ce que tu dois voir à l'écran. Les commandes s'écrivent dans un **terminal**. Sous Windows, prends
PowerShell ou le terminal intégré de VS Code (menu *Terminal → Nouveau terminal*).

**Sommaire**

1. Installer une fois pour toutes
2. Installer la nouvelle version (`s4m-plateforme_6.zip`, branche `evolution/modification-1`)
3. Lancer l'application en local, et la tester
4. Mettre l'application en ligne (préproduction, puis production)
5. La méthode de travail qui garde un code solide
6. Dépannage

---

## 1. Installer une fois pour toutes

| Outil | Pourquoi | Vérifier |
|---|---|---|
| **Node.js 22 (LTS) ou plus récent** — <https://nodejs.org> | Fait tourner l'application | `node -v` affiche `v22…` ou plus |
| **Git** — <https://git-scm.com> | Garde l'historique du code | `git --version` |
| **VS Code** — <https://code.visualstudio.com> (conseillé) | Lire le code et voir les différences entre versions | — |

Rien d'autre n'est nécessaire : ni base de données à installer, ni Docker. La base PostgreSQL est **embarquée**
(PGlite) dans le dossier `donnees/`. Les PDF sont produits par Edge ou Chrome, qui sont détectés automatiquement.

> 💡 **Conseil de rangement.** Déplace le dossier `s4m-plateforme` de *Téléchargements\Sk4m2309* vers
> *Documents\Projects\s4m-plateforme*, puis supprime la copie en double `s4m-plateforme\s4m-plateforme`.
> Un projet professionnel ne vit pas dans *Téléchargements*.

---

## 2. Installer la nouvelle version (« Modification 1 », 23/09/2026)

Tu reçois **`s4m-plateforme_6.zip`** : le dépôt **complet** (code, documentation, historique Git). Il remplace à la
fois `s4m-plateforme_5.zip` et la surcouche `s4m-evolution-23-09` — plus besoin de copier des fichiers à la main.

1. Crée le dossier `Documents\Projects` s'il n'existe pas, et **décompresse** l'archive dedans : tu obtiens
   `Documents\Projects\s4m-plateforme`. (Clic droit → *Extraire tout…* sous Windows.)
2. Ouvre un terminal **dans ce dossier** (dans VS Code : *Fichier → Ouvrir le dossier…*, puis *Terminal → Nouveau
   terminal*).
3. Vérifie que tu es au bon endroit et sur la bonne branche :

```powershell
git branch            # l'étoile doit être sur « evolution/modification-1 »
git log --oneline -4  # le premier commit parle de « Modification 1 »
```

**Voir ce qui a changé depuis le 21/09** : `git diff main --stat`. **Revenir à la version du 21/09** : `git switch main`.
**Adopter la nouvelle version comme référence**, après ta recette : `git switch main` puis
`git merge evolution/modification-1`.

> ⚠️ **Ne copie pas** le `package.json` du dossier `s4m-evolution-23-09` : c'est un fichier vide créé par
> `npm init`, qui casserait l'installation. Le zip de cette livraison contient le bon.

---

## 3. Lancer l'application en local

### 3.1 Premier lancement (trois commandes)

```powershell
npm install        # la première fois, ou après chaque changement de version (1 à 2 minutes)
npm run build      # compile l'interface
npm start          # démarre l'application
```

Tu dois voir, entre autres :

```
[s4m] base vide — création du jeu de démonstration…
[s4m] compte formateur pilote ludoalbisser@gmail.com : créé (candidature validée)
[s4m] application prête sur http://localhost:3001
[s4m] courrier : boîte locale, sauf réglages SMTP enregistrés dans l'application · PDF : Chromium trouvé · IA (.env) : non configurée — réglable dans Organisme → Assistant IA
```

Ouvre **<http://localhost:3001>**.

| Compte | Mot de passe | Pour tester |
|---|---|---|
| **`ludoalbisser@gmail.com`** (formateur, **ton compte**) | **`1234ludo`** | Tout, en partant d'un espace vide : parcours, tests, supports, coffre, positionnements, dossiers |
| `formatrice@demo.example` (formatrice avec historique) | `demonstration-s4m` | Un catalogue rempli, dont « Prospection commerciale B2B » avec 4 supports PPTX, un positionnement signé et un en attente |
| `apprenante@demo.example` | `demonstration-s4m` | L'espace de l'apprenant (sections, signature, « J'affirme avoir déposé ») |
| `admin@demo.example` (organisme) | `demonstration-s4m` | Validation des dossiers, coffres et positionnements de tous les formateurs, candidatures, boîte d'envoi |
| `candidat@demo.example` | `demonstration-s4m` | Une candidature de formateur à valider |

**Arrêter** : `Ctrl + C`. **Repartir d'une base neuve** : arrête l'application, supprime le dossier `donnees`, relance.

> **Ta base existante.** Si tu relances sur ton ancien dossier `donnees`, la **migration**
> `drizzle/0002_modification_1.sql` s'applique toute seule, et le compte `ludoalbisser@gmail.com` est créé **s'il
> n'existe pas déjà**. Si cette adresse sert déjà à un compte *apprenant* de tes essais, le démarrage l'écrit
> (« ADRESSE DÉJÀ UTILISÉE ») : repars d'une base neuve, ou change `COMPTE_PILOTE_EMAIL` dans `.env`.

> **Le mot de passe `1234ludo`** est accepté pour ce compte de test seulement (la règle de l'application impose 10
> caractères). **Change-le** dans « Mon compte » avant toute mise en ligne, et remplace les données fictives de ton
> profil (entreprise, SIRET, IBAN) dans « Mon profil et candidature ».

### 3.2 Les nouveautés, où cliquer

| Tu veux… | Où |
|---|---|
| Générer un parcours avec titre, heures, jours, tarif, nombre de modules | *Mes formations → Nouvelle formation* → **Générer le parcours** |
| Lire ce que l'IA a appris du sujet (recherche web), l'actualiser | Onglet *2. Enjeux* de la formation → **Analyser les enjeux** |
| Aménager les modules, puis enregistrer (à tout moment) | Onglet *3. Parcours* de la formation → **Enregistrer** |
| Générer test de positionnement, évaluation des acquis, supports PPTX | Fiche formation → carte **Kit pédagogique du parcours** |
| Envoyer (ou renvoyer) un formulaire à un apprenant : recueil, positionnement, acquis, satisfaction | Dans le dossier, onglet *Synthèse*, sous chaque apprenant : **Envoyer / Renvoyer** ; le document d'invitation (PDF avec QR code) est à côté |
| Régler l'assistant IA (clé d'API, modèle, recherche web) | Compte **admin** → **Organisme → Assistant IA** |
| Régler l'envoi réel des e-mails, faire un test | Compte **admin** → **Organisme → E-mails** |
| Renvoyer un e-mail parti en échec | **Boîte d'envoi** → onglet *Échecs* → ouvrir → **Renvoyer** |
| Le coffre-fort d'un parcours (pédagogique + administratif) | Menu **Coffre-fort pédagogique** |
| Créer un apprenant et son entreprise d'un coup | *Apprenants et entreprises → Nouvelle fiche apprenant* → « + Créer une nouvelle entreprise… » |
| Inviter un apprenant à se positionner | Bouton **Positionner** sur l'apprenant, ou menu **Positionnements** |
| Modifier la partie financière d'une convention | Dans le dossier (tant qu'il n'est pas validé) : cadre **Partie financière de la convention** |
| Profil, justificatifs, candidature | **Mon profil et candidature** |
| Retrouver ce qui a été archivé ou supprimé ; sauvegarder | **Archives et sauvegarde** ; **Historique** dans une formation ou un questionnaire |

Le scénario complet, étape par étape, est dans [`RECETTE_NARRATIVE.md`](RECETTE_NARRATIVE.md).

### 3.3 Activer l'assistant IA de l'espace pédagogique

Depuis la version 7, **plus de trame sans IA** : les générateurs (dossier d'enjeux, parcours, tests, supports) ont
besoin de l'assistant. Sans lui, leurs boutons sont grisés et expliquent où l'activer ; **tout le reste fonctionne**
(formations, dossiers, conventions, formulaires, e-mails).

**Pour essayer sans clé** (démonstration, tests) : mets `IA_FACTICE=oui` dans `.env` et relance. L'assistant répond
alors sans réseau, avec des contenus fictifs marqués « [démonstration] ». Jamais en production (ignoré si
`NODE_ENV=production`).

**Pour l'activer réellement**, tout se règle dans l'application, avec le compte administrateur de l'organisme :

1. Crée une clé d'API sur <https://console.anthropic.com> (compte payant à l'usage). Conseil : une clé rattachée à
   un *workspace* ; sinon, note l'identifiant du workspace.
2. Connecte-toi en **admin** → **Organisme → Assistant IA** : active l'interrupteur, colle la clé (elle est chiffrée
   en base et jamais réaffichée), choisis le modèle (**Claude Sonnet 5**, recommandé), laisse **Autoriser la
   recherche web** activé (nécessaire aux dossiers d'enjeux), puis **Enregistrer**. Aucun redémarrage.
3. Côté formateur, les boutons de génération sont actifs et affichent le moteur utilisé (« claude-sonnet-5 +
   recherche web »).

**Coûts, ordre de grandeur** (facturés par Anthropic sur ton compte) : un parcours complet ≈ 0,20 – 0,50 € ; un
support de module ≈ 0,10 – 0,20 € ; une recherche web ≈ 0,01 €. Opus coûte environ deux fois plus, Haiku nettement
moins. Chaque appel est journalisé (jetons, recherches, durée) dans le journal du dossier de l'organisme.

L'IA ne reçoit que la description de la formation (jamais un apprenant, une entreprise ou un prix) et ne touche
jamais aux conventions ni aux pièces. Les variables `ANTHROPIC_API_KEY`, `IA_MODELE`, `IA_RECHERCHE_WEB` de `.env`
restent possibles comme **valeurs par défaut du serveur** ; les réglages de l'organisme priment.

### 3.3 bis Envoyer réellement les e-mails

Par défaut, aucun e-mail ne part : ils sont consignés dans la **Boîte d'envoi** (pratique pour tester). Pour
l'envoi réel, compte **admin** → **Organisme → E-mails** :

1. Active **Envoyer réellement les e-mails**.
2. Clique un préréglage (**Gmail / Google Workspace**, Brevo, OVH, IONOS) ou saisis l'hôte, le port et l'option
   « connexion sécurisée » (465 = TLS direct, 587 = STARTTLS).
3. Identifiant (ton adresse), adresse d'expédition (ce que voient les destinataires), mot de passe (chiffré, jamais
   réaffiché). **Avec Gmail ou Google Workspace, ton mot de passe habituel ne marche pas** : compte Google →
   Sécurité → Validation en deux étapes → *Mots de passe des applications* → crée-en un et colle les 16 caractères.
4. **Enregistrer**, puis **M'envoyer un e-mail de test** : le résultat (envoyé, consigné seulement, ou échec avec la
   cause) s'affiche en clair. Vérifie aussi les indésirables la première fois.

Les formulaires de l'apprenant (recueil, positionnement, acquis, satisfaction) partent alors automatiquement au bon
moment du dossier, avec un lien personnel et un PDF d'invitation à QR code ; les e-mails en échec se renvoient
depuis la Boîte d'envoi une fois les réglages corrigés. `COURRIER_MODE=smtp` et `SMTP_URL` dans `.env` restent des
valeurs par défaut.

### 3.4 Lancer les tests

```powershell
npm run verifier                  # typage + lint + 269 tests (environ 1 min) : doit finir sans erreur
npx playwright install chromium   # une seule fois, pour les tests navigateur
npm run test:e2e                  # 11 parcours dans un vrai navigateur (environ 2 min)
npx vitest run tests/integration/modification-1.test.ts   # seulement la recette de « Modification 1 » (32 tests)
```

Ce que tu dois lire : `Tests 269 passed`, puis `11 passed`.

### 3.5 Développer en voyant le résultat en direct

```powershell
npm run dev    # API sur :3001 + interface sur http://localhost:5173, rechargée à chaque modification
```

### 3.6 Recette à la main

Suis [`RECETTE_NARRATIVE.md`](RECETTE_NARRATIVE.md) (1 h 30 à 2 h), puis, pour la fin du parcours apprenant,
[`RECETTE_23-09.md`](RECETTE_23-09.md), section 3.

### 3.7 Sauvegarder tes données locales

Tout est dans le dossier **`donnees/`** (base + pièces archivées). Arrête l'application et copie ce dossier : c'est
ta sauvegarde complète. Pour ton seul espace pédagogique, *Archives et sauvegarde → Télécharger ma sauvegarde*.

---

## 4. Mettre l'application en ligne

### 4.1 Avant tout : trois bloquants

Ne mets **aucun vrai dossier** en ligne avant d'avoir tranché ces trois points de `docs/HYPOTHESES.md` :

- **n° 11, qui signe la convention** : l'apprenant ou le représentant de l'entreprise ;
- **n° 12, valeur juridique de la signature** : prends l'avis d'un juriste ;
- **n° 13, relecture de l'authentification** : fais-la faire par un développeur tiers.

Commence donc par une **préproduction** : une adresse en ligne, des données fictives, un ou deux formateurs pilotes.

### 4.2 Ce dont l'application a besoin en ligne

| Besoin | Pourquoi | Recommandation |
|---|---|---|
| Un serveur **Node 22** qui tourne en continu | L'application est un seul programme (`npm start`) | Un petit serveur virtuel (VPS) hébergé **en France ou dans l'UE** |
| Un **disque persistant** | Les pièces archivées (`ARCHIVE_DIR`) sont des fichiers | Le disque du VPS, sauvegardé chaque nuit |
| Une base **PostgreSQL** | PGlite suffit en local et en préproduction ; en production, une vraie base avec des sauvegardes gérées | Un PostgreSQL « managé » chez le même hébergeur européen, via `DATABASE_URL=postgres://…` |
| **HTTPS** et un nom de domaine | Des sessions et des signatures passent par le site | Le reverse proxy **Caddy** obtient et renouvelle le certificat tout seul |
| Un **SMTP** pour les e-mails | Invitations, relances, envoi des pièces à l'entreprise | Le SMTP de ta messagerie professionnelle, ou un service d'e-mails transactionnels hébergé dans l'UE |

Parmi les hébergeurs européens courants : OVHcloud et Scaleway (France), Hetzner (Allemagne). Compare leurs offres
du moment toi-même : prix et gammes changent souvent. Pour des données d'apprenants, **exige un hébergement UE et
un contrat de sous-traitance RGPD (DPA)** : c'est un point d'audit Qualiopi et RGPD.

> Pourquoi pas une plateforme « tout-en-un » (type Render ou Railway) ? C'est possible, mais l'archive des pièces
> exige un disque persistant, souvent payant ou limité sur ces plateformes. Un VPS reste plus simple à
> comprendre et à sauvegarder.

### 4.3 Mise en ligne pas à pas sur un VPS (Ubuntu), environ 1 heure la première fois

Tu te connectes au serveur avec `ssh utilisateur@adresse-du-serveur`, puis :

```bash
# 1. Node 22 et Git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 2. Le code (depuis ton dépôt GitHub PRIVÉ)
git clone https://github.com/<ton-compte>/s4m-plateforme.git
cd s4m-plateforme
npm ci && npm run build

# 3. La configuration
cp .env.example .env
nano .env
```

Dans `.env`, en production :

```
NODE_ENV=production
PORT=3001
APP_URL=https://app.skills4mation.fr
DATABASE_URL=postgres://utilisateur:motdepasse@hote:5432/s4m     # (ou laisse la base embarquée en préproduction)
ARCHIVE_DIR=/srv/s4m/archive
AMORCE=vide
ADMIN_EMAIL=ton.adresse@skills4mation.fr
ADMIN_MOT_DE_PASSE=une-phrase-longue-et-unique
CLE_SECRETS=                  # facultatif : 64 caractères hexadécimaux ; vide = fichier .cle-secrets créé à côté de la base (à sauvegarder avec elle)
COMPTE_PILOTE_EMAIL=          # VIDE en production : pas de compte de test créé au démarrage
```

L'envoi des e-mails et l'assistant IA se règlent ensuite **dans l'application** (Organisme → E-mails, Organisme →
Assistant IA), pas dans `.env`. `COURRIER_MODE=smtp` + `SMTP_URL` et `ANTHROPIC_API_KEY` restent possibles ici comme
valeurs par défaut.

```bash
# 4. Démarrer en tâche de fond, et redémarrer tout seul après un redémarrage du serveur
sudo npm install -g pm2
pm2 start "npm start" --name s4m
pm2 save && pm2 startup     # suivre la commande qu'il affiche

# 5. HTTPS avec Caddy (certificat automatique)
sudo apt-get install -y caddy
echo 'app.skills4mation.fr {
  reverse_proxy localhost:3001
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Chez ton registrar, fais pointer le nom `app.skills4mation.fr` (enregistrement DNS « A ») vers l'adresse IP du
serveur. Ouvre ensuite <https://app.skills4mation.fr> : connecte-toi avec `ADMIN_EMAIL`, va dans **Organisme** et
saisis l'identité de l'organisme (SIRET, NDA, Qualiopi, représentant, tribunal…). Tant qu'un champ obligatoire
manque, aucun dossier ne peut être validé : c'est volontaire.

### 4.4 Mettre à jour la version en ligne

```bash
cd s4m-plateforme
git pull                  # récupère la version validée (branche main)
npm ci && npm run build
pm2 restart s4m           # les migrations de base s'appliquent toutes seules au démarrage
```

**Règle d'or :** on ne met en ligne que ce qui est passé par `npm run verifier` et par la CI GitHub (coche verte).

### 4.5 Sauvegardes (non négociable)

- **Chaque nuit** : une copie de la base (sauvegarde automatique du PostgreSQL managé, ou copie du dossier
  `donnees/base` si la base est embarquée) **et** du dossier `ARCHIVE_DIR`, envoyée **hors du serveur** (stockage
  objet européen).
- **Une fois par trimestre** : un **test de restauration** sur une machine vierge. Une sauvegarde jamais restaurée
  ne prouve rien.

---

## 5. La méthode de travail qui garde un code solide

C'est ce qui sépare un prototype d'un outil professionnel. Le dépôt applique déjà ces règles, et la CI les vérifie.

1. **Une évolution = une branche.** `git switch -c evolution/<sujet>`. On ne travaille jamais directement sur `main`.
2. **La règle d'abord, testée, puis l'écran.** Toute règle métier vit dans `src/domaine/` (sans base, sans écran),
   avec son test. L'écran ne fait qu'afficher ce que le serveur décide.
3. **`npm run verifier` avant chaque commit.** Si ce n'est pas vert, on ne commite pas.
4. **Des commits petits et parlants** : « Pièce PRG : programme annexé à la convention », pas « modifs ».
5. **Pull request sur GitHub**, puis fusion seulement quand la CI est verte. Même seul, cela laisse une trace relisible.
6. **Base de données : on n'édite jamais une migration existante.** On modifie `src/serveur/bd/schema.ts`, puis
   `npm run db:generate -- --name <sujet>` crée un **nouveau** fichier.
7. **Journal et hypothèses à jour.** Une entrée dans `DEV_LOG.md` par évolution ; tout choix fait à ta place va
   dans `docs/HYPOTHESES.md`.
8. **Secrets hors du code.** Clé d'API IA et mot de passe SMTP se saisissent dans l'application (chiffrés en base) ;
   `.env`, `.cle-secrets` et `donnees/` restent sur la machine, jamais dans Git.
9. **Avec Claude.** Donne-lui le dépôt entier (dossier connecté), demande-lui de lancer `npm run verifier` et de
   **montrer** le résultat. Une affirmation « c'est corrigé » sans test vert n'a aucune valeur.

---

## 6. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `node` n'est pas reconnu | Node.js n'est pas installé, ou le terminal a été ouvert avant l'installation | Installer Node 22, puis rouvrir le terminal |
| `EADDRINUSE :3001` | L'application tourne déjà | Fermer l'autre terminal, ou mettre `PORT=3002` dans `.env` |
| « PDF : indisponible » | Chrome ou Edge introuvable | Aucun blocage : les pièces sont en HTML imprimable. Sinon, renseigner `CHROMIUM_PATH` |
| Les boutons de génération sont grisés (« L'assistant IA n'est pas configuré ») | Aucune clé enregistrée, ou assistant désactivé | Admin → **Organisme → Assistant IA** (voir 3.3) ; pour essayer sans clé, `IA_FACTICE=oui` |
| « Clé d'API IA refusée » | Clé erronée ou révoquée | Recréer une clé sur la console Anthropic et la coller dans Organisme → Assistant IA |
| « Identifiants refusés par le serveur SMTP » avec Gmail | Mot de passe habituel utilisé | Créer un **mot de passe d'application** Google (voir 3.3 bis) |
| Les e-mails restent « Journalisé » dans la boîte d'envoi | Envoi réel non activé | Admin → **Organisme → E-mails** → **Envoyer réellement les e-mails**, puis test |
| « Ce lien n'est plus valable » sur la page d'un formulaire apprenant | Lien de plus de 45 jours, ou remplacé par un renvoi | Ouvrir l'e-mail le plus récent, ou **Renvoyer** depuis le dossier |
| Un test échoue après une modification | Une règle métier a changé | Lire le nom du test : il cite l'exigence. Corriger le code, ou le test si la règle a **vraiment** changé (et le noter au DEV_LOG) |
| « Another git process seems to be running » | Un verrou Git est resté | Fermer VS Code, puis supprimer le fichier `.git\index.lock` |
| « compte formateur pilote … ADRESSE DÉJÀ UTILISÉE » au démarrage | `ludoalbisser@gmail.com` sert déjà à un compte apprenant de ta base | Repartir d'une base neuve (supprimer `donnees`), ou mettre une autre adresse dans `COMPTE_PILOTE_EMAIL` |
| Le bouton « Générer le parcours » reste grisé | Intitulé ou durée en heures manquant | Les renseigner dans l'onglet *1. L'essentiel* |
| « La somme des durées des modules … » à l'enregistrement | Les modules ne totalisent pas la durée de la formation | Ajuster une durée de module, ou la durée totale |
| « Ce lien a expiré » sur la page de positionnement | Lien de plus de 30 jours, ou remplacé par une relance | *Positionnements* → **Relancer** : un nouveau lien part |
| Le PDF de positionnement s'ouvre en HTML | Chrome/Edge introuvable au moment de la signature | Renseigner `CHROMIUM_PATH`, ou imprimer le HTML en PDF |
