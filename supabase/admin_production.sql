-- =====================================================================================================
--  Skills4mation — GABARIT DE MISE EN PRODUCTION : organisme réel + premier administrateur
--
--  À coller dans le SQL Editor de Supabase, APRÈS les migrations 20261005000000 et 20261005000100,
--  sur le projet de PRODUCTION, une seule fois.
--
--  POURQUOI PAR SQL ? Le trigger `s4m_on_auth_user_created` ne crée un profil `admin` que si le compte
--  porte `app_metadata.s4m_role = 'admin'` À LA CRÉATION. Le formulaire d'inscription de l'application
--  (signUp) ne peut écrire que `user_metadata` : il ne peut donc jamais produire un admin. Deux voies :
--    (a) ce script (insert dans auth.users + auth.identities, méthode utilisée par le seed) ;
--    (b) `supabase.auth.admin.createUser({ email, password, email_confirm: true,
--         app_metadata: { s4m_role: 'admin', of_id: '<OF_ID>' }, user_metadata: { prenom, nom } })`
--        depuis un script Node avec la clé service_role — même effet, même trigger.
--
--  REMPLACEZ les placeholders avant d'exécuter :
--    <OF_ID>          identifiant technique de l'organisme (ex. 'of-formatrix' ; lettres, chiffres, tirets)
--    <OF_NOM>         raison sociale (ex. 'BACK TO BUSINESS SA')
--    <EMAIL>          adresse e-mail de l'administrateur (minuscules)
--    <MOT_DE_PASSE>   mot de passe initial, 10 caractères minimum — à changer dès la première connexion
--    <PRENOM> <NOM>   identité de l'administrateur
--  Les autres champs de l'organisme (SIRET, NDA, Qualiopi, IBAN…) se renseignent ensuite dans l'écran
--  « Organisme » de l'application ; ils sont laissés vides ici.
--
--  Idempotent : rejouer le script ne crée pas de doublon (on conflict / gardes d'existence), mais ne
--  CHANGE pas un mot de passe existant — pour cela, utiliser « Reset password » du dashboard Auth.
--  Ne laissez pas ce fichier rempli dans un dépôt : il contient un mot de passe.
-- =====================================================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  -- ▼▼▼ À RENSEIGNER ▼▼▼
  c_of_id constant text := '<OF_ID>';
  c_of_nom constant text := '<OF_NOM>';
  c_email constant text := lower('<EMAIL>');
  c_mdp constant text := '<MOT_DE_PASSE>';
  c_prenom constant text := '<PRENOM>';
  c_nom constant text := '<NOM>';
  -- ▲▲▲ À RENSEIGNER ▲▲▲
  c_instance constant uuid := '00000000-0000-0000-0000-000000000000';
  v_user uuid;
begin
  if c_of_id like '<%' or c_email like '<%' or c_mdp like '<%' then
    raise exception 'Remplacez les placeholders <...> avant d''exécuter ce script.';
  end if;
  if length(c_mdp) < 10 then
    raise exception 'Le mot de passe doit compter au moins 10 caractères.';
  end if;

  -- 1. Organisme (vide hormis le nom ; à compléter dans l'application).
  insert into public.organisme_formation (id, of_nom)
  values (c_of_id, c_of_nom)
  on conflict (id) do nothing;

  -- 2. Compte Auth de l'administrateur. `app_metadata.s4m_role = 'admin'` + `of_id` déclenchent la
  --    création du profil admin par le trigger de la migration.
  select id into v_user from auth.users where lower(email) = c_email;
  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (c_instance, v_user, 'authenticated', 'authenticated', c_email,
            extensions.crypt(c_mdp, extensions.gen_salt('bf')), now(),
            jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 's4m_role', 'admin', 'of_id', c_of_id),
            jsonb_build_object('prenom', c_prenom, 'nom', c_nom),
            now(), now());
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (v_user, v_user, v_user::text, 'email',
            jsonb_build_object('sub', v_user::text, 'email', c_email, 'email_verified', true),
            now(), now(), now());
  end if;

  -- 3. Filet : si le compte existait déjà SANS profil (créé autrement), on crée le profil admin ici.
  insert into public.utilisateur (id, of_id, email, role, prenom, nom)
  values (v_user, c_of_id, c_email, 'admin', c_prenom, c_nom)
  on conflict (id) do nothing;

  -- 4. Contrôle final.
  if not exists (select 1 from public.utilisateur where id = v_user and role = 'admin' and of_id = c_of_id) then
    raise exception 'Le profil administrateur n''a pas été créé : vérifiez que les migrations sont appliquées.';
  end if;
  raise notice 'Organisme % (%) et administrateur % en place. Changez le mot de passe à la première connexion.', c_of_nom, c_of_id, c_email;
end $$;

-- Vérification (facultatif) :
-- select u.email, u.role, u.of_id, o.of_nom from public.utilisateur u join public.organisme_formation o on o.id = u.of_id;
