# Ons Kookboek

Een gedeeld kookboek voor familie en vrienden. Iedereen die is uitgenodigd kan recepten toevoegen, bewerken en verwijderen, met foto's, en eigen favorieten bewaren.

De app draait op **Vercel**. De recepten, foto's en het inloggen zitten in **Supabase**.

## Eenmalig instellen

### 1. Supabase-project en database

1. Maak een project aan op [supabase.com](https://supabase.com).
2. Ga naar **SQL Editor → New query**, plak de hele inhoud van [`supabase/schema.sql`](supabase/schema.sql) en klik op **Run**.
   Je ziet "Success. No rows returned". Het script mag je veilig nog een keer draaien.

### 2. Toegang met codes

Jij deelt **codes** uit. Wie een code heeft, opent de app, vult de code in en **kiest zelf een naam**. Daarna blijft diegene op dat apparaat ingelogd. Er zijn geen e-mails of wachtwoorden.

**Eenmalig instellen** in **Authentication → Sign In / Providers**:

1. Zet **Allow new users to sign up** aan.
2. Zet **Allow anonymous sign-ins** aan.

Dat lijkt open, maar zonder geldige code ziet niemand iets: de database laat alleen mensen met een ingeleverde code bij de recepten.

**Een code maken**: ga naar **SQL Editor → New query** en draai:

```sql
select public.new_invite_code('voor Riet');
```

Je krijgt een code als `K7PM-Q2XD`. Geef die aan de persoon. Elke code werkt één keer. De tekst tussen de haakjes is alleen een notitie voor jezelf.

**Overzicht van alle codes en wie ze gebruikt heeft**:

```sql
select c.code, c.note, c.created_at, p.display_name as gebruikt_door, c.used_at
from public.invite_codes c
left join public.profiles p on p.id = c.used_by
order by c.created_at desc;
```

**Een ongebruikte code intrekken**: `delete from public.invite_codes where code = 'K7PMQ2XD';` (zonder streepje).

**Iemand de toegang afnemen**: zoek de persoon op bij **Authentication → Users** (te herkennen aan "Anonymous") en verwijder de gebruiker. Hun recepten blijven staan.

**Goed om te weten**:

- De inlog hoort bij het apparaat en de browser. Op een nieuw apparaat, of na het wissen van de browsergegevens, is een nieuwe code nodig. Die persoon kiest dan een andere naam, of jij haalt eerst de oude gebruiker weg zodat de naam weer vrij is.
- **iPhone/iPad**: zet de app eerst op het beginscherm en vul de code dáár in. Safari en de app op het beginscherm delen de inlog niet, en Safari wist gegevens van sites die je een week niet hebt bezocht.

### 3. Adres van de app

Ga naar **Authentication → URL Configuration** en vul bij **Site URL** het adres van de app op Vercel in: `https://onskookboek.vercel.app`.

### 4. Code op GitHub

De code staat in [github.com/Stormriderguy/OnsKookboek](https://github.com/Stormriderguy/OnsKookboek).

### 5. Vercel

1. Importeer de GitHub-repository in Vercel (**Add New → Project**). Kies bij **Application Preset** de optie **Vite**.
2. Ga naar **Settings → Environment Variables** en voeg toe, allebei als type **Config**, voor alle omgevingen:
   - `VITE_SUPABASE_URL`: de Project URL uit Supabase (knop **Connect**)
   - `VITE_SUPABASE_ANON_KEY` (of `VITE_SUPABASE_PUBLISHABLE_KEY`, zoals Supabase hem noemt): de **publishable**- of **anon**-sleutel uit Supabase
3. Start een nieuwe deploy (**Deployments → ⋯ → Redeploy**), zodat de sleutels worden meegenomen.

Gebruik nooit de `service_role`- of `secret`-sleutel: die geeft volledige toegang tot de database.

## De app op je telefoon zetten

Open het adres van de app op je telefoon.

- **iPhone (Safari)**: tik op Delen → **Zet op beginscherm**.
- **Android (Chrome)**: tik op ⋮ → **App installeren** of **Toevoegen aan startscherm**.

## Op je eigen computer werken

Nodig: [Node.js](https://nodejs.org) (LTS).

1. Kopieer `.env.example` naar `.env` en vul dezelfde twee waarden in als in Vercel.
2. Draai `npm install` en daarna `npm run dev`.
3. Open `http://localhost:5173`.

`npm run build` controleert de code en maakt de versie die online gaat.

## Later aanpassen

De recepten en foto's staan in Supabase, niet in de code. Wijzigingen aan de app raken de gegevens dus nooit.
Elke push naar de branch `main` op GitHub zet Vercel automatisch online. In Vercel kun je bij **Deployments** met één klik terug naar een eerdere versie (**Promote** / **Instant Rollback**).

## Goed om te weten

- Foto's worden in de browser verkleind (maximaal 1600 px, JPEG) voordat ze worden geüpload. Zo blijft het ruim binnen de gratis 1 GB opslag van Supabase.
- Foto's zijn te zien voor wie de exacte link heeft. Recepten zelf zijn alleen zichtbaar na inloggen.
- Supabase pauzeert gratis projecten na een week zonder gebruik. Je kunt het project dan in het dashboard met één klik weer starten.
