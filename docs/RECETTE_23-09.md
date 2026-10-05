# Recette du 23/09/2026 : la nouvelle série de tests

Il y a deux familles de tests. Les **tests automatiques** tournent seuls, à chaque commit et dans la CI. La
**recette manuelle** se fait à la main, avant une mise en ligne. Tous les tests automatiques ci-dessous ont été
**exécutés** et sont **verts**.

## 1. Lancer les tests

```bash
npm run verifier    # typage + lint + 236 tests (environ 40 secondes)
npm run test:e2e    # 7 parcours dans un vrai navigateur (environ 1 minute)
npx vitest run tests/integration/cdc-oral-23-09.test.ts   # seulement la recette du cahier oral
```

## 2. Tests automatiques ajoutés

### 2.1 Recette du cahier des charges oral : `tests/integration/cdc-oral-23-09.test.ts` (15 tests)

Chaque test porte, **dans son nom**, la phrase du cahier des charges qu'il vérifie. Il utilise une vraie base
PostgreSQL en mémoire, avec trois acteurs.

| # | Test | Exigence |
|---|---|---|
| 1 | L'IA propose objectifs et programme ; rien n'est enregistré sans le formateur | O-02, O-12 |
| 2 | L'IA propose un QCM fondé sur la formation ; une réponse inexploitable est refusée | O-12 |
| 3 | L'IA est réservée au formateur ; sans configuration, elle est indisponible | O-12 |
| 4 | À l'invitation, la page de l'apprenant commence par l'étape préliminaire | O-04 |
| 5 | Constituer le dossier exige recueil + positionnement + dossier enregistré, avec la liste exacte des manques | O-05 |
| 6 | Le programme détaillé est exigé (la convention l'annonce « en annexe ») | O-07 |
| 7 | Seul l'admin valide ; ni le formateur ni l'apprenant | O-06 |
| 8 | Après validation, la section financement contient pré-dossier, convention, planning et programme, téléchargeables ; l'e-mail à l'entreprise joint le programme | O-07 |
| 9 | Impossible d'affirmer le dépôt tant que la convention n'est pas signée | O-09 |
| 10 | Signer en ligne ou redéposer fait passer la pièce à « Validé » | O-08 |
| 11 | L'apprenant coche « j'affirme avoir déposé » **par l'API, avec sa propre session** : la section passe à « terminé », le formateur est prévenu, le journal garde l'auteur, et la déclaration ne se rejoue pas | O-09 |
| 12 | La section « Accord de financement » apparaît d'elle-même après la déclaration | O-10 |
| 13 | L'apprenant dépose l'accord : l'ordre de mission part et le coffre-fort s'ouvre | O-11 |
| 14 | L'accord est déposable par l'apprenant, le formateur et l'organisme | O-11 |
| 15 | Une convention rendue deux fois est **identique à l'octet près**, son montant est calculé, et l'IA n'a jamais vu le dossier | O-12 (exactitude) |

### 2.2 Test de garde de l'architecture : `tests/integration/ia-perimetre.test.ts` (4 tests)

Ce test **lit le code source**. Si quelqu'un, humain ou IA, branche un jour l'assistant IA sur la génération des
pièces, le pipeline, les dossiers, les signatures ou le BPF, la CI échoue. La règle « tout doit être exact » devient
ainsi vérifiable, au lieu de reposer sur la mémoire.

### 2.3 Tests du noyau (instantanés, sans base de données)

| Fichier | Tests | Ce qu'il prouve |
|---|---|---|
| `src/domaine/parcours/apprenant.test.ts` | 15 | Ordre et état des cinq sections, dans tous les cas : invitation, recueil seul, formation sans test de positionnement, dossier soumis, validé, déclaré, accord reçu avant la déclaration, refus, archivage |
| `src/domaine/pedagogie/propositions.test.ts` | 10 | Consignes envoyées à l'IA (aucun prix, aucun apprenant) ; refus des QCM mal formés et des programmes trop courts ; extraction du JSON |
| `src/domaine/pipeline/pipeline.test.ts` | +1 | La déclaration de dépôt est refusée sans convention signée, pour les trois rôles. L'apprenant n'a qu'une seule transition possible |
| `src/client/navigation.test.ts` | 6 | Trois espaces dans l'ordre ; générateur dans l'espace formation ; aucun lien mort ; menus de l'admin, de l'apprenant et du formateur non validé |

### 2.4 Parcours navigateur ajoutés ou modifiés : `tests/e2e/parcours.spec.ts`

- **Nouveau** : le menu principal présente les trois espaces, dans la page et dans le rail latéral.
- **Nouveau** : l'apprenante signe la convention, coche « J'affirme avoir déposé… » ; la section change d'état et la section « Accord » apparaît.
- **Modifié** : dans le générateur, on revient sur l'onglet « Apprenant(s) » puis « Formation » sans rien perdre.
- **Modifié** : l'admin voit deux pièces « Transmis » (planning et programme).

## 3. Recette manuelle, avant une mise en ligne (environ 1 heure)

Lance `npm start`, ouvre <http://localhost:3001>, et coche chaque ligne. Mot de passe de tous les comptes :
`demonstration-s4m`.

| ✓ | Qui | Action | Résultat attendu |
|---|---|---|---|
| ☐ | formatrice@demo.example | Se connecter | Accueil « Bonjour Sophie » avec trois cartes : Espace pédagogique, Espace apprenant, Espace formation |
| ☐ | formatrice | Espace formation → Générateur de conventions : choisir un apprenant, « Reprendre la fiche », corriger le téléphone | Fiche mise à jour sans quitter le générateur |
| ☐ | formatrice | Aller jusqu'à « Financement », puis cliquer sur l'onglet « Apprenant(s) » | Retour possible, sélection conservée ; le récapitulatif final est juste |
| ☐ | formatrice | Créer le dossier, puis « Demander la validation » | Bouton bloqué, avec le motif (RG-02 et la liste des manques, dont le programme) |
| ☐ | formatrice | Inviter l'apprenant (bouton « Inviter ») | Lien copié ; e-mail visible dans la « Boîte d'envoi » |
| ☐ | apprenant invité | Ouvrir le lien, choisir un mot de passe | Page du dossier ; première section jaune « Étape préliminaire » avec recueil et positionnement |
| ☐ | apprenant | Remplir le recueil puis le test | Section 1 verte ; section 2 « En cours » |
| ☐ | formatrice | Compléter dates, planning, lieu, programme ; soumettre | Dossier « En cours de validation » |
| ☐ | admin@demo.example | Valider le dossier | Pièces générées ; e-mail à l'entreprise avec convention, planning **et programme** |
| ☐ | apprenant | Ouvrir le dossier | Section 3 jaune : pré-dossier, convention (à signer), planning et programme (« Transmis ») ; case de déclaration grisée tant que la convention n'est pas signée |
| ☐ | apprenant | Signer la convention (tracé, lieu, consentement), puis cocher « J'affirme avoir déposé… » et confirmer | Section 3 **verte** ; la section 4 « Accord de financement » **apparaît** |
| ☐ | formatrice | Boîte d'envoi | E-mail « demande de financement déposée » |
| ☐ | apprenant **ou** formatrice **ou** admin | Déposer l'accord (PDF) | Dossier « Accord de financement » ; ODM envoyé au formateur ; supports visibles par l'apprenant |
| ☐ | formatrice (IA activée) | Mes formations → nouvelle formation → « Proposer objectifs et programme » | Champs pré-remplis, bandeau « Brouillon proposé par l'IA » ; rien n'est enregistré avant « Enregistrer » |
| ☐ | formatrice (IA activée) | Outils → nouveau test rattaché à une formation → « Proposer 10 questions » | 10 questions éditables, bonne réponse cochée |
| ☐ | formatrice (IA **désactivée**) | Mêmes écrans | Aucun bouton IA ; tout le reste fonctionne |
| ☐ | téléphone (ou fenêtre étroite) | Parcourir l'espace de l'apprenant | Pas de défilement horizontal ; les sections restent lisibles |
