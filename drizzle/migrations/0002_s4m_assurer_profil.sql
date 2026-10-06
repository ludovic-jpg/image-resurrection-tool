-- =====================================================================================================
--  Skills4mation — création du profil à la première connexion (remplace le déclencheur sur auth.users,
--  refusé par Lovable Cloud). Logique IDENTIQUE à public.s4m_creer_profil_depuis_auth() : cas 0 admin
--  via app_metadata, cas 1 invitation, cas 2 candidature formateur, mêmes refus, mêmes messages.
--  - Aucun paramètre : lit elle-même la ligne auth.users de auth.uid(). Le navigateur ne transmet
--    jamais de rôle, d'organisme ni de jeton en paramètre.
--  - Idempotente : si le profil existe déjà, ne fait rien et renvoie le rôle existant.
--  - Renvoie le rôle ('admin' | 'formateur' | 'apprenant').
-- =====================================================================================================
create or replace function public.s4m_assurer_profil()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  u auth.users%rowtype;
  meta jsonb;
  app jsonb;
  v_email text;
  v_jeton text;
  v_role text;
  v_of text;
  v_prenom text;
  v_nom text;
  inv public.invitation%rowtype;
  v_formateur_id text;
  v_existant text;
begin
  if v_uid is null then
    raise exception 'Session absente : reconnectez-vous.';
  end if;

  select role into v_existant from public.utilisateur where id = v_uid;
  if v_existant is not null then
    return v_existant;
  end if;

  select * into u from auth.users where id = v_uid;
  if u.id is null then
    raise exception 'Session absente : reconnectez-vous.';
  end if;

  meta := coalesce(u.raw_user_meta_data, '{}'::jsonb);
  app := coalesce(u.raw_app_meta_data, '{}'::jsonb);
  v_email := lower(trim(coalesce(u.email, '')));
  v_jeton := nullif(meta ->> 'invitation', '');
  v_role := nullif(meta ->> 'role', '');
  v_of := nullif(meta ->> 'of_id', '');
  v_prenom := left(trim(coalesce(meta ->> 'prenom', '')), 100);
  v_nom := left(trim(coalesce(meta ->> 'nom', '')), 100);

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
    values (u.id, app ->> 'of_id', v_email, 'admin', v_prenom, v_nom, true);
    insert into public.evenement (of_id, acteur_id, acteur_role, type, libelle)
    values (app ->> 'of_id', u.id, 'admin', 'compte_cree', 'Compte administrateur créé');
    return 'admin';
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
      raise exception 'Rôle d''invitation invalide.';
    end if;

    insert into public.utilisateur (id, of_id, email, role, prenom, nom, actif)
    values (u.id, inv.of_id, v_email, inv.role, coalesce(nullif(inv.prenom, ''), v_prenom), coalesce(nullif(inv.nom, ''), v_nom), true);

    if inv.role = 'apprenant' then
      if inv.stagiaire_id is null then
        raise exception 'Invitation apprenant sans fiche stagiaire.';
      end if;
      update public.stagiaire set utilisateur_id = u.id where id = inv.stagiaire_id and of_id = inv.of_id;
    else
      if inv.formateur_id is not null then
        update public.formateur set utilisateur_id = u.id where id = inv.formateur_id and of_id = inv.of_id;
      else
        insert into public.formateur (of_id, utilisateur_id, formateur_prenom, formateur_nom, formateur_email)
        values (inv.of_id, u.id, coalesce(nullif(inv.prenom, ''), v_prenom), coalesce(nullif(inv.nom, ''), v_nom), v_email);
      end if;
    end if;

    update public.invitation set utilisee_le = now(), utilisateur_id = u.id where jeton_hash = inv.jeton_hash;

    insert into public.evenement (of_id, acteur_id, acteur_role, type, libelle)
    values (inv.of_id, u.id, inv.role, 'compte_cree', 'Compte ' || inv.role || ' créé sur invitation');
    return inv.role;
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
  values (u.id, v_of, v_email, 'formateur', v_prenom, v_nom, true);

  insert into public.formateur (of_id, utilisateur_id, formateur_prenom, formateur_nom, formateur_email)
  values (v_of, u.id, v_prenom, v_nom, v_email)
  returning id into v_formateur_id;

  insert into public.evenement (of_id, acteur_id, acteur_role, type, libelle)
  values (v_of, u.id, 'formateur', 'compte_cree', 'Compte formateur créé (candidature)');
  return 'formateur';
end;
$$;

revoke all on function public.s4m_assurer_profil() from public;
revoke all on function public.s4m_assurer_profil() from anon;
grant execute on function public.s4m_assurer_profil() to authenticated;
