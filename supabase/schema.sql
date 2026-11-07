-- Ons Kookboek: database, toegangscode, beveiliging, foto-opslag en Realtime.
-- Plak dit hele script in Supabase → SQL Editor → New query, en klik op Run.
-- Je kunt het veilig nog een keer draaien, ook over een eerdere versie heen.
--
-- Hoe toegang werkt:
--   1. De eigenaar stelt één gezamenlijke code in:  select public.set_access_code('jouw-code');
--   2. Iedereen die de code heeft gekregen, opent de app, vult de code in en kiest zelf een naam.
--   3. De app logt anoniem in (Supabase "anonymous sign-in") en controleert de code.
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

-- De gezamenlijke toegangscode (precies één rij). Alleen de eigenaar (via de SQL Editor) kan hierbij.
create table if not exists public.access_code (
  id boolean primary key default true check (id),
  code text not null,                 -- opgeslagen in hoofdletters, zonder spaties en streepjes
  updated_at timestamptz default now()
);

-- Mislukte pogingen per apparaat, zodat niemand eindeloos codes kan raden.
create table if not exists public.join_attempts (
  user_id uuid primary key references auth.users on delete cascade,
  failures int not null default 0,
  last_at timestamptz default now()
);

-- Opruimen van de vorige opzet (een losse code per persoon)
drop function if exists public.redeem_invite(text, text);
drop function if exists public.new_invite_code(text);
drop table if exists public.invite_codes;

-- Bij elke wijziging: wie en wanneer automatisch bijwerken
create or replace function public.set_updated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Tijdens het overzetten van een account naar een nieuw apparaat niets aanpassen.
  if coalesce(current_setting('ons.reassigning', true), '') = 'on' then
    return new;
  end if;
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

-- De naam van wie het recept plaatste (en het laatst wijzigde) staat in het recept zelf.
alter table public.recipes add column if not exists created_by_name text;
alter table public.recipes add column if not exists updated_by_name text;

