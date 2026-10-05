# « Modification 1 » du 23/09/2026 — état des lieux, fonctionnalités ajoutées, contrôles

Ce document répond au fichier **« Modification 1.docx »** (captures d'écran et consignes) et au message qui
l'accompagnait. Il se lit avec trois compagnons :

| Document | Pour quoi faire |
|---|---|
| [`GUIDE_LANCEMENT.md`](GUIDE_LANCEMENT.md) | La **notice de lancement** : installer, lancer, se connecter, tester |
| [`RECETTE_NARRATIVE.md`](RECETTE_NARRATIVE.md) | Le **scénario raconté** qui fait passer par toutes les fonctionnalités, avec avantages et limites pour un OF Qualiopi |
| [`SUITE_ET_TODO.md`](SUITE_ET_TODO.md) | Les **manquements** de cette version, les **points en suspens**, la **to-do** et ce que je peux entreprendre |

---

## 1. État des lieux de départ (ce que j'ai trouvé)

| Élément | État constaté le 23/09 |
|---|---|
| Base de code | `s4m-plateforme_5.zip` (commit `bd29d6f`, 21/09) **+** la surcouche `s4m-evolution-23-09` (54 fichiers : trois espaces, parcours apprenant, pièce PRG, IA pédagogique). La surcouche s'applique proprement : 236 tests verts avant toute modification. |
| `package.json` de la surcouche | Un fichier vide créé par `npm init` (et un `package-lock.json` vide) : **à ne pas copier**, il écraserait les dépendances. Je ne l'ai pas utilisé. |
| Dossier `Sk4m2309` | `exemple-convention.pdf` et `15-signature.png` : repères de forme pour la convention (vérifiés). Le document Word « de référence » cité dans la consigne n'était pas joint : j'ai utilisé le PDF d'exemple et le gabarit HTML existant. |
| Captures de la « Modification 1 » | Menu à trois espaces ; liste des apprenants (dont deux fiches « formatrix albisser » en doublon, avec `ludoalbisser@gmail.com`) ; fiche apprenant sans création d'entreprise ; choix de formation ; formulaire « Nouvelle formation » avec le niveau en saisie libre. |

## 2. Listing complet des fonctionnalités manquantes (avant cette version)

Chaque ligne cite la consigne, l'état trouvé, et ce qui est livré. **21 manques** relevés, **21 traités** ; les limites
de chaque traitement sont dans [`SUITE_ET_TODO.md`](SUITE_ET_TODO.md).

| # | Consigne (reformulée) | État trouvé | Livré dans cette version |
|---|---|---|---|
| M-01 | Niveau : **menu déroulant** | Saisie libre | Liste (Initiation → Expert, « Tous niveaux ») + « Autre… » en saisie libre, partout où le niveau apparaît |
| M-02 | **Générer le parcours** avec seulement titre, heures, jours, tarif, nombre de modules | Seul un bouton IA « objectifs + programme », invisible sans clé d'API | Générateur de parcours dans la fiche formation : **trame automatique toujours disponible** (sans IA ni réseau) **ou** assistant IA ; n modules exactement, durées réparties par demi-heure, objectifs, contenus, méthodes, mise en pratique, évaluation ; programme et objectifs rédigés d'office |
| M-03 | Le formateur **aménage** le contenu et l'**enregistre** | — | Éditeur de modules (ajouter, retirer, monter, descendre, tout modifier), contrôle « somme des modules = durée totale », bouton « Réécrire objectifs et programme depuis les modules » |
| M-04 | Même fonctionnalité pour le **test de positionnement** | Éditeur manuel ; IA seulement si configurée | « Générer le test de positionnement » depuis le parcours : trame (auto-positionnement par objectif, 4 niveaux) ou IA (questions de connaissances) → brouillon dans l'éditeur → enregistrer |
| M-05 | Même fonctionnalité pour l'**évaluation des acquis** | Idem | Idem (trame « je sais faire / avec aide / expliquer / pas encore » ou IA) |
| M-06 | **Supports de formation : un PPTX de 20 diapositives par module**, précédé de recherches approfondies, présentation cognitive et mise en page, partie mise en pratique | Inexistant | Atelier des supports : plan de **20 diapositives** par module (trame cognitive ou IA avec **recherche web** activable), **modifiable diapositive par diapositive**, puis **vrai fichier PPTX** (16:9, charte de l'organisme, notes du formateur, emplacement de visuel légendé) rangé dans le coffre-fort. Ou tous les modules d'un coup |
| M-07 | **Coffre-fort pédagogique par parcours**, rempli par défaut des supports et tests | Coffre = simple liste de fichiers dans la fiche formation | Page dédiée par parcours : supports générés, questionnaires (vierge / corrigé), programme (PDF) apparaissent **d'office** |
| M-08 | Le formateur **ajoute** d'autres supports | Dépôt sans rubrique | Dépôt avec **rubrique** (support, exercice, évaluation, ressource, vidéo, administratif, qualité), description, partage oui/non |
| M-09 | Coffre = **lien vers une autre page**, documents en **téléchargement et en chargement** | — | `/coffres/<parcours>` ; téléchargement unitaire et **ZIP complet** rangé par rubrique |
| M-10 | Page **interactive selon les pièces déposées** (partie administrative) + toujours la partie pédagogique | — | Onglet « Administratif » : documents administratifs/qualité, positionnements signés, et **chaque dossier du parcours** avec l'état de ses pièces (validée / en attente / transmise), barre de progression, téléchargements |
| M-11 | **Onglet coffre-fort** dans le menu, classé par parcours | Absent | Entrée « Coffre-fort pédagogique » dans l'espace pédagogique (et « Coffres-forts » côté organisme, en lecture) |
| M-12 | Nouvel apprenant → pouvoir **créer l'entreprise** | Liste déroulante des entreprises existantes seulement | « + Créer une nouvelle entreprise… » dans la liste : sous-formulaire (raison sociale, SIRET, OPCO, adresse, représentant) ; un seul enregistrement crée les deux fiches |
| M-13 | **Modifier la formation**, notamment la **partie financière** | Tarif seul au catalogue ; dossier limité à prix, OPCO, lieu, dates | Catalogue : tarif stagiaire **et** intra, mode de financement, financeur (liste des 11 OPCO + FAF…), coût horaire formateur, effectifs, lieu (dont SIRET), lien visio. Dossier : intitulé, niveau, modalité, heures présentiel/distanciel, SIRET du lieu, public, prérequis, **mode de financement, financeur, prix, coût formateur** — jusqu'à la validation |
| M-14 | **Tous les champs nécessaires à une convention** | Plusieurs non saisissables à l'écran | Tous les champs de la convention d'exemple sont saisissables (voir §4) ; l'OPCO de l'entreprise pré-remplit le dossier |
| M-15 | **Inviter un apprenant à se positionner** sur un parcours | Impossible hors dossier | Bouton « Positionner » sur chaque apprenant, dans la fiche formation, dans le coffre et dans « Positionnements » |
| M-16 | **E-mail automatique** avec accès à la **page dédiée** (nom, e-mail) | — | E-mail consigné dans la boîte d'envoi (ou envoyé en SMTP) ; lien personnel valable 30 jours ; page dédiée **sans compte à créer**, nom et e-mail affichés |
| M-17 | Il répond au **recueil des besoins** et au **test de positionnement** du parcours | — | Page en deux parties A et B, questions figées à l'envoi ; corrigé jamais envoyé au navigateur |
| M-18 | Il **tape ses réponses, date, signe par dessin**, **PDF** | — | Date (du jour, modifiable), lieu, **signature tracée**, case de certification ; **PDF** produit (repli HTML sans Chromium) avec empreinte SHA-256 des réponses |
| M-19 | **Si complet, tout le monde peut télécharger le PDF** | — | Apprenant (par son lien, et en pièce jointe), formateur, organisme ; un autre formateur n'y a pas accès |
| M-20 | **Profil et candidature** manquants | « Ma candidature » visible seulement **avant** validation ; aucun profil ensuite | « Mon profil et candidature » toujours accessible : profil étendu (statut juridique, domaines, zones, langues, tarif, RC Pro, bio, LinkedIn, disponibilités), **justificatifs avec échéance** et alerte, onglet candidature (statut, dates, motif) |
| M-21 | **Archivage**, **enregistrer à tout moment**, **faire réapparaître** | Formations « retirées » invisibles pour toujours ; outils et fichiers supprimés définitivement | Archives et corbeille restaurables (formations, questionnaires, fichiers, apprenants, entreprises, positionnements) ; **historique des versions** (formations, questionnaires) ; **brouillon de secours** dans le navigateur ; brouillon **serveur** pour le positionnement ; **sauvegarde / restauration** de l'espace pédagogique (JSON) |
| + | Compte `ludoalbisser@gmail.com` / `1234ludo` (formateur) | — | Créé **à chaque démarrage s'il manque**, même sur une base existante, candidature validée |
| + | « Quand tu peux, fais des entrées à menu déroulant » | — | Niveau, domaine, modalité, nombre de modules, financement, financeur, civilité, DREETS, statut juridique, délai d'accès, sanction, handicap, rubriques, nombre de questions, moteur (trame/IA)… (`src/domaine/pedagogie/listes.ts`) |

## 3. Ce qui a été développé (vue technique)

### 3.1 Noyau métier (`src/domaine`, pur et testé)

- `pedagogie/listes.ts` — toutes les listes déroulantes, partagées par le serveur et l'écran.
- `pedagogie/parcours.ts` — modèle `ModuleParcours`, **répartition des heures**, **trame de parcours**, programme et
  objectifs déduits des modules, **trames de tests**, **trame de 20 diapositives**, validation stricte des modules et
  des plans (une proposition mal formée est refusée, jamais « réparée »).
- `pedagogie/propositions.ts` — consignes IA ajoutées : parcours complet (durées **imposées** par la plateforme) et
  plan de diaporama, avec l'étape de **recherche approfondie** puis de conception cognitive.

### 3.2 Serveur

- Migration **`drizzle/0002_modification_1.sql`** (appliquée seule au démarrage) : champs de convention et parcours au
  catalogue, rubriques et corbeille du coffre, archives, profil étendu, échéance des justificatifs, tables
  `version_objet` (historique) et `positionnement`.
- Services nouveaux : `coffre.ts` (coffre par parcours, programme PDF, questionnaires imprimables, ZIP),
  `positionnements.ts` (invitation, page publique, brouillon, signature, PDF, reprise dans le dossier),
  `supports.ts` (PPTX via `pptxgenjs`, documents imprimables), `sauvegarde.ts` (export, import, archives).
- Services enrichis : `formations.ts` (champs, cohérence, versions, archives, corbeille), `pedagogie-ia.ts` (trame ou
  IA pour parcours, tests, plans ; production des PPTX), `repertoire.ts` (entreprise créée avec l'apprenant, archives),
  `candidatures.ts` (profil étendu, échéances), `dossiers.ts` (reprise des champs du catalogue et des positionnements),
  `rgpd.ts` (effacement des nouvelles données), `amorce.ts` (compte pilote).
- Le **test de garde de l'IA** reste vert : seule la couche pédagogique appelle l'IA ; conventions, pièces, montants
  et pipeline restent produits sans IA.

### 3.3 Interface

Écrans nouveaux : **Coffre-fort** (liste + page par parcours), **Positionnements**, **page publique de
positionnement**, **Archives et sauvegarde**, **Historique des versions**. Écrans refondus : **Formation** (quatre
onglets, générateur, éditeur de modules, kit pédagogique), **Outils** (génération, archives, imprimables, historique),
**Apprenants** (entreprise à la volée, positionner, archiver), **Profil et candidature**, **Dossier** (partie
financière complète). Menu : « Coffre-fort pédagogique », « Positionnements », et un groupe « Mon espace » (profil,
archives) — les trois espaces restent exactement trois.

## 4. Champs de la convention : où les saisir

| Rubrique de la convention (PDF d'exemple) | Catalogue (formation) | Dossier (jusqu'à validation) |
|---|---|---|
| 1.1 Intitulé | ✅ | ✅ |
| 1.2 Objectifs + programme en annexe | ✅ (déduits du parcours) | ✅ |
| 1.3 Niveau | ✅ liste | ✅ liste |
| 1.4 Dates, planning | — | ✅ + séances |
| 1.5 Durée, dont présentiel / distanciel | ✅ | ✅ |
| 1.6 Effectif (stagiaires, postes) | effectif min/max | ✅ (apprenants du dossier) |
| 1.7 Lieu + SIRET du lieu | ✅ lieu habituel | ✅ |
| 1.8 Modalité | ✅ liste | ✅ liste |
| 1.9 Prérequis | ✅ | ✅ |
| 1.10 à 1.13 Moyens, sanction, assiduité, évaluation | ✅ (textes du catalogue, repris dans le programme) | texte type du gabarit |
| 3. Coût unitaire HT, nombre de stagiaires, total | ✅ tarif stagiaire + intra | ✅ prix, calcul automatique |
| 3. OPCO / financeur, subrogation | ✅ mode + financeur | ✅ mode + financeur (liste) |
| Coût formateur (ODM) | ✅ coût horaire | ✅ |
| Signature (lieu, date) | — | ✅ lieu ; date à la signature |

## 5. Contrôles exécutés (pas supposés)

| Contrôle | Avant (23/09 matin) | Après |
|---|---|---|
| Typage `tsc` | ✅ | ✅ |
| Lint `eslint` | ✅ | ✅ |
| Tests unitaires et d'intégration | 236 (17 fichiers) | **269 (18 fichiers)** ✅ |
| Parcours navigateur (Playwright, Chromium réel) | 7 | **11** ✅ |
| Build de production | ✅ | ✅ |
| Contrôle visuel | — | 13 captures (bureau et mobile 390 px) : pas de défilement horizontal ; un débordement de boutons corrigé |

Nouvelle recette automatisée : `tests/integration/modification-1.test.ts` (**32 tests**, un par consigne) et
`tests/e2e/modification-1.spec.ts` (**4 parcours** avec le compte pilote : génération du parcours, test de
positionnement, apprenant + entreprise, invitation, signature de l'apprenant, PDF, coffre-fort).

**Bogues trouvés et corrigés pendant la recette** : (1) les messages d'erreur de durée/tarif ne s'affichaient pas sous
le bon champ du formulaire formation ; (2) les boutons du kit pédagogique débordaient de leur carte ; (3) dans le test navigateur, le
tracé de signature tombait sous la barre d'actions collante en bas de la page publique (test corrigé ; en usage réel
l'apprenant voit la zone masquée et fait défiler — à surveiller en recette sur téléphone) ; (4) l'appel « produire le PPTX » envoyait un plan pas encore
nettoyé (nettoyage déplacé côté serveur, qui fait foi).
