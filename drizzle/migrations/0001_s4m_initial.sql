-- =====================================================================================================
--  Skills4mation — migration initiale Supabase (reconstruction Lovable + Supabase)
--  Fichier : supabase/migrations/20261005000000_s4m_initial.sql
--
--  Exécutable d'un seul bloc sur un projet Supabase vierge. Reproduit l'état final des migrations
--  Drizzle 0000 → 0003 de la version Hono, avec les adaptations suivantes :
--
--   1. AUTHENTIFICATION → Supabase Auth.
--      - `utilisateur` devient une table de PROFIL : sa clé `id` est un `uuid` qui référence
--        `auth.users(id) on delete cascade`. (Le type Drizzle était `text`, mais les valeurs étaient
--        déjà des UUID générés par `randomUUID()` : le passage à `uuid` est sans perte, et c'est ce qui
--        permet la référence directe vers auth.users sans colonne de liaison supplémentaire.)
--      - Les colonnes `mot_de_passe_hash` (et le sel, intégré à la chaîne scrypt) sont SUPPRIMÉES.
--      - La table `session_utilisateur` DISPARAÎT : Supabase gère les sessions (JWT + refresh tokens).
--      - Toutes les colonnes qui pointaient vers `utilisateur.id` passent en `uuid`
--        (formateur.utilisateur_id, stagiaire.utilisateur_id, piece_dossier.retour_par,
--        signature.utilisateur_id, invitation.utilisateur_id, evenement.acteur_id,
--        version_objet.auteur_id, evaluation.saisie_par).
--      - `invitation` est REMANIÉE : avec Supabase Auth, le compte n'existe qu'au moment de l'inscription,
--        on ne peut donc plus créer l'utilisateur d'abord. L'invitation porte désormais l'e-mail, l'OF,
--        le rôle et la fiche (stagiaire / formateur) à relier ; le trigger `on auth.users insert`
--        la consomme et crée le profil.
--
--   2. CLOISONNEMENT → RLS sur TOUTES les tables, trois niveaux (docs/ARCHITECTURE.md § Cloisonnement) :
--      (1) étanchéité par of_id ; (2) un formateur ne voit que SES dossiers / formations / stagiaires /
--      coffre ; (3) un apprenant ne voit que ses pièces individuelles et l'espace « Communication
--      Apprenant » — jamais l'ODM (04-AVT), les factures, les finances ni le journal. L'admin voit tout
--      son organisme.
--
--   3. ÉCRITURES SENSIBLES → AUCUNE politique d'écriture côté client. Passent par des Edge Functions
--      exécutées avec la clé service_role : changement de sous-statut du pipeline, génération / retour /
--      signature de pièce, scellement d'empreinte, émargement, compteurs, journal `evenement`,
--      `version_objet`, factures, courriers, réglages secrets, positionnement et formulaires publics.
--      Des triggers « garde-fous » empêchent en plus un client authentifié de toucher aux colonnes
--      sensibles d'une ligne qu'il a par ailleurs le droit de modifier.
--
--   4. ROUTES PUBLIQUES PAR JETON (positionnement, formulaires apprenant) : pas d'accès anon aux tables ;
--      ce sont des Edge Functions qui vérifient le jeton (hash SHA-256) et lisent / écrivent en
--      service_role.
--
--   5. STOCKAGE → trois buckets privés `archive`, `coffre`, `supports`, chemins préfixés par `<of_id>/`.
--
--  Conventions : schéma public, noms de tables / colonnes identiques à Drizzle (variables harmonisées
--  of_id, of_siret…), montants en CENTIMES entiers, dates ISO (AAAA-MM-JJ) en texte, horodatages en
--  timestamptz. Les identifiants métier restent en `text` (UUID sous forme de chaîne) comme dans Hono,
--  avec une valeur par défaut `gen_random_uuid()::text` pour que le client puisse insérer sans fournir
--  d'id.
-- =====================================================================================================

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 0. Extensions / prérequis
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- gen_random_uuid() et sha256(bytea) sont natifs (PostgreSQL ≥ 13 / ≥ 11) : aucune extension requise.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- Organisme de formation (le « porteur » Qualiopi). Une ligne par OF ; tout est cloisonné par of_id.
create table public.organisme_formation (
  id text primary key default gen_random_uuid()::text,
  of_nom text not null default '',
  of_forme_juridique text not null default '',
  of_adresse text not null default '',
  of_siret text not null default '',
  of_nda_numero text not null default '',
  of_dreets_region text not null default '',
  of_qualiopi_numero text not null default '',
  of_certification_complementaire_numero text not null default '',
  of_representant_civilite text not null default '',
  of_representant_prenom text not null default '',
  of_representant_nom text not null default '',
  of_email_pedagogie text not null default '',
  of_email_comptabilite text not null default '',
  of_tribunal_competent text not null default '',
  of_iban text not null default '',
  of_bic text not null default '',
  of_banque_nom text not null default '',
  of_tva_intracom text not null default '',
  of_telephone text not null default '',
  formation_clause_subrogation text not null default '',
  portage_commission_pourcentage real not null default 25,
  tva_pourcentage real not null default 0,
  delai_paiement_jours integer not null default 30,
  conservation_annees integer not null default 10,
  couleur text not null default '#1d6a45',
  signature_representant_png text not null default '',
  cree_le timestamptz not null default now()
);

-- Profil utilisateur. id = auth.users.id. Pas de mot de passe ici (Supabase Auth).
create table public.utilisateur (
  id uuid primary key references auth.users(id) on delete cascade,
  of_id text not null references public.organisme_formation(id),
  email text not null,
  role text not null check (role in ('admin', 'formateur', 'apprenant')),
  prenom text not null default '',
  nom text not null default '',
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  supprime_le timestamptz
);
create unique index utilisateur_email_unique on public.utilisateur (lower(email));

