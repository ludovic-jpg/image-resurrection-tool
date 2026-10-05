# Architecture

## Vue d'ensemble

```
   Navigateur ──────────►  API HTTP (Hono)  ──►  Services  ──►  NOYAU MÉTIER (pur)
   React · TanStack          mince :               cas            règles du cahier
                             session, erreurs      d'usage        des charges
                                                     │
                                       ┌─────────────┼──────────────┬───────────┐
                                       ▼             ▼              ▼           ▼
                                  PostgreSQL      Archive        Courrier      PDF
                                  (PGlite local   (disque ;      (boîte        (Chromium ;
                                  ou serveur)     Drive/S3       locale ;      repli HTML)
                                                  plus tard)     SMTP)
```

Trois couches, une seule direction de dépendance : **l'interface dépend de l'API, l'API des services, les
services du noyau. Le noyau ne dépend de rien.**

## Les trois décisions qui structurent tout

### D1 — Un noyau métier pur

`src/domaine` contient toutes les règles du cahier des charges : variables, pièces, pipeline, signature, BPF.
Il n'importe ni la base, ni le réseau, ni React, ni aucun module `node:`. Ce n'est pas une convention : ESLint
l'impose (`no-restricted-imports` dans `eslint.config.js`) et la CI échoue si la règle est violée.

Ce que cela achète : les 140 tests du noyau s'exécutent en une seconde, sans base ni navigateur. Les règles qui
ne doivent jamais casser — « un formateur ne valide pas son propre dossier », « pas de soumission sans recueil ni
positionnement » — sont prouvées là, une fois, indépendamment de toute technique.

### D2 — Une seule ligne de vérité par pièce

Le cahier des charges demande une « synchronisation bidirectionnelle » du statut d'une pièce entre l'espace de
communication, le dossier et la carte du pipeline (F-COM-08, F-OF-04, RG-03). L'application ne synchronise rien :
il existe **une** ligne `piece_dossier` par pièce (et par stagiaire pour une pièce individuelle), et les trois
écrans lisent cette ligne. La désynchronisation est impossible par construction.

### D3 — Le pipeline est une machine à états gardée par rôle

Aucun écran, aucune route ne modifie un sous-statut directement. Tout passe par `transiter()`
(`src/domaine/pipeline/transitions.ts`), qui vérifie dans l'ordre : le dossier n'est pas archivé, l'action est
possible à cette étape, **elle relève du rôle de l'acteur**, un motif est fourni s'il est exigé, la garde métier
est satisfaite. Elle retourne le nouveau sous-statut et la **liste des effets** à exécuter ; c'est le service
`pipeline.ts` qui les exécute (générer les pièces, écrire à l'entreprise, envoyer l'ODM, ouvrir le coffre…).

L'interface ne devine rien : `lireDossier` renvoie `actions` (avec `bloqueePar` en clair) et, pour chaque pièce,
`peut_signer` / `peut_deposer`. Un bouton n'existe que si le noyau l'autorise.

| Action | Qui | De → vers | Garde | Effets |
|---|---|---|---|---|
| Demander la validation | formateur | Brouillon → En cours de validation | RG-02 + saisie complète | prévenir l'admin |
| Renvoyer pour correction | admin | En cours de validation → Brouillon | motif obligatoire | prévenir le formateur |
| Valider le dossier | admin | → Dossier validé | organisme configuré | **pièces de départ** + **e-mail entreprise** (RG-04) |
| Déclarer le dépôt | formateur, admin | → Dossier déposé | — | — |
| Enregistrer l'accord | **système** | → Accord de financement | pièce Accord déposée | **ODM** + **coffre ouvert** (RG-06, RG-08) |
| Enregistrer un refus | formateur, admin | → Refus de financement | justificatif déposé | archivage (RG-07) |
| Envoyer les éléments pédagogiques | formateur, admin | → AF — Envoi… | — | convocations + e-mails |
| Démarrer la formation | formateur, admin | → Formation en cours | — | émargement, évaluation des acquis |
| Déclarer la formation terminée | formateur, admin | → Dossier incomplet / complet | — | attestation, satisfaction |
| Réévaluer la complétude | **système** | Incomplet ↔ Complet | — | — |
| Émettre la demande de paiement | admin | Complet → Demande de paiement | — | facture de l'OF |
| Enregistrer le paiement | admin | → Paiement réceptionné | — | — |
| Archiver | admin | → Formateur payé / archivé | facture du formateur déposée | lecture seule |

## Données

