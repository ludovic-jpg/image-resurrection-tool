# Skills4mation — Modèle de données Supabase (reconstruction Lovable)

Références : `supabase/migrations/20261005000000_s4m_initial.sql` (tables, RLS, Auth, Storage — exécutable d'un bloc sur un projet vierge) puis `supabase/migrations/20261005000100_s4m_rpc.sql` (RPC, triggers de journal / versions, vues sans secret, attendus par `CARTE_DES_ROUTES.md`).
Mise en production : `supabase/admin_production.sql` (gabarit commenté, placeholders `<OF_ID>`, `<EMAIL>`, `<MOT_DE_PASSE>`… ; crée l'organisme réel et son premier admin par SQL, car le trigger exige `app_metadata.s4m_role` à la création du compte).
Test de non-régression du cloisonnement : `supabase/tests/rls_test.mjs` (voir § Vérification).
Jeu de démonstration (projet de TEST uniquement) : `supabase/seed_demo.sql`, à coller dans le SQL Editor après les deux migrations — 5 comptes (`admin@`, `formatrice@`, `formateur2@`, `apprenante@`, `candidat@demo.example`, mot de passe `demonstration-s4m`), 1 OF, 3 formations, 1 entreprise, 2 stagiaires, 2 dossiers (formation en cours / brouillon) ; le candidat Paul est en brouillon complet (prêt à soumettre). Idempotent.

Légende « qui lit / qui écrit » :
- **Client** = application Lovable avec la clé `anon` + session Supabase Auth (politiques RLS).
- **EF** = Edge Function exécutée avec la clé `service_role` (contourne la RLS, applique les règles métier).
- Rôles : **admin** (organisme), **formateur** (validé, sauf mention), **apprenant** (stagiaire invité).

## 1. Tables

### Organisme et comptes

| Table | Rôle métier | Colonnes clés | Lit | Écrit |
|---|---|---|---|---|
| `organisme_formation` | L'OF porteur Qualiopi ; racine de tout le cloisonnement. | `id`, `of_nom`, `of_siret`, `of_nda_numero`, `of_qualiopi_numero`, `of_iban/bic`, `portage_commission_pourcentage`, `tva_pourcentage`, `couleur`, `signature_representant_png` | Client : **admin uniquement** (table complète). Formateurs / apprenants → vue `organisme_public` | Client : admin (update ; journal par trigger). Création : SQL / EF / `admin_production.sql` |
| `organisme_public` (vue) | Coordonnées publiques de l'OF pour les écrans et documents. `security_invoker` sur `s4m_organisme_public()` (definer filtrée sur `s4m_of_id()`). | `of_nom`, forme juridique, adresse, SIRET, NDA, DREETS, Qualiopi, représentant, `of_email_pedagogie`, `of_telephone`, `couleur`. Exclus : IBAN, BIC, banque, TVA intracom., e-mail compta, tribunal, subrogation, commission, taux, délais, signature | Client : tout membre de l'OF | lecture seule |
| `utilisateur` | **Profil** du compte Supabase Auth (`id = auth.users.id`). Plus de mot de passe ni de sessions ici. | `id uuid`, `of_id`, `email`, `role` (admin/formateur/apprenant), `prenom`, `nom`, `actif`, `supprime_le` | Client : soi-même ; admin : l'OF ; formateur : ses apprenants | Insert : **trigger `auth.users`** uniquement. Update client : prénom / nom (soi-même ou admin), `actif` / `supprime_le` (admin). **`email`, `role`, `of_id`, `id` : jamais côté client** (garde-fou trigger) — l'e-mail suit `auth.users` (changement via Supabase Auth puis synchronisation service) |
| `invitation` | Lien à usage unique pour créer un compte **apprenant** (par le formateur) ou **formateur** (par l'admin). Stocke `sha256(jeton)`. | `jeton_hash`, `of_id`, `email`, `role`, `stagiaire_id` / `formateur_id` (fiche à relier), `expire_le`, `utilisee_le`, `utilisateur_id` | Client : admin ; formateur (invitations de ses stagiaires) | Client : insert / delete (admin ; formateur pour ses stagiaires). Consommation : trigger auth |
| `formateur` | Fiche + candidature du formateur (F-ONB-01), reliée au compte par `utilisateur_id`. | `id`, `of_id`, `utilisateur_id uuid`, identité, entreprise, NDA, IBAN/BIC, `statut_candidature` (brouillon/soumise/validee/refusee), `decidee_le`, `anonymise_le` | Client : soi-même ; admin : l'OF. **Jamais l'apprenant** (IBAN/BIC, SIRET, adresse, tarifs) → il passe par `formateur_public` | Insert : trigger auth / EF. Update : soi-même (fiche, brouillon → soumise) ; admin (décision). Garde-fou trigger |
| `formateur_public` (vue) | « Carte de visite » du formateur : prénom, nom, e-mail pro, bio, domaines, LinkedIn, statut. Aucune donnée bancaire, SIRET, adresse, téléphone ni tarif. Vue `security_invoker` sur la fonction security definer `s4m_formateurs_publics()` qui filtre elle-même. | `id`, `of_id`, `formateur_prenom`, `formateur_nom`, `formateur_email`, `formateur_bio`, `formateur_domaines`, `formateur_linkedin` | Client : admin (OF) ; formateur (lui-même) ; **apprenant : les formateurs de ses dossiers** | lecture seule |
| `piece_formateur` | Pièces de candidature (Kbis, RC pro…). Fichier dans bucket `archive`, `<of_id>/candidatures/<formateur_id>/…`. | `formateur_id`, `type`, `nom_fichier`, `chemin`, `expire_le` (ISO) | Client : le formateur ; admin | Client : le formateur (insert/delete) |

### Catalogue du formateur

| Table | Rôle métier | Colonnes clés | Lit | Écrit |
|---|---|---|---|---|
| `entreprise_cliente` | Donneur d'ordre, propriété d'un formateur. | `of_id`, `formateur_id`, `entreprise_nom`, `entreprise_siret`, représentant, `entreprise_opco`, `archive_le` | Client : formateur propriétaire ; admin | Client : formateur propriétaire |
| `stagiaire` | Fiche apprenant gérée par le formateur ; `utilisateur_id` une fois le compte créé. | `of_id`, `formateur_id`, `entreprise_id`, `utilisateur_id uuid`, identité, `stagiaire_situation_handicap`, `archive_le` | Client : formateur propriétaire ; admin ; l'apprenant (sa fiche) | Client : formateur propriétaire (sans toucher `utilisateur_id`). Liaison compte : trigger auth |
| `formation` | Parcours du catalogue (programme, modules, prix, lieu, enjeux IA). | `of_id`, `formateur_id`, `formation_titre`, durées, `formation_prix_unitaire_ht` / `_groupe_ht` (centimes), `formation_modules jsonb`, `dossier_enjeux jsonb`, `archivee` | Client : formateur propriétaire ; admin | Client : formateur propriétaire |
| `modele_outil` | Questionnaires modèles (positionnement / acquis). | `formateur_id`, `formation_id`, `type`, `contenu jsonb`, `archive_le` | Client : formateur propriétaire ; admin | Client : formateur propriétaire |
| `coffre_fichier` | Coffre-fort pédagogique d'une formation (bucket `coffre`, `<of_id>/coffres/<formation_id>/…`). | `formateur_id`, `formation_id`, `nom_fichier`, `chemin`, `partageable`, `categorie`, `origine`, `supprime_le` (corbeille) | Client : formateur ; admin ; **apprenant** : fichiers `partageable` non supprimés des formations de ses dossiers ayant atteint « accord de financement » (RG-08) | Client : formateur propriétaire. Supports générés par IA : EF |
| `version_objet` | Historique de versions (formation / outil). | `of_id`, `type`, `objet_id`, `libelle`, `snapshot jsonb`, `auteur_id uuid` | Client : admin ; formateur (ses objets) | **Jamais le client directement.** Écrit par le trigger `s4m_version` (BEFORE UPDATE sur `formation` / `modele_outil`, photographie OLD, purge > 50) via la fonction interne `s4m_memoriser_version` (SECURITY DEFINER, non exécutable par `authenticated`) ; restauration par la RPC `s4m_restaurer_version` |
| `positionnement` | Invitation d'un apprenant à se positionner **sans compte** (lien personnel, `sha256(jeton)`). | `formateur_id`, `formation_id`, `stagiaire_id`, `jeton_hash`, `statut`, `questionnaire`, `reponses`, `score`, `signature_png`, `chemin_pdf`, `empreinte_pdf`, `expire_le` | Client : formateur ; admin. Jamais l'apprenant connecté | Client : formateur (création, message, archivage). Page publique (brouillon, signature, PDF, relance/jeton) : **EF** ; colonnes verrouillées par trigger |

### Dossier de formation (pipeline)

| Table | Rôle métier | Colonnes clés | Lit | Écrit |
|---|---|---|---|---|
| `dossier_formation` | Objet central : instantané de la formation + état du pipeline A → G. | `of_id`, `dossier_reference` (ADF-AAAA-NNNN), `formateur_id`, `entreprise_id`, `formation_id`, `sous_statut`, `mode_financement`, prix (centimes), dates ISO, `questionnaire_*`, `coffre_ouvert`, `valide_le`, `termine_le`, `archive_le` | Client : admin ; formateur propriétaire. **Pas l'apprenant** → vue `dossier_formation_apprenant` | Client : formateur (insert brouillon, update en brouillon, delete brouillon) ; admin (update brouillon / en cours de validation). **Pipeline (`sous_statut`, motifs, dates d'étape, `coffre_ouvert`) : EF uniquement**, verrouillé par trigger |
| `dossier_formation_apprenant` (vue) | Ce que l'apprenant voit de SES dossiers. `security_invoker` sur `s4m_dossiers_apprenant()` (definer filtrée : rôle apprenant + inscrit). | identification, `sous_statut`, contenu pédagogique, lieu, dates, `mode_financement`, `formation_opco`, `coffre_ouvert`. Exclus : prix, `formateur_cout_horaire`, `questionnaire_positionnement` / `_acquis` (corrigés), motifs, `entreprise_id` | Client : l'apprenant inscrit (0 ligne pour les autres rôles) | lecture seule |
| `stagiaire_dossier` | Inscription d'un stagiaire (≤ 8) à un dossier. | `dossier_id`, `stagiaire_id`, `poste_occupe`, `statut_assiduite`, `rang` | Client : interne ; apprenant : sa ligne | Client : tant que le dossier est modifiable |
| `seance` | Planning (date ISO, heures). | `dossier_id`, `date`, `heure_debut`, `heure_fin` | Client : tous les acteurs du dossier | Client : tant que le dossier est modifiable |
| `emargement` | Émargement signé (tracé PNG, horodatage **serveur**). | `seance_id`, `stagiaire_id`, `signataire`, `trace_png`, `horodatage` | Client : interne ; apprenant : ses pointages | **EF uniquement** |
| `evaluation` | Évaluations (positionnement / acquis / satisfaction) par stagiaire. | `dossier_id`, `stagiaire_id`, `type`, `reponses jsonb`, `score`, `saisie_par uuid` | Client : interne ; apprenant : les siennes | Client : admin / formateur du dossier |
| `piece_dossier` | Les 13 pièces de la nomenclature, collectives ou par stagiaire. Fichiers dans `archive`, `<of_id>/dossiers/<ref>/{Pièces de départ,Retour}/…`. | `dossier_id`, `code`, `stagiaire_id`, `statut`, `chemin_depart`, `empreinte_depart`, `chemin_retour`, `empreinte_retour`, `mode_retour`, `retour_par uuid` | Client : interne (toutes) ; **apprenant : codes de l'espace « Communication Apprenant » (PRE, 02-AVT, 03-AVT, PRG, ACC, 05-AVT, 06-PDT, 07-FIN, 09-FIN), collectives ou les siennes ; jamais 04-AVT (ODM), 10/11-FIN (factures), 00/01-AVT, 08-FIN, REF, 12-APR** | **EF uniquement** (génération, dépôt de retour, signature, scellement d'empreinte) |
| `signature` | Preuve de signature en ligne (tracé, lieu, IP, empreinte du document). | `piece_id`, `utilisateur_id uuid`, `signataire_*`, `empreinte_document`, `adresse_ip` | Client : interne ; apprenant : les siennes | **EF uniquement** |
| `facture_of` | Facture OF → client (FA-AAAA-NNNN). | `dossier_id` (unique), `facture_of_numero`, `facture_of_date`, `facture_of_acompte` (centimes) | Client : admin ; formateur du dossier. **Jamais l'apprenant** | **EF uniquement** |
| `facture_formateur` | Facture formateur → OF (FF-AAAA-NNNN). | `dossier_id` (unique), `facture_formateur_numero`, `facture_formateur_date` | idem | **EF uniquement** |
| `formulaire_apprenant` | Formulaires remplis par lien (recueil des besoins, positionnement du dossier) sans compte. | `dossier_id`, `stagiaire_id`, `type`, `jeton_hash`, `statut`, `brouillon`, `envois`, `expire_le` | Client : interne (suivi) | **EF uniquement** (envoi, remplissage public) |

### Transverse

| Table | Rôle métier | Colonnes clés | Lit | Écrit |
|---|---|---|---|---|
| `evenement` | Journal d'audit (par OF et par dossier). | `of_id`, `dossier_id`, `acteur_id uuid`, `acteur_role`, `type`, `libelle`, `detail jsonb` | Client : admin (OF) ; formateur (ses dossiers). **Jamais l'apprenant** | **EF et triggers uniquement** (trigger auth, triggers `s4m_journal` / `s4m_profil` via la fonction interne `s4m_journal`, non exécutable par `authenticated`) |
| `courrier` | Courriers sortants journalisés (pièces jointes, erreurs d'envoi). | `of_id`, `dossier_id`, `formateur_id`, `type`, `destinataire`, `corps_html`, `statut` | Client : admin ; formateur (les siens) | **EF uniquement** |
| `compteur` | Compteurs de numérotation (`ADF-2026`, `FA-2026`, `FF-2026`). | `of_id`, `cle`, `valeur` | **Personne côté client** | **EF uniquement** (`insert … on conflict do update`) |
| `reglage` | Réglages par OF (courrier, IA…) ; `secret = true` ⇒ chiffré. | `of_id`, `cle`, `valeur`, `secret` | Client : admin, réglages **non secrets** | Client : admin (non secrets). Secrets : **EF** (chiffrement) |

### Buckets Storage (privés)

| Bucket | Chemin | Lecture client | Écriture client |
|---|---|---|---|
| `archive` | `<of_id>/dossiers/<dossier_reference>/<sous-dossier>/<fichier>` | admin ; formateur propriétaire du dossier | aucune (EF : génération, retour, scellement) |
| `archive` | `<of_id>/candidatures/<formateur_id>/<fichier>` | le formateur ; admin | le formateur (insert/delete) |
| `coffre` | `<of_id>/coffres/<formation_id>/<fichier>` | quiconque voit la ligne `coffre_fichier` (apprenant compris, RG-08) | formateur propriétaire de la formation |
| `supports` | `<of_id>/supports/<formation_id>/<fichier>` | formateur propriétaire ; admin | formateur propriétaire |

L'apprenant ne lit **jamais** `archive` directement : l'EF « télécharger la pièce » vérifie `peutVoir` puis renvoie une URL signée.

## 2. Fonctions d'aide SQL (security definer, stable, `search_path = public`)

| Fonction | Retour |
|---|---|
| `s4m_of_id()` | `of_id` du profil actif de `auth.uid()` (null sinon) |
| `s4m_role()` | `'admin' \| 'formateur' \| 'apprenant'` |
| `s4m_formateur_id()` | id de la fiche formateur liée (quel que soit l'état de la candidature) |
| `s4m_est_admin()` | boolean |
| `s4m_formateur_valide_id()` | id formateur **si candidature validée** (= `exigerFormateurValide`) |
| `s4m_stagiaire_id()` | id de la fiche stagiaire liée au compte apprenant |
| `s4m_dossier_lisible(id)` / `s4m_dossier_interne(id)` / `s4m_dossier_modifiable(id)` | reproduisent `accederAuDossier` / lecture interne / `exigerModifiable` |
| `s4m_apprenant_inscrit(id)` | l'apprenant connecté est inscrit au dossier |
| `s4m_piece_espace_apprenant(code)` | code dans l'espace « Communication Apprenant » |
| `s4m_a_atteint(courant, seuil)` / `s4m_rang_statut(s)` | ordre du pipeline (`aAtteint` du noyau, branche `refus_financement` incluse) |
| `s4m_formateurs_publics()` | lignes de `formateur_public` visibles par l'appelant (admin : OF ; formateur : lui ; apprenant : formateurs de ses dossiers) |
| `s4m_est_service()` | vrai hors contexte client. Lit le rôle de la **requête** (`request.jwt.claims` ->> 'role', `request.jwt.claim.role`, `current_setting('role')`, `session_user`), pas `current_user` — qui vaut le propriétaire dans un SECURITY DEFINER. Utilisée par les triggers garde-fous |
| `s4m_organisme_public()`, `s4m_dossiers_apprenant()`, `s4m_coffre_ouvert_apprenant(formation_id)` | sources filtrées des vues `organisme_public`, `dossier_formation_apprenant`, et test RG-08 de la politique `coffre_fichier` (l'apprenant ne lit pas `dossier_formation`) |

## 2 bis. RPC, triggers et vues (migration 2)

| Objet | Porté depuis | Retour / effet | Qui |
|---|---|---|---|
| `s4m_moi()` | `GET /api/auth/moi` | `{ acteur: {utilisateur_id, of_id, role, formateur_id, formateur_valide, stagiaire_id, nom, email}, organisme: {nom, couleur} }` ou `{ acteur: null }` | tout connecté |
| `s4m_lister_dossiers()` | `dossiers.listerDossiers` | `{ etapes, sous_statuts, dossiers: [carte…] }` — cartes du pipeline, compteur de pièces suivies visibles, nom du formateur via `formateur_public` | A / F validé / S (RLS) |
| `s4m_coffres_parcours()` | `coffre.listerCoffresParcours` | tableau d'agrégats par formation (pédagogique, administratif, dossiers, positionnements) | A / F validé |
| `s4m_coffres_apprenant()` | `formations.coffresDeLApprenant` | `[{ dossier_id, dossier_reference, formation_titre, fichiers[] }]` (RG-08) | S |
| `s4m_dupliquer_formation(id text)` | `formations.dupliquerFormation` | la nouvelle formation (jsonb) ; copie des outils actifs ; « introuvable » si pas la sienne | F validé |
| `s4m_restaurer_version(id text)` | `formations.restaurerVersion` | `{ type, id }` ; mémorise l'état courant avant | F validé |
| `s4m_definir_seances(dossier_id text, jsonb)` | `dossiers.definirSeances` | delete + insert atomiques, validation (≤ 20, formats, fin > début) ; renvoie les séances | F (brouillon) / A |
| `s4m_objectifs_atteints(dossier_id text, valeur text)` | `dossiers.renseignerObjectifsAtteints` (#94) | `{ ok: true }` ; SECURITY DEFINER contrôlée (admin ou formateur du dossier, non terminal, 4 000 car.) | A / F validé |
| `s4m_questionnaire(dossier_id text, type text, stagiaire_id text)` | `evaluations.lireQuestionnaire` | `{ type, ouvert, formulaire: null, questionnaire (sans corrigé pour S), reponses, score, date }` | A / F / S |
| `s4m_piece_visible(id text)`, `s4m_coffre_accessible(id text)` | `peutVoir`, RG-08 | boolean = « la ligne existe sous RLS » | tout connecté |
| trigger `s4m_version` (formation, modele_outil) | `memoriserVersion` | BEFORE UPDATE → `version_objet` (OLD), purge > 50, `enjeux_le` | — |
| triggers `s4m_journal` (organisme_formation, formation, modele_outil, coffre_fichier delete) | `journaliser` | `organisme_modifie`, `formation_creee/archivee/restauree`, `outil_cree/archive`, `coffre_purge` | — |
| trigger `s4m_profil` (formateur) | `candidatures.mettreAJourMonProfil` | prénom/nom figés après validation (sauf admin), profil verrouillé pendant l'étude, `profil_modifie`, recopie prénom/nom → `utilisateur` | — |
| `reglage_vue` | `reglages.vueReglages` | clés non secrètes + `ia_cle_definie`, `smtp_mot_de_passe_defini` (jamais la valeur) | A |
| `positionnement_vue` | `listerPositionnements` | sans jeton_hash / brouillon / questionnaire / réponses / signature | A / F |
| `formulaire_apprenant_vue` | `etatFormulaires`, `listerFormulaires` | sans jeton_hash / brouillon | A / F |

Tous les ids métier passés aux RPC sont `text` (UUID en chaîne) ; seul `utilisateur.id` est `uuid`. Les RPC sont SECURITY INVOKER (RLS de l'appelant) **sauf** `s4m_moi`, `s4m_questionnaire`, `s4m_restaurer_version`, `s4m_objectifs_atteints`, SECURITY DEFINER avec contrôles explicites. `EXECUTE` est retiré à `public` et `anon` sur toutes les fonctions, et à `authenticated` sur les fonctions internes `s4m_journal` / `s4m_memoriser_version`.

## 3. Choix structurants

1. **`utilisateur.id` devient `uuid` référençant `auth.users(id) on delete cascade`.** Les id Hono étaient déjà des UUID générés par `randomUUID()` (type `text`) : la conversion est sans perte et évite une colonne `auth_user_id` de liaison. Toutes les colonnes qui pointaient vers l'utilisateur passent en `uuid` (`formateur.utilisateur_id`, `stagiaire.utilisateur_id`, `piece_dossier.retour_par`, `signature.utilisateur_id`, `invitation.utilisateur_id`, `evenement.acteur_id`, `version_objet.auteur_id`, `evaluation.saisie_par`). Les autres identifiants métier restent en `text` (UUID chaîne) avec `default gen_random_uuid()::text`.
2. **`mot_de_passe_hash` supprimé, `session_utilisateur` supprimée** : Supabase Auth porte mots de passe, sessions (JWT + refresh), anti-force brute et réinitialisation. `changerMotDePasse` → `supabase.auth.updateUser`.
3. **Trigger `after insert on auth.users`** (`s4m_creer_profil_depuis_auth`) crée le profil :
   - `app_metadata.s4m_role = 'admin'` + `of_id` → **admin** (seul canal : `auth.admin.createUser` côté service ; `app_metadata` n'est jamais modifiable par un client) ;
   - `user_metadata.invitation = <jeton clair>` → vérifie `sha256(jeton)`, non utilisée, non expirée, **même e-mail** ; prend OF / rôle / prénom / nom **de l'invitation** ; relie la fiche `stagiaire` ou `formateur` ; consomme l'invitation ;
   - sinon : **inscription spontanée = formateur candidat uniquement** (`of_id` facultatif, sinon le premier OF) ; tout `role` autre que `formateur` dans `user_metadata` est refusé.
4. **`invitation` remaniée** : elle porte désormais `of_id`, `email`, `role`, `prenom`, `nom`, `stagiaire_id` / `formateur_id`, car le compte n'existe pas avant l'inscription (dans Hono l'utilisateur était créé d'abord, inactif).
5. **RLS sur toutes les tables**, trois niveaux : (1) `of_id = s4m_of_id()` partout ; (2) formateur = ses `formateur_id` (candidature validée) ; (3) apprenant = `s4m_apprenant_inscrit` + `s4m_piece_espace_apprenant` + `stagiaire_id` ∈ {null, le sien}. `compteur` : RLS sans aucune politique (= interdit au client).
6. **Écritures sensibles sans politique client** (EF service_role) : pipeline, pièces, signatures, émargements, factures, journal, courriers, compteurs, versions, formulaires publics, positionnement public, réglages secrets. En complément, des **triggers garde-fous** (`s4m_garde_*`, SECURITY INVOKER) refusent à un client authentifié de toucher `sous_statut`, motifs, dates d'étape, `coffre_ouvert`, `of_id`, `formateur_id`, `dossier_reference` ; le rôle / l'activation d'un compte (sauf admin) ; la décision de candidature (sauf admin) ; les réponses, signature, PDF, jeton d'un positionnement.
7. **Routes publiques par jeton** (`/positionnement/:jeton`, formulaires apprenant, lien d'invitation) : aucun accès `anon` aux tables (`revoke all … from anon`). Ce sont des Edge Functions qui hachent le jeton et lisent / écrivent en `service_role`.
8. **Storage** : trois buckets privés créés par `insert into storage.buckets`, politiques `storage.objects` basées sur `storage.foldername(name)[1] = s4m_of_id()`.
9. `maj_le` mis à jour par trigger sur `dossier_formation`, `formation`, `modele_outil`, `reglage`.
10. Index conservés (uniques Drizzle inclus : `dossier_reference_unique`, `piece_dossier_unique` avec `coalesce(stagiaire_id,'')`, `utilisateur_email_unique` sur `lower(email)`, etc.) + index sur les colonnes filtrées par les politiques (`formateur_id`, `utilisateur_id`, `dossier_id`, `of_id`).

## 4. Écarts avec la version Hono

| Sujet | Hono | Supabase |
|---|---|---|
| Authentification | scrypt + sessions opaques en base, CSRF maison | Supabase Auth (e-mail / mot de passe) ; pas de table de session |
| `utilisateur` | table de compte (`text` id, hash) | table de profil (`uuid` = `auth.users.id`), sans hash |
| Invitation | utilisateur créé inactif puis activé | invitation autoportante consommée par le trigger auth |
| Cloisonnement | services (`accederAuDossier`…) | RLS + fonctions `s4m_*` ; les services deviennent des Edge Functions pour les écritures sensibles |
| « introuvable » plutôt qu'« interdit » | réponse 404 volontaire | RLS : la ligne est simplement absente (0 ligne), même effet |
| Formateur non validé | `exigerFormateurValide` par service | `s4m_formateur_valide_id()` dans les politiques ; le candidat ne voit que sa fiche / ses pièces |
| Fichiers | disque local, `cheminPiece/Coffre/Candidature` | buckets `archive` / `coffre` / `supports`, mêmes chemins relatifs préfixés par `<of_id>/` |
| Numérotation | `numeroSuivant` dans la transaction | même table `compteur`, EF uniquement |
| Fiche formateur vue par l'apprenant | le service ne renvoyait que nom / contact | l'apprenant n'a **aucun** accès à `formateur` ; il lit la vue `formateur_public` (prénom, nom, e-mail pro, bio, domaines, LinkedIn) limitée aux formateurs de ses dossiers |
| Organisme vu par formateur / apprenant | le service ne renvoyait que nom / couleur / coordonnées utiles | vue `organisme_public` ; la table complète (IBAN, commission, signature) est réservée à l'admin |
| Dossier vu par l'apprenant | `lireDossier` filtrait les champs internes | vue `dossier_formation_apprenant` (sans prix, coût, corrigés, motifs) ; `s4m_lister_dossiers`, `s4m_questionnaire`, `s4m_coffres_apprenant` s'appuient dessus |
| Objectifs atteints (#94) | service hors fenêtre de modification | RPC `s4m_objectifs_atteints` (definer contrôlée) |
| Réglages secrets | déchiffrés côté serveur | ni lus ni écrits par le client (`secret = false` dans les politiques) |
| Évaluations | saisie via service | insert / update client par admin ou formateur du dossier (règles de date / score à porter dans l'UI ou une EF si besoin) |

## 5. Vérification

```bash
# depuis la racine du dépôt (PGlite est dans package.json)
npm ci
node supabase/tests/rls_test.mjs
# ou avec un node_modules externe :
PGLITE_PATH=/chemin/vers/node_modules node supabase/tests/rls_test.mjs
```

Le script crée un stub Supabase (schémas `auth` / `storage`, `auth.users`, `auth.uid()`, rôles, `storage.buckets` / `storage.objects`, `storage.foldername`), applique la migration, puis vérifie 185 points : deux organismes, formateurs A et B du même OF, admin de chaque OF, apprenant du dossier A, anonyme, candidat non validé, vue `formateur_public` (apprenant : 0 ligne sur `formateur`, nom visible via la vue, aucune colonne sensible). La section 10 rejoue `seed_demo.sql` deux fois sur une base neuve (pgcrypto réel de PGlite) et contrôle ce que chaque compte de démo voit ; la section 11 teste les RPC / triggers / vues de la migration 2 par rôle ; la section 12 rejoue `admin_production.sql` (placeholders substitués, refus sans substitution, idempotence) ; la section 13 rejoue les sondes de la relecture indépendante (journal / versions forgés, lecture des prix et corrigés par l'apprenant, IBAN de l'OF, changement d'e-mail, objectifs atteints). Résultat attendu : `185 vérifications réussies, 0 échec(s)`.

## 6. Points à surveiller

- Sur Supabase, les politiques sur `storage.objects` et le trigger sur `auth.users` sont créés par le rôle `postgres` de la migration : c'est la pratique courante, mais vérifier qu'un `supabase db reset` les rejoue sans conflit avec des politiques Storage créées depuis le dashboard.
- La signature SQL de `storage.foldername` du stub est simplifiée (tableau des dossiers) ; elle correspond au comportement de la vraie fonction.
- Les Edge Functions doivent reproduire les règles métier du noyau (`src/domaine`) : transitions du pipeline, `peutValider`, scellement d'empreinte, horodatage serveur. La RLS n'est qu'un filet.