-- Invitation à usage unique (apprenant invité par son formateur, ou formateur invité par l'admin).
-- ÉCART Hono : l'invitation porte l'e-mail / l'OF / le rôle / la fiche à relier, car le compte auth
-- n'existe pas encore. `jeton_hash` = SHA-256 hex du jeton envoyé par e-mail (jamais le jeton en clair).
create table public.invitation (
  jeton_hash text primary key,
  of_id text not null references public.organisme_formation(id),
  email text not null,
  role text not null check (role in ('formateur', 'apprenant')),   -- jamais 'admin' par invitation
  prenom text not null default '',
  nom text not null default '',
  stagiaire_id text,          -- fiche apprenant à relier (role = apprenant) ; FK ajoutée plus bas
  formateur_id text,          -- fiche formateur à relier (role = formateur, optionnel) ; FK plus bas
  utilisateur_id uuid references public.utilisateur(id) on delete cascade,  -- renseigné à l'utilisation
  expire_le timestamptz not null,
  utilisee_le timestamptz,
  cree_le timestamptz not null default now()
);
create index invitation_email_idx on public.invitation (lower(email));

-- Formateur (candidature F-ONB-01 puis fiche validée). utilisateur_id = compte lié (null si anonymisé).
create table public.formateur (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  utilisateur_id uuid references public.utilisateur(id) on delete set null,
  formateur_prenom text not null default '',
  formateur_nom text not null default '',
  formateur_email text not null default '',
  formateur_telephone text not null default '',
  formateur_entreprise_nom text not null default '',
  formateur_entreprise_adresse text not null default '',
  formateur_entreprise_siret text not null default '',
  formateur_nda_numero text not null default '',
  formateur_dreets_region text not null default '',
  formateur_iban text not null default '',
  formateur_bic text not null default '',
  parcours text not null default '',
  statut_candidature text not null default 'brouillon'
    check (statut_candidature in ('brouillon', 'soumise', 'validee', 'refusee')),
  motif_decision text not null default '',
  soumise_le timestamptz,
  decidee_le timestamptz,
  anonymise_le timestamptz,
  cree_le timestamptz not null default now(),
  formateur_statut_juridique text not null default '',
  formateur_domaines jsonb not null default '[]'::jsonb,
  formateur_zones text not null default '',
  formateur_langues text not null default '',
  formateur_tarif_journalier integer,          -- centimes
  formateur_bio text not null default '',
  formateur_linkedin text not null default '',
  formateur_disponibilites text not null default '',
  formateur_assurance_rc text not null default ''
);
create index formateur_utilisateur_idx on public.formateur (utilisateur_id);
create index formateur_of_idx on public.formateur (of_id);

alter table public.invitation
  add constraint invitation_formateur_id_fk foreign key (formateur_id) references public.formateur(id) on delete cascade;

-- Pièces justificatives de la candidature du formateur (Kbis, RC pro, diplômes…). Bucket `archive`,
-- chemin `<of_id>/candidatures/<formateur_id>/<fichier>`.
create table public.piece_formateur (
  id text primary key default gen_random_uuid()::text,
  formateur_id text not null references public.formateur(id) on delete cascade,
  type text not null,
  nom_fichier text not null,
  chemin text not null,
  taille integer not null,
  cree_le timestamptz not null default now(),
  expire_le text not null default ''                -- date ISO ou ''
);
create index piece_formateur_formateur_idx on public.piece_formateur (formateur_id);

-- Entreprise cliente (donneur d'ordre), propriété d'un formateur.
create table public.entreprise_cliente (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  formateur_id text not null references public.formateur(id),
  entreprise_nom text not null default '',
  entreprise_nom_commercial text not null default '',
  entreprise_adresse text not null default '',
  entreprise_siret text not null default '',
  entreprise_representant_civilite text not null default '',
  entreprise_representant_prenom text not null default '',
  entreprise_representant_nom text not null default '',
  entreprise_representant_telephone text not null default '',
  entreprise_representant_email text not null default '',
  cree_le timestamptz not null default now(),
  entreprise_opco text not null default '',
  archive_le timestamptz
);
create index entreprise_cliente_formateur_idx on public.entreprise_cliente (formateur_id);

-- Stagiaire (apprenant), fiche gérée par un formateur ; utilisateur_id = compte apprenant une fois invité.
create table public.stagiaire (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  formateur_id text not null references public.formateur(id),
  entreprise_id text references public.entreprise_cliente(id),
  utilisateur_id uuid references public.utilisateur(id) on delete set null,
  stagiaire_prenom text not null default '',
  stagiaire_nom text not null default '',
  stagiaire_email text not null default '',
  stagiaire_telephone text not null default '',
  stagiaire_poste text not null default '',
  stagiaire_situation_handicap text not null default '',
  cree_le timestamptz not null default now(),
  archive_le timestamptz
);
create index stagiaire_formateur_idx on public.stagiaire (formateur_id);
create index stagiaire_utilisateur_idx on public.stagiaire (utilisateur_id);

alter table public.invitation
  add constraint invitation_stagiaire_id_fk foreign key (stagiaire_id) references public.stagiaire(id) on delete cascade;

-- Formation (parcours) du catalogue d'un formateur.
create table public.formation (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  formateur_id text not null references public.formateur(id),
  formation_titre text not null default '',
  formation_objectifs text not null default '',
  formation_niveau text not null default '',
  formation_prerequis text not null default '',
  formation_duree_heures_total real,
  formation_duree_jours real,
  formation_modalite text not null default 'presentiel',
  formation_prix_unitaire_ht integer,          -- centimes
  programme text not null default '',
  public_vise text not null default '',
  archivee boolean not null default false,
  cree_le timestamptz not null default now(),
  formation_nb_modules integer,
  formation_modules jsonb not null default '[]'::jsonb,
  formation_duree_heures_presentiel real,
  formation_duree_heures_distanciel real,
  formation_prix_groupe_ht integer,            -- centimes
  formation_effectif_min integer,
  formation_effectif_max integer,
  formation_lieu_nom text not null default '',
  formation_lieu_adresse text not null default '',
  formation_lieu_siret text not null default '',
  formation_lien_visio text not null default '',
  mode_financement text not null default 'opco',
  formation_opco text not null default '',
  formateur_cout_horaire integer,              -- centimes
  formation_domaine text not null default '',
  formation_moyens_pedagogiques text not null default '',
  formation_modalites_evaluation text not null default '',
  formation_modalites_sanction text not null default '',
  formation_accessibilite text not null default '',
  formation_delai_acces text not null default '',
  archivee_le timestamptz,
  maj_le timestamptz not null default now(),
  dossier_enjeux jsonb,
  enjeux_le timestamptz
);
create index formation_formateur_idx on public.formation (formateur_id);

-- Modèles d'outils pédagogiques (questionnaires de positionnement / d'acquis), propriété du formateur.
create table public.modele_outil (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  formateur_id text not null references public.formateur(id),
  formation_id text references public.formation(id) on delete set null,
  type text not null,
  titre text not null default '',
  contenu jsonb not null,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  archive_le timestamptz
);
create index modele_outil_formateur_idx on public.modele_outil (formateur_id);

-- Coffre-fort pédagogique d'une formation (F-OUT-04). Bucket `coffre`,
-- chemin `<of_id>/coffres/<formation_id>/<fichier>`.
create table public.coffre_fichier (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  formateur_id text not null references public.formateur(id),
  formation_id text not null references public.formation(id) on delete cascade,
  nom_fichier text not null,
  chemin text not null,
  taille integer not null,
  type_mime text not null default '',
  partageable boolean not null default true,
  cree_le timestamptz not null default now(),
  categorie text not null default 'support',
  origine text not null default 'depot',
  description text not null default '',
  supprime_le timestamptz
);
create index coffre_fichier_formation_idx on public.coffre_fichier (formation_id);
create index coffre_fichier_chemin_idx on public.coffre_fichier (chemin);

-- Dossier de formation : l'objet central du pipeline (sous-statuts A → G).
create table public.dossier_formation (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  dossier_reference text not null,
  formateur_id text not null references public.formateur(id),
  entreprise_id text not null references public.entreprise_cliente(id),
  formation_id text references public.formation(id) on delete set null,
  sous_statut text not null default 'brouillon' check (sous_statut in (
    'brouillon', 'en_cours_validation', 'dossier_valide', 'dossier_depose', 'accord_financement',
    'refus_financement', 'envoi_elements_pedagogiques', 'formation_debutee', 'fin_dossier_incomplet',
    'fin_dossier_complet', 'demande_paiement', 'paiement_receptionne', 'archive')),
  mode_financement text not null default 'opco',
  formation_titre text not null default '',
  formation_objectifs text not null default '',
  formation_objectifs_atteints text not null default '',
  formation_niveau text not null default '',
  formation_prerequis text not null default '',
  formation_duree_heures_total real,
  formation_duree_jours real,
  formation_duree_heures_presentiel real,
  formation_duree_heures_distanciel real,
  formation_modalite text not null default 'presentiel',
  formation_lieu_nom text not null default '',
  formation_lieu_adresse text not null default '',
  formation_lieu_siret text not null default '',
  formation_lien_visio text not null default '',
  formation_date_debut text not null default '',
  formation_date_fin text not null default '',
  formation_opco text not null default '',
  formation_prix_unitaire_ht integer,          -- centimes
  formation_prix_presentiel_ht integer,        -- centimes
  formateur_cout_horaire integer,              -- centimes
  signature_lieu text not null default '',
  questionnaire_positionnement jsonb,
  questionnaire_acquis jsonb,
  motif_renvoi text not null default '',
  motif_refus text not null default '',
  coffre_ouvert boolean not null default false,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  valide_le timestamptz,
  termine_le timestamptz,
  archive_le timestamptz,
  formation_public_vise text not null default '',
  formation_programme text not null default ''
);
create unique index dossier_reference_unique on public.dossier_formation (of_id, dossier_reference);
create index dossier_formateur_idx on public.dossier_formation (formateur_id);
create index dossier_of_idx on public.dossier_formation (of_id);

-- Inscription d'un stagiaire à un dossier (8 au plus).
create table public.stagiaire_dossier (
  id text primary key default gen_random_uuid()::text,
  dossier_id text not null references public.dossier_formation(id) on delete cascade,
  stagiaire_id text not null references public.stagiaire(id),
  poste_occupe text not null default '',
  statut_assiduite text not null default '',
  rang integer not null default 1
);
create unique index stagiaire_dossier_unique on public.stagiaire_dossier (dossier_id, stagiaire_id);
create index stagiaire_dossier_stagiaire_idx on public.stagiaire_dossier (stagiaire_id);

-- Séances (planning).
create table public.seance (
  id text primary key default gen_random_uuid()::text,
  dossier_id text not null references public.dossier_formation(id) on delete cascade,
  date text not null,
  heure_debut text not null,
  heure_fin text not null
);
create index seance_dossier_idx on public.seance (dossier_id);

-- Émargement (tracé PNG + horodatage SERVEUR) — écrit par Edge Function uniquement.
create table public.emargement (
  id text primary key default gen_random_uuid()::text,
  seance_id text not null references public.seance(id) on delete cascade,
  stagiaire_id text not null references public.stagiaire(id),
  signataire text not null,
  trace_png text not null,
  horodatage timestamptz not null default now()
);
create unique index emargement_unique on public.emargement (seance_id, stagiaire_id, signataire);

-- Évaluations (positionnement / acquis / satisfaction) par stagiaire et dossier.
create table public.evaluation (
  id text primary key default gen_random_uuid()::text,
  dossier_id text not null references public.dossier_formation(id) on delete cascade,
  stagiaire_id text not null references public.stagiaire(id),
  type text not null,
  date text not null,
  reponses jsonb not null,
  score real,
  ajustement text not null default '',
  saisie_par uuid,                                 -- utilisateur ; pas de FK (trace)
  cree_le timestamptz not null default now()
);
create unique index evaluation_unique on public.evaluation (dossier_id, stagiaire_id, type);

-- Pièce du dossier (13 pièces de la nomenclature). Bucket `archive`,
-- chemins `<of_id>/dossiers/<dossier_reference>/{Pièces de départ|Retour}/<fichier>`.
-- Écritures (génération, retour, scellement d'empreinte) : Edge Functions uniquement.
create table public.piece_dossier (
  id text primary key default gen_random_uuid()::text,
  dossier_id text not null references public.dossier_formation(id) on delete cascade,
  code text not null,
  stagiaire_id text references public.stagiaire(id),
  statut text not null default 'en_attente',
  chemin_depart text,
  empreinte_depart text,
  genere_le timestamptz,
  chemin_retour text,
  nom_fichier_retour text,
  empreinte_retour text,
  mode_retour text,
  retour_le timestamptz,
  retour_par uuid references public.utilisateur(id) on delete set null,
  transmise_le timestamptz
);
create unique index piece_dossier_unique on public.piece_dossier (dossier_id, code, coalesce(stagiaire_id, ''));
create index piece_dossier_dossier_idx on public.piece_dossier (dossier_id);

-- Preuve de signature en ligne (tracé, lieu, horodatage serveur, IP, empreinte) — Edge Function uniquement.
create table public.signature (
  id text primary key default gen_random_uuid()::text,
  piece_id text not null references public.piece_dossier(id) on delete cascade,
  utilisateur_id uuid references public.utilisateur(id) on delete set null,
  signataire_nom text not null,
  signataire_role text not null,
  signataire_email text not null,
  zone text not null,
  trace_png text not null,
  lieu text not null,
  horodatage timestamptz not null,
  empreinte_document text not null,
  adresse_ip text not null default ''
);
create index signature_piece_idx on public.signature (piece_id);

-- Facture de l'OF au client (numérotée par compteur FA-AAAA) — Edge Function uniquement.
create table public.facture_of (
  id text primary key default gen_random_uuid()::text,
  dossier_id text not null unique references public.dossier_formation(id) on delete cascade,
  facture_of_numero text not null,
  facture_of_date text not null,
  facture_of_code_client text not null default '',
  facture_of_numero_adherent text not null default '',
  facture_of_acompte integer                    -- centimes
);

-- Facture du formateur à l'OF (numérotée FF-AAAA) — Edge Function uniquement.
create table public.facture_formateur (
  id text primary key default gen_random_uuid()::text,
  dossier_id text not null unique references public.dossier_formation(id) on delete cascade,
  facture_formateur_numero text not null,
  facture_formateur_date text not null
);

-- Journal d'événements (audit) — INSERT par Edge Functions / triggers service uniquement.
create table public.evenement (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  dossier_id text references public.dossier_formation(id) on delete cascade,
  acteur_id uuid,                                  -- utilisateur ; pas de FK (trace)
  acteur_role text not null,
  type text not null,
  libelle text not null,
  detail jsonb,
  cree_le timestamptz not null default now()
);
create index evenement_dossier_idx on public.evenement (dossier_id);
create index evenement_of_idx on public.evenement (of_id, cree_le desc);

-- Courriers sortants journalisés — Edge Function uniquement.
create table public.courrier (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  dossier_id text references public.dossier_formation(id) on delete cascade,
  type text not null,
  destinataire text not null,
  sujet text not null,
  corps_html text not null,
  pieces_jointes jsonb not null default '[]'::jsonb,
  statut text not null default 'journalise',
  erreur text not null default '',
  cree_le timestamptz not null default now(),
  formateur_id text
);
create index courrier_dossier_idx on public.courrier (dossier_id);

-- Compteurs de numérotation (ADF-AAAA, FA-AAAA, FF-AAAA) — service_role uniquement.
create table public.compteur (
  of_id text not null references public.organisme_formation(id),
  cle text not null,
  valeur integer not null default 0
);
create unique index compteur_unique on public.compteur (of_id, cle);

-- Versions d'objets (formation / outil) — INSERT par Edge Function uniquement.
create table public.version_objet (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  type text not null,
  objet_id text not null,
  libelle text not null default '',
  snapshot jsonb not null,
  auteur_id uuid,                                  -- utilisateur ; pas de FK (trace)
  cree_le timestamptz not null default now()
);
create index version_objet_idx on public.version_objet (type, objet_id);

-- Positionnement par lien personnel (Modification 1). La partie publique passe par Edge Function.
create table public.positionnement (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  formateur_id text not null references public.formateur(id),
  formation_id text references public.formation(id) on delete set null,
  stagiaire_id text not null references public.stagiaire(id),
  jeton_hash text not null unique,
  statut text not null default 'envoye',
  message text not null default '',
  formation_titre text not null default '',
  questionnaire jsonb,
  questions_recueil jsonb not null default '[]'::jsonb,
  brouillon jsonb,
  recueil jsonb,
  reponses jsonb,
  score real,
  date_reponse text not null default '',
  signature_png text not null default '',
  signature_lieu text not null default '',
  signe_le timestamptz,
  chemin_pdf text,
  empreinte_pdf text,
  envoye_le timestamptz,
  expire_le timestamptz not null,
  archive_le timestamptz,
  cree_le timestamptz not null default now()
);
create index positionnement_formateur_idx on public.positionnement (formateur_id);

-- Réglages par OF (courrier, IA…). `secret = true` ⇒ valeur chiffrée, jamais lue par le client.
create table public.reglage (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  cle text not null,
  valeur text not null default '',
  secret boolean not null default false,
  maj_le timestamptz not null default now()
);
create unique index reglage_of_cle_idx on public.reglage (of_id, cle);

-- Formulaires apprenant par lien (recueil des besoins, positionnement du dossier…) — Edge Function.
create table public.formulaire_apprenant (
  id text primary key default gen_random_uuid()::text,
  of_id text not null references public.organisme_formation(id),
  dossier_id text not null references public.dossier_formation(id) on delete cascade,
  stagiaire_id text not null references public.stagiaire(id),
  type text not null,
  jeton_hash text not null unique,
  statut text not null default 'envoye',
  brouillon jsonb,
  envois integer not null default 0,
  envoye_le timestamptz,
  expire_le timestamptz not null,
  signe_le timestamptz,
  chemin_invitation text,
  cree_le timestamptz not null default now()
);
create unique index formulaire_apprenant_cle_idx on public.formulaire_apprenant (dossier_id, stagiaire_id, type);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Fonctions d'aide (security definer, stable, search_path = public)
--    Elles lisent `utilisateur` / `formateur` / `stagiaire` en contournant la RLS : c'est ce qui évite
--    toute récursion entre politiques.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- of_id de l'utilisateur connecté (null si pas de profil, profil inactif ou supprimé).
create or replace function public.s4m_of_id()
returns text language sql stable security definer set search_path = public as $$
  select u.of_id from public.utilisateur u
  where u.id = auth.uid() and u.actif and u.supprime_le is null
$$;

-- Rôle texte : 'admin' | 'formateur' | 'apprenant' (null si pas de profil actif).
create or replace function public.s4m_role()
returns text language sql stable security definer set search_path = public as $$
  select u.role from public.utilisateur u
  where u.id = auth.uid() and u.actif and u.supprime_le is null
$$;

-- id du formateur lié au compte connecté, null sinon (quel que soit l'état de sa candidature).
create or replace function public.s4m_formateur_id()
returns text language sql stable security definer set search_path = public as $$
  select f.id from public.formateur f
  where f.utilisateur_id = auth.uid() and f.anonymise_le is null
  limit 1
$$;

create or replace function public.s4m_est_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.s4m_role() = 'admin', false)
$$;

-- Fonctions complémentaires (mêmes garanties) :

-- id du formateur lié SEULEMENT si sa candidature est validée (équivalent de `exigerFormateurValide`).
create or replace function public.s4m_formateur_valide_id()
returns text language sql stable security definer set search_path = public as $$
  select f.id from public.formateur f
  where f.utilisateur_id = auth.uid() and f.anonymise_le is null and f.statut_candidature = 'validee'
  limit 1
$$;

-- id du stagiaire lié au compte apprenant connecté, null sinon.
create or replace function public.s4m_stagiaire_id()
returns text language sql stable security definer set search_path = public as $$
  select st.id from public.stagiaire st
  where st.utilisateur_id = auth.uid() and st.archive_le is null
  limit 1
$$;

-- Vrai hors contexte client (service_role, postgres, Edge Function, trigger GoTrue).
-- PIÈGE : dans une fonction SECURITY DEFINER, `current_user` vaut le PROPRIÉTAIRE (postgres) — une garde
-- fondée sur lui laisserait passer un client. On lit donc le rôle porté par la requête :
--   - `request.jwt.claims` ->> 'role' (PostgREST récent) ou `request.jwt.claim.role` (ancien format) ;
--   - `current_setting('role')`, posé par `SET ROLE authenticated` (PostgREST) et conservé dans un
--     SECURITY DEFINER ;
--   - session_user / current_user en dernier recours.
-- Il suffit qu'UNE de ces sources désigne un rôle client pour que la réponse soit « non ».
create or replace function public.s4m_est_service()
returns boolean language sql stable as $$
  select not (
       coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') in ('authenticated', 'anon')
    or coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') in ('authenticated', 'anon')
    or current_setting('role') in ('authenticated', 'anon')
    or session_user in ('authenticated', 'anon')
    or current_user in ('authenticated', 'anon')
  )
$$;

-- Rang d'un sous-statut du pipeline (ordre A → G), reproduit src/domaine/pipeline/statuts.ts.
create or replace function public.s4m_rang_statut(s text)
returns integer language sql immutable as $$
  select case s
    when 'brouillon' then 0
    when 'en_cours_validation' then 1
    when 'dossier_valide' then 2
    when 'dossier_depose' then 3
    when 'accord_financement' then 4
    when 'refus_financement' then 5
    when 'envoi_elements_pedagogiques' then 6
    when 'formation_debutee' then 7
    when 'fin_dossier_incomplet' then 8
    when 'fin_dossier_complet' then 9
    when 'demande_paiement' then 10
    when 'paiement_receptionne' then 11
    when 'archive' then 12
    else -1 end
$$;

-- `aAtteint(courant, seuil)` : le dossier a-t-il atteint le seuil ? (refus_financement est une branche.)
create or replace function public.s4m_a_atteint(courant text, seuil text)
returns boolean language sql immutable as $$
  select case
    when courant = 'refus_financement' then
      seuil = 'refus_financement' or public.s4m_rang_statut(seuil) < public.s4m_rang_statut('accord_financement')
    when seuil = 'refus_financement' then false
    else public.s4m_rang_statut(courant) >= public.s4m_rang_statut(seuil)
  end
$$;

-- Le dossier est-il LISIBLE par l'utilisateur connecté ? (= accederAuDossier : même OF, et admin,
-- ou formateur propriétaire validé, ou apprenant inscrit.)
create or replace function public.s4m_dossier_lisible(p_dossier_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dossier_formation d
    where d.id = p_dossier_id
      and d.of_id = public.s4m_of_id()
      and (
        public.s4m_est_admin()
        or d.formateur_id = public.s4m_formateur_valide_id()
        or exists (select 1 from public.stagiaire_dossier sd
                   where sd.dossier_id = d.id and sd.stagiaire_id = public.s4m_stagiaire_id())
      )
  )
$$;

-- Le dossier est-il lisible par un acteur INTERNE (admin / formateur propriétaire) ? Jamais l'apprenant.
create or replace function public.s4m_dossier_interne(p_dossier_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dossier_formation d
    where d.id = p_dossier_id
      and d.of_id = public.s4m_of_id()
      and (public.s4m_est_admin() or d.formateur_id = public.s4m_formateur_valide_id())
  )
$$;

-- Le dossier est-il MODIFIABLE par l'utilisateur connecté ? (= exigerModifiable : formateur en
-- brouillon ; admin en brouillon ou en cours de validation.)
create or replace function public.s4m_dossier_modifiable(p_dossier_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dossier_formation d
    where d.id = p_dossier_id
      and d.of_id = public.s4m_of_id()
      and (
        (d.formateur_id = public.s4m_formateur_valide_id() and d.sous_statut = 'brouillon')
        or (public.s4m_est_admin() and d.sous_statut in ('brouillon', 'en_cours_validation'))
      )
  )
