-- TSENA — installation de l'assistant IA (à exécuter une seule fois dans Supabase > SQL Editor > New query > Run,
-- APRÈS supabase/schema.sql). Peut être relancé sans danger (il remplace ce qu'il a déjà créé).
--
-- Ce script crée un schéma privé « ai », invisible depuis les appareils (il n'est pas publié par l'API Supabase) :
--   - ai.secrets : la clé API du serveur IA en ligne. Seule la fonction cloud « ai-chat » la lit ; elle n'est
--                  jamais renvoyée aux appareils.
--   - ai.data    : vue en LECTURE SEULE des données de l'application pour l'assistant, sans les mots de passe,
--                  réponses secrètes et photos.
--   - ai_reader  : rôle Postgres qui n'a le droit que de LIRE ai.data. Toutes les requêtes de l'assistant
--                  (y compris la requête SQL de secours) s'exécutent avec ce rôle, dans une transaction en lecture seule.

create schema if not exists ai;
revoke all on schema ai from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema ai from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema ai from authenticated'; end if;
end $$;

-- 1. Clé API (et autres secrets éventuels de l'assistant).
create table if not exists ai.secrets (
  id         text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table ai.secrets enable row level security; -- aucune règle : personne d'autre que le propriétaire n'y accède

-- 2. Lecture tolérante d'une date (une date mal écrite donne « vide » au lieu d'une erreur).
create or replace function ai.ts(v text) returns timestamptz language plpgsql immutable as $$
begin
  return v::timestamptz;
exception when others then
  return null;
end $$;

-- 3. Vue des données pour l'assistant : mêmes fiches que la table « records », sans les champs sensibles ni les
--    photos (trop lourdes), sans les tables techniques, et le journal d'activité limité aux 120 derniers jours.
create or replace view ai.data as
select r.tbl, r.id, r.rev, r.updated_at,
       case r.tbl
         when 'users'      then r.data - 'passwordHash' - 'secretAnswerHash' - 'secretQuestion' - '_f'
         when 'settings'   then r.data - 'logo' - '_f'
         when 'categories' then r.data - 'logo' - '_f'
         else r.data - 'photo' - 'photos' - '_f'
       end as data
from public.records r
where r.tbl not in ('syncConflicts', 'printJobs', 'printStations', 'devices', 'restorePoints')
  and not (r.tbl = 'audit' and r.updated_at < now() - interval '120 days');

-- 4. Rôle en lecture seule.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ai_reader') then create role ai_reader nologin; end if;
end $$;
grant ai_reader to current_user; -- le propriétaire (postgres) peut « devenir » ai_reader le temps d'une requête
grant usage on schema ai to ai_reader;
grant select on ai.data to ai_reader;
grant execute on function ai.ts(text) to ai_reader;
revoke all on ai.secrets from ai_reader;
