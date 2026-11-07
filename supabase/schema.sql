-- Ons Kookboek: database, toegangscodes, beveiliging, foto-opslag en Realtime.
-- Plak dit hele script in Supabase → SQL Editor → New query, en klik op Run.
-- Je kunt het veilig nog een keer draaien, ook over een eerdere versie heen.
--
-- Hoe toegang werkt:
--   1. De eigenaar maakt een code:  select public.new_invite_code('voor Riet');
--   2. Die persoon opent de app, vult de code in en kiest zelf een naam.
--   3. De app logt anoniem in (Supabase "anonymous sign-in") en levert de code in.
--      Pas dan bestaat er een profiel, en alleen mensen met een profiel zien de recepten.

-- ============================================================
-- Tabellen
-- ============================================================

-- Weergavenamen (één per persoon, elke naam maar één keer)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null
);
create unique index if not exists profiles_display_name_uniek on public.profiles (lower(display_name));

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

-- Toegangscodes. Alleen de eigenaar (via de SQL Editor) kan hierbij; de app niet.
create table if not exists public.invite_codes (
  code text primary key,              -- opgeslagen zonder streepje, in hoofdletters
  note text default '',               -- voor wie de code bedoeld is
  created_at timestamptz default now(),
  used_by uuid references auth.users on delete set null,
  used_at timestamptz
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
-- Toegang: lid zijn, codes maken en inleveren
-- ============================================================

-- Lid = iemand die een code heeft ingeleverd en dus een profiel heeft.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- Nieuwe code voor de eigenaar, bijvoorbeeld 'K7PM-Q2XD'. Elke code werkt één keer.
create or replace function public.new_invite_code(p_note text default '')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- zonder I, L, O, 0, 1
  b bytea;
  c text;
begin
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    c := '';
    for i in 0..7 loop
      -- bytes 6 en 8 van een uuid zijn deels vast; die slaan we over
      c := c || substr(alphabet, 1 + get_byte(b, case when i < 6 then i else i + 3 end) % 31, 1);
    end loop;
    exit when not exists (select 1 from public.invite_codes where code = c);
  end loop;
  insert into public.invite_codes (code, note) values (c, coalesce(p_note, ''));
  return substr(c, 1, 4) || '-' || substr(c, 5, 4);
end;
$$;

-- Code inleveren en een naam kiezen. Lukt alleen met een ongebruikte code en een vrije naam.
create or replace function public.redeem_invite(p_code text, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  clean_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  if exists (select 1 from public.profiles where id = uid) then
    raise exception 'already_member';
  end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 40 then
    raise exception 'invalid_name';
  end if;
  if exists (select 1 from public.profiles where lower(display_name) = lower(clean_name)) then
    raise exception 'name_taken';
  end if;

  update public.invite_codes
     set used_by = uid, used_at = now()
   where code = clean_code and used_at is null;
  if not found then
    raise exception 'invalid_code';
  end if;

  insert into public.profiles (id, display_name) values (uid, clean_name);
  return clean_name;
exception
  -- Twee mensen kozen tegelijk dezelfde naam: alles terugdraaien, de code blijft geldig.
  when unique_violation then
    raise exception 'name_taken';
end;
$$;

revoke all on function public.new_invite_code(text) from public, anon, authenticated;
revoke all on function public.redeem_invite(text, text) from public, anon;
grant execute on function public.redeem_invite(text, text) to authenticated;
grant execute on function public.is_member() to authenticated;

-- ============================================================
-- Beveiliging (Row Level Security): alles alleen voor leden
-- ============================================================

alter table public.profiles     enable row level security;
alter table public.recipes      enable row level security;
alter table public.favorites    enable row level security;
alter table public.invite_codes enable row level security;  -- geen regels = de app kan er niet bij

-- recipes: leden mogen alles
drop policy if exists "recipes lezen"       on public.recipes;
drop policy if exists "recipes toevoegen"   on public.recipes;
drop policy if exists "recipes wijzigen"    on public.recipes;
drop policy if exists "recipes verwijderen" on public.recipes;

create policy "recipes lezen"       on public.recipes for select to authenticated using ((select public.is_member()));
create policy "recipes toevoegen"   on public.recipes for insert to authenticated with check ((select public.is_member()));
create policy "recipes wijzigen"    on public.recipes for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "recipes verwijderen" on public.recipes for delete to authenticated using ((select public.is_member()));

-- favorites: ieder lid alleen zijn eigen rijen
drop policy if exists "favorites eigen lezen"       on public.favorites;
drop policy if exists "favorites eigen toevoegen"   on public.favorites;
drop policy if exists "favorites eigen verwijderen" on public.favorites;

create policy "favorites eigen lezen"       on public.favorites for select to authenticated using (user_id = (select auth.uid()));
create policy "favorites eigen toevoegen"   on public.favorites for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_member()));
create policy "favorites eigen verwijderen" on public.favorites for delete to authenticated using (user_id = (select auth.uid()));

-- profiles: leden zien elkaars naam, ieder ziet zijn eigen profiel.
-- Aanmaken gaat alleen via redeem_invite; de naam wordt één keer gekozen.
drop policy if exists "profiles lezen"           on public.profiles;
drop policy if exists "profiles eigen toevoegen" on public.profiles;
drop policy if exists "profiles eigen wijzigen"  on public.profiles;

create policy "profiles lezen" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_member()));

-- ============================================================
-- Foto-opslag: bucket 'recipe-photos'
-- Lezen is openbaar (via de exacte link); uploaden en verwijderen alleen voor leden.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "foto's lezen ingelogd"       on storage.objects;
drop policy if exists "foto's uploaden ingelogd"    on storage.objects;
drop policy if exists "foto's verwijderen ingelogd" on storage.objects;
drop policy if exists "foto's lezen leden"          on storage.objects;
drop policy if exists "foto's uploaden leden"       on storage.objects;
drop policy if exists "foto's verwijderen leden"    on storage.objects;

-- Lezen is nodig zodat leden foto's ook kunnen verwijderen
create policy "foto's lezen leden"       on storage.objects for select to authenticated using (bucket_id = 'recipe-photos' and (select public.is_member()));
create policy "foto's uploaden leden"    on storage.objects for insert to authenticated with check (bucket_id = 'recipe-photos' and (select public.is_member()));
create policy "foto's verwijderen leden" on storage.objects for delete to authenticated using (bucket_id = 'recipe-photos' and (select public.is_member()));

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
