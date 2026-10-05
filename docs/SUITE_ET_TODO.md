# Après la version 7 : manquements, points en suspens, to-do

> Mise à jour du 23/09/2026 (version 7). Traité depuis la « Modification 1 » : L-01 en partie (adaptateur testé sans réseau, assistant
> factice, premier appel réel à faire ensemble), **L-02 et L-03 réglés** (plus de trame : dossier d'enjeux + questions de connaissances),
> L-05 en partie (lien de 45 jours renouvelé à chaque renvoi ; pas encore de limitation de débit), L-06 réglé (relance J+7, à froid J+90),
> H-34 réglé (Sonnet 5, recherche web activée, réglable dans l'appli). Nouveaux points : révoquer la clé d'API qui a circulé dans un Word ;
> confirmer les ordres de grandeur de coût après les premiers appels réels ; limitation de débit des routes publiques `/api/public/*`.


Ce que cette version **ne fait pas encore**, ce qui **attend ta décision**, et ce qui reste **à faire**, par ordre de
priorité. Pour chaque ligne de la to-do : ce que je peux entreprendre moi-même dans une prochaine session, et ce qui
dépend de toi ou d'un tiers.

## 1. Manquements de cette version (dits franchement)

| # | Manquement | Conséquence | Gravité |
|---|---|---|---|
| L-01 | **L'IA n'a pas été testée en réel** : pas de clé d'API dans mon environnement. Les appels sont testés avec une IA factice ; le nom de l'outil de recherche web (`web_search_20250305`) et le modèle sont à vérifier sur <https://docs.claude.com> | Premier essai IA à faire avec toi ; un ajustement de consigne est probable | Moyenne |
| L-02 | La **trame** (sans IA) structure le parcours mais **ne connaît pas le sujet** : contenus génériques | Le formateur doit réécrire les contenus ; un auditeur repère un programme générique | Moyenne |
| L-03 | L'évaluation des acquis par la trame est une **auto-évaluation** | Insuffisante seule pour l'ind. 11 : ajouter des questions de connaissances ou une mise en situation | Moyenne |
| L-04 | Les **PPTX n'ont pas d'images** : un cadre « visuel suggéré » à remplacer. Pas d'export PDF des supports | Finition manuelle dans PowerPoint | Faible |
| L-05 | Le **lien de positionnement** suffit à répondre et signer (pas de code par e-mail) ; pas de limitation du nombre d'appels sur les routes publiques | Un lien transféré permet à un tiers de répondre ; valeur probante « simple » | Moyenne (à trancher, H-27) |
| L-06 | **Pas de relance automatique** des positionnements (relance manuelle seulement) ; pas de purge des positionnements jamais transformés en dossier | Suivi manuel ; donnée conservée sans durée définie (RGPD) | Moyenne |
| L-07 | Le **brouillon de secours** des formulaires vit dans le navigateur (un appareil) ; seul le positionnement a un brouillon côté serveur | Changer d'ordinateur en cours de saisie d'une formation perd le brouillon non enregistré (l'enregistrement, lui, est toujours possible) | Faible |
| L-08 | L'**OF ne peut pas modifier** le profil d'un formateur ni déposer dans son coffre depuis l'écran | Corrections d'identité par la base ou par le formateur | Faible |
| L-09 | La **sauvegarde JSON** ne contient ni les fichiers du coffre, ni les dossiers ; l'import ne recrée pas les fiches apprenants et entreprises | La vraie sauvegarde reste la copie de `donnees/` | Faible |
| L-10 | Pas de **tableau de bord OF** des attestations formateurs échues | Suivi ind. 27 à faire formateur par formateur | Faible |
| L-11 | Le compte pilote utilise un **mot de passe de 8 caractères** (la règle de l'application en exige 10) et un profil pré-rempli de **données fictives** (entreprise, SIRET, IBAN de démonstration) | À corriger dans « Mon profil » ; **changer le mot de passe avant toute mise en ligne** | Moyenne en production, nulle en local |
| L-12 | Si ta base locale contient déjà un compte **apprenant** avec `ludoalbisser@gmail.com` (tes essais), le compte formateur **n'est pas créé** (une adresse = un compte) ; le démarrage l'écrit en clair | Voir `GUIDE_LANCEMENT.md`, §6 | Faible |
| L-13 | Développé et testé sous **Linux** ; la portabilité Windows (déjà traitée le 21/09) n'a pas été re-testée sur ton PC | Premier `npm start` à faire ensemble si besoin | Faible |
| L-14 | Le fichier Word « de référence » pour la convention n'était pas joint | Si ce Word contient des champs absents du PDF d'exemple, envoie-le : je les ajoute | À confirmer |
| L-15 | Bundle de l'interface de 580 Ko (avertissement de compilation) | Premier affichage un peu plus lent sur mobile ; découpage à faire | Faible |

## 2. Points en suspens : décisions qui te reviennent

Ils complètent `HYPOTHESES.md` (n° 27 à 34). **Les trois bloquants d'avant restent bloquants** : n° 11 (qui signe
la convention), n° 12 (valeur de la signature), n° 13 (relecture de l'authentification).

| # | Question | Ce que j'ai fait par défaut | Ce que tu dois trancher |
|---|---|---|---|
| H-27 | Positionnement : lien personnel **sans compte** ? | Oui, lien de 30 jours, renouvelé à chaque relance | Garder, ou ajouter un code à usage unique envoyé par e-mail avant la signature |
| H-28 | Trame d'auto-positionnement acceptable pour ton certificateur ? | Oui pour le positionnement ; pas seule pour les acquis | Valider avec ton certificateur Qualiopi |
| H-29 | Reprise automatique du positionnement signé dans le dossier | Seulement si le test du dossier est **identique** à celui auquel l'apprenant a répondu | Confirmer |
| H-30 | Nom et prénom du formateur figés après validation | Oui (ils figurent sur les contrats signés) | Confirmer, et dire qui les corrige (l'OF ?) |
| H-31 | Durée de conservation des positionnements non suivis d'un dossier | Aucune purge | Proposer : 12 mois, puis suppression automatique |
| H-32 | Qui voit les coffres-forts | Formateur (écriture) ; OF (lecture) ; apprenant (fichiers partagés, après l'accord) | Confirmer, ou ouvrir l'écriture à l'OF |
| H-33 | Support régénéré | L'ancien passe à la corbeille | Confirmer |
| H-34 | IA : quel modèle, recherche web oui/non | Désactivée par défaut ; recherche web désactivée | Choisir le modèle, activer la recherche (coût supplémentaire) — et l'inscrire au registre RGPD |

## 3. To-do priorisée

| Priorité | Tâche | Qui | Charge estimée |
|---|---|---|---|
| **P0** | Recette racontée complète (`RECETTE_NARRATIVE.md`) sur ton PC, avec tes vraies formations | Toi (1 h 30), moi pour corriger les tickets | 1 session |
| **P0** | Trancher H-11, H-12, H-13 (bloquants de production) et H-27 à H-34 | Toi (+ juriste pour H-12) | — |
| **P0** | Premier essai de l'IA en réel (clé, modèle), réglage des consignes sur 2 formations | Toi (clé) + moi | 1 session |
| P1 | Relances automatiques des positionnements (J+3, J+7) et purge à 12 mois | Moi | 0,5 session |
| P1 | Code à usage unique avant signature du positionnement (si H-27 le demande) ; limitation de débit des routes publiques | Moi | 0,5 session |
| P1 | Tableau de bord OF : attestations échues, positionnements en attente, coffres incomplets | Moi | 1 session |
| P1 | Écran OF : corriger l'identité d'un formateur, déposer dans un coffre | Moi | 0,5 session |
| P2 | Supports : images (banque libre de droits ou images déposées), export PDF, choix de gabarit | Moi | 1 session |
| P2 | Sauvegarde complète en un clic (base + archive, chiffrée) côté OF | Moi | 0,5 session |
| P2 | Découpage du bundle (chargement à la demande des écrans) | Moi | 0,25 session |
| P2 | Préproduction en ligne (VPS UE, HTTPS, SMTP) — `GUIDE_LANCEMENT.md` §4 | Toi + moi en accompagnement | 1 demi-journée |
| P3 | Reprise des données de l'ancien outil Lovable | Moi, sur export fourni | à chiffrer |

**Ce que je peux entreprendre dès la prochaine session, sans attendre de décision :** P1 (relances, tableau de bord
OF, écran de correction OF), P2 (images et PDF des supports, sauvegarde complète, bundle). **Ce qui t'attend
d'abord :** la recette sur ton PC, les décisions H-11 à H-13 et H-27 à H-34, et une clé d'API si tu veux l'IA.