$$;

-- L'apprenant connecté est-il inscrit à ce dossier ?
create or replace function public.s4m_apprenant_inscrit(p_dossier_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.stagiaire_dossier sd
    where sd.dossier_id = p_dossier_id and sd.stagiaire_id = public.s4m_stagiaire_id()
  )
$$;

-- RG-08 : la formation est-elle ouverte à l'apprenant connecté (un de SES dossiers sur cette formation a
-- atteint l'accord de financement) ? SECURITY DEFINER : l'apprenant n'a pas accès à dossier_formation.
create or replace function public.s4m_coffre_ouvert_apprenant(p_formation_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dossier_formation d
    join public.stagiaire_dossier sd on sd.dossier_id = d.id
    where d.formation_id = p_formation_id
      and sd.stagiaire_id = public.s4m_stagiaire_id()
      and public.s4m_a_atteint(d.sous_statut, 'accord_financement')
  )
$$;

-- Codes de pièces de l'espace « Communication Apprenant » (src/domaine/referentiel/pieces.ts).
-- Exclus : 00-AVT, 01-AVT (recueil / positionnement internes), REF, 04-AVT (ODM), 08-FIN,
-- 10-FIN et 11-FIN (factures), 12-APR (enquête à froid).
create or replace function public.s4m_piece_espace_apprenant(p_code text)
returns boolean language sql immutable as $$
  select p_code in ('PRE', '02-AVT', '03-AVT', 'PRG', 'ACC', '05-AVT', '06-PDT', '07-FIN', '09-FIN')