PostgreSQL partout : **PGlite** en local et dans les tests (PostgreSQL compilé en WebAssembly — un simple dossier
sur le disque), un serveur PostgreSQL en production. Même schéma Drizzle, mêmes migrations SQL (`drizzle/`),
**rejouées à chaque démarrage** : le code et le schéma ne peuvent plus diverger — c'était la cause des écrans
cassés de l'ancienne application, dont le code lisait des tables jamais créées dans la base distante.

Conventions du schéma (`src/serveur/bd/schema.ts`) :
- une colonne qui porte une donnée du dictionnaire a **le nom de la variable harmonisée** (`of_siret`,
  `formation_titre`) : base, noyau et gabarits parlent la même langue ;
- toute table racine porte `of_id` — la plateforme est multi-organismes, l'étanchéité se joue là ;
- groupes répétables = tables enfants (`stagiaire_dossier`, `seance`) ; les colonnes `stagiaire_1..8` et
  `session_1..20` n'existent que le temps de générer un document ;
- montants en **centimes entiers** ; dates en texte ISO ; horodatages en `timestamptz` ;
- le dossier porte un **instantané** de la formation : modifier le catalogue ne réécrit pas les dossiers.

## Cloisonnement

Trois niveaux, tous vérifiés par des tests d'intégration :
1. **Entre organismes** : chaque requête filtre sur `acteur.of_id`.
2. **Entre formateurs** (§9 du cahier des charges) : `accederAuDossier`, `lireFormation`, `lireStagiaire`…
   répondent « introuvable » — et non « interdit » — pour ne pas révéler l'existence d'une ressource.
3. **Pour l'apprenant** : `peutVoir()` ne lui ouvre que l'espace « Communication Apprenant » et, pour les pièces
   individuelles, que les siennes. Jamais l'ODM, les factures, les finances ni le journal.

L'acteur est toujours reconstruit côté serveur à partir de la session ; aucun identifiant de rôle ou
d'organisme n'est lu dans le corps d'une requête.

## Pièces, signature et archive

Génération : agrégat du dossier → `resoudreVariables` → `rendreGabarit` → HTML → (PDF si un Chromium est là) →
archive `Pièces de départ`. Le **HTML est toujours archivé** : c'est lui que l'empreinte scelle.

Signature en ligne (`retours.ts`) : le document est rendu **tel que présenté** au signataire, son empreinte
SHA-256 est calculée, la signature (tracé PNG, lieu, horodatage **serveur**, adresse IP, empreinte) est
enregistrée, le document est rendu à nouveau avec le bloc de signature, archivé dans `Retour` avec son certificat,
et l'empreinte du fichier archivé est scellée en base. `verifierIntegritePiece` recalcule cette empreinte à la
demande : un fichier modifié après coup est détecté.

Retour hors ligne : le fichier déposé suit le même chemin (archive `Retour`, empreinte scellée, pièce « Validé »).

## Sécurité — ce qui est en place

- Mots de passe : scrypt, sel par utilisateur, comparaison à temps constant ; 10 caractères minimum.
- Sessions : jeton aléatoire de 256 bits, **seule son empreinte est en base** ; cookie `HttpOnly`, `SameSite=Lax`,
  `Secure` en production ; 12 heures ; toutes fermées au changement de mot de passe.
- Anti-force brute : 5 échecs par adresse sur 15 minutes ; réponse identique que le compte existe ou non.
- CSRF : toute requête d'écriture exige un en-tête que seul le code de l'application peut poser.
- Fichiers : taille bornée, extensions en liste blanche, noms assainis, chemins confinés à la racine de l'archive,
  type MIME déduit côté serveur.
- Documents affichés dans un cadre isolé (`sandbox`, CSP `default-src 'none'`) ; valeurs échappées dans les gabarits.
- Erreurs : un message lisible pour l'utilisateur, le détail technique dans le journal du serveur seulement.

## Ce qui n'est PAS fait (et où le brancher)

| Sujet | État | Point d'extension |
|---|---|---|
| Archivage sur Google Drive ou S3 | disque local | implémenter l'interface `Archive` (`ports/archive.ts`) |
| Génération de QCM par IA (présente dans l'ancien outil) | hors périmètre | un service appelant `enregistrerOutil` |
| Espace propre à l'entreprise | l'entreprise reçoit des e-mails | nouveau rôle dans `Role` et `peutVoir` |
| Barème de commission dégressif | taux unique par organisme | `calculs.ts` |
| Tableau de bord satisfaction (Qualiopi 30) | réponses archivées | lecture de la table `evaluation` |
