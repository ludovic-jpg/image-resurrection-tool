-- =====================================================================================================
--  Skills4mation — migration 2 : RPC, triggers de journal / versions, vues sans secret
--  Fichier : supabase/migrations/20261005000100_s4m_rpc.sql — à exécuter APRÈS 20261005000000_s4m_initial.sql
--
--  Objets attendus par lovable/CARTE_DES_ROUTES.md (§ 1 et fin du § 2), portés depuis les services Hono :
--   RPC      : s4m_moi(), s4m_restaurer_version(text), s4m_dupliquer_formation(text), s4m_coffres_parcours(),
--              s4m_coffres_apprenant(), s4m_lister_dossiers(), s4m_definir_seances(text, jsonb),
--              s4m_questionnaire(text, text, text), s4m_piece_visible(text), s4m_coffre_accessible(text)
--   Triggers : version_objet (formation, modele_outil, avant modification, purge au-delà de 50) ;
--              journal `evenement` (organisme_formation, formation, modele_outil, coffre_fichier delete,
--              profil formateur validé) ; recopie prénom/nom formateur → utilisateur.
--   Vues     : reglage_vue, positionnement_vue, formulaire_apprenant_vue.
--
--  TYPES D'IDENTIFIANTS : les ids métier (formation, dossier, version, pièce, fichier, stagiaire…) sont des
--  `text` (UUID en chaîne) dans la migration 1, comme dans Hono. Les signatures ci-dessous prennent donc
--  `text`, pas `uuid` — la carte des routes est alignée en conséquence. Seul `utilisateur.id` est un `uuid`.
--
--  Les RPC sont SECURITY INVOKER (droits et RLS de l'appelant ; « introuvable » = 0 ligne), SAUF
--  exceptions nommées, qui contrôlent elles-mêmes l'accès :
--    s4m_moi()                  — lit le profil, l'organisme et la fiche liée de l'appelant (auth.uid()) ;
--    s4m_questionnaire(...)     — l'apprenant n'a pas accès à dossier_formation (corrigés) ;
--    s4m_restaurer_version(...) — doit écrire dans version_objet ; vérifie OF + propriété de l'objet ;
--    s4m_objectifs_atteints(...)— écrit une seule colonne hors de la fenêtre de modification du dossier.
--  Les fonctions internes `s4m_journal` et `s4m_memoriser_version` (SECURITY DEFINER) ne sont PAS
--  exécutables par `authenticated` : seuls les triggers (propriétaire) et le service les appellent.
--  Les triggers qui écrivent dans `evenement` / `version_objet` sont SECURITY DEFINER.
-- =====================================================================================================

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. s4m_moi() — GET /api/auth/moi : { acteur, organisme: { nom, couleur } } ou { acteur: null }
--    Acteur = { utilisateur_id, of_id, role, formateur_id, formateur_valide, stagiaire_id, nom, email }
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_moi()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'acteur', jsonb_build_object(
        'utilisateur_id', u.id,
        'of_id', u.of_id,
        'role', u.role,
        'formateur_id', f.id,
        'formateur_valide', coalesce(f.statut_candidature = 'validee', false),
        'stagiaire_id', st.id,
        'nom', trim(u.prenom || ' ' || u.nom),
        'email', u.email
      ),
      'organisme', jsonb_build_object('nom', o.of_nom, 'couleur', o.couleur)
    )
    from public.utilisateur u
    join public.organisme_formation o on o.id = u.of_id
    left join lateral (select f.id, f.statut_candidature from public.formateur f
                       where u.role = 'formateur' and f.utilisateur_id = u.id and f.anonymise_le is null limit 1) f on true
    left join lateral (select st.id from public.stagiaire st
                       where u.role = 'apprenant' and st.utilisateur_id = u.id and st.archive_le is null limit 1) st on true
    where u.id = auth.uid() and u.actif and u.supprime_le is null
  ), jsonb_build_object('acteur', null))