$$;

revoke all on function public.s4m_est_service() from public;
grant execute on function
  public.s4m_of_id(), public.s4m_role(), public.s4m_formateur_id(), public.s4m_est_admin(),
  public.s4m_formateur_valide_id(), public.s4m_stagiaire_id(), public.s4m_est_service(),
  public.s4m_rang_statut(text), public.s4m_a_atteint(text, text), public.s4m_dossier_lisible(text),
  public.s4m_dossier_interne(text), public.s4m_dossier_modifiable(text), public.s4m_apprenant_inscrit(text),
  public.s4m_piece_espace_apprenant(text), public.s4m_coffre_ouvert_apprenant(text)
to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Trigger `on auth.users insert` → création du profil
--    Métadonnées attendues dans raw_user_meta_data : { invitation?: "<jeton clair>", of_id?: "...",
--    role?: "formateur", prenom?: "...", nom?: "..." }.
--    RÈGLES DE PRUDENCE :
--      - Avec un jeton d'invitation valide (non utilisé, non expiré, e-mail identique) : le profil prend
--        l'OF, le rôle (formateur | apprenant), le prénom / nom de l'INVITATION — pas des métadonnées —
--        et la fiche (stagiaire / formateur) est reliée au compte. L'invitation est consommée.
--      - Sans invitation : seule l'inscription SPONTANÉE d'un formateur candidat est acceptée
--        (F-ONB-01) ; rôle forcé à 'formateur', fiche `formateur` créée en 'brouillon'.
--        Un rôle 'admin' ou 'apprenant' demandé dans les métadonnées est REFUSÉ.
--      - Un admin se crée UNIQUEMENT par `auth.admin.createUser()` (service_role / dashboard) avec
--        `app_metadata: { s4m_role: 'admin', of_id: '...' }`. `raw_app_meta_data` n'est jamais
--        modifiable par un client (contrairement à `raw_user_meta_data`, libre au signUp) : c'est le seul
--        canal sûr pour attribuer ce rôle.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_creer_profil_depuis_auth()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_email text := lower(trim(coalesce(new.email, '')));
  v_jeton text := nullif(meta ->> 'invitation', '');
  v_role text := nullif(meta ->> 'role', '');
  v_of text := nullif(meta ->> 'of_id', '');
  v_prenom text := left(trim(coalesce(meta ->> 'prenom', '')), 100);
  v_nom text := left(trim(coalesce(meta ->> 'nom', '')), 100);
  inv public.invitation%rowtype;
  v_formateur_id text;
begin
  if v_email = '' then
    raise exception 'Inscription refusée : adresse e-mail absente.';
  end if;

  -- 0) Création d'un ADMIN par le service (app_metadata, jamais user_metadata).
  if (app ->> 's4m_role') = 'admin' then
    if nullif(app ->> 'of_id', '') is null
       or not exists (select 1 from public.organisme_formation where id = app ->> 'of_id') then
      raise exception 'Création d''un administrateur : of_id absent ou inconnu dans app_metadata.';
    end if;
    insert into public.utilisateur (id, of_id, email, role, prenom, nom, actif)
    values (new.id, app ->> 'of_id', v_email, 'admin', v_prenom, v_nom, true);
    insert into public.evenement (of_id, acteur_id, acteur_role, type, libelle)
    values (app ->> 'of_id', new.id, 'admin', 'compte_cree', 'Compte administrateur créé');
    return new;
  end if;

  -- 1) Inscription sur invitation.
  if v_jeton is not null then
    select * into inv from public.invitation i
    where i.jeton_hash = encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex')
      and i.utilisee_le is null and i.expire_le > now()
    for update;
    if inv.jeton_hash is null then
      raise exception 'Ce lien d''invitation n''est plus valable. Demandez-en un nouveau.';
    end if;
    if lower(inv.email) <> v_email then
      raise exception 'Cette invitation a été émise pour une autre adresse e-mail.';
    end if;
    if inv.role not in ('formateur', 'apprenant') then
      raise exception 'Rôle d''invitation invalide.';  -- jamais admin par invitation
    end if;

    insert into public.utilisateur (id, of_id, email, role, prenom, nom, actif)
    values (new.id, inv.of_id, v_email, inv.role, coalesce(nullif(inv.prenom, ''), v_prenom), coalesce(nullif(inv.nom, ''), v_nom), true);

    if inv.role = 'apprenant' then
      if inv.stagiaire_id is null then
        raise exception 'Invitation apprenant sans fiche stagiaire.';
      end if;
      update public.stagiaire set utilisateur_id = new.id where id = inv.stagiaire_id and of_id = inv.of_id;
    else
      if inv.formateur_id is not null then
        update public.formateur set utilisateur_id = new.id where id = inv.formateur_id and of_id = inv.of_id;
      else
        insert into public.formateur (of_id, utilisateur_id, formateur_prenom, formateur_nom, formateur_email)
        values (inv.of_id, new.id, coalesce(nullif(inv.prenom, ''), v_prenom), coalesce(nullif(inv.nom, ''), v_nom), v_email);
      end if;
    end if;

    update public.invitation set utilisee_le = now(), utilisateur_id = new.id where jeton_hash = inv.jeton_hash;

    insert into public.evenement (of_id, acteur_id, acteur_role, type, libelle)
    values (inv.of_id, new.id, inv.role, 'compte_cree', 'Compte ' || inv.role || ' créé sur invitation');
    return new;
  end if;

  -- 2) Inscription spontanée : candidature formateur uniquement.
  if v_role is not null and v_role <> 'formateur' then
    raise exception 'Inscription refusée : le rôle « % » n''est attribué que sur invitation.', v_role;
  end if;
  if v_of is not null and not exists (select 1 from public.organisme_formation where id = v_of) then
    v_of := null;
  end if;
  if v_of is null then
    select id into v_of from public.organisme_formation order by cree_le asc limit 1;
  end if;
  if v_of is null then
    raise exception 'Aucun organisme de formation n''est configuré.';
  end if;

  insert into public.utilisateur (id, of_id, email, role, prenom, nom, actif)
  values (new.id, v_of, v_email, 'formateur', v_prenom, v_nom, true);

  insert into public.formateur (of_id, utilisateur_id, formateur_prenom, formateur_nom, formateur_email)
  values (v_of, new.id, v_prenom, v_nom, v_email)
  returning id into v_formateur_id;

  insert into public.evenement (of_id, acteur_id, acteur_role, type, libelle)
  values (v_of, new.id, 'formateur', 'compte_cree', 'Compte formateur créé (candidature)');
  return new;
