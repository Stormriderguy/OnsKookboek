-- Ons Kookboek: database, beveiliging, foto-opslag en Realtime.
-- Plak dit hele script in Supabase → SQL Editor → New query, en klik op Run.
-- Je kunt het veilig nog een keer draaien.

-- ============================================================
-- Tabellen
-- ============================================================

-- Weergavenamen
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null
);

-- Recepten
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  meals text[] default '{}',
  tastes text[] default '{}',
  minutes int,
  servings int,
  ingredients jsonb default '[]',  -- [{qty, unit, name}]
  steps text[] default '{}',
  photos text[] default '{}',      -- paden in storage-bucket 'recipe-photos'
  created_at timestamptz default now(),
  created_by uuid references auth.users default auth.uid(),
  updated_at timestamptz default now(),
  updated_by uuid references auth.users default auth.uid()
);

-- Favorieten per persoon
create table if not exists public.favorites (
  user_id uuid references auth.users on delete cascade default auth.uid(),
  recipe_id uuid references public.recipes on delete cascade,
  primary key (user_id, recipe_id)
);

-- Bij elke wijziging: wie en wanneer automatisch bijwerken
create or replace function public.set_updated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.created_at := old.created_at;  -- aanmaakgegevens blijven altijd gelijk
  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists recipes_set_updated on public.recipes;
create trigger recipes_set_updated
  before update on public.recipes
  for each row execute function public.set_updated();

-- ============================================================
-- Beveiliging (Row Level Security)
-- ============================================================

alter table public.profiles  enable row level security;
alter table public.recipes   enable row level security;
alter table public.favorites enable row level security;

-- recipes: ingelogde gebruikers mogen alles
drop policy if exists "recipes lezen"      on public.recipes;
drop policy if exists "recipes toevoegen"  on public.recipes;
drop policy if exists "recipes wijzigen"   on public.recipes;
drop policy if exists "recipes verwijderen" on public.recipes;

create policy "recipes lezen"       on public.recipes for select to authenticated using (true);
create policy "recipes toevoegen"   on public.recipes for insert to authenticated with check (true);
create policy "recipes wijzigen"    on public.recipes for update to authenticated using (true) with check (true);
create policy "recipes verwijderen" on public.recipes for delete to authenticated using (true);

-- favorites: ieder alleen zijn eigen rijen
drop policy if exists "favorites eigen lezen"      on public.favorites;
drop policy if exists "favorites eigen toevoegen"  on public.favorites;
drop policy if exists "favorites eigen verwijderen" on public.favorites;

create policy "favorites eigen lezen"       on public.favorites for select to authenticated using (user_id = (select auth.uid()));
create policy "favorites eigen toevoegen"   on public.favorites for insert to authenticated with check (user_id = (select auth.uid()));
create policy "favorites eigen verwijderen" on public.favorites for delete to authenticated using (user_id = (select auth.uid()));

-- profiles: iedereen ingelogd mag lezen, ieder schrijft alleen zijn eigen profiel
drop policy if exists "profiles lezen"          on public.profiles;
drop policy if exists "profiles eigen toevoegen" on public.profiles;
drop policy if exists "profiles eigen wijzigen"  on public.profiles;

create policy "profiles lezen"           on public.profiles for select to authenticated using (true);
create policy "profiles eigen toevoegen" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles eigen wijzigen"  on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ============================================================
-- Foto-opslag: bucket 'recipe-photos'
-- Lezen is openbaar (via de exacte link); uploaden en verwijderen alleen ingelogd.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "foto's lezen ingelogd"      on storage.objects;
drop policy if exists "foto's uploaden ingelogd"   on storage.objects;
drop policy if exists "foto's verwijderen ingelogd" on storage.objects;

-- Nodig zodat ingelogde gebruikers foto's ook kunnen verwijderen
create policy "foto's lezen ingelogd"       on storage.objects for select to authenticated using (bucket_id = 'recipe-photos');
create policy "foto's uploaden ingelogd"    on storage.objects for insert to authenticated with check (bucket_id = 'recipe-photos');
create policy "foto's verwijderen ingelogd" on storage.objects for delete to authenticated using (bucket_id = 'recipe-photos');

-- ============================================================
-- Realtime: wijzigingen in recepten live doorsturen
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recipes'
  ) then
    alter publication supabase_realtime add table public.recipes;
  end if;
end;
$$;
