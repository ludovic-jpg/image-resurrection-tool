-- =====================================================================================================
--  Lot 8 — planification de la tâche quotidienne (pg_cron + pg_net) à 03:00, heure de Paris.
--  Fichier : supabase/migrations/20261006000801_lot8_tache_quotidienne.sql   (NOUVELLE migration)
--
--  Ce que la tâche déclenche : POST <adresse de l'application>/api/taches-quotidiennes, protégé par l'en-tête
--  `x-cron-secret` (secret CRON_SECRET du serveur). Elle envoie la satisfaction « à froid » à J+90 et UNE relance à J+7
--  des formulaires apprenant restés sans réponse (équivalent de l'ancien `setInterval` de `taches.ts`).
--
--  AUCUN SECRET EN CLAIR dans ce fichier. Le secret et l'adresse sont lus dans Vault (supabase_vault) au moment de
--  l'appel. À RENSEIGNER UNE FOIS, dans l'éditeur SQL du projet (jamais dans un fichier versionné) :
--
--      select vault.create_secret('<la même valeur que le secret CRON_SECRET du serveur>', 's4m_cron_secret');
--      select vault.create_secret('https://<adresse publique de l''application>', 's4m_app_url');
--
--  Pour changer une valeur plus tard : select vault.update_secret(id, '<nouvelle valeur>') (id lu dans vault.secrets).
--  Tant que ces deux secrets manquent, la fonction ne fait RIEN (elle prévient dans les journaux Postgres) : la
--  migration est donc sans danger à appliquer avant de les renseigner.
--
--  « 03:00 heure de Paris » : pg_cron compte en UTC, or 03:00 à Paris tombe à 01:00 UTC l'été et 02:00 UTC l'hiver. Le
--  travail est donc planifié à 01:00 ET 02:00 UTC, et la fonction ne lance l'appel que lorsqu'il est effectivement
--  03h à Paris : un seul déclenchement par nuit, changement d'heure compris.
-- =====================================================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Lance l'appel si (et seulement si) il est 03h à Paris. `p_maintenant` ne sert qu'aux tests.
create or replace function public.s4m_lancer_taches_quotidiennes(p_maintenant timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_url text;
begin
  if extract(hour from (p_maintenant at time zone 'Europe/Paris')) <> 3 then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 's4m_cron_secret' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 's4m_app_url' limit 1;
  if coalesce(v_secret, '') = '' or coalesce(v_url, '') = '' then
    raise warning 's4m : tâche quotidienne non lancée — renseignez les secrets Vault s4m_cron_secret et s4m_app_url';
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/taches-quotidiennes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

-- Réservée à la planification (propriétaire) et au service : un client authentifié ne peut pas la déclencher.
revoke all on function public.s4m_lancer_taches_quotidiennes(timestamptz) from public, anon, authenticated;
grant execute on function public.s4m_lancer_taches_quotidiennes(timestamptz) to service_role;

-- Planification idempotente : la rejouer remplace le travail existant au lieu d'en créer un second.
do $$
begin
  if exists (select 1 from cron.job where jobname = 's4m-taches-quotidiennes') then
    perform cron.unschedule('s4m-taches-quotidiennes');
  end if;
  perform cron.schedule('s4m-taches-quotidiennes', '0 1,2 * * *', 'select public.s4m_lancer_taches_quotidiennes()');
end;
$$;
