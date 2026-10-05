-- =====================================================================================================
--  Skills4mation — JEU DE DÉMONSTRATION (données ENTIÈREMENT FICTIVES)
--
--  /!\ AVERTISSEMENT : réservé à un projet Supabase de TEST. NE JAMAIS exécuter en production :
--      ce script crée des comptes Auth avec un mot de passe connu (`demonstration-s4m`) et insère
--      directement dans auth.users / auth.identities.
--
--  À coller dans le SQL Editor de Supabase APRÈS les deux migrations (20261005000000_s4m_initial.sql puis
--  20261005000100_s4m_rpc.sql).
--  Idempotent : chaque étape est gardée par l'existence (on conflict do nothing / if not exists) ;
--  le rejouer ne crée pas de doublon.
--
--  Comptes créés (mot de passe commun : demonstration-s4m) :
--    admin@demo.example       — admin de l'organisme (via app_metadata, seul canal autorisé)
--    formatrice@demo.example  — formatrice, candidature validée (Sophie Lambert)
--    formateur2@demo.example  — second formateur validé (Marc Weber), pour tester le cloisonnement
--    apprenante@demo.example  — apprenante (Anne Martin), inscrite au dossier de la formatrice
--    candidat@demo.example    — candidat formateur (Paul Durand), candidature en BROUILLON COMPLET :
--                               téléphone, parcours et 3 pièces obligatoires présents, prêt à « Soumettre »
--
--  Les profils, fiches formateur et la liaison apprenant ↔ stagiaire sont produits par le trigger
--  `s4m_on_auth_user_created` de la migration ; le script complète seulement ce que le trigger ne fait
--  pas (validation des candidatures, catalogue, dossiers, pièces).
-- =====================================================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  c_of constant text := 'of-demo';
  c_mdp constant text := 'demonstration-s4m';
  c_instance constant uuid := '00000000-0000-0000-0000-000000000000';
  -- Identifiants fixes (idempotence).
  u_admin constant uuid := 'a0000000-0000-4000-8000-000000000001';
  u_sophie constant uuid := 'a0000000-0000-4000-8000-000000000002';
  u_marc constant uuid := 'a0000000-0000-4000-8000-000000000003';
  u_anne constant uuid := 'a0000000-0000-4000-8000-000000000004';
  u_paul constant uuid := 'a0000000-0000-4000-8000-000000000005';
  f_sophie text; f_marc text; f_paul text;
  jeton_anne constant text := 'demo-invitation-anne-martin';
  st_anne text; st_luc text;