end;
$$;

-- RETIRÉ POUR LOVABLE CLOUD (accord du 06/10/2026) : le schéma auth n'accepte aucun déclencheur.
-- La même logique est appliquée par public.s4m_assurer_profil() (migration 20261006000000),
-- appelée par l'application juste après la connexion.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Triggers garde-fous (colonnes sensibles interdites au client) et maj_le automatique
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- maj_le = now() sur toute mise à jour.
create or replace function public.s4m_maj_le()
returns trigger language plpgsql as $$
begin
  new.maj_le := now();
  return new;
end;
$$;
create trigger s4m_maj_le before update on public.dossier_formation for each row execute function public.s4m_maj_le();
create trigger s4m_maj_le before update on public.formation for each row execute function public.s4m_maj_le();
create trigger s4m_maj_le before update on public.modele_outil for each row execute function public.s4m_maj_le();
create trigger s4m_maj_le before update on public.reglage for each row execute function public.s4m_maj_le();

-- utilisateur : un client ne change jamais of_id ; seul un admin change un rôle / l'activation.
-- SECURITY INVOKER (défaut) pour que s4m_est_service() voie le vrai rôle de session.
create or replace function public.s4m_garde_utilisateur()
returns trigger language plpgsql as $$
begin
  if public.s4m_est_service() then return new; end if;
  -- L'e-mail est celui d'auth.users : il ne se change que par Supabase Auth (updateUser + confirmation)
  -- puis synchronisation côté service ; le rôle et l'organisme ne se changent que côté service.
  if new.of_id is distinct from old.of_id or new.id is distinct from old.id
     or new.email is distinct from old.email or new.role is distinct from old.role then
    raise exception 'Modification interdite (organisme, identifiant, e-mail ou rôle : action serveur uniquement).';
  end if;
  if (new.actif is distinct from old.actif or new.supprime_le is distinct from old.supprime_le) and not public.s4m_est_admin() then
    raise exception 'Seul un administrateur modifie l''activation d''un compte.';
  end if;
  return new;
end;
$$;
create trigger s4m_garde before update on public.utilisateur for each row execute function public.s4m_garde_utilisateur();

-- formateur : le formateur ne décide pas de sa propre candidature. Il peut seulement passer
-- brouillon → soumise (avec soumise_le). of_id et utilisateur_id sont figés côté client.
create or replace function public.s4m_garde_formateur()
returns trigger language plpgsql as $$
begin
  if public.s4m_est_service() then return new; end if;
  if new.of_id is distinct from old.of_id or new.utilisateur_id is distinct from old.utilisateur_id
     or new.anonymise_le is distinct from old.anonymise_le then
    raise exception 'Modification interdite (organisme / compte lié / anonymisation).';
  end if;
  if not public.s4m_est_admin() then
    if new.decidee_le is distinct from old.decidee_le or new.motif_decision is distinct from old.motif_decision then
      raise exception 'La décision sur une candidature appartient à l''organisme.';
    end if;
    if new.statut_candidature is distinct from old.statut_candidature
       and not (old.statut_candidature = 'brouillon' and new.statut_candidature = 'soumise') then
      raise exception 'Seule la soumission (brouillon → soumise) est permise au candidat.';
    end if;
  end if;
  return new;
end;
$$;
create trigger s4m_garde before update on public.formateur for each row execute function public.s4m_garde_formateur();

