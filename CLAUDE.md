# Ons Kookboek – projectopdracht

## Korte beschrijving

Ons Kookboek is een gedeelde recepten-webapp voor familie en vrienden. Iedereen die is uitgenodigd kan recepten toevoegen, bewerken en verwijderen, met ingrediënten, bereidingsstappen en foto's. Ieder heeft eigen favorieten, en je kunt filteren op maaltijd en smaak en zoeken op naam of ingrediënt.

De app draait op **Vercel**, met **Supabase** voor de database, de foto-opslag en het inloggen. Er is een eerste versie gebouwd als Claude-artifact (`kookboek.html` in deze map). Gebruik die als referentie voor ontwerp en gedrag, maar bouw de app opnieuw op met de stack hieronder.

Alle tekst in de app is Nederlands.

## Stack

- Vite + React + TypeScript (single-page app, geen server-side rendering nodig)
- `@supabase/supabase-js` voor de database, opslag en inloggen
- Gewone CSS met design tokens (zie Ontwerp). Geen UI-framework nodig.
- Hosting op Vercel (Hobby-plan, persoonlijk gebruik), met automatisch online zetten vanuit GitHub
- Installeerbaar als app op de telefoon: een webmanifest met naam, kleuren en icoon

## Functies

1. **Recepten bekijken**: een raster met kaarten met foto, titel, labels en bereidingstijd. Als er geen foto is, toont de kaart een gekleurd vlak met de eerste letter.
2. **Recept openen**: een detailweergave met
   - een fotogalerij (swipen)
   - ingrediënten en genummerde bereidingsstappen
   - een personenteller: de hoeveelheden rekenen mee (komma als decimaalteken, ook breuken als `1/2`)
   - de regel "Toegevoegd door … op …" en "bijgewerkt door … op …"
3. **Recept toevoegen en bewerken** in één formulier met deze velden:
   - naam (verplicht) en korte omschrijving
   - maaltijd, meerdere mogelijk: Ontbijt, Lunch, Diner, Snack, Dessert, Bijgerecht
   - smaak, meerdere mogelijk: Zoet, Zout, Hartig, Pittig, Zuur, Fris
   - bereidingstijd in minuten en aantal personen
   - ingrediënten als rijen van hoeveelheid, eenheid en naam. Eenheden: g, kg, ml, dl, l, el, tl, snufje, stuk(s), teen, blik, bos, plak, kopje, naar smaak.
   - bereidingsstappen als losse regels; rijen en stappen kun je toevoegen en verwijderen
   - foto's: meerdere per recept
4. **Recept verwijderen**, met een bevestiging in de pagina zelf (geen `confirm()`). De foto's van het recept worden mee verwijderd.
5. **Favorieten per persoon**: een hartje op de kaart en in de detailweergave, en een filter "Favorieten".
6. **Zoeken en filteren**: zoeken op titel, omschrijving en ingrediënten; filteren op maaltijd (één tegelijk), smaak (meerdere, alle moeten kloppen) en favorieten; sorteren op nieuwste, A–Z of snelste.
7. **Live bijwerken**: als iemand anders iets toevoegt of wijzigt, zie je dat zonder te herladen (Supabase Realtime op de tabel `recipes`).

## Inloggen

- De eigenaar deelt eenmalige toegangscodes uit (`select public.new_invite_code('notitie');` in de SQL Editor). Geen e-mails of wachtwoorden.
- Wie een code heeft, vult in de app de code in en kiest zelf een naam (uniek, één keer gekozen). Technisch: Supabase anonymous sign-in, daarna de RPC `redeem_invite(code, naam)` die de code verbruikt en het profiel aanmaakt.
- Daarna blijft de persoon op dat apparaat ingelogd; er is geen uitlogknop (na uitloggen is een nieuwe code nodig).
- In Supabase staan "Allow new users to sign up" en "Allow anonymous sign-ins" aan. Toegang tot de gegevens loopt via `public.is_member()` (= heeft een profiel): alleen leden zien en wijzigen recepten, favorieten en foto's.
- De naam wordt getoond bij "Toegevoegd door".

## Datamodel (Supabase)

Lever dit op als `supabase/schema.sql`, dat de eigenaar in één keer in de SQL Editor kan plakken.