$$;
grant execute on function public.s4m_moi() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Versions d'objets (formations.memoriserVersion) : trigger BEFORE UPDATE sur formation / modele_outil
--    qui photographie OLD dans version_objet et purge au-delà de 50 versions. SECURITY DEFINER car le
--    client n'a pas de politique d'écriture sur version_objet.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_memoriser_version(p_of_id text, p_type text, p_objet_id text, p_snapshot jsonb, p_libelle text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Fonction INTERNE : appelée par les triggers de version et par s4m_restaurer_version (definer).
  -- Aucun droit EXECUTE pour `authenticated` / `anon` (voir § 12).
  insert into public.version_objet (of_id, type, objet_id, libelle, snapshot, auteur_id)
  values (p_of_id, p_type, p_objet_id, p_libelle, p_snapshot, auth.uid());
  delete from public.version_objet v
  where v.type = p_type and v.objet_id = p_objet_id
    and v.id in (select id from public.version_objet where type = p_type and objet_id = p_objet_id
                 order by cree_le desc offset 50);
end;
$$;
revoke all on function public.s4m_memoriser_version(text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.s4m_memoriser_version(text, text, text, jsonb, text) to service_role;

create or replace function public.s4m_version_formation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Ne photographie que si quelque chose change réellement (hors maj_le). Le libellé peut être fixé par
  -- s4m_restaurer_version via `s4m.libelle_version` (un client ne peut qu'en changer le texte, jamais
  -- empêcher la photographie).
  if to_jsonb(old) - 'maj_le' is distinct from to_jsonb(new) - 'maj_le' then
    perform public.s4m_memoriser_version(old.of_id, 'formation', old.id, to_jsonb(old),
      coalesce(nullif(current_setting('s4m.libelle_version', true), ''),
               'Avant la modification du ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
    if new.dossier_enjeux is distinct from old.dossier_enjeux and new.dossier_enjeux is not null then
      new.enjeux_le := now();
    end if;
  end if;
  return new;
end;
$$;
create trigger s4m_version before update on public.formation for each row execute function public.s4m_version_formation();

create or replace function public.s4m_version_outil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if to_jsonb(old) - 'maj_le' is distinct from to_jsonb(new) - 'maj_le' then
    perform public.s4m_memoriser_version(old.of_id, 'outil', old.id, to_jsonb(old),
      coalesce(nullif(current_setting('s4m.libelle_version', true), ''), 'Avant modification'));
  end if;
  return new;
end;
$$;
create trigger s4m_version before update on public.modele_outil for each row execute function public.s4m_version_outil();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Journal `evenement` par triggers (écritures restées « Client + RLS » qui journalisaient côté serveur)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_journal(p_of_id text, p_dossier_id text, p_type text, p_libelle text, p_detail jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Fonction INTERNE : appelée uniquement par les triggers de journal (propriétaire). Aucun droit
  -- EXECUTE pour `authenticated` / `anon` : un client ne peut pas forger une ligne de journal.
  insert into public.evenement (of_id, dossier_id, acteur_id, acteur_role, type, libelle, detail)
  values (p_of_id, p_dossier_id, auth.uid(), coalesce(public.s4m_role(), 'systeme'), p_type, p_libelle, p_detail);
end;
$$;
revoke all on function public.s4m_journal(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.s4m_journal(text, text, text, text, jsonb) to service_role;

-- organisme_formation : organisme.mettreAJourOrganisme → « organisme_modifie » + liste des champs.
create or replace function public.s4m_journal_organisme()
returns trigger language plpgsql security definer set search_path = public as $$
declare champs jsonb;
begin
  select coalesce(jsonb_agg(k), '[]'::jsonb) into champs
  from jsonb_each(to_jsonb(new)) n(k, v)
  where v is distinct from (to_jsonb(old) -> k);
  if jsonb_array_length(champs) > 0 then
    perform public.s4m_journal(new.id, null, 'organisme_modifie', 'Configuration de l''organisme modifiée', jsonb_build_object('champs', champs));
  end if;
  return new;
end;
$$;
create trigger s4m_journal after update on public.organisme_formation for each row execute function public.s4m_journal_organisme();

-- formation : creerFormation / archiverFormation / restaurerFormation.
create or replace function public.s4m_journal_formation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.s4m_journal(new.of_id, null, 'formation_creee', 'Formation « ' || new.formation_titre || ' » créée');
  elsif new.archivee and not old.archivee then
    perform public.s4m_journal(new.of_id, null, 'formation_archivee', 'Formation « ' || new.formation_titre || ' » archivée');
  elsif old.archivee and not new.archivee then
    perform public.s4m_journal(new.of_id, null, 'formation_restauree', 'Formation « ' || new.formation_titre || ' » restaurée');
  end if;
  return new;
end;
$$;
create trigger s4m_journal after insert or update on public.formation for each row execute function public.s4m_journal_formation();

-- modele_outil : création / archivage (enregistrerOutil, archiverOutil).
create or replace function public.s4m_journal_outil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.s4m_journal(new.of_id, null, 'outil_cree', 'Outil « ' || new.titre || ' » créé');
  elsif new.archive_le is not null and old.archive_le is null then
    perform public.s4m_journal(new.of_id, null, 'outil_archive', 'Outil « ' || new.titre || ' » archivé');
  end if;
  return new;
end;
$$;
create trigger s4m_journal after insert or update on public.modele_outil for each row execute function public.s4m_journal_outil();

-- coffre_fichier : purge définitive (purgerDuCoffre) → « coffre_purge ».
create or replace function public.s4m_journal_coffre_purge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.s4m_journal(old.of_id, null, 'coffre_purge', 'Fichier « ' || old.nom_fichier || ' » supprimé définitivement');
  return old;
end;
$$;
create trigger s4m_journal after delete on public.coffre_fichier for each row execute function public.s4m_journal_coffre_purge();
-- Durcissement de la politique de purge (carte #49) : un client ne supprime qu'un fichier déjà en corbeille.
drop policy if exists coffre_delete on public.coffre_fichier;
create policy coffre_delete on public.coffre_fichier for delete to authenticated
  using (of_id = public.s4m_of_id() and formateur_id = public.s4m_formateur_valide_id() and supprime_le is not null);

-- formateur : profil modifié après validation (candidatures.mettreAJourMonProfil) → « profil_modifie »,
-- prénom/nom figés après validation (sauf admin) et recopiés dans `utilisateur`.
-- SECURITY DEFINER (appelle s4m_journal, interne) ; s4m_est_service() lit le rôle de la REQUÊTE
-- (JWT / SET ROLE), pas current_user, donc reste fiable ici.
create or replace function public.s4m_profil_formateur()
returns trigger language plpgsql security definer set search_path = public as $$
declare champs jsonb;
begin
  select coalesce(jsonb_agg(k), '[]'::jsonb) into champs
  from jsonb_each(to_jsonb(new)) n(k, v)
  where v is distinct from (to_jsonb(old) -> k) and k not in ('statut_candidature', 'soumise_le', 'decidee_le', 'motif_decision');
  if old.statut_candidature = 'validee' and new.statut_candidature = 'validee' and not public.s4m_est_service() then
    if old.statut_candidature = 'validee' and not public.s4m_est_admin()
       and (new.formateur_prenom is distinct from old.formateur_prenom or new.formateur_nom is distinct from old.formateur_nom) then
      raise exception 'Après validation, votre nom et votre prénom ne se modifient que par l''organisme de formation.';
    end if;
    if jsonb_array_length(champs) > 0 then
      perform public.s4m_journal(new.of_id, null, 'profil_modifie',
        'Profil formateur mis à jour (' || (select string_agg(x, ', ') from jsonb_array_elements_text(champs) x) || ')');
    end if;
  end if;
  if old.statut_candidature = 'soumise' and new.statut_candidature = 'soumise' and not public.s4m_est_service()
     and not public.s4m_est_admin() and jsonb_array_length(champs) > 0 then
    raise exception 'Votre candidature est en cours d''étude : attendez la décision pour modifier votre profil.';
  end if;
  if (new.formateur_prenom is distinct from old.formateur_prenom or new.formateur_nom is distinct from old.formateur_nom)
     and new.utilisateur_id is not null then
    update public.utilisateur set prenom = new.formateur_prenom, nom = new.formateur_nom where id = new.utilisateur_id;
  end if;
  return new;
end;
$$;
create trigger s4m_profil before update on public.formateur for each row execute function public.s4m_profil_formateur();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. s4m_restaurer_version(version_id) — formations.restaurerVersion : { type, id }
--    L'état courant est d'abord mémorisé (par le trigger de version), la restauration est réversible.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_restaurer_version(p_version_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.version_objet%rowtype;
  snap jsonb;
  f public.formation%rowtype;
  o public.modele_outil%rowtype;
  champs text[] := array['formation_titre','formation_objectifs','formation_niveau','formation_prerequis','formation_duree_heures_total',
    'formation_duree_jours','formation_modalite','formation_prix_unitaire_ht','programme','public_vise','formation_nb_modules','formation_modules',
    'formation_duree_heures_presentiel','formation_duree_heures_distanciel','formation_prix_groupe_ht','formation_effectif_min','formation_effectif_max',
    'formation_lieu_nom','formation_lieu_adresse','formation_lieu_siret','formation_lien_visio','mode_financement','formation_opco','formation_domaine',
    'formation_moyens_pedagogiques','formation_modalites_evaluation','formation_modalites_sanction','formation_accessibilite','formation_delai_acces','dossier_enjeux'];
  courant jsonb;
  fusion jsonb;
begin
  -- SECURITY DEFINER : contrôles explicites (OF de l'appelant + objet appartenant au formateur validé).
  select * into v from public.version_objet where id = p_version_id and of_id = public.s4m_of_id();
  if v.id is null then raise exception 'Version introuvable.'; end if;
  snap := v.snapshot;
  if v.type = 'formation' then
    select * into f from public.formation where id = v.objet_id and formateur_id = public.s4m_formateur_valide_id();
    if f.id is null then raise exception 'Formation introuvable.'; end if;
    -- L'état courant est photographié par le trigger de version, avec le libellé du service Hono.
    courant := to_jsonb(f);
    fusion := courant;
    for i in 1 .. array_length(champs, 1) loop
      if snap ? champs[i] then fusion := jsonb_set(fusion, array[champs[i]], snap -> champs[i], true); end if;
    end loop;
    perform set_config('s4m.libelle_version', 'Avant restauration d''une version antérieure', true);
    update public.formation set
      formation_titre = fusion ->> 'formation_titre', formation_objectifs = fusion ->> 'formation_objectifs',
      formation_niveau = fusion ->> 'formation_niveau', formation_prerequis = fusion ->> 'formation_prerequis',
      formation_duree_heures_total = (fusion ->> 'formation_duree_heures_total')::real, formation_duree_jours = (fusion ->> 'formation_duree_jours')::real,
      formation_modalite = fusion ->> 'formation_modalite', formation_prix_unitaire_ht = (fusion ->> 'formation_prix_unitaire_ht')::integer,
      programme = fusion ->> 'programme', public_vise = fusion ->> 'public_vise', formation_nb_modules = (fusion ->> 'formation_nb_modules')::integer,
      formation_modules = coalesce(fusion -> 'formation_modules', '[]'::jsonb),
      formation_duree_heures_presentiel = (fusion ->> 'formation_duree_heures_presentiel')::real, formation_duree_heures_distanciel = (fusion ->> 'formation_duree_heures_distanciel')::real,
      formation_prix_groupe_ht = (fusion ->> 'formation_prix_groupe_ht')::integer, formation_effectif_min = (fusion ->> 'formation_effectif_min')::integer,
      formation_effectif_max = (fusion ->> 'formation_effectif_max')::integer, formation_lieu_nom = fusion ->> 'formation_lieu_nom',
      formation_lieu_adresse = fusion ->> 'formation_lieu_adresse', formation_lieu_siret = fusion ->> 'formation_lieu_siret',
      formation_lien_visio = fusion ->> 'formation_lien_visio', mode_financement = fusion ->> 'mode_financement', formation_opco = fusion ->> 'formation_opco',
      formation_domaine = fusion ->> 'formation_domaine', formation_moyens_pedagogiques = fusion ->> 'formation_moyens_pedagogiques',
      formation_modalites_evaluation = fusion ->> 'formation_modalites_evaluation', formation_modalites_sanction = fusion ->> 'formation_modalites_sanction',
      formation_accessibilite = fusion ->> 'formation_accessibilite', formation_delai_acces = fusion ->> 'formation_delai_acces',
      dossier_enjeux = fusion -> 'dossier_enjeux', maj_le = now()
    where id = f.id;
    perform set_config('s4m.libelle_version', '', true);
    return jsonb_build_object('type', 'formation', 'id', f.id);
  end if;
  select * into o from public.modele_outil where id = v.objet_id and formateur_id = public.s4m_formateur_valide_id();
  if o.id is null then raise exception 'Outil pédagogique introuvable.'; end if;
  perform set_config('s4m.libelle_version', 'Avant restauration d''une version antérieure', true);
  update public.modele_outil set
    titre = coalesce(snap ->> 'titre', o.titre), contenu = coalesce(snap -> 'contenu', o.contenu),
    formation_id = nullif(snap ->> 'formation_id', ''), maj_le = now()
  where id = o.id;
  perform set_config('s4m.libelle_version', '', true);
  return jsonb_build_object('type', 'outil', 'id', o.id);
end;
$$;
grant execute on function public.s4m_restaurer_version(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. s4m_dupliquer_formation(formation_id) — formations.dupliquerFormation : la nouvelle ligne `formation`
--    (copie + outils actifs, sans le coffre). Retour : la formation complète (jsonb), comme lireFormation.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_dupliquer_formation(p_formation_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  src public.formation%rowtype;
  nouveau_id text := gen_random_uuid()::text;
  o record;
begin
  select * into src from public.formation where id = p_formation_id and formateur_id = public.s4m_formateur_valide_id();
  if src.id is null then raise exception 'Formation introuvable.'; end if;
  insert into public.formation (id, of_id, formateur_id, formation_titre, formation_objectifs, formation_niveau, formation_prerequis,
    formation_duree_heures_total, formation_duree_jours, formation_modalite, formation_prix_unitaire_ht, programme, public_vise, archivee,
    formation_nb_modules, formation_modules, formation_duree_heures_presentiel, formation_duree_heures_distanciel, formation_prix_groupe_ht,
    formation_effectif_min, formation_effectif_max, formation_lieu_nom, formation_lieu_adresse, formation_lieu_siret, formation_lien_visio,
    mode_financement, formation_opco, formateur_cout_horaire, formation_domaine, formation_moyens_pedagogiques, formation_modalites_evaluation,
    formation_modalites_sanction, formation_accessibilite, formation_delai_acces, archivee_le, dossier_enjeux, enjeux_le)
  values (nouveau_id, src.of_id, src.formateur_id, src.formation_titre || ' (copie)', src.formation_objectifs, src.formation_niveau, src.formation_prerequis,
    src.formation_duree_heures_total, src.formation_duree_jours, src.formation_modalite, src.formation_prix_unitaire_ht, src.programme, src.public_vise, false,
    src.formation_nb_modules, src.formation_modules, src.formation_duree_heures_presentiel, src.formation_duree_heures_distanciel, src.formation_prix_groupe_ht,
    src.formation_effectif_min, src.formation_effectif_max, src.formation_lieu_nom, src.formation_lieu_adresse, src.formation_lieu_siret, src.formation_lien_visio,
    src.mode_financement, src.formation_opco, src.formateur_cout_horaire, src.formation_domaine, src.formation_moyens_pedagogiques, src.formation_modalites_evaluation,
    src.formation_modalites_sanction, src.formation_accessibilite, src.formation_delai_acces, null, src.dossier_enjeux, src.enjeux_le);
  for o in select * from public.modele_outil where formation_id = src.id and archive_le is null loop
    insert into public.modele_outil (of_id, formateur_id, formation_id, type, titre, contenu)
    values (o.of_id, o.formateur_id, nouveau_id, o.type, o.titre, o.contenu);
  end loop;
  return (select to_jsonb(f) from public.formation f where f.id = nouveau_id);
end;
$$;
grant execute on function public.s4m_dupliquer_formation(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 6. s4m_coffres_parcours() — coffre.listerCoffresParcours (F validé, A) : tableau d'agrégats
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_coffres_parcours()
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'formation_titre', f.formation_titre,
    'formateur', fo.formateur_prenom || ' ' || fo.formateur_nom,
    'modules', jsonb_array_length(coalesce(f.formation_modules, '[]'::jsonb)),
    'heures', f.formation_duree_heures_total,
    'pedagogique', (select count(*) from public.coffre_fichier c where c.formation_id = f.id and c.supprime_le is null and c.categorie not in ('administratif', 'qualite'))
                 + (select count(*) from public.modele_outil m where m.formation_id = f.id and m.archive_le is null) + 1,
    'administratif', (select count(*) from public.coffre_fichier c where c.formation_id = f.id and c.supprime_le is null and c.categorie in ('administratif', 'qualite')),
    'dossiers', (select count(*) from public.dossier_formation d where d.formation_id = f.id),
    'positionnements_signes', (select count(*) from public.positionnement p where p.formation_id = f.id and p.archive_le is null and p.statut = 'complet'),
    'positionnements_attente', (select count(*) from public.positionnement p where p.formation_id = f.id and p.archive_le is null and p.statut <> 'complet')
  ) order by f.formation_titre), '[]'::jsonb)
  from public.formation f
  join public.formateur fo on fo.id = f.formateur_id
  where f.archivee = false and public.s4m_role() in ('admin', 'formateur')
$$;
grant execute on function public.s4m_coffres_parcours() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 7. s4m_coffres_apprenant() — formations.coffresDeLApprenant (S) : RG-08
--    [{ dossier_id, dossier_reference, formation_titre, fichiers: [{ id, nom_fichier, taille, categorie }] }]
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_coffres_apprenant()
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'dossier_id', d.id,
    'dossier_reference', d.dossier_reference,
    'formation_titre', d.formation_titre,
    'fichiers', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'nom_fichier', c.nom_fichier, 'taille', c.taille, 'categorie', c.categorie) order by c.cree_le)
      from public.coffre_fichier c
      where c.formation_id = d.formation_id and c.partageable and c.supprime_le is null
    ), '[]'::jsonb)
  ) order by d.maj_le desc), '[]'::jsonb)
  from public.dossier_formation_apprenant d          -- l'apprenant ne lit pas la table dossier_formation
  where d.formation_id is not null
    and public.s4m_a_atteint(d.sous_statut, 'accord_financement')
$$;
grant execute on function public.s4m_coffres_apprenant() to authenticated, service_role;

-- s4m_coffre_accessible(fichier_id) — carte #55 : le fichier est-il accessible à l'appelant ?
-- (F propriétaire validé, A de l'OF, S si partageable + dossier ≥ accord de financement.) Même règle que
-- la politique RLS de coffre_fichier : « existe sous RLS ».
create or replace function public.s4m_coffre_accessible(p_fichier_id text)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.coffre_fichier c where c.id = p_fichier_id)
$$;
grant execute on function public.s4m_coffre_accessible(text) to authenticated, service_role;

-- s4m_piece_visible(piece_id) — carte #109 : reprend `peutVoir` (= politique RLS de piece_dossier).
create or replace function public.s4m_piece_visible(p_piece_id text)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.piece_dossier p where p.id = p_piece_id)
$$;
grant execute on function public.s4m_piece_visible(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 8. s4m_lister_dossiers() — dossiers.listerDossiers (F, A, S) : { etapes, sous_statuts, dossiers: [...] }
--    `etapes` et `sous_statuts` reproduisent src/domaine/pipeline/statuts.ts ; le front peut les ignorer.
--    Compteur d'avancement : pièces SUIVIES, d'un espace, visibles par l'acteur (peutVoir).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_etapes()
returns jsonb language sql immutable as $$
  select '[{"cle":"A","titre":"Création du dossier Formation"},{"cle":"B","titre":"Demande de financement"},{"cle":"C","titre":"Début de la Formation"},{"cle":"D","titre":"Fin de la Formation"},{"cle":"E","titre":"Demande de paiement"},{"cle":"F","titre":"Paiement réceptionné"},{"cle":"G","titre":"Formateur payé / Dossier archivé"}]'::jsonb
$$;
create or replace function public.s4m_sous_statuts()
returns jsonb language sql immutable as $$
  select '[{"cle":"brouillon","etape":"A","libelle":"Brouillon"},{"cle":"en_cours_validation","etape":"A","libelle":"En cours de validation"},{"cle":"dossier_valide","etape":"B","libelle":"Dossier validé"},{"cle":"dossier_depose","etape":"B","libelle":"Dossier Formation déposé"},{"cle":"accord_financement","etape":"B","libelle":"Accord de financement"},{"cle":"refus_financement","etape":"B","libelle":"Refus de financement"},{"cle":"envoi_elements_pedagogiques","etape":"B","libelle":"AF — Envoi des éléments pédagogiques à l''apprenant"},{"cle":"formation_debutee","etape":"C","libelle":"Formation en cours"},{"cle":"fin_dossier_incomplet","etape":"D","libelle":"Dossier incomplet"},{"cle":"fin_dossier_complet","etape":"D","libelle":"Dossier complet"},{"cle":"demande_paiement","etape":"E","libelle":"Demande de paiement"},{"cle":"paiement_receptionne","etape":"F","libelle":"Paiement réceptionné"},{"cle":"archive","etape":"G","libelle":"Formateur payé / Dossier archivé"}]'::jsonb
$$;
-- Pièces dont le statut est suivi ET qui appartiennent à un espace (referentiel/pieces.ts :
-- suiviStatut = false pour 03-AVT, PRG, 11-FIN ; espace = null pour 00-AVT, 01-AVT, REF, 08-FIN, 12-APR).
create or replace function public.s4m_piece_suivie(p_code text)
returns boolean language sql immutable as $$
  select p_code in ('PRE', '02-AVT', 'ACC', '04-AVT', '05-AVT', '06-PDT', '07-FIN', '09-FIN', '10-FIN')
$$;
grant execute on function public.s4m_etapes(), public.s4m_sous_statuts(), public.s4m_piece_suivie(text) to authenticated, service_role;

-- `formateur` est lu via la vue `formateur_public` (l'apprenant n'a pas accès à la table `formateur`).
create or replace function public.s4m_lister_dossiers()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'etapes', public.s4m_etapes(),
    'sous_statuts', public.s4m_sous_statuts(),
    'dossiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'dossier_reference', d.dossier_reference,
        'sous_statut', d.sous_statut,
        'libelle_statut', (select s ->> 'libelle' from jsonb_array_elements(public.s4m_sous_statuts()) s where s ->> 'cle' = d.sous_statut),
        'etape', (select s ->> 'etape' from jsonb_array_elements(public.s4m_sous_statuts()) s where s ->> 'cle' = d.sous_statut),
        'archive', d.sous_statut in ('refus_financement', 'archive'),
        'formation_titre', d.formation_titre,
        'formation_date_debut', d.formation_date_debut,
        'formation_date_fin', d.formation_date_fin,
        'apprenants', coalesce((select jsonb_agg(st.stagiaire_prenom || ' ' || st.stagiaire_nom order by sd.rang)
                                from public.stagiaire_dossier sd join public.stagiaire st on st.id = sd.stagiaire_id
                                where sd.dossier_id = d.id), '[]'::jsonb),
        'formateur', coalesce((select fp.formateur_prenom || ' ' || fp.formateur_nom from public.formateur_public fp where fp.id = d.formateur_id), ''),
        'pieces_validees', (select count(*) from public.piece_dossier p where p.dossier_id = d.id and public.s4m_piece_suivie(p.code) and p.statut = 'valide'),
        'pieces_total', (select count(*) from public.piece_dossier p where p.dossier_id = d.id and public.s4m_piece_suivie(p.code)),
        'maj_le', d.maj_le
      ) order by d.maj_le desc)
      from (
        -- Admin / formateur : la table sous RLS. Apprenant : la vue sans prix ni corrigés (la table lui
        -- renvoie 0 ligne, la vue renvoie 0 ligne aux autres rôles).
        select x.id, x.dossier_reference, x.sous_statut, x.formation_titre, x.formation_date_debut,
               x.formation_date_fin, x.formateur_id, x.maj_le
        from public.dossier_formation x
        union all
        select y.id, y.dossier_reference, y.sous_statut, y.formation_titre, y.formation_date_debut,
               y.formation_date_fin, y.formateur_id, y.maj_le
        from public.dossier_formation_apprenant y
      ) d
    ), '[]'::jsonb)
  )
