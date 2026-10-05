# Carte des routes — migration Skills4mation vers Lovable + Supabase

Document de travail produit à partir de `src/serveur/http/app.ts` (116 routes), des services `src/serveur/services/*.ts`, des ports `src/serveur/ports/*.ts` et de `docs/ARCHITECTURE.md`. Il sert de contrat entre trois chantiers menés en parallèle : la migration SQL (tables, RLS, fonctions `s4m_*`), les Edge Functions (Deno) et le front Lovable.

## 0. Conventions retenues

- **Trois cibles possibles par route** :
  - **Client + RLS** : le front appelle Supabase directement (`supabase.from(...)`, Storage). L'étanchéité est garantie par les politiques RLS fondées sur `s4m_of_id()`, `s4m_role()`, `s4m_formateur_id()`, `s4m_est_admin()`. La validation Zod des services est reportée côté client (schémas copiés tels quels) et doublée par des contraintes `CHECK` en base.
  - **RPC SQL** : fonction PostgreSQL appelée par `supabase.rpc()`, pour une opération atomique multi-tables ou une projection qu'une politique RLS ne sait pas exprimer. **SECURITY INVOKER par défaut** (droits et RLS de l'appelant). Exceptions nommées, en SECURITY DEFINER avec contrôles explicites : `s4m_moi()`, `s4m_questionnaire()` (l'apprenant ne lit pas `dossier_formation` ; corrigé masqué), `s4m_restaurer_version()` (écrit `version_objet`), `s4m_objectifs_atteints()` (une colonne hors fenêtre de modification). Les fonctions internes `s4m_journal` / `s4m_memoriser_version` ne sont pas exécutables par un client.
  - **Edge Function `<nom>`** : fonction Deno avec `service_role`, seule à pouvoir : transiter le pipeline (`transiter()`), générer des pièces, signer (SHA-256), envoyer des e-mails, appeler l'IA, produire des PDF/PPTX/ZIP, incrémenter les compteurs, écrire dans `evenement` et `version_objet`, servir les routes publiques par jeton.
- **Journal `evenement` et `version_objet`** : jamais écrits par le client. Pour les écritures de saisie restées en « Client + RLS » qui journalisaient côté serveur (organisme modifié, formation archivée, fichier purgé, formation créée…), on crée des **triggers SQL** `AFTER INSERT/UPDATE/DELETE` qui insèrent la ligne de journal, et un trigger `BEFORE UPDATE` sur `formation` et `modele_outil` qui photographie `OLD` dans `version_objet` (et purge au-delà de 50). Les Edge Functions journalisent explicitement, comme aujourd'hui.
- **Fichiers** : trois buckets Storage privés, `archive` (pièces de dossier, candidatures, positionnements, invitations), `coffre` (coffre-fort pédagogique), `supports` (PPTX générés). Chemin toujours préfixé `<of_id>/…` ; les politiques `storage.objects` réutilisent `s4m_of_id()` ; pour le bucket `coffre`, la politique de lecture est `exists (select 1 from coffre_fichier where chemin = name)` évaluée sous RLS (la règle fine, apprenant compris, est donc celle de `coffre_fichier`) ; `s4m_coffre_accessible(fichier_id text)` expose le même test au front. Les téléchargements se font par **URL signée** créée côté client (`createSignedUrl`, 60 s) quand la politique RLS suffit ; sinon par Edge Function.
- **Identité** : `utilisateur` devient le profil (`id = auth.users.id`, `of_id`, `role`, `prenom`, `nom`, `email`, `actif`, `supprime_le`). `session_utilisateur` et `mot_de_passe_hash` disparaissent. **Le compte naît au `supabase.auth.signUp()` côté client** ; le trigger `s4m_on_auth_user_created` crée le profil : avec `options.data.invitation = <jeton clair>` (invitation valide, même e-mail) → profil apprenant/formateur de l'invitation et fiche reliée ; sans invitation → formateur candidat uniquement. Un admin ne naît que par `app_metadata.s4m_role` (service ou `supabase/admin_production.sql`). Aucune Edge Function ne crée de ligne `utilisateur` / `formateur` ni d'utilisateur Auth à la place de l'intéressé. `email`, `role`, `of_id` ne sont jamais modifiables côté client.
- **Projections sans données sensibles** : formateurs et apprenants lisent `organisme_public` (pas `organisme_formation` : IBAN, BIC, commission, signature réservés à l'admin) ; l'apprenant lit `dossier_formation_apprenant` (pas `dossier_formation` : prix, coût horaire, questionnaires avec corrigé, motifs) et `formateur_public` (pas `formateur`).
- **Acteur** : les Edge Functions reconstruisent l'`Acteur` (même forme qu'aujourd'hui) à partir du JWT (`getUser()`) puis de `utilisateur`/`formateur`/`stagiaire` — jamais du corps de la requête. Les routes publiques n'ont pas de JWT : elles s'authentifient par le jeton haché (SHA-256) comme aujourd'hui.
- **Noyau `src/domaine`** : vérifié — aucun import `node:`, aucune dépendance externe hors `vitest` (fichiers `*.test.ts` seulement), aucun global Node (`Buffer`, `process`, `fs`). Imports uniquement relatifs intra-domaine. Il se copie tel quel dans `src/domaine` (front) et `supabase/functions/_shared/domaine` (Deno, qui lit les `.ts` nativement). Seule précaution : exclure les `*.test.ts` et `dossier/fixture.ts` du bundle Edge (poids), et ajouter l'extension `.ts` aux imports relatifs pour Deno (`from "../gabarits/moteur.ts"`) — à faire par un script de copie, pas à la main. Le hachage reste injecté (`Hacheur`) : `crypto.subtle.digest("SHA-256")` côté Deno.

## 1. Tableau des 116 routes

Rôles : `A` = admin, `F` = formateur (validé sauf mention), `S` = apprenant (stagiaire), `P` = public (par jeton), `*` = tout connecté.

### 1.1 Authentification et compte (9)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 1 | POST | /api/auth/inscription | P | auth.inscrireFormateur + connecter | Client (`supabase.auth.signUp`) + trigger | `signUp({ email, password, options: { data: { prenom, nom, of_id? } } })`. Le trigger `s4m_on_auth_user_created` crée `utilisateur` (role formateur, OF demandé ou premier OF), la fiche `formateur` en brouillon et le journal `compte_cree`. Tout `role` autre que formateur dans `data` est refusé. Mot de passe ≥ 10 caractères : réglage Auth. Pas d'Edge Function. |
| 2 | POST | /api/auth/connexion | P | auth.connecter | Client (Supabase Auth) | `signInWithPassword`. L'anti-force brute et le hachage scrypt disparaissent (GoTrue les porte). |
| 3 | POST | /api/auth/deconnexion | P | auth.deconnecter | Client (Supabase Auth) | `signOut`. |
| 4 | GET | /api/auth/moi | * | auth.acteurDepuisJeton + organisme.lireOrganisme | RPC SQL `s4m_moi()` | Retourne `{ acteur, organisme: { nom, couleur } }` (SECURITY DEFINER ; formateurs et apprenants ne lisent plus `organisme_formation`, l'en-tête complet vient de `organisme_public`) (acteur = utilisateur_id, of_id, role, formateur_id, formateur_valide, stagiaire_id, nom, email) ou `{ acteur: null }` en un appel. |
| 5 | GET | /api/auth/invitation/:jeton | P | auth.lireInvitation | Edge Function `auth-compte` (lecture seule) | Lecture par `sha256(jeton)` dans `invitation` ; renvoie `{ email, prenom, nom }` si non consommée et non expirée, pour pré-remplir le formulaire. N'écrit rien. |
| 6 | POST | /api/auth/invitation/:jeton | P | auth.accepterInvitation | Client (`supabase.auth.signUp`) + trigger | `signUp({ email, password, options: { data: { invitation: jeton } } })`. Le trigger vérifie le hash, l'expiration, la non-consommation et l'**égalité de l'e-mail**, crée le profil avec l'OF / le rôle / le nom DE L'INVITATION, relie la fiche `stagiaire` (ou `formateur`), consomme l'invitation et journalise. Le client se connecte ensuite (`signInWithPassword`, ou session directe si la confirmation d'e-mail est désactivée). |
| 7 | POST | /api/compte/mot-de-passe | * | auth.changerMotDePasse | Client (Supabase Auth) | `auth.updateUser({password})` après réauthentification. Pas de révocation manuelle des sessions : régler « Sign out other sessions » côté GoTrue. |
| 8 | GET | /api/compte/suppression | F | rgpd.apercuSuppression | Client + RLS | Compte les dossiers du formateur (`dossier_formation` sous RLS) ; le texte de l'aperçu est calculé côté front. |
| 9 | POST | /api/compte/suppression | F | rgpd.supprimerMonCompte | Edge Function `sauvegarde-rgpd` | Transaction de dissociation/effacement + suppression Storage (`archive/<of>/candidatures/<formateur>`) + `auth.admin.deleteUser`. Vérifier le mot de passe par `signInWithPassword` avant. |

### 1.2 Pages publiques par jeton (8)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 10 | GET | /api/public/positionnement/:jeton | P | positionnements.lirePositionnementPublic | Edge Function `public-positionnement` | Corrigé retiré (`sansCorrige`). |
| 11 | PUT | /api/public/positionnement/:jeton/brouillon | P | positionnements.enregistrerBrouillonPublic | Edge Function `public-positionnement` | |
| 12 | POST | /api/public/positionnement/:jeton/signer | P | positionnements.signerPositionnementPublic | Edge Function `public-positionnement` | Score, HTML, PDF, Storage, SHA-256, journal, 2 e-mails. |
| 13 | GET | /api/public/positionnement/:jeton/pdf | P | positionnements.telechargerPdfPublic | Edge Function `public-positionnement` | Streame le fichier du bucket `archive` (pas de JWT côté apprenant). |
| 14 | GET | /api/public/formulaire/:jeton | P | formulaires.lireFormulairePublic | Edge Function `public-formulaire` | |
| 15 | PUT | /api/public/formulaire/:jeton/brouillon | P | formulaires.enregistrerBrouillonPublic | Edge Function `public-formulaire` | |
| 16 | POST | /api/public/formulaire/:jeton/signer | P | formulaires.signerFormulairePublic | Edge Function `public-formulaire` | Réponses + signature + rendu pièce + certificat + `marquerValidee` + réactions pipeline + e-mails. **Ne crée pas de compte** : si l'apprenant n'en a pas, l'Edge insère au besoin une ligne `invitation` (rôle apprenant, `stagiaire_id`, e-mail de la fiche) et envoie le lien ; le compte naîtra au `signUp` de l'apprenant (#6). |
| 17 | GET | /api/public/formulaire/:jeton/pdf | P | formulaires.telechargerPdfPublic | Edge Function `public-formulaire` | |

### 1.3 Référentiel (1)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 18 | GET | /api/referentiel | * | NOMENCLATURE, ETAPES, SOUS_STATUTS, REGLES (noyau) | Client (noyau embarqué) | Plus d'appel réseau : le front importe `src/domaine/referentiel` et `pipeline`. |

### 1.4 Candidature du formateur (6)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 19 | GET | /api/candidature | F (même non validé) | candidatures.lireMaCandidature | Client + RLS | `formateur` + `piece_formateur` où `formateur_id = s4m_formateur_id()` ; manques et échéances calculés côté front (`TYPES_PIECE_FORMATEUR` à déplacer dans le noyau). |
| 20 | PATCH | /api/candidature | F | candidatures.mettreAJourMonProfil | Client + RLS | Politique `UPDATE` : refusée si `statut_candidature = 'soumise'` ; trigger qui fige prénom/nom après validation et recopie prénom/nom dans `utilisateur`. |
| 21 | POST | /api/candidature/pieces | F | candidatures.deposerPieceFormateur | Client + RLS (Storage) | Upload bucket `archive` sous `<of_id>/candidatures/<formateur_id>/…` puis insert `piece_formateur`. Taille/extension contrôlées en front et par la politique Storage (`mime`/taille). |
| 22 | DELETE | /api/candidature/pieces/:id | F | candidatures.supprimerPieceFormateur | Client + RLS (Storage) | `storage.remove` + delete ligne. |
| 23 | POST | /api/candidature/soumettre | F | candidatures.soumettreCandidature | Edge Function `candidatures` | Contrôle des manques, passage à `soumise`, journal, e-mail aux admins. |
| 24 | GET | /api/pieces-formateur/:id | F, A | candidatures.telechargerPieceFormateur | Client + RLS (URL signée) | Politique Storage : propriétaire ou admin du même OF. |

### 1.5 Administration de l'organisme (8)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 25 | GET | /api/admin/candidatures | A | candidatures.listerCandidatures | Client + RLS | |
| 26 | GET | /api/admin/candidatures/:id | A | candidatures.lireCandidature | Client + RLS | |
| 27 | POST | /api/admin/candidatures/:id/decision | A | candidatures.deciderCandidature | Edge Function `candidatures` | Journal + e-mail au candidat. |
| 28 | GET | /api/admin/organisme | A | organisme.lireOrganisme + champsOfManquants | Client + RLS | `champsOfManquants` et `CHAMPS_OF_OBLIGATOIRES` à déplacer dans le noyau (`domaine/referentiel`). |
| 29 | PATCH | /api/admin/organisme | A | organisme.mettreAJourOrganisme | Client + RLS | Journal par trigger `AFTER UPDATE`. |
| 30 | GET | /api/admin/reglages | A | reglages.vueReglages | Client + RLS (vue `reglage_vue`) | Vue SQL qui remplace la valeur des clés secrètes par un booléen `defini`. |
| 31 | PATCH | /api/admin/reglages | A | reglages.enregistrerReglages | Edge Function `reglages` | Chiffrement AES-GCM des secrets avec `CLE_SECRETS` (Web Crypto) avant upsert ; journal. |
| 32 | POST | /api/admin/reglages/test-courriel | A | reglages.envoyerCourrielDeTest | Edge Function `courriels-envoyer` | Action `test`. |

### 1.6 Boîte d'envoi (2)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 33 | GET | /api/courriers | F, A | requête directe `courrier` | Client + RLS | Politique `courrier_select` : même OF ET (admin OU `formateur_id = s4m_formateur_valide_id()` OU dossier interne au formateur via `s4m_dossier_interne(dossier_id)`). Pas de filtre par destinataire. |
| 34 | POST | /api/courriers/:id/renvoyer | F, A | s.courrier.envoyer | Edge Function `courriels-envoyer` | Action `renvoyer` ; relit les pièces jointes dans `archive`. |

### 1.7 Formations, versions, coffre-fort d'une formation (15)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 35 | GET | /api/formations | F | formations.listerFormations | Client + RLS | |
| 36 | POST | /api/formations/:id/restaurer | F | formations.restaurerFormation | Client + RLS | Journal par trigger. |
| 37 | GET | /api/versions/:type/:id | F | formations.listerVersions | Client + RLS | `version_objet` en lecture seule ; `resumer()` côté front. |
| 38 | POST | /api/versions/:id/restaurer | F | formations.restaurerVersion | RPC SQL `s4m_restaurer_version(version_id text)` | Photographie l'état courant puis réapplique le snapshot (formation ou outil), en une transaction. |
| 39 | POST | /api/formations | F | formations.creerFormation | Client + RLS | Validation `SchemaFormation` + `controlerCoherence` + `completerDepuisModules` côté front (fonctions à extraire dans le noyau) ; journal par trigger. |
| 40 | GET | /api/formations/:id | F | formations.lireFormation | Client + RLS | |
| 41 | PATCH | /api/formations/:id | F | formations.modifierFormation | Client + RLS | Trigger `BEFORE UPDATE` → `version_objet`. |
| 42 | POST | /api/formations/:id/dupliquer | F | formations.dupliquerFormation | RPC SQL `s4m_dupliquer_formation(id text)` | Copie formation + outils actifs, atomique. |
| 43 | DELETE | /api/formations/:id | F | formations.archiverFormation | Client + RLS | `UPDATE archivee = true` ; journal par trigger. |
| 44 | GET | /api/formations/:id/coffre | F, A | formations.listerCoffre | Client + RLS | |
| 45 | POST | /api/formations/:id/coffre | F | formations.deposerDansCoffre | Client + RLS (Storage) | Upload bucket `coffre` sous `<of_id>/coffres/<formation_id>/…` puis insert `coffre_fichier`. |
| 46 | PATCH | /api/coffre/:id | F | formations.reglerPartage / modifierFichierCoffre | Client + RLS | |
| 47 | DELETE | /api/coffre/:id | F | formations.supprimerDuCoffre | Client + RLS | `supprime_le = now()`. |
| 48 | POST | /api/coffre/:id/restaurer | F | formations.restaurerDuCoffre | Client + RLS | |
| 49 | DELETE | /api/coffre/:id/definitif | F | formations.purgerDuCoffre | Client + RLS (Storage) | Politique `DELETE` : seulement si `supprime_le IS NOT NULL` ; `storage.remove` ; journal par trigger `AFTER DELETE`. |

### 1.8 Coffre-fort pédagogique par parcours (7)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 50 | GET | /api/coffres-parcours | F, A | coffre.listerCoffresParcours | RPC SQL `s4m_coffres_parcours()` | Agrégats (compteurs par formation) en une requête. |
| 51 | GET | /api/coffres-parcours/:id | F, A | coffre.lireCoffreParcours | Client + RLS | 6 à 7 `select` parallèles (formation, coffre, outils, positionnements, dossiers, pièces, inscrits) assemblés côté front avec le noyau (`libelleSousStatut`, `definitionPiece`). |
| 52 | GET | /api/coffres-parcours/:id/programme | F, A | coffre.documentProgrammeParcours | Client (HTML imprimable) | `documentProgramme` (supports.ts) n'a aucune dépendance Node : à déplacer dans le noyau ; le front l'affiche et propose « Imprimer / Enregistrer en PDF ». Option PDF serveur : Edge `pieces-generer` action `pdf`. |
| 53 | GET | /api/coffres-parcours/:id/zip | F, A | coffre.exporterCoffreZip | Edge Function `coffre` | JSZip (`npm:jszip`) + lecture Storage ; renvoie le ZIP en flux. |
| 54 | GET | /api/outils/:id/document | F, A | coffre.documentOutilParcours | Client (HTML imprimable) | `documentOutil` à déplacer dans le noyau ; le corrigé n'est affiché que si `s4m_role() <> 'apprenant'` (de toute façon la ligne `modele_outil` n'est lisible que par F/A). |
| 55 | GET | /api/coffre/:id/telecharger | F, A, S | formations.telechargerDuCoffre | Client + RLS (URL signée) | Politique Storage bucket `coffre` : « l'objet existe dans `coffre_fichier` sous RLS » (F propriétaire, A même OF, S si partageable + dossier ≥ accord de financement) ; `s4m_coffre_accessible(fichier_id text)` encapsule le même test pour le front. |
| 56 | GET | /api/coffres | S | formations.coffresDeLApprenant | RPC SQL `s4m_coffres_apprenant()` | Encapsule la règle RG-08 (`aAtteint(sous_statut, 'accord_financement')` recodée en SQL par liste de sous-statuts). |

### 1.9 Espace pédagogique : IA, supports, outils (14)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 57 | GET | /api/ia/etat | F | pedagogieIa.etatIa | Edge Function `ia-assistant` | Action `etat` : lit `reglage` (clé déchiffrée) puis repli sur `ANTHROPIC_API_KEY`. |
| 58 | POST | /api/ia/qcm | F | pedagogieIa.proposerQcm | Edge Function `ia-assistant` | |
| 59 | POST | /api/ia/programme | F | pedagogieIa.proposerProgramme | Edge Function `ia-assistant` | |
| 60 | POST | /api/ia/parcours | F | pedagogieIa.proposerParcours | Edge Function `ia-assistant` | Recherche web + 10 000 tokens : durée pouvant dépasser 60 s. |
| 61 | POST | /api/ia/enjeux | F | pedagogieIa.analyserEnjeux | Edge Function `ia-assistant` | Écrit `formation.dossier_enjeux` + `version_objet` + journal. |
| 62 | POST | /api/ia/test | F | pedagogieIa.proposerTest (= proposerQcm) | Edge Function `ia-assistant` | Alias à supprimer dans le front Lovable. |
| 63 | POST | /api/ia/plan-support | F | pedagogieIa.proposerPlanSupport | Edge Function `ia-assistant` | 14 000 tokens de sortie. |
| 64 | POST | /api/supports | F | pedagogieIa.produireSupport | Edge Function `supports-produire` | pptxgenjs → bucket `supports` + `coffre_fichier` (origine `genere`) + journal. |
| 65 | POST | /api/supports/tous | F | pedagogieIa.produireTousLesSupports | Edge Function `supports-produire` | Jusqu'à 12 appels IA en série : dépasse la limite de temps d'une Edge Function. À découper : le front boucle module par module (plan-support puis supports). |
| 66 | GET | /api/outils | F | formations.listerOutils | Client + RLS | |
| 67 | POST | /api/outils/:id/restaurer | F | formations.restaurerOutil | Client + RLS | |
| 68 | POST | /api/outils | F | formations.enregistrerOutil | Client + RLS | `validerContenuOutil` + `validerQuestionnaire` (noyau) côté front. |
| 69 | PUT | /api/outils/:id | F | formations.enregistrerOutil | Client + RLS | Trigger `version_objet`. |
| 70 | DELETE | /api/outils/:id | F | formations.supprimerOutil | Client + RLS | `archive_le = now()`. |

### 1.10 Répertoires (8)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 71 | GET | /api/entreprises | F | repertoire.listerEntreprises | Client + RLS | |
| 72 | POST | /api/entreprises/:id/archiver | F | repertoire.archiverFiche | Client + RLS | |
| 73 | POST | /api/stagiaires/:id/archiver | F | repertoire.archiverFiche | Client + RLS | |
| 74 | POST | /api/entreprises | F | repertoire.enregistrerEntreprise | Client + RLS | |
| 75 | PATCH | /api/entreprises/:id | F | repertoire.enregistrerEntreprise | Client + RLS | |
| 76 | GET | /api/stagiaires | F | repertoire.listerStagiaires | Client + RLS | |
| 77 | POST | /api/stagiaires | F | repertoire.enregistrerStagiaire | Client + RLS | « Nouvelle entreprise dans le même geste » : deux inserts enchaînés côté front, ou RPC `s4m_creer_stagiaire_avec_entreprise` si l'on veut l'atomicité. |
| 78 | PATCH | /api/stagiaires/:id | F | repertoire.enregistrerStagiaire | Client + RLS | |

### 1.11 Positionnement avant dossier (5)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 79 | GET | /api/positionnements | F, A | positionnements.listerPositionnements | Client + RLS | Jointure stagiaire/entreprise via `select('*, stagiaire(*, entreprise_cliente(*))')`. Colonnes `jeton_hash`, `brouillon`, `questionnaire` à exclure par une vue `positionnement_vue`. |
| 80 | POST | /api/positionnements | F | positionnements.inviterAuPositionnement | Edge Function `positionnements` | Jeton aléatoire + hash, questionnaire figé, e-mail, journal. |
| 81 | POST | /api/positionnements/:id/relancer | F | positionnements.relancerPositionnement | Edge Function `positionnements` | Nouveau jeton, nouvel e-mail. |
| 82 | POST | /api/positionnements/:id/archiver | F | positionnements.archiverPositionnement | Client + RLS | |
| 83 | GET | /api/positionnements/:id/pdf | F, A | positionnements.telechargerPdfPositionnement | Client + RLS (URL signée) | `chemin_pdf` dans bucket `archive`. |

### 1.12 Archives, sauvegarde (3)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 84 | GET | /api/archives | F | sauvegarde.archivesEtCorbeille | Client + RLS | 6 listes filtrées sur `archive_le / supprime_le IS NOT NULL`. |
| 85 | GET | /api/sauvegarde/export | F | sauvegarde.exporterMesDonnees | Edge Function `sauvegarde-rgpd` | JSON de portabilité + journal. |
| 86 | POST | /api/sauvegarde/import | F | sauvegarde.importerMesDonnees | Edge Function `sauvegarde-rgpd` | Recrée formations et outils en copies ; journal. |

### 1.13 Dossiers et pipeline (21)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 87 | GET | /api/dossiers | F, A, S | dossiers.listerDossiers | RPC SQL `s4m_lister_dossiers()` | Cartes du pipeline avec compteur de pièces suivies ; `etapes/sous_statuts` viennent du noyau côté front. |
| 88 | POST | /api/dossiers | F | dossiers.creerDossier | Edge Function `dossiers` | Compteur `ADF-AAAA-NNNN`, instantané de la formation, `synchroniserPieces`, reprise des positionnements signés, envoi automatique recueil + positionnement (e-mails, PDF QR). |
| 89 | GET | /api/dossiers/:id | F, A, S | dossiers.lireDossier | Client + RLS (noyau côté front) | Le front charge dossier (**apprenant : `dossier_formation_apprenant`**, F/A : `dossier_formation`), stagiaires, séances, pièces, évaluations, journal, factures, signatures (RLS) puis calcule `actionsPossibles`, `sectionsParcours`, `calculer`, `piecesManquantesPourCompletude`, `vuePiece`. **Condition** : les politiques RLS sur `piece_dossier`, `evaluation`, `emargement` reproduisent `peutVoir()` pour l'apprenant (ses pièces individuelles, jamais ODM/factures/finances) et `evenement` est invisible à l'apprenant. `synchroniserPieces()` appelé à la lecture aujourd'hui devient inutile : il est exécuté à chaque transition et à `dossiers` (stagiaires). |
| 90 | PATCH | /api/dossiers/:id | F, A | dossiers.modifierDossier | Client + RLS | Politique `UPDATE` : F si `brouillon`, A si `brouillon` ou `en_cours_validation` ; colonnes modifiables limitées par une vue updatable ou un trigger (jamais `sous_statut`, `dossier_reference`, `of_id`). |
| 91 | DELETE | /api/dossiers/:id | F | dossiers.supprimerBrouillon | Client + RLS | Politique `DELETE` : formateur propriétaire et `sous_statut = 'brouillon'`. |
| 92 | PUT | /api/dossiers/:id/seances | F, A | dossiers.definirSeances | RPC SQL `s4m_definir_seances(dossier_id text, seances jsonb)` | Delete + insert atomiques, mêmes conditions que #90. |
| 93 | PUT | /api/dossiers/:id/stagiaires | F | dossiers.definirStagiaires | Edge Function `dossiers` | Action `stagiaires` : met à jour `stagiaire_dossier`, supprime les pièces des retirés, `synchroniserPieces`. |
| 94 | PATCH | /api/dossiers/:id/objectifs-atteints | F, A | dossiers.renseignerObjectifsAtteints | RPC SQL `s4m_objectifs_atteints(dossier_id text, valeur text)` | SECURITY DEFINER contrôlée : admin de l'OF ou formateur validé du dossier ; dossier non terminal ; texte rogné à 4 000 ; ne touche que `formation_objectifs_atteints` (+ `maj_le`). Renvoie `{ ok: true }`. La politique UPDATE de `dossier_formation` ne l'autorise pas (fenêtre brouillon). |
| 95 | POST | /api/dossiers/:id/actions/:action | F, A, S | pipeline.executerAction | Edge Function `pipeline-transiter` | Le cœur : `transiter()` + effets (pièces, e-mails, ODM, coffre, compteurs FA/FF, formulaires de fin). |
| 96 | POST | /api/dossiers/:id/inviter | F, A | dossiers.inviter | Edge Function `dossiers` | Action `inviter` : génère un jeton aléatoire, insère `invitation` (`sha256(jeton)`, rôle apprenant, `stagiaire_id`, e-mail de la fiche, expiration 14 j), envoie l'e-mail avec le lien `/invitation/<jeton>`, journalise. **Ne crée ni utilisateur Auth ni profil** : le compte naît au `signUp` (#6). (Un formateur validé peut aussi insérer l'`invitation` en Client + RLS ; l'Edge n'est utile que pour l'e-mail.) |
| 97 | POST | /api/dossiers/:id/relancer | F, A | dossiers.relancerApprenant | Edge Function `dossiers` | Action `relancer`. |
| 98 | POST | /api/dossiers/:id/recreer | F, A | dossiers.recreerDepuis | Edge Function `dossiers` | Action `recreer` (= `creer` + recopie du lieu/OPCO/prix). |
| 99 | POST | /api/dossiers/:id/pieces-externes/:code | F, A, S | retours.deposerPieceExterne | Edge Function `pieces-retourner` | Le client envoie le fichier dans `archive` (préfixe `<of>/depots-temp/`), l'Edge le déplace dans `Retour`, scelle l'empreinte, `marquerValidee`, réactions pipeline. |
| 100 | GET | /api/dossiers/:id/formulaires | F, A, S | formulaires.etatFormulaires | Client + RLS | `formulaire_apprenant` + `piece_dossier` ; `MOMENTS`, `CONFIG_EVALUATIONS`, `questionnaireOuvert` à déplacer dans le noyau. Vue sans `jeton_hash`/`brouillon`. |
| 101 | POST | /api/dossiers/:id/formulaires/envoyer | F, A | formulaires.envoyerFormulaire | Edge Function `formulaires-envoyer` | Jeton, document d'invitation (QR code SVG + PDF), Storage, e-mail, journal. |
| 102 | GET | /api/dossiers/:id/formulaires/:stagiaire/:type/invitation | F, A, S | formulaires.telechargerInvitation | Client + RLS (URL signée) | `chemin_invitation` dans `archive`. |
| 103 | GET | /api/formulaires | F, A | formulaires.listerFormulaires | Client + RLS | |
| 104 | GET | /api/dossiers/:id/emargement | F, A, S | retours.etatEmargement | Client + RLS | `seance` + `emargement` ; apprenant : ses pointages seulement (RLS). `dureeSeanceHeures` côté front. |
| 105 | GET | /api/dossiers/:id/trame-facture | F, A | retours.trameFactureFormateur | Edge Function `pieces-generer` | Action `apercu` sur la pièce 10-FIN (rendu HTML, pas d'archivage). |
| 106 | GET | /api/dossiers/:id/questionnaires/:type | F, A, S | evaluations.lireQuestionnaire | RPC SQL `s4m_questionnaire(dossier_id text, type text, stagiaire_id text)` | Retire `bonne_reponse` quand `s4m_role() = 'apprenant'` : une politique RLS ne masque pas une sous-clé JSON, d'où la RPC (ou une vue `dossier_formation_apprenant` sans les colonnes `questionnaire_*`). |
| 107 | POST | /api/dossiers/:id/questionnaires/:type | S | evaluations.enregistrerEvaluation | Edge Function `pieces-retourner` | Action `repondre` : `enregistrerReponses` + rendu/archivage/validation de la pièce + réactions pipeline. |

### 1.14 Pièces, signature, émargement (7)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 108 | GET | /api/pieces/:id/apercu | F, A, S | retours.apercuPiece | Edge Function `pieces-generer` | Action `apercu` ; renvoie `text/html` avec la CSP `default-src 'none'`. Même chemin de rendu que la signature (l'empreinte scelle ce HTML). |
| 109 | GET | /api/pieces/:id/telecharger | F, A, S | retours.telechargerPiece | Client + RLS (URL signée) ; Edge `pieces-generer` si `chemin_depart` absent | Politique Storage `archive` : `s4m_piece_visible(piece_id text)` (reprend `peutVoir`). |
| 110 | GET | /api/pieces/:id/integrite | F, A, S | retours.verifierIntegritePiece | Edge Function `signature-signer` | Action `verifier` : relit le fichier `Retour`, recalcule SHA-256. |
| 111 | POST | /api/pieces/:id/signer | F (04-AVT), S | retours.signerPiece | Edge Function `signature-signer` | Action `signer`. |
| 112 | POST | /api/pieces/:id/deposer | F, A, S | retours.deposerRetour | Edge Function `pieces-retourner` | Action `deposer` (fichier passé par Storage temporaire, cf. #99). |
| 113 | POST | /api/pieces/:id/regenerer | F, A | retours.regenererPiece | Edge Function `pieces-generer` | Action `regenerer`. |
| 114 | POST | /api/seances/:id/emarger | F, S | retours.emarger | Edge Function `signature-signer` | Action `emarger` : horodatage serveur, validation du tracé, journal. |

### 1.15 BPF (2)

| # | Méthode | Chemin | Rôles | Service appelé | Cible | Remarque |
|---|---|---|---|---|---|---|
| 115 | GET | /api/bpf | F, A | bpf.lireBpf | Edge Function `bpf` | Charge l'agrégat de chaque dossier (`chargerAgregat` + `calculer` + `agregerBpf`). Alternative sans Edge : RPC `s4m_lignes_bpf()` qui renvoie les lignes brutes et le noyau agrège en front — à préférer si le volume reste < 500 dossiers. |
| 116 | GET | /api/bpf/export | F, A | bpf.exporterBpfCsv | Edge Function `bpf` | Action `csv` (`bpfEnCsv` du noyau). |

### 1.16 Décompte et répartition

Total : **116 routes**, égal au nombre de `app.get/post/put/patch/delete(` dans `app.ts` (le `app.all("/api/*")` 404 n'est pas une route métier).

| Cible | Routes | Numéros |
|---|---|---|
| Client + RLS (Supabase direct, Storage, Auth, noyau embarqué) | **59** | 2, 3, 7, 8, 18–22, 24–26, 28–30, 33, 35–37, 39–41, 43–49, 51, 52, 54, 55, 66–79, 82–84, 89–91, 94, 100, 102–104, 109 |
| RPC SQL | **8** | 4, 38, 42, 50, 56, 87, 92, 106 |
| Edge Function | **49** | 1, 5, 6, 9–17, 23, 27, 31, 32, 34, 53, 57–65, 80, 81, 85, 86, 88, 93, 95–99, 101, 105, 107, 108, 110–116 |

(Le #109 est compté « Client » ; son repli de génération passe par `pieces-generer`.)

## 2. Edge Functions à créer (18 + 1 tâche planifiée)

Toutes partagent `supabase/functions/_shared/` :

- `domaine/` : copie du noyau (script de copie, imports suffixés `.ts`).
- `acteur.ts` : JWT → `Acteur` (`utilisateur`, `formateur`, `stagiaire`) ; `exigerRole`, `exigerFormateurValide`, `accederAuDossier` (recopiés de `socle.ts`/`agregat.ts`).
- `bd.ts` : client `service_role` ; helpers de lecture équivalents à `agregat.ts` (`chargerAgregat`, `chargerContextePipeline`, `stagiairesDuDossier`, `seancesDuDossier`, `heuresRealisees`). Drizzle n'est pas repris : requêtes `supabase-js` (ou `postgres` npm pour les transactions).
- `archive.ts` : port `Archive` sur Storage (`ecrire`, `lire`, `existe`, `supprimer`, bucket + chemin), `cheminPiece/cheminCoffre/cheminCandidature/nomSur` recopiés.
- `courrier.ts` : port `Courrier` (journalise dans `courrier`, expédie via Resend, ou SMTP par réglages si un relais HTTP est fourni) + `courriels.ts` (16 gabarits d'e-mail, pur TypeScript, copiés tels quels).
- `pdf.ts` : port `ConvertisseurPdf` (voir §3.1) avec repli HTML.
- `gabarits.ts` : les 15 gabarits HTML + 3 fragments embarqués (voir §3.5).
- `generation.ts`, `retours.ts`, `pipeline.ts` : portage des services correspondants (ils ne dépendent de Node que par `Buffer` et `sha256`).
- `hacheur.ts` : `sha256` via `crypto.subtle`.
- `journal.ts` : `journaliser()`.
- `erreurs.ts` : `ErreurMetier` → réponse JSON `{erreur, code, details}` avec les mêmes statuts 400/401/403/404/409 ; validation Zod (`npm:zod`).

Convention d'appel : `POST /functions/v1/<nom>` avec `{ action, ...entrées }` (sauf routes publiques en GET/PUT/POST par chemin), en-tête `Authorization: Bearer <JWT utilisateur>` (vérifié dans la fonction, `verify_jwt = false` pour les fonctions publiques).

| Edge Function | Routes | Entrées JSON | Contrôles | Modules du noyau réutilisés | Tables touchées | Secrets |
|---|---|---|---|---|---|---|
| `auth-compte` | 1, 5, 6 | `{action:"inscription", email, mot_de_passe, prenom, nom}` ; `{action:"lire_invitation", jeton}` ; `{action:"accepter_invitation", jeton, mot_de_passe}` | Publique ; unicité e-mail ; mot de passe ≥ 10 ; invitation non consommée/non expirée (hash SHA-256) | — | `utilisateur`, `formateur`, `invitation`, `evenement`, `auth.users` (admin API) | `SUPABASE_SERVICE_ROLE_KEY` |
| `candidatures` | 23, 27 | `{action:"soumettre"}` ; `{action:"decider", formateur_id, validee, motif}` | F (soumettre) / A (decider) ; même `of_id` ; manques ; statut `soumise` | — (`TYPES_PIECE_FORMATEUR` à mettre dans le noyau) | `formateur`, `piece_formateur`, `organisme_formation`, `utilisateur`, `evenement`, `courrier` | service_role, `RESEND_API_KEY`, `APP_URL` |
| `reglages` | 31 | `{ia_cle?, ia_modele?, …, smtp_mot_de_passe?, courrier_actif?}` (secret vide = inchangé, `-` = effacer) | A | — | `reglage`, `evenement` | service_role, `CLE_SECRETS` |
| `courriels-envoyer` | 32, 34 | `{action:"test"}` ; `{action:"renvoyer", courrier_id}` | A (test) ; F/A avec règle de visibilité du courrier | `echapperHtml` | `courrier`, `reglage` (SMTP), Storage `archive` (PJ) | service_role, `RESEND_API_KEY`, `COURRIER_EXPEDITEUR`, `CLE_SECRETS` |
| `coffre` | 53 | `{formation_id}` → ZIP binaire | F propriétaire / A même OF | `CATEGORIES_COFFRE`, `documentProgramme`, `documentOutil` (à déplacer dans le noyau) | `formation`, `coffre_fichier`, `modele_outil`, `positionnement`, `organisme_formation` ; Storage `coffre`, `archive` | service_role |
| `ia-assistant` | 57–63 | `{action:"etat"}` ; `{action:"enjeux", formation_id}` ; `{action:"qcm", formation_id, type, nombre}` ; `{action:"programme", formation_titre, …}` ; `{action:"parcours", titre, heures, jours, nb_modules, …}` ; `{action:"plan_support", formation_id, module_index}` | F validé ; formation du formateur ; IA configurée (réglages déchiffrés puis `.env`) | `pedagogie/propositions` (consignes, `extraireJson`, `validerProposition*`), `pedagogie/parcours` (`repartirHeures`, `programmeDepuisModules`), `pedagogie/enjeux` | `formation`, `reglage`, `version_objet`, `evenement` | service_role, `CLE_SECRETS`, `ANTHROPIC_API_KEY` (défaut), `IA_MODELE`, `IA_WORKSPACE_ID`, `IA_RECHERCHE_WEB` |
| `supports-produire` | 64, 65 | `{formation_id, module_index, diapos}` (un module ; « tous » = boucle côté front) | F validé ; `validerDiapos` | `pedagogie/parcours` (`validerDiapos`, `heuresTexte`), `echapperHtml` | `coffre_fichier`, `organisme_formation`, `evenement` ; Storage `supports` | service_role |
| `positionnements` | 80, 81 | `{action:"inviter", stagiaire_id, formation_id, message}` ; `{action:"relancer", id}` | F validé ; fiche et formation du formateur ; test de positionnement existant | `formulaires/definitions` (`FORMULAIRES`), `formulaires/qcm` | `positionnement`, `modele_outil`, `stagiaire`, `formation`, `formateur`, `courrier`, `evenement` | service_role, `RESEND_API_KEY`, `APP_URL` |
| `public-positionnement` | 10–13 | GET `?jeton=` ; PUT `{jeton, recueil, reponses, date}` ; POST `{jeton, …, trace_png, lieu, consentement}` ; GET pdf | Publique ; jeton haché, non archivé, non expiré sauf complet ; IP consignée | `validerReponses`, `corriger`, `sansCorrige`, `validerDemandeSignature`, `echapperHtml` | `positionnement`, `stagiaire`, `entreprise_cliente`, `organisme_formation`, `formateur`, `courrier`, `evenement` ; Storage `archive` | service_role, `RESEND_API_KEY`, `APP_URL`, PDF |
| `public-formulaire` | 14–17 | mêmes formes avec `reponses` objet ou tableau, `lieu` | Publique ; jeton haché ; formulaire ouvert à l'étape ; pièce non validée | `sansCorrige`, `validerReponses`, `corriger`, `validerDemandeSignature`, `certificatHtml`, `rendreGabarit` + `zones`, `resoudreVariables`, `blocSignatureHtml`, `pieces/statut` | `formulaire_apprenant`, `evaluation`, `signature`, `piece_dossier`, `dossier_formation`, `stagiaire`, `utilisateur` (+ `auth.users`), `courrier`, `evenement` ; Storage `archive` | service_role, `RESEND_API_KEY`, `APP_URL`, PDF |
| `sauvegarde-rgpd` | 9, 85, 86 | `{action:"export"}` ; `{action:"import", chemin_storage}` (fichier déposé en Storage temporaire) ; `{action:"supprimer_compte", phrase, mot_de_passe}` | F validé (export/import) ; F (suppression) ; phrase exacte ; mot de passe vérifié par `signInWithPassword` | `validerQuestionnaire`, `validerModules`, `validerEnjeux` (réimport) | `formation`, `modele_outil`, `stagiaire`, `entreprise_cliente`, `dossier_formation`, `coffre_fichier`, `positionnement`, `piece_formateur`, `formateur`, `utilisateur`, `evenement` ; Storage ; `auth.users` | service_role |
| `dossiers` | 88, 93, 96, 97, 98 | `{action:"creer", stagiaire_ids, entreprise_id, formation_id, formation_modalite, mode_financement}` ; `{action:"stagiaires", dossier_id, stagiaire_ids}` ; `{action:"inviter"/"relancer", dossier_id, stagiaire_id}` ; `{action:"recreer", dossier_id}` | F validé (creer/stagiaires) ; F/A (inviter/relancer/recreer) ; cloisonnement par `accederAuDossier` | `piecesAttendues`, `definitionPiece`, `NOMENCLATURE` | `dossier_formation`, `stagiaire_dossier`, `piece_dossier`, `compteur`, `modele_outil`, `positionnement`, `evaluation`, `formulaire_apprenant`, `invitation`, `utilisateur`, `courrier`, `evenement` ; Storage `archive` | service_role, `RESEND_API_KEY`, `APP_URL`, PDF |
| `pipeline-transiter` | 95 | `{dossier_id, action, motif?}` (`action` ∈ `REGLES`) | Acteur reconstruit ; `transiter()` décide (rôle, étape, garde, motif) ; `manquesAvantSoumission`, `champsOfManquants` | `pipeline/transitions` (`transiter`, `REGLES`), `pipeline/statuts`, `pieces/statut`, `referentiel/pieces`, `dossier/resolution`, `gabarits/moteur` + `zones`, `signature/preuve`, `dossier/formats` | `dossier_formation`, `piece_dossier`, `compteur` (FA/FF), `facture_of`, `facture_formateur`, `formulaire_apprenant`, `invitation`, `utilisateur`, `courrier`, `evenement` ; Storage `archive` | service_role, `RESEND_API_KEY`, `APP_URL`, PDF |
| `pieces-generer` | 105, 108, 113 (+ repli 109) | `{action:"apercu", piece_id}` → HTML ; `{action:"trame_facture", dossier_id}` → HTML ; `{action:"regenerer", piece_id}` ; `{action:"generer", piece_id}` | `peutVoir` ; dossier non terminal ; pièce non validée (regenerer) ; F/A (regenerer, trame) | `rendreGabarit`, `zones`, `resoudreVariables`, `estIndividuelle`, `blocSignatureHtml`, `horodatageLisible`, `piecesAttendues`, `FORMULAIRES` | `piece_dossier`, `signature`, `evaluation`, `emargement`, `seance`, `organisme_formation`, `evenement` ; Storage `archive` | service_role, PDF |
| `pieces-retourner` | 99, 107, 112 | `{action:"deposer", piece_id, chemin_temp}` ; `{action:"piece_externe", dossier_id, code, chemin_temp}` ; `{action:"repondre", dossier_id, type, reponses, ajustement?}` | `peutValider(code, role)` ; dossier ouvert ; extension/taille (`validerFichier`) ; apprenant seul pour `repondre` | `peutValider`, `peutVoir`, `definitionPiece`, `estCodePiece`, `controlerReponses` (→ noyau), `validerReponses`, `corriger`, rendu de pièce | `piece_dossier`, `evaluation`, `dossier_formation` (via `pipeline-transiter` interne : `enregistrer_accord`, `reevaluer_completude`), `evenement` ; Storage `archive` | service_role, PDF |
| `signature-signer` | 110, 111, 114 | `{action:"signer", piece_id, trace_png, lieu, consentement}` ; `{action:"emarger", seance_id, trace_png, stagiaire_id?}` ; `{action:"verifier", piece_id}` | Signataire autorisé (S sur ses pièces sauf 00/01/08/12 ; F sur 04-AVT) ; pièce non validée ; `validerDemandeSignature` ; IP ; horodatage serveur | `signature/preuve` (`validerDemandeSignature`, `certificatHtml`, `verifierIntegrite`), rendu de pièce, `peutValider` | `signature`, `emargement`, `piece_dossier`, `seance`, `evenement` (+ réactions pipeline) ; Storage `archive` | service_role, PDF |
| `formulaires-envoyer` | 101 | `{dossier_id, stagiaire_id, type, message?}` | F/A ; formulaire ouvert à l'étape ; questionnaire rattaché ; pièce non validée | `pieces/statut`, `pipeline/statuts` (`aAtteint`, `estTerminal`), `echapperHtml` | `formulaire_apprenant`, `piece_dossier`, `formateur`, `organisme_formation`, `courrier`, `evenement` ; Storage `archive` | service_role, `RESEND_API_KEY`, `APP_URL`, PDF |
| `bpf` | 115, 116 | `{exercice?}` ; `{action:"csv", exercice}` | F/A | `bpf/agregation` (`agregerBpf`, `bpfEnCsv`, `exercicesDisponibles`), `dossier/calculs`, `dossier/formats` | lecture `dossier_formation`, `formateur`, `seance`, `stagiaire_dossier`, `emargement`, `evaluation`, `facture_*`, `organisme_formation` | service_role |
| `taches-quotidiennes` (pas une route) | — (remplace `taches.ts`) | déclenchée par `pg_cron` + `pg_net` (ou Supabase Cron) chaque nuit, en-tête secret | aucun acteur ; vérifie `CRON_SECRET` | idem `formulaires-envoyer` | `dossier_formation`, `formulaire_apprenant`, `courrier`, `evenement` | service_role, `CRON_SECRET` |

Dépendances internes : `pieces-retourner`, `signature-signer` et `public-formulaire` appellent la logique de transition (`enregistrer_accord`, `reevaluer_completude`) **en import direct** du module `_shared/pipeline.ts`, pas par HTTP, pour rester dans la même exécution.

Fonctions SQL et triggers fournis par la migration `supabase/migrations/20261005000100_s4m_rpc.sql` (hors RLS, qui est dans `20261005000000_s4m_initial.sql`). **Les identifiants métier sont des `text` (UUID en chaîne), pas des `uuid`** — seul `utilisateur.id` est `uuid` : `s4m_moi()`, `s4m_restaurer_version(text)`, `s4m_dupliquer_formation(text)`, `s4m_coffres_parcours()`, `s4m_coffres_apprenant()`, `s4m_lister_dossiers()`, `s4m_definir_seances(text, jsonb)`, `s4m_questionnaire(text, text, text)`, `s4m_piece_visible(text)`, `s4m_coffre_accessible(text)` ; triggers `version_objet` (BEFORE UPDATE sur formation et modele_outil, purge au-delà de 50, `enjeux_le` posé quand `dossier_enjeux` change), journal `evenement` (organisme_formation update, formation insert/archivage/restauration, modele_outil insert/archivage, coffre_fichier delete, profil formateur validé), trigger profil formateur (prénom/nom figés après validation sauf admin, profil verrouillé pendant l'étude, recopie prénom/nom dans `utilisateur`) ; vues `reglage_vue`, `positionnement_vue`, `formulaire_apprenant_vue` (toutes `security_invoker`, sans jeton, brouillon, questionnaire ni secret). Toutes les RPC sont SECURITY INVOKER : la RLS de l'appelant s'applique, « introuvable » = exception `introuvable` ou 0 ligne. `s4m_questionnaire` renvoie `formulaire: null` (le front prend `FORMULAIRES` dans le noyau) ; `s4m_lister_dossiers` renvoie aussi `etapes` / `sous_statuts` comme le service. Le nom du formateur affiché à l'apprenant passe par la vue `formateur_public` (l'apprenant n'a aucun accès à la table `formateur`).

## 3. Ce qui ne passe pas tel quel

| Point | Aujourd'hui | Problème en Edge Function | Options | Recommandation | Effort |
|---|---|---|---|---|---|
| **3.1 PDF** | `ports/pdf.ts` : playwright-core + Chromium local, repli HTML | Pas de Chromium dans Deno Deploy ; limite mémoire 256 Mo | (a) HTML imprimable côté navigateur (`window.print`, `@page` déjà dans les gabarits) ; (b) service externe Gotenberg/Browserless appelé en `fetch` ; (c) jsPDF/pdf-lib : refaire la mise en page à la main | **(a) + (b) optionnel** : le HTML reste la référence scellée (déjà le cas), l'archive contient toujours le `.html`. Le PDF n'est qu'un confort : brancher Gotenberg (`PDF_SERVICE_URL`, `PDF_API_KEY`) derrière le port `ConvertisseurPdf`, repli HTML si absent — exactement le mécanisme actuel. (c) écartée : 15 gabarits à réécrire. | (a) 0,5 j ; (b) 1 j + hébergement |
| **3.2 E-mails** | nodemailer, SMTP par organisme (réglages) ou `.env` | nodemailer non compatible Deno (sockets TCP ; `npm:nodemailer` fonctionne mal, pas de SMTP sortant garanti) | (a) Resend API (`fetch`) avec clé plateforme ; (b) relais SMTP → HTTP (Brevo, Mailjet, SMTP2GO ont des API) ; (c) garder un SMTP par organisme via `npm:nodemailer` — fragile | **(a)** : port `Courrier` sur Resend, expéditeur par organisme (`courrier_expediteur` vérifié comme domaine Resend) ; conserver `reglage.smtp_*` seulement si (b) est choisi. Traçabilité `courrier` inchangée. | 1 j |
| **3.3 Archive disque** | `ArchiveLocale` (`node:fs`) | Pas de disque persistant | Storage : 3 buckets privés, mêmes chemins relatifs stockés en base | Port `Archive` sur `supabase.storage.from(bucket)` ; les colonnes `chemin_*` gardent la forme `<of>/dossiers/<ref>/Retour/<fichier>`. Dépôts de fichiers par le client vers un préfixe temporaire puis `move` par l'Edge (évite de faire transiter 15 Mo par la fonction). Encoder le nom dans `nomSur` sans espaces insécables (contrainte de clés Storage). | 1 j |
| **3.4 PGlite / Drizzle** | PGlite local, Postgres en prod, migrations rejouées au démarrage | PGlite inutile ; Drizzle possible dans Deno mais double schéma | Migrations SQL `supabase/migrations` (autre agent) ; requêtes `supabase-js` dans les Edge Functions ; `npm:postgres` pour les deux transactions (`inscription`, `supprimerMonCompte`) ou RPC SQL | Abandonner Drizzle ; les types viennent de `supabase gen types`. Les tests d'intégration PGlite sont remplacés par `supabase start` + vitest. | 2 j (réécriture des requêtes des services portés) |
| **3.5 Gabarits HTML sur disque** | `gabarits/*.html` lus par `node:fs` | Deno Deploy n'embarque pas les fichiers hors bundle de façon fiable | (a) Générer `_shared/gabarits.generes.ts` (`export const GABARITS = { "02-AVT.html": "...", ... }`, clés = noms de fichiers du dossier `gabarits/`, extension comprise) par script au build ; (b) bucket `gabarits` lu à chaque rendu | **(a)** : build déterministe, le test « contrôle final » des gabarits continue de tourner sur les sources. Le front en a aussi besoin pour l'aperçu local éventuel (#52, #54). | 0,5 j |
| **3.6 pptxgenjs / jszip / qrcode** | npm, sortie `nodebuffer` | `npm:` dans Deno : jszip OK (`type: "uint8array"`), qrcode OK (`toString svg`), pptxgenjs dépend de jszip + `https` Node — fonctionne via `npm:pptxgenjs` avec `write({outputType:"arraybuffer"})` mais à tester sur Deno Deploy (taille du bundle ≈ 2 Mo) | Si pptxgenjs échoue en Edge : produire le PPTX **côté client** (pptxgenjs tourne en navigateur, `writeFile`/`write("blob")`) puis upload dans `supports` + insert `coffre_fichier` (Client + RLS) | Tester `npm:pptxgenjs` en premier ; repli client. | 1 j (test) ; +1 j si repli |
| **3.7 Chiffrement des secrets** | AES-256-GCM `node:crypto`, clé `CLE_SECRETS` ou fichier `.cle-secrets` | Pas de fichier ; `node:crypto` partiellement supporté | (a) Web Crypto `AES-GCM` avec `CLE_SECRETS` en secret de fonction (même format `v1:` → les valeurs existantes restent lisibles) ; (b) Supabase Vault (`vault.create_secret`) | **(a)** pour la compatibilité du format et l'absence d'extension ; Vault si l'on veut que même `service_role` ne lise pas les secrets en clair. | 0,5 j |
| **3.8 Sessions, scrypt, anti-force brute, CSRF** | `auth.ts`, cookie `s4m_session`, en-tête `x-requested-with` | Remplacés par GoTrue (JWT, refresh, rate limit) | — | Supprimer `session_utilisateur`, `mot_de_passe_hash`, le compteur d'échecs. Garder `invitation` (flux apprenant sans mot de passe). Reprendre la politique « 10 caractères minimum » dans les réglages Auth. | 0,5 j |
| **3.9 Hachage SHA-256** | `createHash` Node | `crypto.subtle.digest` asynchrone | — | Le noyau accepte déjà un `Hacheur` async ; `sha256()` devient `async` dans les modules portés. | 0,2 j |
| **3.10 Tâche quotidienne** | `setInterval` au démarrage | Pas de processus résident | `pg_cron` + `pg_net` appelant l'Edge `taches-quotidiennes` | Un job à 03:00 Europe/Paris. | 0,2 j |
| **3.11 Limite de durée des Edge Functions** | serveur sans limite | ~150 s CPU / 400 s mur par requête | — | `ia-assistant` (parcours, plan-support avec recherche web) tient en général mais sans marge ; `supports/tous` (#65) et `produireTousLesSupports` sont à découper côté front ; `bpf` peut passer en RPC + noyau front si lent. | compris ci-dessus |
| **3.12 Taille de corps** | 100 Mo (coffre) via Hono | Edge : quelques Mo raisonnables | — | Tous les uploads passent par Storage direct depuis le client (déjà prévu : #21, #45, #86, #99, #112). | 0 |

## 4. Secrets Supabase à déclarer

Déclarés par `supabase secrets set` (Edge Functions) ; les deux premiers sont injectés automatiquement.

| Secret Supabase | Depuis `.env.example` | Usage | Remarque |
|---|---|---|---|
| `SUPABASE_URL` | `DATABASE_URL` (remplacé) | toutes les fonctions | automatique |
| `SUPABASE_SERVICE_ROLE_KEY` | — | toutes les fonctions | automatique ; jamais dans le front |
| `SUPABASE_ANON_KEY` | — | vérification du JWT entrant | automatique |
| `APP_URL` | `APP_URL` | liens dans les e-mails et documents (invitation, positionnement, formulaire) | URL Lovable de production |
| `RESEND_API_KEY` | `SMTP_URL` + `COURRIER_MODE` | `courrier.ts` | vide = boîte locale (tout journalisé, rien ne part), comme `COURRIER_MODE=boite-locale` |
| `COURRIER_EXPEDITEUR` | `COURRIER_EXPEDITEUR` | expéditeur par défaut si l'organisme n'en a pas réglé | |
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | `ia-assistant` (défaut si pas de clé par organisme) | |
| `IA_MODELE` | `IA_MODELE` | idem | défaut `claude-sonnet-5` |
| `IA_WORKSPACE_ID` | `IA_WORKSPACE_ID` | idem | |
| `IA_RECHERCHE_WEB` | `IA_RECHERCHE_WEB` | idem | `oui`/`non` |
| `CLE_SECRETS` | `CLE_SECRETS` | `reglages`, `ia-assistant`, `courriels-envoyer` (déchiffrement) | 64 hex obligatoires (plus de fichier `.cle-secrets`) ; reprendre la valeur de production pour relire les secrets migrés |
| `PDF_SERVICE_URL`, `PDF_API_KEY` | `CHROMIUM_PATH` | `pdf.ts` (Gotenberg/Browserless) | vide = repli HTML |
| `CRON_SECRET` | — | `taches-quotidiennes` | en-tête `x-cron-secret` posé par `pg_net` |
| `ARCHIVE_BUCKET`, `COFFRE_BUCKET`, `SUPPORTS_BUCKET` | `ARCHIVE_DIR` | facultatif ; défauts `archive`, `coffre`, `supports` | |

Variables de `.env.example` **sans équivalent** (disparaissent) : `PORT`, `DATABASE_URL`, `AMORCE`, `ADMIN_EMAIL`/`ADMIN_MOT_DE_PASSE` (premier admin créé par un script SQL de seed ou le dashboard), `IA_FACTICE` (ne pas porter en production ; utile seulement en local avec `supabase functions serve`), `COMPTE_PILOTE_*` (créer le compte pilote par seed).
