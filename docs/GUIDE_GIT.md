# Git pas à pas — pour ce dépôt

Ce guide suppose que vous n'avez jamais utilisé Git en ligne de commande. Il couvre exactement ce dont ce projet a
besoin, et rien de plus.

## L'idée, en trois phrases

Git photographie l'état du projet à chaque **commit** ; on peut revenir à n'importe quelle photo.
Une **branche** est une copie de travail parallèle : on y casse ce qu'on veut sans toucher à `main`.
GitHub est un coffre distant : `push` y envoie vos commits, `pull` en rapporte ceux des autres.

`main` doit toujours fonctionner. Tout le reste découle de cette règle.

## 1. Publier le dépôt sur GitHub (une seule fois)

Le dossier contient déjà son historique (`.git`). Il reste à lui donner une adresse distante.

1. Sur github.com : **New repository** → nom `s4m-plateforme` → **Private** → ne cochez **rien** (ni README, ni
   .gitignore : le dépôt les a déjà) → **Create repository**.
2. Dans un terminal ouvert dans le dossier du projet :

```bash
git remote add origin https://github.com/<votre-compte>/s4m-plateforme.git
git push -u origin main
```

3. Ouvrez l'onglet **Actions** du dépôt : la CI tourne (typage, lint, tests, build, parcours navigateur).
   Une coche verte = le dépôt est sain sur une machine qui n'est pas la vôtre.

## 2. Le cycle de travail : une branche par module

Ne travaillez jamais directement sur `main`. Pour chaque évolution :

```bash
git switch main            # repartir de la version saine
git pull                   # la mettre à jour
git switch -c evol/relance-entreprise    # créer la branche et s'y placer
```

Travaillez. Puis, avant chaque commit :

```bash
npm run verifier           # typage + lint + tests. Rouge = on ne commite pas.
git status                 # ce qui a changé
git diff                   # le détail, ligne par ligne
git add -A                 # tout préparer
git commit -m "Relance de l'entreprise depuis le dossier (F-CRM-06 étendu)"
git push -u origin evol/relance-entreprise
```

Sur GitHub, un bandeau propose **Compare & pull request**. Ouvrez-la : la CI se relance sur la branche.
Verte → **Merge pull request** → **Delete branch**. Puis, chez vous :

```bash
git switch main
git pull
git branch -d evol/relance-entreprise
```

C'est la traduction exacte du « checkpoint » de votre protocole : *un module n'est fusionné que tous tests au vert*.
Pour le rendre impossible à contourner : GitHub → Settings → Branches → **Add branch protection rule** sur `main`
→ *Require status checks to pass before merging*.

### Conventions de nommage

| Préfixe | Usage |
|---|---|
| `evol/…` | une fonctionnalité nouvelle |
| `correctif/…` | un bogue |
| `doc/…` | documentation seule |

Un message de commit dit **ce que la version fait désormais**, au présent, avec la référence de l'exigence quand il
y en a une : « Refuse la soumission sans positionnement (RG-02) ».

## 3. Se sortir d'un mauvais pas

| Situation | Commande | Effet |
|---|---|---|
| J'ai modifié un fichier, je veux l'annuler | `git restore chemin/du/fichier` | revient à la dernière photo |
| J'ai tout cassé sur ma branche, rien n'est commité | `git restore .` | idem, pour tout |
| Mon dernier commit est mauvais, **pas encore poussé** | `git reset --soft HEAD~1` | défait le commit, garde les modifications |
| Un commit **déjà poussé** est mauvais | `git revert <identifiant>` | crée un commit inverse ; l'historique reste honnête |
| Je veux voir le projet tel qu'il était | `git log --oneline` puis `git switch --detach <identifiant>` | lecture seule ; retour : `git switch main` |
| Je suis perdu | `git status` | Git dit toujours où l'on est et propose la suite |

À ne jamais faire sur `main` : `git push --force`, `git reset --hard` sur des commits déjà poussés.

## 4. Les secrets

Le fichier `.env` n'est **jamais** versionné (`.gitignore` s'en charge) ; seul `.env.example`, sans valeur sensible,
l'est. Le dossier `donnees/` — base et archive, donc des données personnelles — non plus.

Avant un premier `push`, vérifiez :

```bash
git ls-files | grep -E "^\.env$|^donnees/"     # ne doit RIEN afficher
```

Si un secret part un jour sur GitHub : le considérer comme compromis, **le changer chez le fournisseur** d'abord,
nettoyer l'historique ensuite. L'effacer du dépôt ne suffit pas.

L'ancien dépôt `skills4mation` versionne son `.env`. Il ne contient que des clés publiques, donc rien à révoquer,
mais c'est une habitude à ne pas reproduire.

## 5. Travailler avec Claude sur ce dépôt

Ce qui a bien fonctionné pour construire cette version, et qui vaut pour la suite :

1. **Une session = un module = une branche.** Donnez l'exigence (`F-…`), le critère d'acceptation, et rien d'autre.
2. **`DEV_LOG.md` est la mémoire du projet.** Une nouvelle session ne sait rien de la précédente : faites-lui lire
   `DEV_LOG.md` et `docs/ARCHITECTURE.md` en premier. Demandez-lui d'y écrire sa décision avant de conclure.
3. **Exigez le vert.** « Lance `npm run verifier` et montre-moi la sortie » vaut mieux que « est-ce que ça marche ? ».
4. **Pour développer au quotidien sur votre machine**, Claude Code (dans un terminal, à la racine du dépôt) est
   l'outil adapté : il lit, modifie, teste et commite sur place. Cowork convient mieux aux tâches autour du code —
   analyser un cahier des charges, produire un document, préparer une recette.