$$;

grant execute on function public.s4m_lister_dossiers() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 9. s4m_definir_seances(dossier_id, seances jsonb) — dossiers.definirSeances : delete + insert atomiques,
--    mêmes conditions que la modification du dossier (RLS de `seance` → s4m_dossier_modifiable).
--    Entrée : [{ date: 'AAAA-MM-JJ', heure_debut: 'HH:MM', heure_fin: 'HH:MM' }] (≤ 20).
--    Retour : les séances du dossier, triées (date, heure_debut), comme seancesDuDossier.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_definir_seances(p_dossier_id text, p_seances jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare se jsonb; n integer;
begin
  if not public.s4m_dossier_modifiable(p_dossier_id) then
    raise exception 'Ce dossier n''est plus modifiable à cette étape : les pièces émises font foi.';
  end if;
  if jsonb_typeof(p_seances) <> 'array' then raise exception 'Planning invalide.'; end if;
  n := jsonb_array_length(p_seances);
  if n > 20 then raise exception 'Un planning compte 20 séances au plus.'; end if;
  for se in select * from jsonb_array_elements(p_seances) loop
    if (se ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$' or (se ->> 'heure_debut') !~ '^\d{2}:\d{2}$' or (se ->> 'heure_fin') !~ '^\d{2}:\d{2}$' then
      raise exception 'Séance invalide (date AAAA-MM-JJ, heures HH:MM).';
    end if;
    if (se ->> 'heure_fin') <= (se ->> 'heure_debut') then raise exception 'L''heure de fin doit suivre l''heure de début.'; end if;
  end loop;
  delete from public.seance where dossier_id = p_dossier_id;
  insert into public.seance (dossier_id, date, heure_debut, heure_fin)
  select p_dossier_id, s ->> 'date', s ->> 'heure_debut', s ->> 'heure_fin' from jsonb_array_elements(p_seances) s;
  update public.dossier_formation set maj_le = now() where id = p_dossier_id;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.date, x.heure_debut) from public.seance x where x.dossier_id = p_dossier_id), '[]'::jsonb);
