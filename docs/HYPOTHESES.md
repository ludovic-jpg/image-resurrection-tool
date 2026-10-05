# Hypothèses à faire valider

Le cahier des charges laisse dix points ouverts, la skill `conventions-s4m` en ajoute six. Décision du 20/09/2026 :
avancer sur des **hypothèses par défaut**, chacune isolée en un seul endroit du code pour être changée sans risque.
Aucune n'a été tranchée « à la place » du porteur de projet : ce fichier est la liste de ce qui reste à lui.

## Points ouverts du cahier des charges (§10)

| # | Question | Hypothèse appliquée | Où la changer |
|---|---|---|---|
| 1 | Nature du « Pré-dossier » | Pièce `PRE` : synthèse du recueil et du positionnement, signée une fois par l'apprenant | `referentiel/pieces.ts`, `gabarits/PRE.html` |
| 2 | Déclenchement de l'ODM | Automatique dès le dépôt de l'Accord, sans validation intermédiaire (lecture littérale de RG-06) | `pipeline/transitions.ts` → `enregistrer_accord` |
| 3 | Accord : un document ou un par espace | Un seul document partagé ; le premier dépôt vaut pour tous (cohérent avec D2) | — |
| 4 | Facture de l'OF côté formateur | Consultation seule : transmise, sans statut | `pieces.ts` → `11-FIN.suiviStatut` |
| 5 | Contenu du coffre ouvert à l'apprenant | Seulement les fichiers marqués « partagé » par le formateur | `formations.ts` → `coffresDeLApprenant` |
| 6 | Pièces de la candidature | CV, identité, diplômes obligatoires ; K-bis, attestations, casier, autre facultatifs | `candidatures.ts` → `TYPES_PIECE_FORMATEUR` |
| 7 | Stockage cloud | Disque local ; interface `Archive` prête pour Drive ou S3 | `ports/archive.ts` |
| 8 | Contenu du BPF | Rubriques proposées par F-BPF-02 ; action rattachée à l'exercice de sa **date de fin** | `bpf/agregation.ts` |
| 9 | Durées de conservation | 10 ans, paramétrable par organisme ; **aucune purge automatique n'est codée** | écran « Organisme » |
| 10 | Anonymisation ou dissociation | Dissociation : compte supprimé, champs identifiants effacés, ligne « formateur » conservée anonyme ; les pièces déjà archivées ne sont pas réécrites | `services/rgpd.ts` |

## Incohérences relevées par la skill `conventions-s4m`

Deux SIRET, deux numéros de TVA, tribunal compétent, certification ICPF n° B02267, numéro Qualiopi jamais
renseigné : **ce ne sont plus des questions de code.** Ce sont des champs de l'écran « Organisme » ; la bonne
valeur est celle que l'admin saisit, et la validation d'un dossier est refusée tant que les champs obligatoires
sont vides. La sixième — signature de la convocation — suit le cahier des charges (6.4.2 : « Oui »).

## Choix faits en cours de développement, à confirmer

