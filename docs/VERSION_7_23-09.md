# Version 7 (23/09/2026) — journal de production

Réponse au document **« modif.docx »** (captures + consignes) et au questionnaire du 23/09 au soir.
Se lit avec `GUIDE_LANCEMENT.md` (installer, lancer, régler l'IA et les e-mails) et `SUITE_ET_TODO.md` (ce qui reste).

## 1. Décisions prises (questionnaire du 23/09)

| Sujet | Décision du porteur de projet | Traduction dans l'application |
|---|---|---|
| Envoi des e-mails | SMTP de sa messagerie (Gmail / Google Workspace) | Onglet **Organisme → E-mails** : préréglage Gmail, mot de passe d'application, bouton d'e-mail de test, renvoi depuis la boîte d'envoi |
| Trames sans IA | Supprimées partout (parcours, tests, supports) | Toute génération passe par l'IA ; sans clé, les boutons sont grisés avec la marche à suivre |
| Saisie par le formateur | Supprimée : seul l'apprenant répond | Le formateur **envoie** le formulaire ; l'apprenant répond et signe sur sa page |
| Coût horaire formateur | Supprimé | Retiré du catalogue et du dossier ; rémunération = calcul par commission |
| Formulaires en page interactive | Les cinq : recueil, positionnement, acquis, satisfaction à chaud et à froid | Service `formulaires-apprenant` + page publique `/formulaire/<jeton>` |
| Déclenchement | Automatique **et** bouton | Création du dossier → recueil + positionnement ; formation terminée → acquis + à chaud ; J+90 → à froid ; relance unique à J+7 ; bouton « Envoyer / Renvoyer » |
| Modèle IA | Claude Sonnet 5 | Par défaut, modifiable dans **Organisme → Assistant IA** (Opus 5.5, Haiku 4.5) |

## 2. Ce qui a été fait, point par point du document « modif.docx »

| Consigne | Livré |
|---|---|
| « L'assistant IA n'est pas encore configuré » | Réglage **dans l'application** (clé, workspace, modèle, recherche web), clé chiffrée en base, jamais réaffichée ; `.env` ne sert plus que de valeur par défaut. La clé fournie dans le Word n'est **pas** rattachée à un workspace : l'API exige alors l'identifiant du workspace — champ prévu, message d'erreur explicite |
| « Le contenu des tests et modules est très générique » | **Dossier d'enjeux** par formation : l'IA mène une recherche web sur le titre réel (enjeux, cadre réglementaire, notions clés, erreurs fréquentes, pratiques actuelles, glossaire, sources) ; enregistré sur la formation (onglet « 2. Enjeux »), injecté dans toutes les consignes suivantes. Consignes réécrites en mode expert (alignement pédagogique, Bloom, charge cognitive, distracteurs plausibles, contenu rédigé sur les diapositives) |
| « Recherche web via API Claude pour chaque formation » | Outil `web_search` d'Anthropic (version 20260318), localisé France, 3 à 8 recherches selon la tâche, sources consignées et affichées |
| « Public visé et prérequis pré-remplis depuis le parcours » | Proposés par l'IA à la génération du parcours, enregistrés sur la formation, repris dans chaque nouveau dossier (modifiables jusqu'à validation) |
| « Les envois de mails ne sont pas fonctionnels » | Cause : mode « boîte locale » par défaut, SMTP uniquement par `.env`. Désormais réglable à l'écran, testable en un clic, erreurs traduites (identifiants refusés → « mot de passe d'application »), renvoi possible |
| « Supprimer coût horaire formateur » | Fait (catalogue, dossier, schémas de saisie) |
| « Supprimer la trame d'auto-positionnement / la saisie par le formateur » | Fait (voir décisions) |
| « L'apprenant clique → page interactive avec son nom, formation, formulaire → répond, signe, validé, rangé dans les dossiers » | Fait : e-mail avec lien personnel (45 jours) **et** document d'invitation PDF avec **QR code** ; page mobile d'abord ; brouillon reprenable ; signature tracée ; la pièce est rendue **avec la signature**, archivée dans « Retour » avec son certificat, passe à « Validé » et apparaît aussitôt dans le dossier, l'espace de l'apprenant et le coffre-fort du parcours ; document signé envoyé à l'apprenant et au formateur |

## 3. Vue technique

**Serveur** — `ports/ia.ts` réécrit (retries 429/5xx/réseau, reprise `pause_turn`, détection `max_tokens`, cache de consigne, en-tête workspace, usage et sources retournés, assistant **factice** `IA_FACTICE=oui` pour essayer sans clé) ; `ports/chiffrement.ts` (AES-256-GCM, clé `CLE_SECRETS` ou fichier `.cle-secrets`) ; `ports/courrier.ts` (résolveur SMTP par organisme, erreurs expliquées) ; `services/reglages.ts` ; `services/formulaires-apprenant.ts` (envoi, page publique, signature, relances, à froid) ; `services/pedagogie-ia.ts` (enjeux → parcours / tests / supports, seconde tentative sur réponse mal formée, usage journalisé) ; `evaluations.ts` (cœur `enregistrerReponses` sans rôle) ; migration `0003_version_7.sql` (tables `reglage`, `formulaire_apprenant`, colonnes `dossier_enjeux`, `enjeux_le`) ; nouvel effet de pipeline `ENVOYER_FORMULAIRES_DE_FIN`.

**Interface** — Formations (onglet Enjeux, progression de génération en deux temps, kit pédagogique en 5 étapes avec état), Outils et Coffre (IA seule), Dossier (section « Formulaires de l'apprenant » avec état, envoi, invitation PDF, aperçu de la pièce), page publique `Formulaire.tsx`, Organisme à onglets (Identité / Assistant IA / E-mails), Boîte d'envoi (statut, erreur, renvoi, filtre).

**Qualité** — 310 tests unitaires et d'intégration (dont 37 nouveaux dans `version-7.test.ts`), 14 scénarios navigateur Playwright (dont 3 nouveaux), typage strict, lint, build ; relecture code + UX par un second agent (Fable) : échappement HTML, secrets, cas limites, libellés, accessibilité, mobile.

## 4. Défauts corrigés en cours de route (relevés par les tests)

- `/api/ia/etat` renvoyait une promesse non attendue → l'interface croyait l'IA absente.
- L'assistant factice répondait un dossier d'enjeux à la place d'un parcours (motif de détection trop large).
- Nom de l'administrateur non échappé dans l'e-mail de test ; message de déchiffrement illisible si la clé change.
- Jeu de démonstration : dépendait des trames et de la saisie formateur ; réécrit.

## 5. Limites connues (franches)

1. **L'IA réelle n'a pas été appelée depuis mon environnement** : la clé fournie n'était pas rattachée à un workspace, et l'exécution d'appels réseau avec cette clé a été bloquée par sécurité. Tout est testé avec un faux serveur (retries, pause, sources) et l'assistant factice. **Premier essai réel à faire ensemble** (clé + identifiant de workspace dans Organisme → Assistant IA).
2. **La clé d'API a circulé dans un fichier Word** : la révoquer et en créer une nouvelle (console.anthropic.com), idéalement rattachée à un workspace.
3. Un renvoi ou une relance J+7 **remplace le lien** du premier e-mail (l'ancien ne fonctionne plus, message explicite).
4. Ordres de grandeur de coût affichés (0,20-0,50 € par parcours, 0,10-0,20 € par support) à confirmer après les premiers appels réels (l'usage est journalisé événement par événement).
5. Bundle de l'interface ≈ 640 Ko : découpage à faire.
6. Les PPTX restent sans images (cadre « visuel » à remplacer).