-- dossier_formation : le pipeline (sous_statut, dates d'étape, motifs, coffre_ouvert) ne bouge que via
-- Edge Function. of_id, formateur_id et dossier_reference sont figés.
create or replace function public.s4m_garde_dossier()
returns trigger language plpgsql as $$
begin
  if public.s4m_est_service() then return new; end if;
  if new.sous_statut is distinct from old.sous_statut
     or new.of_id is distinct from old.of_id
     or new.formateur_id is distinct from old.formateur_id
     or new.dossier_reference is distinct from old.dossier_reference
     or new.coffre_ouvert is distinct from old.coffre_ouvert
     or new.motif_renvoi is distinct from old.motif_renvoi
     or new.motif_refus is distinct from old.motif_refus
     or new.valide_le is distinct from old.valide_le
     or new.termine_le is distinct from old.termine_le
     or new.archive_le is distinct from old.archive_le then
    raise exception 'Le pipeline du dossier ne se modifie que par une action serveur (Edge Function).';
  end if;
  return new;
end;
$$;
create trigger s4m_garde before update on public.dossier_formation for each row execute function public.s4m_garde_dossier();

-- positionnement : réponses, signature, PDF et jeton ne bougent que côté serveur (page publique).
create or replace function public.s4m_garde_positionnement()
returns trigger language plpgsql as $$
begin
  if public.s4m_est_service() then return new; end if;
  if new.of_id is distinct from old.of_id or new.formateur_id is distinct from old.formateur_id
     or new.stagiaire_id is distinct from old.stagiaire_id
     or new.jeton_hash is distinct from old.jeton_hash
     or new.reponses is distinct from old.reponses or new.recueil is distinct from old.recueil
     or new.brouillon is distinct from old.brouillon or new.score is distinct from old.score
     or new.date_reponse is distinct from old.date_reponse
     or new.signature_png is distinct from old.signature_png or new.signature_lieu is distinct from old.signature_lieu
     or new.signe_le is distinct from old.signe_le
     or new.chemin_pdf is distinct from old.chemin_pdf or new.empreinte_pdf is distinct from old.empreinte_pdf
     or new.expire_le is distinct from old.expire_le or new.envoye_le is distinct from old.envoye_le then
    raise exception 'Les réponses, la signature et le jeton d''un positionnement ne se modifient que côté serveur.';
  end if;
  return new;
end;
$$;
create trigger s4m_garde before update on public.positionnement for each row execute function public.s4m_garde_positionnement();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Droits de base et RLS
--    - anon : aucun accès aux tables (les pages publiques passent par Edge Functions).
--    - authenticated : accès gouverné par les politiques ci-dessous.
--    - service_role : contourne la RLS (comportement Supabase), réservé aux Edge Functions.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;

alter table public.organisme_formation enable row level security;
alter table public.utilisateur enable row level security;
alter table public.invitation enable row level security;
alter table public.formateur enable row level security;
alter table public.piece_formateur enable row level security;
alter table public.entreprise_cliente enable row level security;
alter table public.stagiaire enable row level security;
alter table public.formation enable row level security;
alter table public.modele_outil enable row level security;
alter table public.coffre_fichier enable row level security;
alter table public.dossier_formation enable row level security;
alter table public.stagiaire_dossier enable row level security;
alter table public.seance enable row level security;
alter table public.emargement enable row level security;
alter table public.evaluation enable row level security;
alter table public.piece_dossier enable row level security;
alter table public.signature enable row level security;
alter table public.facture_of enable row level security;
alter table public.facture_formateur enable row level security;
alter table public.evenement enable row level security;
alter table public.courrier enable row level security;
alter table public.compteur enable row level security;
alter table public.version_objet enable row level security;
alter table public.positionnement enable row level security;
alter table public.reglage enable row level security;
alter table public.formulaire_apprenant enable row level security;

-- ── organisme_formation ── Table complète (IBAN/BIC, commission de portage, signature du représentant…) :
-- ADMIN uniquement. Formateurs et apprenants lisent la vue `organisme_public` (plus bas).
-- Écriture : admin (update). Création : SQL / service.
create policy of_select on public.organisme_formation for select to authenticated
  using (id = public.s4m_of_id() and public.s4m_est_admin());
create policy of_update_admin on public.organisme_formation for update to authenticated
  using (id = public.s4m_of_id() and public.s4m_est_admin())
  with check (id = public.s4m_of_id());

-- ── utilisateur ── Soi-même ; admin : tous les comptes de l'OF ; formateur validé : les comptes des
-- stagiaires qu'il gère (pour afficher « compte activé »). Update : soi-même (prénom/nom) ou admin de l'OF.
-- Insert : uniquement par le trigger auth (security definer) ou service_role.
create policy utilisateur_select on public.utilisateur for select to authenticated
  using (
    id = auth.uid()
    or (of_id = public.s4m_of_id() and public.s4m_est_admin())
    or (of_id = public.s4m_of_id() and exists (
          select 1 from public.stagiaire st
          where st.utilisateur_id = utilisateur.id and st.formateur_id = public.s4m_formateur_valide_id()))
  );
create policy utilisateur_update on public.utilisateur for update to authenticated
  using (id = auth.uid() or (of_id = public.s4m_of_id() and public.s4m_est_admin()))
  with check (of_id = public.s4m_of_id());

-- ── invitation ── Émise par un admin (tout rôle non admin) ou un formateur validé (apprenants de SES
-- fiches). Lecture : admin de l'OF, ou l'émetteur (via la fiche stagiaire / formateur). Le jeton clair
-- est généré côté client (ou Edge Function d'envoi d'e-mail) ; seule son empreinte est stockée.
create policy invitation_select on public.invitation for select to authenticated
  using (
    of_id = public.s4m_of_id() and (
      public.s4m_est_admin()
      or exists (select 1 from public.stagiaire st
                 where st.id = invitation.stagiaire_id and st.formateur_id = public.s4m_formateur_valide_id())
    )
  );
create policy invitation_insert on public.invitation for insert to authenticated
  with check (
    of_id = public.s4m_of_id()
    and role in ('formateur', 'apprenant')
    and utilisee_le is null and utilisateur_id is null
    and (
      public.s4m_est_admin()
      or (role = 'apprenant' and exists (
            select 1 from public.stagiaire st
            where st.id = invitation.stagiaire_id and st.of_id = invitation.of_id
              and st.formateur_id = public.s4m_formateur_valide_id()))
    )
  );
create policy invitation_delete on public.invitation for delete to authenticated
  using (
    of_id = public.s4m_of_id() and utilisee_le is null and (
      public.s4m_est_admin()
      or exists (select 1 from public.stagiaire st
                 where st.id = invitation.stagiaire_id and st.formateur_id = public.s4m_formateur_valide_id())
    )
  );

-- ── formateur ── Sa propre fiche ; admin : toutes les fiches de l'OF. JAMAIS l'apprenant : il ne lit
-- ni IBAN/BIC, ni SIRET, ni adresse, ni tarifs. Pour afficher le nom de son formateur, il passe par la
-- vue `formateur_public` (plus bas).
create policy formateur_select on public.formateur for select to authenticated
  using (
    utilisateur_id = auth.uid()
    or (of_id = public.s4m_of_id() and public.s4m_est_admin())
  );
create policy formateur_update on public.formateur for update to authenticated
  using (utilisateur_id = auth.uid() or (of_id = public.s4m_of_id() and public.s4m_est_admin()))
  with check (of_id = public.s4m_of_id());
-- Pas d'insert client : la fiche naît avec le compte (trigger auth) ou par service_role.

-- ── formateur_public ── Vue « carte de visite » du formateur : prénom, nom, e-mail professionnel,
-- bio, domaines, LinkedIn. AUCUNE donnée sensible (IBAN/BIC, SIRET, adresse, téléphone, tarifs, NDA).
-- Qui voit quoi : admin → tous les formateurs de l'OF ; formateur → lui-même ; apprenant → les
-- formateurs de SES dossiers. Implémentation : fonction security definer (contourne la RLS de
-- `formateur`) qui applique elle-même le filtre, puis vue security_invoker par-dessus.
create or replace function public.s4m_formateurs_publics()
returns table (
  id text, of_id text, formateur_prenom text, formateur_nom text, formateur_email text,
  formateur_bio text, formateur_domaines jsonb, formateur_linkedin text, statut_candidature text
)
language sql stable security definer set search_path = public as $$
  select f.id, f.of_id, f.formateur_prenom, f.formateur_nom, f.formateur_email,
         f.formateur_bio, f.formateur_domaines, f.formateur_linkedin, f.statut_candidature
  from public.formateur f
  where f.of_id = public.s4m_of_id()
    and f.anonymise_le is null
    and (
      public.s4m_est_admin()
      or f.utilisateur_id = auth.uid()
      or exists (select 1 from public.dossier_formation d
                 where d.formateur_id = f.id and public.s4m_apprenant_inscrit(d.id))
    )
$$;
grant execute on function public.s4m_formateurs_publics() to authenticated, service_role;

create view public.formateur_public with (security_invoker = true) as
  select * from public.s4m_formateurs_publics();
grant select on public.formateur_public to authenticated, service_role;

-- ── piece_formateur ── Le formateur gère ses pièces de candidature ; l'admin les lit.
create policy piece_formateur_select on public.piece_formateur for select to authenticated
  using (
    formateur_id = public.s4m_formateur_id()
    or (public.s4m_est_admin() and exists (select 1 from public.formateur f where f.id = piece_formateur.formateur_id and f.of_id = public.s4m_of_id()))
  );
create policy piece_formateur_insert on public.piece_formateur for insert to authenticated
  with check (formateur_id = public.s4m_formateur_id());
create policy piece_formateur_delete on public.piece_formateur for delete to authenticated
  using (formateur_id = public.s4m_formateur_id());

-- ── entreprise_cliente ── Propriété du formateur validé ; admin en lecture.
create policy entreprise_select on public.entreprise_cliente for select to authenticated
  using (of_id = public.s4m_of_id() and (public.s4m_est_admin() or formateur_id = public.s4m_formateur_valide_id()));
create policy entreprise_insert on public.entreprise_cliente for insert to authenticated
  with check (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());
create policy entreprise_update on public.entreprise_cliente for update to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id())
  with check (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());

-- ── stagiaire ── Propriété du formateur validé ; admin en lecture ; l'apprenant lit sa propre fiche.
create policy stagiaire_select on public.stagiaire for select to authenticated
  using (
    (of_id = public.s4m_of_id() and (public.s4m_est_admin() or formateur_id = public.s4m_formateur_valide_id()))
    or utilisateur_id = auth.uid()
  );
create policy stagiaire_insert on public.stagiaire for insert to authenticated
  with check (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id() and utilisateur_id is null);
create policy stagiaire_update on public.stagiaire for update to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id())
  with check (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());

-- ── formation ── Catalogue du formateur validé ; admin en lecture.
create policy formation_select on public.formation for select to authenticated
  using (of_id = public.s4m_of_id() and (public.s4m_est_admin() or formateur_id = public.s4m_formateur_valide_id()));
create policy formation_insert on public.formation for insert to authenticated
  with check (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());
create policy formation_update on public.formation for update to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id())
  with check (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());
create policy formation_delete on public.formation for delete to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());

-- ── modele_outil ── Idem formation.
create policy modele_outil_select on public.modele_outil for select to authenticated
  using (of_id = public.s4m_of_id() and (public.s4m_est_admin() or formateur_id = public.s4m_formateur_valide_id()));
create policy modele_outil_insert on public.modele_outil for insert to authenticated
  with check (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());
create policy modele_outil_update on public.modele_outil for update to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id())
  with check (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());
create policy modele_outil_delete on public.modele_outil for delete to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());

-- ── coffre_fichier ── Formateur : son coffre (corbeille comprise) ; admin : lecture ; apprenant (RG-08) :
-- fichiers « partageable » non supprimés des formations de SES dossiers ayant atteint l'accord de financement.
create policy coffre_select on public.coffre_fichier for select to authenticated
  using (
    (of_id = public.s4m_of_id() and (public.s4m_est_admin() or formateur_id = public.s4m_formateur_valide_id()))
    or (partageable and supprime_le is null and public.s4m_coffre_ouvert_apprenant(formation_id))
  );
create policy coffre_insert on public.coffre_fichier for insert to authenticated
  with check (
    of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id()
    and exists (select 1 from public.formation f where f.id = coffre_fichier.formation_id and f.formateur_id = public.s4m_formateur_valide_id())
  );
create policy coffre_update on public.coffre_fichier for update to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id())
  with check (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());
create policy coffre_delete on public.coffre_fichier for delete to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());

