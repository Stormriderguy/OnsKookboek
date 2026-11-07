# Ons Kookboek

Een gedeeld kookboek voor familie en vrienden. Iedereen die is uitgenodigd kan recepten toevoegen, bewerken en verwijderen, met foto's, en eigen favorieten bewaren.

De app draait op **Vercel**. De recepten, foto's en het inloggen zitten in **Supabase**.

## Eenmalig instellen

### 1. Supabase-project en database

1. Maak een project aan op [supabase.com](https://supabase.com).
2. Ga naar **SQL Editor → New query**, plak de hele inhoud van [`supabase/schema.sql`](supabase/schema.sql) en klik op **Run**.
   Je ziet "Success. No rows returned". Het script mag je veilig nog een keer draaien.

### 2. Alleen mensen die jij toevoegt

Iedereen logt in met een **naam** en een **code** die jij uitdeelt. Er worden geen e-mails verstuurd.

1. Ga naar **Authentication → Sign In / Providers**.
2. Zet **Allow new users to sign up** uit. Laat **Email** aan (inloggen met naam en code loopt daarlangs).

**Iemand toevoegen** (ook jezelf):

1. Ga naar **Authentication → Users → Add user → Create new user**.
2. **Email**: de naam gevolgd door `@onskookboek.app`, bijvoorbeeld `riet@onskookboek.app`.
   Gebruik kleine letters, zonder spaties (een streepje mag: `oma-riet@onskookboek.app`). Dit is geen echt e-mailadres; er komt nooit mail naartoe.
3. **Password**: de code die je aan die persoon geeft. Minimaal 6 tekens; liever 8 of meer, bijvoorbeeld `tulp-48-appel`.
4. Vink **Auto Confirm User** aan en klik op **Create user**.

Geef de persoon de naam (`riet`) en de code. Bij de eerste keer inloggen kiest diegene de naam die bij de recepten komt te staan.

**Code kwijt of iemand weghalen**: zoek de persoon op bij **Authentication → Users**. Via ⋯ kun je een nieuw wachtwoord (code) instellen of de gebruiker verwijderen. Hun recepten blijven staan.

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