end;
$$;
grant execute on function public.s4m_definir_seances(text, jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 10. s4m_questionnaire(dossier_id, type, stagiaire_id) — evaluations.lireQuestionnaire
--     { type, ouvert, formulaire, questionnaire, reponses, score, date }
--     `formulaire` (définitions des champs 00-AVT / 08-FIN / 12-APR) vit dans le noyau front : renvoyé null
--     ici, le front le prend dans `domaine/formulaires/definitions`. Le corrigé (bonne_reponse) est retiré
--     pour l'apprenant ; stagiaire_id ignoré pour l'apprenant (toujours le sien).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_questionnaire(p_dossier_id text, p_type text, p_stagiaire_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.dossier_formation%rowtype;
  cible text;
  q jsonb;
  ev public.evaluation%rowtype;
  ouvert_des text;
begin
  -- SECURITY DEFINER (l'apprenant ne lit pas dossier_formation) : accederAuDossier reproduit à la main.
  if not public.s4m_dossier_lisible(p_dossier_id) then raise exception 'Dossier introuvable.'; end if;
  select * into d from public.dossier_formation where id = p_dossier_id;
  if p_type not in ('recueil', 'positionnement', 'acquis', 'satisfaction_chaud', 'satisfaction_froid') then
    raise exception 'Type de questionnaire inconnu.';
  end if;
  if public.s4m_role() = 'apprenant' then
    cible := public.s4m_stagiaire_id();
    if cible is null then raise exception 'Accès interdit.'; end if;
  else
    if p_stagiaire_id is null then raise exception 'Le stagiaire concerné doit être précisé.'; end if;
    if not exists (select 1 from public.stagiaire_dossier where dossier_id = d.id and stagiaire_id = p_stagiaire_id) then
      raise exception 'Stagiaire introuvable dans ce dossier.';
    end if;
    cible := p_stagiaire_id;
  end if;
  ouvert_des := case p_type when 'recueil' then 'brouillon' when 'positionnement' then 'brouillon' when 'acquis' then 'formation_debutee'
                            when 'satisfaction_chaud' then 'fin_dossier_incomplet' else 'fin_dossier_complet' end;
  q := case p_type when 'positionnement' then d.questionnaire_positionnement when 'acquis' then d.questionnaire_acquis else null end;
  if q is not null and public.s4m_role() = 'apprenant' then
    q := jsonb_build_object('titre', q -> 'titre', 'questions',
           coalesce((select jsonb_agg(jsonb_build_object('enonce', x -> 'enonce', 'propositions', x -> 'propositions'))
                     from jsonb_array_elements(coalesce(q -> 'questions', '[]'::jsonb)) x), '[]'::jsonb));
  end if;
  select * into ev from public.evaluation where dossier_id = d.id and stagiaire_id = cible and type = p_type;
  return jsonb_build_object(
    'type', p_type,
    'ouvert', public.s4m_a_atteint(d.sous_statut, ouvert_des) and d.sous_statut not in ('refus_financement', 'archive'),
    'formulaire', null,
    'questionnaire', q,
    'reponses', ev.reponses,
    'score', ev.score,
    'date', ev.date
  );
end;
$$;
grant execute on function public.s4m_questionnaire(text, text, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 10 bis. s4m_objectifs_atteints(dossier_id, valeur) — dossiers.renseignerObjectifsAtteints (route #94)
--     Saisie en FIN de formation, donc hors de la fenêtre « dossier modifiable » de la politique UPDATE.
--     SECURITY DEFINER, contrôlée : admin de l'OF ou formateur validé propriétaire ; dossier non terminal ;
--     texte rogné à 4 000 caractères. Seule la colonne formation_objectifs_atteints (et maj_le) change.
--     Retour : { ok: true } comme la route Hono.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.s4m_objectifs_atteints(p_dossier_id text, p_valeur text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.dossier_formation%rowtype;
begin
  if public.s4m_role() not in ('admin', 'formateur') then raise exception 'Accès interdit.'; end if;
  if not public.s4m_dossier_interne(p_dossier_id) then raise exception 'Dossier introuvable.'; end if;
  select * into d from public.dossier_formation where id = p_dossier_id;
  if d.sous_statut in ('refus_financement', 'archive') then raise exception 'Ce dossier est archivé.'; end if;
  update public.dossier_formation
     set formation_objectifs_atteints = left(trim(coalesce(p_valeur, '')), 4000), maj_le = now()
   where id = p_dossier_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.s4m_objectifs_atteints(text, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 11. Vues sans secret (security_invoker : la RLS des tables sous-jacentes s'applique)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- reglage_vue — reglages.vueReglages : une ligne par OF, clés non secrètes en clair, secrets → booléen « défini ».
-- `ia_defaut_serveur`, `modeles`, `prereglages` sont des constantes serveur : le front les tient du noyau.
-- La vue lit `reglage` en SECURITY DEFINER filtré (les lignes `secret = true` ne sont pas lisibles par la RLS
-- client, or il faut savoir si elles existent) sans jamais exposer la valeur chiffrée.
create or replace function public.s4m_reglages_vue()
returns table (of_id text, ia_modele text, ia_workspace text, ia_recherche_web text, ia_active text, smtp_hote text, smtp_port text,
               smtp_securise text, smtp_utilisateur text, courrier_expediteur text, courrier_actif text,
               ia_cle_definie boolean, smtp_mot_de_passe_defini boolean)
language sql stable security definer set search_path = public as $$
  select o.id,
    coalesce((select valeur from public.reglage where of_id = o.id and cle = 'ia_modele'), ''),
    coalesce((select valeur from public.reglage where of_id = o.id and cle = 'ia_workspace'), ''),
    coalesce((select valeur from public.reglage where of_id = o.id and cle = 'ia_recherche_web'), 'oui'),
    coalesce((select valeur from public.reglage where of_id = o.id and cle = 'ia_active'), 'oui'),
    coalesce((select valeur from public.reglage where of_id = o.id and cle = 'smtp_hote'), ''),
    coalesce((select valeur from public.reglage where of_id = o.id and cle = 'smtp_port'), ''),
    coalesce((select valeur from public.reglage where of_id = o.id and cle = 'smtp_securise'), 'non'),
    coalesce((select valeur from public.reglage where of_id = o.id and cle = 'smtp_utilisateur'), ''),
    coalesce((select valeur from public.reglage where of_id = o.id and cle = 'courrier_expediteur'), ''),
    coalesce((select valeur from public.reglage where of_id = o.id and cle = 'courrier_actif'), 'non'),
    exists (select 1 from public.reglage where of_id = o.id and cle = 'ia_cle' and secret and valeur <> ''),
    exists (select 1 from public.reglage where of_id = o.id and cle = 'smtp_mot_de_passe' and secret and valeur <> '')
  from public.organisme_formation o
  where o.id = public.s4m_of_id() and public.s4m_est_admin()
$$;
grant execute on function public.s4m_reglages_vue() to authenticated, service_role;
create view public.reglage_vue with (security_invoker = true) as select * from public.s4m_reglages_vue();
grant select on public.reglage_vue to authenticated, service_role;

-- positionnement_vue — positionnements.listerPositionnements : sans jeton_hash, brouillon, questionnaire,
-- recueil, reponses, signature_png. Même forme que le service (apprenant, email, entreprise, expire, pdf…).
create view public.positionnement_vue with (security_invoker = true) as
  select p.id, p.of_id, p.formateur_id, p.formation_id, p.formation_titre, p.stagiaire_id,
         st.stagiaire_prenom || ' ' || st.stagiaire_nom as apprenant,
         st.stagiaire_email as email,
         coalesce(ent.entreprise_nom, '') as entreprise,
         p.statut,
         (p.statut <> 'complet' and p.expire_le <= now()) as expire,
         p.score, p.message, p.date_reponse, p.envoye_le, p.signe_le,
         (p.chemin_pdf is not null) as pdf,
         p.expire_le, p.archive_le, p.cree_le
  from public.positionnement p
  join public.stagiaire st on st.id = p.stagiaire_id
  left join public.entreprise_cliente ent on ent.id = st.entreprise_id;
grant select on public.positionnement_vue to authenticated, service_role;

-- formulaire_apprenant_vue — formulaires.etatFormulaires / listerFormulaires : sans jeton_hash ni brouillon.
create view public.formulaire_apprenant_vue with (security_invoker = true) as
  select f.id, f.of_id, f.dossier_id, d.dossier_reference, d.formation_titre, f.stagiaire_id,
         st.stagiaire_prenom || ' ' || st.stagiaire_nom as apprenant,
         f.type,
         case f.type when 'recueil' then 'Recueil des besoins' when 'positionnement' then 'Test de positionnement' when 'acquis' then 'Évaluation des acquis'
                     when 'satisfaction_chaud' then 'Satisfaction à chaud' when 'satisfaction_froid' then 'Satisfaction à froid' else f.type end as libelle,
         f.statut, f.envois, f.envoye_le, f.expire_le, f.signe_le,
         (f.chemin_invitation is not null) as invitation,
         f.cree_le
  from public.formulaire_apprenant f
  join public.dossier_formation d on d.id = f.dossier_id
  join public.stagiaire st on st.id = f.stagiaire_id;
grant select on public.formulaire_apprenant_vue to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 12. Verrouillage : PostgreSQL accorde EXECUTE à PUBLIC par défaut sur toute fonction. On retire ce
--     droit à PUBLIC et anon pour l'ensemble du schéma ; seules les fonctions explicitement accordées à
--     `authenticated` restent appelables par un client connecté.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on all functions in schema public from public, anon;
-- Fonctions internes : jamais exécutables par un client connecté.
revoke all on function public.s4m_journal(text, text, text, text, jsonb) from authenticated;
revoke all on function public.s4m_memoriser_version(text, text, text, jsonb, text) from authenticated;

-- Fin de la migration 2.