-- ── dossier_formation ── Lecture : admin (OF), formateur propriétaire validé, apprenant inscrit.
-- Insert : formateur validé, en brouillon, pour lui-même. Update : formateur en brouillon ; admin en
-- brouillon / en cours de validation (colonnes de pipeline verrouillées par trigger). Delete : brouillon.
-- L'apprenant n'est PAS dans cette politique : la ligne complète porte les prix, le coût horaire du
-- formateur, les motifs internes et les questionnaires AVEC corrigé. Il lit la vue
-- `dossier_formation_apprenant` (plus bas) ; s4m_lister_dossiers / s4m_questionnaire en tiennent compte.
create policy dossier_select on public.dossier_formation for select to authenticated
  using (
    of_id = public.s4m_of_id() and (
      public.s4m_est_admin()
      or formateur_id = public.s4m_formateur_valide_id()
    )
  );
create policy dossier_insert on public.dossier_formation for insert to authenticated
  with check (
    of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id()
    and sous_statut = 'brouillon' and coffre_ouvert = false
    and valide_le is null and termine_le is null and archive_le is null
    and exists (select 1 from public.entreprise_cliente e where e.id = dossier_formation.entreprise_id and e.formateur_id = public.s4m_formateur_valide_id())
  );
create policy dossier_update on public.dossier_formation for update to authenticated
  using (public.s4m_dossier_modifiable(id))
  with check (of_id = public.s4m_of_id());
create policy dossier_delete on public.dossier_formation for delete to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id() and sous_statut = 'brouillon');

-- ── stagiaire_dossier ── Interne : via le dossier ; apprenant : sa propre ligne seulement.
create policy stagiaire_dossier_select on public.stagiaire_dossier for select to authenticated
  using (public.s4m_dossier_interne(dossier_id) or (stagiaire_id = public.s4m_stagiaire_id() and public.s4m_dossier_lisible(dossier_id)));
create policy stagiaire_dossier_insert on public.stagiaire_dossier for insert to authenticated
  with check (
    public.s4m_dossier_modifiable(dossier_id)
    and exists (select 1 from public.stagiaire st where st.id = stagiaire_dossier.stagiaire_id and st.of_id = public.s4m_of_id()
                and (public.s4m_est_admin() or st.formateur_id = public.s4m_formateur_valide_id()))
  );
create policy stagiaire_dossier_update on public.stagiaire_dossier for update to authenticated
  using (public.s4m_dossier_modifiable(dossier_id)) with check (public.s4m_dossier_modifiable(dossier_id));
create policy stagiaire_dossier_delete on public.stagiaire_dossier for delete to authenticated
  using (public.s4m_dossier_modifiable(dossier_id));

-- ── seance ── Lisible par tous les acteurs du dossier ; modifiable tant que le dossier l'est.
create policy seance_select on public.seance for select to authenticated using (public.s4m_dossier_lisible(dossier_id));
create policy seance_insert on public.seance for insert to authenticated with check (public.s4m_dossier_modifiable(dossier_id));
create policy seance_update on public.seance for update to authenticated using (public.s4m_dossier_modifiable(dossier_id)) with check (public.s4m_dossier_modifiable(dossier_id));
create policy seance_delete on public.seance for delete to authenticated using (public.s4m_dossier_modifiable(dossier_id));

-- ── emargement ── Interne : via le dossier de la séance ; apprenant : ses propres pointages.
-- Écriture : Edge Function uniquement (horodatage serveur).
create policy emargement_select on public.emargement for select to authenticated
  using (
    exists (select 1 from public.seance s where s.id = emargement.seance_id
            and (public.s4m_dossier_interne(s.dossier_id)
                 or (emargement.stagiaire_id = public.s4m_stagiaire_id() and public.s4m_dossier_lisible(s.dossier_id))))
  );

-- ── evaluation ── Interne : via le dossier ; apprenant : les siennes. Saisie : formateur / admin du dossier.
create policy evaluation_select on public.evaluation for select to authenticated
  using (public.s4m_dossier_interne(dossier_id) or (stagiaire_id = public.s4m_stagiaire_id() and public.s4m_dossier_lisible(dossier_id)));
create policy evaluation_insert on public.evaluation for insert to authenticated
  with check (public.s4m_dossier_interne(dossier_id));
create policy evaluation_update on public.evaluation for update to authenticated
  using (public.s4m_dossier_interne(dossier_id)) with check (public.s4m_dossier_interne(dossier_id));

-- ── piece_dossier ── Interne : toutes les pièces du dossier ; apprenant (= peutVoir) : pièces de
-- l'espace « Communication Apprenant », collectives ou les SIENNES. Jamais ODM (04-AVT), factures
-- (10-FIN, 11-FIN), recueil/positionnement internes (00/01-AVT, 08-FIN), REF, 12-APR.
-- Écriture : Edge Functions uniquement (génération, retour, signature, scellement).
create policy piece_select on public.piece_dossier for select to authenticated
  using (
    public.s4m_dossier_interne(dossier_id)
    or (
      public.s4m_apprenant_inscrit(dossier_id)
      and public.s4m_piece_espace_apprenant(code)
      and (stagiaire_id is null or stagiaire_id = public.s4m_stagiaire_id())
    )
  );

-- ── signature ── Interne : via la pièce ; apprenant : ses propres signatures. Écriture : Edge Function.
create policy signature_select on public.signature for select to authenticated
  using (
    utilisateur_id = auth.uid()
    or exists (select 1 from public.piece_dossier p where p.id = signature.piece_id and public.s4m_dossier_interne(p.dossier_id))
  );

-- ── facture_of / facture_formateur ── Interne uniquement (jamais l'apprenant). Écriture : Edge Function.
create policy facture_of_select on public.facture_of for select to authenticated using (public.s4m_dossier_interne(dossier_id));
create policy facture_formateur_select on public.facture_formateur for select to authenticated using (public.s4m_dossier_interne(dossier_id));

-- ── evenement (journal) ── Admin : tout l'OF ; formateur : le journal de SES dossiers. Jamais l'apprenant.
-- Écriture : Edge Functions / triggers service uniquement.
create policy evenement_select on public.evenement for select to authenticated
  using (
    of_id = public.s4m_of_id() and (
      public.s4m_est_admin()
      or (dossier_id is not null and public.s4m_dossier_interne(dossier_id))
    )
  );

-- ── courrier ── Admin : tout l'OF ; formateur : ses courriers / ceux de ses dossiers. Écriture : Edge Function.
create policy courrier_select on public.courrier for select to authenticated
  using (
    of_id = public.s4m_of_id() and (
      public.s4m_est_admin()
      or formateur_id = public.s4m_formateur_valide_id()
      or (dossier_id is not null and public.s4m_dossier_interne(dossier_id))
    )
  );

-- ── compteur ── Aucun accès client (service_role uniquement). RLS activée sans politique = tout refusé.

-- ── version_objet ── Admin : tout l'OF ; formateur : versions de ses formations / outils. Écriture : Edge Function.
create policy version_objet_select on public.version_objet for select to authenticated
  using (
    of_id = public.s4m_of_id() and (
      public.s4m_est_admin()
      or (type = 'formation' and exists (select 1 from public.formation f where f.id = version_objet.objet_id and f.formateur_id = public.s4m_formateur_valide_id()))
      or (type = 'outil' and exists (select 1 from public.modele_outil m where m.id = version_objet.objet_id and m.formateur_id = public.s4m_formateur_valide_id()))
    )
  );

-- ── positionnement ── Formateur validé : les siens (création, message, archivage) ; admin : lecture.
-- La page publique (lecture par jeton, brouillon, signature, PDF) = Edge Function. Jamais l'apprenant connecté.
create policy positionnement_select on public.positionnement for select to authenticated
  using (of_id = public.s4m_of_id() and (public.s4m_est_admin() or formateur_id = public.s4m_formateur_valide_id()));
create policy positionnement_insert on public.positionnement for insert to authenticated
  with check (
    of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id()
    and reponses is null and signe_le is null and chemin_pdf is null
    and exists (select 1 from public.stagiaire st where st.id = positionnement.stagiaire_id and st.formateur_id = public.s4m_formateur_valide_id())
  );
create policy positionnement_update on public.positionnement for update to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id())
  with check (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id());

-- ── reglage ── Admin de l'OF : réglages NON secrets en lecture / écriture. Les secrets (clés API…)
-- ne sont ni lisibles ni modifiables par le client : Edge Function (chiffrement) uniquement.
create policy reglage_select on public.reglage for select to authenticated
  using (of_id = public.s4m_of_id() and public.s4m_est_admin() and secret = false);
create policy reglage_insert on public.reglage for insert to authenticated
  with check (of_id = public.s4m_of_id() and public.s4m_est_admin() and secret = false);
create policy reglage_update on public.reglage for update to authenticated
  using (of_id = public.s4m_of_id() and public.s4m_est_admin() and secret = false)
  with check (of_id = public.s4m_of_id() and public.s4m_est_admin() and secret = false);

-- ── formulaire_apprenant ── Interne : via le dossier (suivi des envois). Remplissage public : Edge Function.
create policy formulaire_apprenant_select on public.formulaire_apprenant for select to authenticated
  using (of_id = public.s4m_of_id() and public.s4m_dossier_interne(dossier_id));