```sql
-- Weergavenamen
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null
);

-- Recepten
create table recipes (
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
  created_by uuid references auth.users,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users
);

-- Favorieten per persoon
create table favorites (
  user_id uuid references auth.users on delete cascade,
  recipe_id uuid references recipes on delete cascade,
  primary key (user_id, recipe_id)
);
```

Beveiliging (Row Level Security op alle tabellen):

- `recipes`: ingelogde gebruikers mogen lezen, toevoegen, wijzigen en verwijderen.
- `favorites`: iedere gebruiker mag alleen zijn eigen rijen lezen en schrijven.
- `profiles`: iedereen die is ingelogd mag lezen; ieder schrijft alleen zijn eigen profiel.
- Storage-bucket `recipe-photos`: alleen ingelogde gebruikers mogen uploaden en verwijderen. Lezen is openbaar, zodat foto's eenvoudig laden; wie de exacte link heeft, kan een foto zien.
- Zet Realtime aan voor de tabel `recipes`.

## Foto's

- Verklein foto's in de browser vóór het uploaden: maximaal 1600 px aan de langste kant, JPEG, kwaliteit 0,85. Zo blijft het binnen de gratis 1 GB opslag van Supabase.
- Toon een "Uploaden…"-tegel zolang een upload loopt, en blokkeer opslaan tot alle uploads klaar zijn.
- Als iemand een foto uit een recept haalt of het bewerken annuleert, verwijder dan de foto's die niet meer gebruikt worden uit de bucket.

## Ontwerp

Neem het ontwerp van `kookboek.html` over.

- **Kleuren**: basilicumgroen als hoofdkleur, saffraangeel voor smaaklabels en tomaatrood voor favorieten en verwijderen, op een licht groenig papierwit. Er is ook een donker thema dat de systeeminstelling volgt; de tokens staan bovenaan in `kookboek.html`.
- **Lettertypes**: Bricolage Grotesque voor koppen en Figtree voor tekst (Google Fonts).
- **Opbouw**: een vaste kopbalk met zoekveld, de knop "+ Recept" en een filterbalk die horizontaal scrolt. Recepten openen als een venster over de pagina.
- **Mobiel eerst**: alles moet goed werken op een telefoon van 375 px breed, zonder horizontaal scrollen.
- **Toegankelijkheid**: zichtbare focus, labels op alle velden, en rekening houden met `prefers-reduced-motion`.

## Omgevingsvariabelen

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Zet een `.env.example` in de repo. Echte sleutels horen niet in Git.

## Wat Claude Code moet opleveren

1. Een werkend Vite + React + TypeScript-project met alle functies hierboven.
2. `supabase/schema.sql` met tabellen, beveiligingsregels, de storage-bucket en de Realtime-instelling.
3. Een `README.md` in eenvoudig Nederlands met de stappen voor de eigenaar:
   - een Supabase-project aanmaken en het SQL-script draaien
   - aanmelden uitzetten en mensen uitnodigen
   - bij Authentication → URL Configuration het Vercel-adres als Site URL en Redirect URL invullen
   - de repo op GitHub zetten
   - het project in Vercel importeren en de twee omgevingsvariabelen invullen
4. Een webmanifest met icoon, zodat de app op de telefoon te installeren is.

## Klaar wanneer

- [ ] Met een geldige code en een zelfgekozen naam kom je erin en blijf je ingelogd; zonder geldige code zie je niets.
- [ ] Een recept met ingrediënten, stappen en twee foto's toevoegen, bewerken en verwijderen werkt.
- [ ] Een tweede gebruiker ziet een nieuw recept zonder te herladen.
- [ ] Favorieten zijn per persoon en blijven bewaard na opnieuw inloggen.
- [ ] De filters, het zoeken, het sorteren en de personenteller werken.
- [ ] De app werkt in een licht en een donker thema, en op een telefoon.
- [ ] `npm run build` slaagt zonder fouten, en de app draait op Vercel.

## Later aanpassen

De recepten en foto's staan in Supabase en niet in de code. Wijzigingen aan de app raken dus nooit de data. Elke push naar GitHub zet Vercel automatisch online, en in Vercel kun je met één klik terug naar een eerdere versie.