create or replace function public.set_author_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('ons.reassigning', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by_name := (select display_name from public.profiles where id = coalesce(new.created_by, auth.uid()));
    new.updated_by_name := new.created_by_name;
  else
    new.created_by_name := old.created_by_name;
    new.updated_by_name := (select display_name from public.profiles where id = auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists recipes_set_author_names on public.recipes;
create trigger recipes_set_author_names
  before insert or update on public.recipes
  for each row execute function public.set_author_names();

-- Past de eigenaar een naam aan (bijv. een tikfout), dan verandert die ook in de recepten.
create or replace function public.rename_in_recipes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_name is distinct from old.display_name then
    perform set_config('ons.reassigning', 'on', true);
    update public.recipes set created_by_name = new.display_name where created_by = new.id;
    update public.recipes set updated_by_name = new.display_name where updated_by = new.id;
    perform set_config('ons.reassigning', 'off', true);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_rename_in_recipes on public.profiles;
create trigger profiles_rename_in_recipes
  after update of display_name on public.profiles
  for each row execute function public.rename_in_recipes();

-- Bestaande recepten aanvullen met de naam (zonder 'bijgewerkt op' te veranderen)
select set_config('ons.reassigning', 'on', false);
update public.recipes r set created_by_name = p.display_name
  from public.profiles p where p.id = r.created_by and r.created_by_name is distinct from p.display_name;
update public.recipes r set updated_by_name = p.display_name
  from public.profiles p where p.id = r.updated_by and r.updated_by_name is distinct from p.display_name;
select set_config('ons.reassigning', 'off', false);

-- ============================================================
-- Toegang: lid zijn, de code instellen en binnenkomen
-- ============================================================

-- Lid = iemand die de code heeft ingevuld en dus een profiel heeft.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- Voor de eigenaar: de gezamenlijke code instellen of veranderen.
-- Hoofdletters, spaties en streepjes maken niet uit. Wie al binnen is, blijft binnen.
create or replace function public.set_access_code(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if char_length(clean) < 6 then
    raise exception 'De code moet minstens 6 letters of cijfers hebben.';
  end if;
  insert into public.access_code (id, code) values (true, clean)
  on conflict (id) do update set code = excluded.code, updated_at = now();
  return 'Code ingesteld';
end;
$$;

-- Binnenkomen: code controleren en je voor- en achternaam invullen.
-- Bestaat die naam al (bijvoorbeeld op een nieuw apparaat), dan neem je dat account over,
-- met favorieten en de recepten die op die naam staan.
-- Geeft {ok: true, name} terug, of {ok: false, error}. Na 10 foute codes is dit apparaat geblokkeerd.
create or replace function public.join_cookbook(p_code text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  clean_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  existing text;
  old_id uuid;
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;

  select display_name into existing from public.profiles where id = uid;
  if existing is not null then
    return jsonb_build_object('ok', true, 'name', existing);
  end if;

  if coalesce((select failures from public.join_attempts where user_id = uid), 0) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  if not exists (select 1 from public.access_code where code = clean_code) then
    insert into public.join_attempts (user_id, failures) values (uid, 1)
    on conflict (user_id) do update set failures = public.join_attempts.failures + 1, last_at = now();
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  if char_length(clean_name) < 3 or char_length(clean_name) > 80 then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  -- Deze naam bestaat al: zet dat account over naar dit apparaat.
  select id into old_id from public.profiles where lower(display_name) = lower(clean_name);
  if old_id is not null then
    perform set_config('ons.reassigning', 'on', true);
    update public.favorites set user_id = uid where user_id = old_id;
    update public.recipes set created_by = uid where created_by = old_id;
    update public.recipes set updated_by = uid where updated_by = old_id;
    update public.profiles set id = uid where id = old_id returning display_name into existing;
    perform set_config('ons.reassigning', 'off', true);
    delete from public.join_attempts where user_id = uid;
    return jsonb_build_object('ok', true, 'name', existing, 'returning', true);
  end if;

  begin
    insert into public.profiles (id, display_name) values (uid, clean_name);
  exception
    -- Twee mensen kozen op hetzelfde moment dezelfde naam.
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'name_taken');
  end;
  delete from public.join_attempts where user_id = uid;
  return jsonb_build_object('ok', true, 'name', clean_name);
end;
$$;

revoke all on function public.set_access_code(text) from public, anon, authenticated;
revoke all on function public.join_cookbook(text, text) from public, anon;
grant execute on function public.join_cookbook(text, text) to authenticated;
grant execute on function public.is_member() to authenticated;

-- ============================================================
-- Beveiliging (Row Level Security): alles alleen voor leden
-- ============================================================

alter table public.profiles     enable row level security;
alter table public.recipes      enable row level security;
alter table public.favorites    enable row level security;
alter table public.access_code   enable row level security;  -- geen regels = de app kan er niet bij
alter table public.join_attempts enable row level security;  -- idem

-- recipes: alle leden mogen lezen en toevoegen; alleen wie het recept plaatste, mag het wijzigen of verwijderen
drop policy if exists "recipes lezen"       on public.recipes;
drop policy if exists "recipes toevoegen"   on public.recipes;
drop policy if exists "recipes wijzigen"    on public.recipes;
drop policy if exists "recipes verwijderen" on public.recipes;

create policy "recipes lezen"       on public.recipes for select to authenticated using ((select public.is_member()));
create policy "recipes toevoegen"   on public.recipes for insert to authenticated
  with check ((select public.is_member()) and created_by = (select auth.uid()));
create policy "recipes wijzigen"    on public.recipes for update to authenticated
  using ((select public.is_member()) and created_by = (select auth.uid()))
  with check ((select public.is_member()) and created_by = (select auth.uid()));
create policy "recipes verwijderen" on public.recipes for delete to authenticated
  using ((select public.is_member()) and created_by = (select auth.uid()));

-- favorites: ieder lid alleen zijn eigen rijen
drop policy if exists "favorites eigen lezen"       on public.favorites;
drop policy if exists "favorites eigen toevoegen"   on public.favorites;
drop policy if exists "favorites eigen verwijderen" on public.favorites;

create policy "favorites eigen lezen"       on public.favorites for select to authenticated using (user_id = (select auth.uid()));
create policy "favorites eigen toevoegen"   on public.favorites for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_member()));
create policy "favorites eigen verwijderen" on public.favorites for delete to authenticated using (user_id = (select auth.uid()));

-- profiles: leden zien elkaars naam, ieder ziet zijn eigen profiel.
-- Aanmaken gaat alleen via join_cookbook; de naam wordt één keer gekozen.
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