begin
  -- ── 1. Organisme ──────────────────────────────────────────────────────────────────────────────────
  insert into public.organisme_formation (
    id, of_nom, of_forme_juridique, of_adresse, of_siret, of_nda_numero, of_dreets_region, of_qualiopi_numero,
    of_representant_civilite, of_representant_prenom, of_representant_nom, of_email_pedagogie, of_email_comptabilite,
    of_tribunal_competent, of_iban, of_bic, of_banque_nom, of_telephone, portage_commission_pourcentage, tva_pourcentage
  ) values (
    c_of, 'ORGANISME DÉMO FORMATION', 'SAS au capital de 1 000 €', '1 rue de l''Exemple, 68100 Mulhouse', '00000000000000',
    '00 00 00000 00', 'Grand Est', 'QUALIOPI-DEMO-0000', 'Mme', 'Claire', 'Exemple',
    'pedagogie@organisme-demo.example', 'compta@organisme-demo.example', 'tribunal de commerce de Mulhouse',
    'FR00 0000 0000 0000 0000 0000 000', 'DEMOFRPP', 'Banque Démo', '03 00 00 00 00', 25, 0
  ) on conflict (id) do nothing;

  -- ── 2. Comptes Auth (méthode standard : auth.users + auth.identities) ─────────────────────────────
  -- Le trigger de la migration crée le profil `utilisateur` (+ fiche `formateur` pour les inscriptions
  -- spontanées, + liaison `stagiaire` pour l'invitation).

  -- 2a. Admin : rôle porté par app_metadata (jamais par user_metadata).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (c_instance, u_admin, 'authenticated', 'authenticated', 'admin@demo.example',
          extensions.crypt(c_mdp, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"],"s4m_role":"admin","of_id":"of-demo"}'::jsonb,
          '{"prenom":"Claire","nom":"Exemple"}'::jsonb, now(), now())
  on conflict (id) do nothing;

  -- 2b. Formateurs (inscription spontanée → candidature en brouillon, validée plus bas).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (c_instance, u_sophie, 'authenticated', 'authenticated', 'formatrice@demo.example',
     extensions.crypt(c_mdp, extensions.gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"of_id":"of-demo","prenom":"Sophie","nom":"Lambert"}'::jsonb, now(), now()),
    (c_instance, u_marc, 'authenticated', 'authenticated', 'formateur2@demo.example',
     extensions.crypt(c_mdp, extensions.gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"of_id":"of-demo","prenom":"Marc","nom":"Weber"}'::jsonb, now(), now()),
    (c_instance, u_paul, 'authenticated', 'authenticated', 'candidat@demo.example',
     extensions.crypt(c_mdp, extensions.gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"of_id":"of-demo","prenom":"Paul","nom":"Durand"}'::jsonb, now(), now())
  on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  select u.id, u.id, u.id::text, 'email',
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         now(), now(), now()
  from auth.users u
  where u.id in (u_admin, u_sophie, u_marc, u_paul)
    and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

  -- Filet : si le trigger n'a pas tourné (profils absents), on les crée explicitement.
  insert into public.utilisateur (id, of_id, email, role, prenom, nom)
  values (u_admin, c_of, 'admin@demo.example', 'admin', 'Claire', 'Exemple'),
         (u_sophie, c_of, 'formatrice@demo.example', 'formateur', 'Sophie', 'Lambert'),
         (u_marc, c_of, 'formateur2@demo.example', 'formateur', 'Marc', 'Weber'),
         (u_paul, c_of, 'candidat@demo.example', 'formateur', 'Paul', 'Durand')
  on conflict (id) do nothing;
  insert into public.formateur (of_id, utilisateur_id, formateur_prenom, formateur_nom, formateur_email)
  select c_of, u.id, u.prenom, u.nom, u.email from public.utilisateur u
  where u.id in (u_sophie, u_marc, u_paul) and not exists (select 1 from public.formateur f where f.utilisateur_id = u.id);

  select id into f_sophie from public.formateur where utilisateur_id = u_sophie;
  select id into f_marc from public.formateur where utilisateur_id = u_marc;
  select id into f_paul from public.formateur where utilisateur_id = u_paul;

  -- Candidatures : Sophie et Marc validées ; Paul en brouillon complet (la recette « le candidat soumet,
  -- l'admin décide » se joue de bout en bout).
  update public.formateur set
    statut_candidature = 'validee', soumise_le = coalesce(soumise_le, now() - interval '30 days'), decidee_le = coalesce(decidee_le, now() - interval '29 days'),
    formateur_telephone = '06 00 00 00 01', formateur_entreprise_nom = 'SL Formation', formateur_entreprise_adresse = '8 rue des Vignes, 68170 Rixheim',
    formateur_entreprise_siret = '22222222222222', formateur_nda_numero = '44 68 00000 68', formateur_dreets_region = 'Grand Est',
    formateur_statut_juridique = 'Entreprise individuelle', formateur_domaines = '["Bureautique","Gestion"]'::jsonb,
    formateur_tarif_journalier = 90000, formateur_bio = 'Formatrice bureautique et gestion depuis dix ans.',
    formateur_iban = 'FR00 1111 1111 1111 1111 1111 111', formateur_bic = 'DEMOFRPP'
  where id = f_sophie and statut_candidature <> 'validee';

  update public.formateur set
    statut_candidature = 'validee', soumise_le = coalesce(soumise_le, now() - interval '20 days'), decidee_le = coalesce(decidee_le, now() - interval '19 days'),
    formateur_telephone = '06 00 00 00 03', formateur_entreprise_nom = 'MW Conseil', formateur_entreprise_siret = '33333333333333',
    formateur_statut_juridique = 'SASU', formateur_domaines = '["Management"]'::jsonb, formateur_tarif_journalier = 110000,
    formateur_bio = 'Formateur management, quinze ans en direction d''équipes.'
  where id = f_marc and statut_candidature <> 'validee';

  update public.formateur set
    formateur_telephone = '06 00 00 00 02', formateur_entreprise_nom = 'PD Formation EI', formateur_entreprise_siret = '44444444444444',
    formateur_statut_juridique = 'Entreprise individuelle', formateur_domaines = '["Management","Commercial"]'::jsonb,
    parcours = 'Quinze ans d''expérience en management d''équipes commerciales, formateur indépendant depuis 2019.'
  where id = f_paul and statut_candidature = 'brouillon' and parcours = '';

  -- Pièces obligatoires de la candidature (cv, identité, diplôme). Les fichiers Storage correspondants
  -- ne sont pas créés ici (bucket `archive`, chemin `<of_id>/candidatures/<formateur_id>/…`).
  insert into public.piece_formateur (id, formateur_id, type, nom_fichier, chemin, taille)
  values
    ('pf-demo-cv', f_paul, 'cv', 'cv-paul-durand.pdf', c_of || '/candidatures/' || f_paul || '/cv_demo_cv-paul-durand.pdf', 1024),
    ('pf-demo-id', f_paul, 'identite', 'identite-paul-durand.pdf', c_of || '/candidatures/' || f_paul || '/identite_demo_identite-paul-durand.pdf', 1024),
    ('pf-demo-dip', f_paul, 'diplome', 'diplome-paul-durand.pdf', c_of || '/candidatures/' || f_paul || '/diplome_demo_diplome-paul-durand.pdf', 1024)
  on conflict (id) do nothing;

  -- ── 3. Catalogue de Sophie : 2 formations ────────────────────────────────────────────────────────
  insert into public.formation (id, of_id, formateur_id, formation_titre, formation_objectifs, formation_niveau, formation_prerequis,
    formation_duree_heures_total, formation_duree_jours, formation_duree_heures_presentiel, formation_modalite,
    formation_prix_unitaire_ht, programme, public_vise, formation_domaine, mode_financement, formateur_cout_horaire)
  values
    ('fo-demo-excel', c_of, f_sophie, 'Excel — tableaux croisés dynamiques et automatisation',
     'Structurer ses données, produire des synthèses fiables et automatiser le reporting mensuel.', 'Intermédiaire', 'Pratique courante d''Excel',
     14, 2, 14, 'presentiel', 120000,
     E'Jour 1 — Structurer ses données, tableaux croisés dynamiques, segments et chronologies.\nJour 2 — Champs calculés, Power Query, automatisation du reporting, contrôle des données.',
     'Assistants de gestion, comptables, responsables administratifs', 'Bureautique', 'opco', 6000),
    ('fo-demo-manager', c_of, f_sophie, 'Manager une équipe de proximité',
     'Prendre sa place de manager, conduire les entretiens individuels, animer des réunions efficaces.', 'Débutant', 'Aucun',
     21, 3, 21, 'presentiel', 150000,
     E'Jour 1 — Posture et rôle du manager de proximité.\nJour 2 — Entretiens individuels : recadrage, feedback.\nJour 3 — Animer une réunion d''équipe efficace.',
     'Chefs d''équipe et d''atelier récemment nommés', 'Management', 'opco', 6500)
  on conflict (id) do nothing;

  -- Une formation pour Marc, pour que son espace ne soit pas vide (et vérifier qu'elle reste invisible à Sophie).
  insert into public.formation (id, of_id, formateur_id, formation_titre, formation_objectifs, formation_duree_heures_total, formation_duree_jours, formation_prix_unitaire_ht, programme, formation_domaine)
  values ('fo-demo-prospection', c_of, f_marc, 'Prospection commerciale B2B', 'Cibler, contacter et convertir des prospects B2B.', 14, 2, 130000,
          E'Jour 1 — Cibler ses prospects.\nJour 2 — Préparer et réussir la prise de contact.', 'Commercial')
  on conflict (id) do nothing;

  -- Coffre-fort de la formation Excel : un support partageable, un document privé.
  insert into public.coffre_fichier (id, of_id, formateur_id, formation_id, nom_fichier, chemin, taille, type_mime, partageable, categorie, description)
  values
    ('cf-demo-1', c_of, f_sophie, 'fo-demo-excel', 'Support-Excel-TCD.pdf', 'of-demo/coffres/fo-demo-excel/Support-Excel-TCD.pdf', 1024, 'application/pdf', true, 'support', 'Support de cours jour 1'),
    ('cf-demo-2', c_of, f_sophie, 'fo-demo-excel', 'Corrige-exercices.pdf', 'of-demo/coffres/fo-demo-excel/Corrige-exercices.pdf', 2048, 'application/pdf', false, 'corrige', 'Corrigé réservé au formateur')
  on conflict (id) do nothing;
  -- NB : les objets Storage correspondants ne sont pas créés ici (il faudrait téléverser de vrais fichiers).

  -- ── 4. Entreprise cliente et 2 stagiaires ────────────────────────────────────────────────────────
  insert into public.entreprise_cliente (id, of_id, formateur_id, entreprise_nom, entreprise_nom_commercial, entreprise_adresse, entreprise_siret,
    entreprise_representant_civilite, entreprise_representant_prenom, entreprise_representant_nom, entreprise_representant_telephone, entreprise_representant_email, entreprise_opco)
  values ('ent-demo-dupont', c_of, f_sophie, 'Menuiserie Dupont SARL', 'Atelier Dupont', '12 avenue des Artisans, 68200 Mulhouse', '11111111111111',
          'M.', 'Jean', 'Dupont', '03 11 11 11 11', 'jean.dupont@menuiserie-dupont.example', 'OPCO 2i')
  on conflict (id) do nothing;

  insert into public.stagiaire (id, of_id, formateur_id, entreprise_id, stagiaire_prenom, stagiaire_nom, stagiaire_email, stagiaire_poste)
  values
    ('st-demo-anne', c_of, f_sophie, 'ent-demo-dupont', 'Anne', 'Martin', 'apprenante@demo.example', 'Assistante de gestion'),
    ('st-demo-luc', c_of, f_sophie, 'ent-demo-dupont', 'Luc', 'Petit', 'luc.petit@stagiaire.example', 'Chef d''atelier')
  on conflict (id) do nothing;
  st_anne := 'st-demo-anne'; st_luc := 'st-demo-luc';

  -- ── 5. Deux dossiers à des étapes différentes ────────────────────────────────────────────────────
  -- Dossier 1 : Excel, Anne + Luc, formation en cours (étape C) — pièces de départ émises.
  insert into public.dossier_formation (id, of_id, dossier_reference, formateur_id, entreprise_id, formation_id, sous_statut, mode_financement,
    formation_titre, formation_objectifs, formation_niveau, formation_prerequis, formation_duree_heures_total, formation_duree_jours, formation_duree_heures_presentiel,
    formation_modalite, formation_lieu_nom, formation_lieu_adresse, formation_date_debut, formation_date_fin, formation_opco,
    formation_prix_unitaire_ht, formateur_cout_horaire, signature_lieu, formation_programme, formation_public_vise, coffre_ouvert, valide_le)
  values ('d-demo-1', c_of, 'ADF-2026-0001', f_sophie, 'ent-demo-dupont', 'fo-demo-excel', 'formation_debutee', 'opco',
    'Excel — tableaux croisés dynamiques et automatisation', 'Structurer ses données, produire des synthèses fiables et automatiser le reporting mensuel.',
    'Intermédiaire', 'Pratique courante d''Excel', 14, 2, 14,
    'presentiel', 'Atelier Dupont', '12 avenue des Artisans, 68200 Mulhouse', to_char(now() - interval '1 day', 'YYYY-MM-DD'), to_char(now() + interval '6 days', 'YYYY-MM-DD'), 'OPCO 2i',
    120000, 6000, 'Mulhouse',
    E'Jour 1 — Structurer ses données, tableaux croisés dynamiques, segments et chronologies.\nJour 2 — Champs calculés, Power Query, automatisation du reporting, contrôle des données.',
    'Assistants de gestion, comptables, responsables administratifs', true, now() - interval '10 days')
  on conflict (id) do nothing;

  insert into public.stagiaire_dossier (id, dossier_id, stagiaire_id, poste_occupe, rang)
  values ('sd-demo-1a', 'd-demo-1', st_anne, 'Assistante de gestion', 1), ('sd-demo-1b', 'd-demo-1', st_luc, 'Chef d''atelier', 2)
  on conflict (id) do nothing;

  insert into public.seance (id, dossier_id, date, heure_debut, heure_fin)
  values ('se-demo-1', 'd-demo-1', to_char(now() - interval '1 day', 'YYYY-MM-DD'), '09:00', '17:00'),
         ('se-demo-2', 'd-demo-1', to_char(now() + interval '6 days', 'YYYY-MM-DD'), '09:00', '17:00')
  on conflict (id) do nothing;

  -- Pièces : collectives (02-AVT convention, 03-AVT règlement, PRG, ACC, 04-AVT ODM, 10-FIN facture OF)
  -- et individuelles (05-AVT convocation, 06-PDT émargement) pour chaque stagiaire.
  insert into public.piece_dossier (id, dossier_id, code, stagiaire_id, statut, chemin_depart, empreinte_depart, genere_le)
  values
    ('pd-demo-02', 'd-demo-1', '02-AVT', null, 'valide', 'of-demo/dossiers/ADF-2026-0001/Pièces de départ/02-AVT-convention.html', repeat('0', 64), now() - interval '10 days'),
    ('pd-demo-03', 'd-demo-1', '03-AVT', null, 'valide', 'of-demo/dossiers/ADF-2026-0001/Pièces de départ/03-AVT-reglement.html', repeat('0', 64), now() - interval '10 days'),
    ('pd-demo-prg', 'd-demo-1', 'PRG', null, 'valide', 'of-demo/dossiers/ADF-2026-0001/Pièces de départ/PRG-programme.html', repeat('0', 64), now() - interval '10 days'),
    ('pd-demo-acc', 'd-demo-1', 'ACC', null, 'valide', 'of-demo/dossiers/ADF-2026-0001/Pièces de départ/ACC-accessibilite.html', repeat('0', 64), now() - interval '10 days'),
    ('pd-demo-04', 'd-demo-1', '04-AVT', null, 'valide', 'of-demo/dossiers/ADF-2026-0001/Pièces de départ/04-AVT-odm.html', repeat('0', 64), now() - interval '10 days'),
    ('pd-demo-10', 'd-demo-1', '10-FIN', null, 'en_attente', null, null, null),
    ('pd-demo-05a', 'd-demo-1', '05-AVT', st_anne, 'valide', 'of-demo/dossiers/ADF-2026-0001/Pièces de départ/05-AVT-convocation-anne-martin.html', repeat('0', 64), now() - interval '9 days'),
    ('pd-demo-05b', 'd-demo-1', '05-AVT', st_luc, 'en_attente', 'of-demo/dossiers/ADF-2026-0001/Pièces de départ/05-AVT-convocation-luc-petit.html', repeat('0', 64), now() - interval '9 days'),
    ('pd-demo-06a', 'd-demo-1', '06-PDT', st_anne, 'en_attente', null, null, null),
    ('pd-demo-06b', 'd-demo-1', '06-PDT', st_luc, 'en_attente', null, null, null)
  on conflict (id) do nothing;

  insert into public.evenement (id, of_id, dossier_id, acteur_id, acteur_role, type, libelle)
  values
    ('ev-demo-1', c_of, 'd-demo-1', u_sophie, 'formateur', 'dossier_cree', 'Dossier ADF-2026-0001 créé'),
    ('ev-demo-2', c_of, 'd-demo-1', u_admin, 'admin', 'dossier_valide', 'Dossier validé par l''organisme'),
    ('ev-demo-3', c_of, 'd-demo-1', null, 'systeme', 'coffre_ouvert', 'Coffre-fort pédagogique ouvert aux apprenants')
  on conflict (id) do nothing;

  insert into public.compteur (of_id, cle, valeur) values (c_of, 'ADF-' || to_char(now(), 'YYYY'), 2) on conflict (of_id, cle) do nothing;

  -- Dossier 2 : Management, Luc seul, brouillon (étape A) — modifiable par Sophie.
  insert into public.dossier_formation (id, of_id, dossier_reference, formateur_id, entreprise_id, formation_id, sous_statut, mode_financement,
    formation_titre, formation_objectifs, formation_niveau, formation_duree_heures_total, formation_duree_jours, formation_modalite,
    formation_prix_unitaire_ht, formateur_cout_horaire, formation_programme, formation_public_vise)
  values ('d-demo-2', c_of, 'ADF-2026-0002', f_sophie, 'ent-demo-dupont', 'fo-demo-manager', 'brouillon', 'opco',
    'Manager une équipe de proximité', 'Prendre sa place de manager, conduire les entretiens individuels, animer des réunions efficaces.', 'Débutant', 21, 3, 'presentiel',
    150000, 6500, E'Jour 1 — Posture et rôle du manager de proximité.\nJour 2 — Entretiens individuels.\nJour 3 — Animer une réunion d''équipe.', 'Chefs d''équipe récemment nommés')
  on conflict (id) do nothing;
  insert into public.stagiaire_dossier (id, dossier_id, stagiaire_id, poste_occupe, rang)
  values ('sd-demo-2a', 'd-demo-2', st_luc, 'Chef d''atelier', 1) on conflict (id) do nothing;

  -- ── 6. Apprenante : invitation puis compte Auth (le trigger relie le compte à la fiche stagiaire) ──
  insert into public.invitation (jeton_hash, of_id, email, role, prenom, nom, stagiaire_id, expire_le)
  values (encode(sha256(convert_to(jeton_anne, 'UTF8')), 'hex'), c_of, 'apprenante@demo.example', 'apprenant', 'Anne', 'Martin', st_anne, now() + interval '14 days')
  on conflict (jeton_hash) do nothing;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (c_instance, u_anne, 'authenticated', 'authenticated', 'apprenante@demo.example',
          extensions.crypt(c_mdp, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('invitation', jeton_anne), now(), now())
  on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  select u.id, u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
  from auth.users u where u.id = u_anne
    and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

  -- Filet si le trigger n'a pas tourné : profil apprenant + liaison fiche.
  insert into public.utilisateur (id, of_id, email, role, prenom, nom)
  values (u_anne, c_of, 'apprenante@demo.example', 'apprenant', 'Anne', 'Martin') on conflict (id) do nothing;
  update public.stagiaire set utilisateur_id = u_anne where id = st_anne and utilisateur_id is null;
  update public.invitation set utilisee_le = coalesce(utilisee_le, now()), utilisateur_id = coalesce(utilisateur_id, u_anne)
  where jeton_hash = encode(sha256(convert_to(jeton_anne, 'UTF8')), 'hex');

  raise notice 'Jeu de démonstration Skills4mation en place (organisme %, 5 comptes, mot de passe : %).', c_of, c_mdp;
end $$;