| # | Sujet | Choix | Pourquoi |
|---|---|---|---|
| 11 | **Qui signe la convention ?** | L'apprenant, dans son espace (tableau 6.4.2 du cahier des charges), alors que la pièce est juridiquement signée par le représentant de l'entreprise | Le cahier des charges n'ouvre pas d'espace à l'entreprise. Le bloc de signature nomme le signataire réel. **À trancher avant mise en production.** |
| 12 | **Valeur de la signature** | Signature électronique **simple** (tracé + horodatage serveur + empreinte + certificat), sans prestataire — décision du porteur de projet. Le §9 du cahier des charges parle de « valeur probante » | Ni avancée ni qualifiée au sens eIDAS. Avis juridique recommandé pour la convention et l'ODM. |
| 13 | **Authentification** | Écrite sur des primitives standard (scrypt, jetons hachés) plutôt qu'avec la bibliothèque annoncée au cadrage | Besoin réduit ; flux métier spécifiques de toute façon. **À faire relire par un tiers avant mise en production.** |
| 14 | Plusieurs apprenants par dossier | De 1 à 8 ; pièces individuelles (convocation, émargement, évaluations, attestation) en un exemplaire par stagiaire | Le cahier des charges parle de « l'apprenant », le référentiel de variables de 8 stagiaires |
| 15 | Modèle de commission | Prix de vente HT − commission de portage (taux de l'organisme) = net formateur ; un coût horaire saisi prime | Repris de l'ancien outil, sans son barème dégressif |
| 16 | Heures réalisées | Émargement électronique : somme des séances signées par le stagiaire. Feuille papier déposée : durée prévue | L'attestation atteste de la durée **réalisée** |
| 17 | Feuille d'émargement papier | Le formateur peut la **déposer** (il la cosigne) ; il ne peut pas la signer en ligne à la place de l'apprenant | Usage réel en salle |
| 18 | Satisfaction à chaud et à froid | Hors des deux espaces, renseignées en ligne, non bloquantes pour la complétude ; à froid : e-mail automatique à J+90 | Rattachement « à cadrer » selon le cahier des charges |
| 19 | Complétude du dossier (étape D) | Pré-dossier, convention, accord, ODM, convocation, émargement, évaluation des acquis, attestation | `pieces.ts` → `requisePourCompletude` |
| 20 | Mentions de la facture de l'OF | Pénalités de retard et indemnité forfaitaire de 40 € ajoutées (obligatoires entre professionnels), absentes de la matrice | À faire relire |

## Choix du 23/09/2026 (cahier des charges oral), à confirmer

| # | Sujet | Choix | Où le changer |
|---|---|---|---|
| 21 | **Qui déclare la demande de financement déposée ?** | L'apprenant, depuis son espace (« J'affirme avoir déposé… ») ; le formateur et l'OF le peuvent aussi (dépôt fait par l'entreprise) | `pipeline/transitions.ts` → `declarer_depot.acteurs` |
| 22 | **Déclaration avant la signature de la convention** | Refusée, quel que soit le rôle : pas de demande de financement sans convention signée | `pipeline/transitions.ts` → `declarer_depot.garde` |
| 23 | **Programme de formation (pièce `PRG`)** | Nouvelle pièce « 2 ter », annexe de la convention, transmise sans statut ; programme **obligatoire** avant soumission | `referentiel/pieces.ts`, `services/pipeline.ts` → `manquesAvantSoumission` |
| 24 | **Apparition de la section « Accord de financement »** | Dans l'espace de l'apprenant : seulement après la déclaration de dépôt. Côté serveur, l'accord reste recevable dès la validation (un accord peut arriver avant la déclaration) | `domaine/parcours/apprenant.ts` |
| 25 | **Fournisseur d'IA** | Claude (Anthropic), facultatif, désactivé par défaut ; seule la description de la formation est envoyée ; tout résultat est un brouillon relu par le formateur | `serveur/ports/ia.ts` (port remplaçable) |
| 26 | **Ordre des onglets du générateur** | Celui du cahier écrit (F-DOS-02) : apprenant, entreprise, formation, modalité, financement. La dictée disait « apprenant, entreprise, puis financement, etc. » | `client/ecrans/NouveauDossier.tsx` |


## Choix du 23/09/2026 (« Modification 1 »), à confirmer

| # | Sujet | Choix | Où le changer |
|---|---|---|---|
| 27 | **Positionnement sans compte** | Lien personnel de 30 jours (jeton aléatoire, seule son empreinte est stockée), renouvelé à chaque relance ; signature électronique simple | `services/positionnements.ts` |
| 28 | **Trame d'auto-positionnement** | Une question par objectif, échelle à 4 niveaux ; la « bonne réponse » est la maîtrise. Pour les acquis, même principe, à compléter par des questions de connaissances | `domaine/pedagogie/parcours.ts` |
| 29 | **Reprise du positionnement dans le dossier** | Automatique à la création du dossier, seulement si le test du dossier est identique à celui signé | `positionnements.ts` → `reprendrePositionnements` |
| 30 | **Identité du formateur après validation** | Nom et prénom figés (contrats signés) ; le reste du profil reste modifiable, et chaque modification est journalisée | `candidatures.ts` → `CHAMPS_FIGES_APRES_VALIDATION` |
| 31 | **Conservation des positionnements non suivis d'un dossier** | Aucune purge automatique (proposition : 12 mois) | à coder (`services/taches.ts`) |
| 32 | **Accès aux coffres-forts** | Formateur : lecture et écriture ; organisme : lecture ; apprenant : fichiers « partagés » après l'accord (RG-08 inchangée) | `services/coffre.ts`, `formations.ts` |
| 33 | **Support régénéré** | L'ancien PPTX du même module passe à la corbeille (restaurable) | `pedagogie-ia.ts` → `enregistrerSupport` |
| 34 | **IA : recherche web** | Désactivée par défaut (`IA_RECHERCHE_WEB=non`) ; les durées des modules ne sont jamais demandées à l'IA, elles sont imposées | `ports/ia.ts`, `config.ts` |
| 35 | **Compte pilote** | `ludoalbisser@gmail.com` créé au démarrage s'il manque, candidature validée, mot de passe de 8 caractères toléré pour ce seul compte ; jamais créé si l'adresse sert déjà à un autre rôle | `.env` → `COMPTE_PILOTE_*`, `bd/amorce.ts` |
