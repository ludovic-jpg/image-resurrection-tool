-- =====================================================================================================
--  Lot 8 — suppression de compte formateur (RGPD) : effacement atomique des données personnelles.
--  Fichier : supabase/migrations/20261006000800_lot8_rgpd.sql   (NOUVELLE migration : rien d'existant n'est modifié)
--
--  Pourquoi une fonction SQL : supabase-js n'a pas de transaction. Le service Node enchaînait ces suppressions dans
--  une transaction (`rgpd.supprimerMonCompte`) ; ici la fonction s4m_effacer_donnees_formateur() fait la même chose
--  en UN SEUL bloc : tout est effacé, ou rien. Elle n'est appelable que par le serveur (service_role), jamais par un
--  client : la phrase de confirmation et le mot de passe sont vérifiés AVANT, dans la fonction serveur
--  `supprimerMonCompte` (src/lib/rgpd.functions.ts).
--
--  Hypothèse retenue (point ouvert n° 10 du cahier des charges, reprise de l'ancien serveur) : DISSOCIATION +
--  EFFACEMENT. La ligne « formateur » subsiste, anonyme, pour que les dossiers instruits restent rattachés à quelque
--  chose ; les pièces déjà émises et archivées ne sont pas réécrites (conservation légale, Qualiopi).
--
--  Effacé : brouillons ; positionnements ; outils ; formations et coffres qui ne servent à aucun dossier conservé ;
--  fiches apprenants et entreprises qui ne figurent dans aucun dossier conservé (et les comptes des apprenants
--  concernés, dont les identifiants sont renvoyés pour suppression côté Auth) ; pièces de candidature ; courriers,
--  invitations et lignes de journal hors dossier qui le concernent ; identité, coordonnées, IBAN, parcours… du
--  formateur ; profil utilisateur.
--  Conservé : dossiers instruits (non brouillon) avec leurs pièces, signatures et journal (la référence à l'auteur
--  du journal est coupée : acteur_id passe à null).
--
--  Renvoie les chemins Storage à supprimer (la base ne peut pas les effacer elle-même) et les comptes Auth des
--  apprenants à supprimer : { of_id, archive: [chemin…], coffre: [chemin…], comptes_apprenants: [uuid…] }.
-- =====================================================================================================

create or replace function public.s4m_effacer_donnees_formateur(p_formateur_id text, p_utilisateur_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.formateur%rowtype;
  v_email_compte text;
  v_emails text[] := '{}';
  v_brouillons text[] := '{}';
  v_formations text[] := '{}';
  v_outils text[] := '{}';
  v_orphelins text[] := '{}';
  v_comptes uuid[] := '{}';
  v_chemins_archive jsonb;
  v_chemins_coffre jsonb;
begin
  if not public.s4m_est_service() then
    raise exception 'Cette opération est réservée au serveur.' using errcode = '42501';
  end if;

  select * into f from public.formateur where id = p_formateur_id for update;
  if not found or f.utilisateur_id is distinct from p_utilisateur_id or f.anonymise_le is not null then
    raise exception 'Compte introuvable.' using errcode = 'P0002';
  end if;
  select email into v_email_compte from public.utilisateur where id = p_utilisateur_id;

  -- Adresses à purger des courriers et invitations (celle du compte, celle de la fiche).
  v_emails := array(
    select distinct lower(e) from unnest(array[v_email_compte, f.formateur_email]) e where coalesce(e, '') <> ''
  );

  -- 1. Ce qui sera supprimé : on relève d'abord les identifiants et les fichiers.
  select coalesce(array_agg(id), '{}') into v_brouillons
    from public.dossier_formation where formateur_id = f.id and sous_statut = 'brouillon';

  select coalesce(array_agg(id), '{}') into v_formations
    from public.formation fo
   where fo.formateur_id = f.id
     and not exists (
       select 1 from public.dossier_formation d
        where d.formation_id = fo.id and d.formateur_id = f.id and d.sous_statut <> 'brouillon');

  select coalesce(array_agg(id), '{}') into v_outils from public.modele_outil where formateur_id = f.id;

  select coalesce(jsonb_agg(distinct chemin), '[]'::jsonb) into v_chemins_archive
    from (
      select chemin from public.piece_formateur where formateur_id = f.id
      union select chemin_depart from public.piece_dossier where dossier_id = any(v_brouillons)
      union select chemin_retour from public.piece_dossier where dossier_id = any(v_brouillons)
      union select chemin_invitation from public.formulaire_apprenant where dossier_id = any(v_brouillons)
      union select chemin_pdf from public.positionnement where formateur_id = f.id
    ) t(chemin)
   where chemin is not null;

  select coalesce(jsonb_agg(distinct chemin), '[]'::jsonb) into v_chemins_coffre
    from public.coffre_fichier where formation_id = any(v_formations);

  -- 2. Brouillons : ils n'engagent personne (pièces, séances, évaluations, courriers… partent en cascade).
  delete from public.dossier_formation where formateur_id = f.id and sous_statut = 'brouillon';

  -- 3. Positionnements hors dossier (pré-contractuels), outils, formations et coffres sans dossier conservé.
  delete from public.positionnement where formateur_id = f.id;
  delete from public.modele_outil where formateur_id = f.id;
  delete from public.formation where id = any(v_formations);

  -- 4. Fiches apprenants qui ne figurent dans aucun dossier conservé, et leurs comptes.
  select coalesce(array_agg(s.id), '{}') into v_orphelins
    from public.stagiaire s
   where s.formateur_id = f.id
     and not exists (select 1 from public.stagiaire_dossier x where x.stagiaire_id = s.id)
     and not exists (select 1 from public.evaluation x where x.stagiaire_id = s.id)
     and not exists (select 1 from public.emargement x where x.stagiaire_id = s.id)
     and not exists (select 1 from public.piece_dossier x where x.stagiaire_id = s.id)
     and not exists (select 1 from public.formulaire_apprenant x where x.stagiaire_id = s.id)
     and not exists (select 1 from public.positionnement x where x.stagiaire_id = s.id);

  v_emails := v_emails || array(
    select distinct lower(stagiaire_email) from public.stagiaire
     where id = any(v_orphelins) and stagiaire_email <> '');

  select coalesce(array_agg(distinct s.utilisateur_id), '{}') into v_comptes
    from public.stagiaire s
    join public.utilisateur u on u.id = s.utilisateur_id and u.role = 'apprenant'
   where s.id = any(v_orphelins)
     and not exists (
       select 1 from public.stagiaire s2
        where s2.utilisateur_id = s.utilisateur_id and s2.id <> all(v_orphelins));

  delete from public.stagiaire where id = any(v_orphelins);
  delete from public.utilisateur where id = any(v_comptes) and role = 'apprenant';

  -- 5. Entreprises clientes qui ne figurent dans aucun dossier conservé.
  update public.stagiaire set entreprise_id = null
   where formateur_id = f.id and entreprise_id is not null
     and entreprise_id not in (select entreprise_id from public.dossier_formation where formateur_id = f.id);
  delete from public.entreprise_cliente e
   where e.formateur_id = f.id
     and not exists (select 1 from public.dossier_formation d where d.entreprise_id = e.id)
     and not exists (select 1 from public.stagiaire s where s.entreprise_id = e.id);

  -- 6. Pièces de candidature (les fichiers sont supprimés du Storage par le serveur, d'après la liste renvoyée).
  delete from public.piece_formateur where formateur_id = f.id;

  -- 7. Traces hors dossier : invitations, courriers, journal, historique des versions.
  delete from public.invitation where formateur_id = f.id or lower(email) = any(v_emails);
  delete from public.courrier
   where of_id = f.of_id
     and ((dossier_id is null and formateur_id = f.id) or lower(destinataire) = any(v_emails));
  delete from public.version_objet
   where of_id = f.of_id
     and ((type = 'formation' and objet_id = any(v_formations)) or (type = 'outil' and objet_id = any(v_outils)));
  update public.version_objet set auteur_id = null where auteur_id = p_utilisateur_id;
  delete from public.evenement
   where of_id = f.of_id and dossier_id is null and type <> 'compte_supprime'
     and (acteur_id = p_utilisateur_id or detail ->> 'formateur_id' = f.id);
  -- Les suppressions de fichiers de coffre ci-dessus ont journalisé leur nom (déclencheur) : on retire ces lignes.
  delete from public.evenement
   where of_id = f.of_id and dossier_id is null and type = 'coffre_purge' and cree_le = now();
  update public.evenement set acteur_id = null where acteur_id = p_utilisateur_id;

  -- 8. Effacement des données identifiantes du formateur et de son entreprise ; la ligne subsiste, anonyme.
  update public.formateur set
    utilisateur_id = null,
    formateur_prenom = 'Formateur',
    formateur_nom = '(compte supprimé)',
    formateur_email = '',
    formateur_telephone = '',
    formateur_entreprise_nom = '',
    formateur_entreprise_adresse = '',
    formateur_entreprise_siret = '',
    formateur_nda_numero = '',
    formateur_dreets_region = '',
    formateur_iban = '',
    formateur_bic = '',
    parcours = '',
    formateur_statut_juridique = '',
    formateur_domaines = '[]'::jsonb,
    formateur_zones = '',
    formateur_langues = '',
    formateur_tarif_journalier = null,
    formateur_bio = '',
    formateur_linkedin = '',
    formateur_disponibilites = '',
    formateur_assurance_rc = '',
    motif_decision = '',
    anonymise_le = now()
   where id = f.id;

  -- 9. Le profil (le compte Auth est supprimé ensuite par le serveur, avec la clé service).
  delete from public.utilisateur where id = p_utilisateur_id and role = 'formateur';

  insert into public.evenement (of_id, dossier_id, acteur_id, acteur_role, type, libelle, detail)
  values (f.of_id, null, null, 'systeme', 'compte_supprime',
          'Compte formateur supprimé à la demande de son titulaire ; dossiers instruits conservés',
          jsonb_build_object('formateur_id', f.id));

  return jsonb_build_object(
    'of_id', f.of_id,
    'archive', v_chemins_archive,
    'coffre', v_chemins_coffre,
    'comptes_apprenants', to_jsonb(v_comptes)
  );
end;
$$;

revoke all on function public.s4m_effacer_donnees_formateur(text, uuid) from public, anon, authenticated;
grant execute on function public.s4m_effacer_donnees_formateur(text, uuid) to service_role;