-- ── organisme_public ── Coordonnées publiques de l'OF (en-têtes, pied de page des écrans, convention,
-- attestation) pour TOUT membre de l'organisme. Exclus : IBAN, BIC, banque, TVA intracom., e-mail
-- comptabilité, tribunal, clause de subrogation, commission de portage, taux de TVA, délai de paiement,
-- durée de conservation, signature du représentant.
create or replace function public.s4m_organisme_public()
returns table (
  id text, of_nom text, of_forme_juridique text, of_adresse text, of_siret text, of_nda_numero text,
  of_dreets_region text, of_qualiopi_numero text, of_certification_complementaire_numero text,
  of_representant_civilite text, of_representant_prenom text, of_representant_nom text,
  of_email_pedagogie text, of_telephone text, couleur text
)
language sql stable security definer set search_path = public as $$
  select o.id, o.of_nom, o.of_forme_juridique, o.of_adresse, o.of_siret, o.of_nda_numero,
         o.of_dreets_region, o.of_qualiopi_numero, o.of_certification_complementaire_numero,
         o.of_representant_civilite, o.of_representant_prenom, o.of_representant_nom,
         o.of_email_pedagogie, o.of_telephone, o.couleur
  from public.organisme_formation o
  where o.id = public.s4m_of_id()
$$;
grant execute on function public.s4m_organisme_public() to authenticated, service_role;
create view public.organisme_public with (security_invoker = true) as
  select * from public.s4m_organisme_public();
grant select on public.organisme_public to authenticated, service_role;

-- ── dossier_formation_apprenant ── Ce que l'apprenant voit de SES dossiers : identification, étape,
-- contenu pédagogique, lieu, dates, financement (mode / OPCO, qui figurent sur la convention).
-- Exclus : formation_prix_unitaire_ht, formation_prix_presentiel_ht, formateur_cout_horaire,
-- questionnaire_positionnement, questionnaire_acquis (corrigés), motif_renvoi, motif_refus, entreprise_id.
create or replace function public.s4m_dossiers_apprenant()
returns table (
  id text, of_id text, dossier_reference text, formateur_id text, formation_id text, sous_statut text,
  mode_financement text, formation_titre text, formation_objectifs text, formation_objectifs_atteints text,
  formation_niveau text, formation_prerequis text, formation_duree_heures_total real, formation_duree_jours real,
  formation_duree_heures_presentiel real, formation_duree_heures_distanciel real, formation_modalite text,
  formation_lieu_nom text, formation_lieu_adresse text, formation_lien_visio text, formation_date_debut text,
  formation_date_fin text, formation_opco text, signature_lieu text, formation_public_vise text,
  formation_programme text, coffre_ouvert boolean, cree_le timestamptz, maj_le timestamptz,
  valide_le timestamptz, termine_le timestamptz, archive_le timestamptz
)
language sql stable security definer set search_path = public as $$
  select d.id, d.of_id, d.dossier_reference, d.formateur_id, d.formation_id, d.sous_statut,
         d.mode_financement, d.formation_titre, d.formation_objectifs, d.formation_objectifs_atteints,
         d.formation_niveau, d.formation_prerequis, d.formation_duree_heures_total, d.formation_duree_jours,
         d.formation_duree_heures_presentiel, d.formation_duree_heures_distanciel, d.formation_modalite,
         d.formation_lieu_nom, d.formation_lieu_adresse, d.formation_lien_visio, d.formation_date_debut,
         d.formation_date_fin, d.formation_opco, d.signature_lieu, d.formation_public_vise,
         d.formation_programme, d.coffre_ouvert, d.cree_le, d.maj_le,
         d.valide_le, d.termine_le, d.archive_le
  from public.dossier_formation d
  where public.s4m_role() = 'apprenant'
    and d.of_id = public.s4m_of_id()
    and public.s4m_apprenant_inscrit(d.id)
$$;
grant execute on function public.s4m_dossiers_apprenant() to authenticated, service_role;
create view public.dossier_formation_apprenant with (security_invoker = true) as
  select * from public.s4m_dossiers_apprenant();
grant select on public.dossier_formation_apprenant to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 6. Stockage : buckets privés et politiques sur storage.objects (chemins `<of_id>/...`)
--    archive  : `<of_id>/dossiers/<dossier_reference>/<sous-dossier>/<fichier>` (pièces de départ / retour)
--               `<of_id>/candidatures/<formateur_id>/<fichier>`           (pièces de candidature)
--    coffre   : `<of_id>/coffres/<formation_id>/<fichier>`                 (coffre-fort pédagogique)
--    supports : `<of_id>/supports/<formation_id>/<fichier>`                (supports pédagogiques générés)
--    Les pièces de dossier ne sont PAS lues directement par l'apprenant : l'Edge Function renvoie une
--    URL signée après avoir vérifié `peutVoir`. Les écritures dans `archive/<of>/dossiers` sont réservées
--    aux Edge Functions (scellement d'empreinte).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- RETIRÉ POUR LOVABLE CLOUD (accord du 06/10/2026) : les buckets privés archive, coffre et supports
-- sont créés par l'outil de stockage Lovable Cloud, pas par SQL. Les politiques ci-dessous restent.

-- archive — lecture interne des pièces de SES dossiers (admin : tout l'OF) ; candidatures : le formateur.
create policy s4m_archive_select on storage.objects for select to authenticated
  using (
    bucket_id = 'archive'
    and (storage.foldername(name))[1] = public.s4m_of_id()
    and (
      ((storage.foldername(name))[2] = 'dossiers' and exists (
         select 1 from public.dossier_formation d
         where d.of_id = public.s4m_of_id() and d.dossier_reference = (storage.foldername(name))[3]
           and (public.s4m_est_admin() or d.formateur_id = public.s4m_formateur_valide_id())))
      or ((storage.foldername(name))[2] = 'candidatures'
          and ((storage.foldername(name))[3] = public.s4m_formateur_id() or public.s4m_est_admin()))
    )
  );
create policy s4m_archive_insert_candidature on storage.objects for insert to authenticated
  with check (
    bucket_id = 'archive'
    and (storage.foldername(name))[1] = public.s4m_of_id()
    and (storage.foldername(name))[2] = 'candidatures'
    and (storage.foldername(name))[3] = public.s4m_formateur_id()
  );
create policy s4m_archive_delete_candidature on storage.objects for delete to authenticated
  using (
    bucket_id = 'archive'
    and (storage.foldername(name))[1] = public.s4m_of_id()
    and (storage.foldername(name))[2] = 'candidatures'
    and (storage.foldername(name))[3] = public.s4m_formateur_id()
  );

-- coffre — lecture : quiconque voit la ligne `coffre_fichier` correspondante (la RLS de la table porte
-- la règle fine, apprenant compris) ; écriture : le formateur validé sur SES formations.
create policy s4m_coffre_select on storage.objects for select to authenticated
  using (
    bucket_id = 'coffre'
    and (storage.foldername(name))[1] = public.s4m_of_id()
    and exists (select 1 from public.coffre_fichier cf where cf.chemin = storage.objects.name)
  );
create policy s4m_coffre_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'coffre'
    and (storage.foldername(name))[1] = public.s4m_of_id()
    and (storage.foldername(name))[2] = 'coffres'
    and exists (select 1 from public.formation f where f.id = (storage.foldername(name))[3] and f.formateur_id = public.s4m_formateur_valide_id())
  );
create policy s4m_coffre_update on storage.objects for update to authenticated
  using (
    bucket_id = 'coffre'
    and (storage.foldername(name))[1] = public.s4m_of_id()
    and exists (select 1 from public.formation f where f.id = (storage.foldername(name))[3] and f.formateur_id = public.s4m_formateur_valide_id())
  );
create policy s4m_coffre_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'coffre'
    and (storage.foldername(name))[1] = public.s4m_of_id()
    and exists (select 1 from public.formation f where f.id = (storage.foldername(name))[3] and f.formateur_id = public.s4m_formateur_valide_id())
  );

-- supports — formateur validé sur SES formations (lecture / écriture) ; admin en lecture.
create policy s4m_supports_select on storage.objects for select to authenticated
  using (
    bucket_id = 'supports'
    and (storage.foldername(name))[1] = public.s4m_of_id()
    and (public.s4m_est_admin() or exists (
      select 1 from public.formation f where f.id = (storage.foldername(name))[3] and f.formateur_id = public.s4m_formateur_valide_id()))
  );
create policy s4m_supports_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'supports'
    and (storage.foldername(name))[1] = public.s4m_of_id()
    and (storage.foldername(name))[2] = 'supports'
    and exists (select 1 from public.formation f where f.id = (storage.foldername(name))[3] and f.formateur_id = public.s4m_formateur_valide_id())
  );
create policy s4m_supports_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'supports'
    and (storage.foldername(name))[1] = public.s4m_of_id()
    and exists (select 1 from public.formation f where f.id = (storage.foldername(name))[3] and f.formateur_id = public.s4m_formateur_valide_id())
  );

-- Fin de la migration.
