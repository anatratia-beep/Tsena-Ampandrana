-- TSENA — installation du cloud (à exécuter une seule fois dans Supabase > SQL Editor > New query > Run)
-- Toutes les données de l'application sont stockées dans la table "records".
-- Une modification plus ancienne n'écrase jamais une modification plus récente.

create sequence if not exists public.records_rev_seq;

create table if not exists public.records (
  tbl        text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null,
  device     text,
  rev        bigint      not null default nextval('public.records_rev_seq'),
  primary key (tbl, id)
);
create index if not exists records_rev_idx on public.records (rev);

create or replace function public.records_keep_latest()
returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return null; -- la version déjà dans le cloud est plus récente : on la garde
  end if;
  new.rev := nextval('public.records_rev_seq');
  return new;
end $$;

drop trigger if exists records_keep_latest on public.records;
create trigger records_keep_latest before update on public.records
  for each row execute function public.records_keep_latest();

-- Sauvegardes complètes conservées dans le cloud.
create table if not exists public.backups (
  id         uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  label      text,
  device     text,
  data       jsonb       not null
);

-- Sécurité : seuls les appareils connectés avec le compte de la société ont accès.
alter table public.records enable row level security;
alter table public.backups enable row level security;

drop policy if exists "records_company" on public.records;
create policy "records_company" on public.records for all to authenticated using (true) with check (true);

drop policy if exists "backups_company" on public.backups;
create policy "backups_company" on public.backups for all to authenticated using (true) with check (true);

-- Droits d'accès pour les appareils connectés (nécessaire sur les projets récents).
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.records to authenticated;
grant select, insert, update, delete on public.backups to authenticated;
grant usage, select on sequence public.records_rev_seq to authenticated;

-- Page de garantie publique : un client qui scanne le QR d'une pièce voit seulement le nom du produit,
-- la date d'achat et la fin de garantie (jamais le client, le prix ni le reste des données).
create or replace function public.warranty_lookup(p_serial text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'serial', s.data->>'serial',
    'status', s.data->>'status',
    'soldAt', case when s.data->>'status' = 'sold' then s.data->>'outAt' end,
    'product', p.data->>'name',
    'warrantyMonths', nullif(p.data->>'warrantyMonths', '')::numeric,
    'company', c.data->>'name',
    'phone', c.data->>'phone'
  )
  from public.records s
  left join public.records p on p.tbl = 'products' and p.id = s.data->>'productId'
  left join public.records c on c.tbl = 'settings' and c.id = 'company'
  where s.tbl = 'serials' and s.id = upper(trim(p_serial)) and coalesce((s.data->>'deleted')::boolean, false) = false
  limit 1
$$;
revoke all on function public.warranty_lookup(text) from public;
grant execute on function public.warranty_lookup(text) to anon, authenticated;
