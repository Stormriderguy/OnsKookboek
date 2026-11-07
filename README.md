# Ons Kookboek

Een gedeeld kookboek voor familie en vrienden. Iedereen die is uitgenodigd kan recepten toevoegen, bewerken en verwijderen, met foto's, en eigen favorieten bewaren.

De app draait op **Vercel**. De recepten, foto's en het inloggen zitten in **Supabase**.

## Eenmalig instellen

### 1. Supabase-project en database

1. Maak een project aan op [supabase.com](https://supabase.com).
2. Ga naar **SQL Editor → New query**, plak de hele inhoud van [`supabase/schema.sql`](supabase/schema.sql) en klik op **Run**.
   Je ziet "Success. No rows returned". Het script mag je veilig nog een keer draaien.

### 2. Toegang met één gezamenlijke code

Er is **één code** voor het hele kookboek. Jij geeft die aan familie en vrienden. Wie de code heeft, opent de app en vult de code, de **voornaam** en de **achternaam** in. Daarna blijft diegene op dat apparaat ingelogd; er is geen uitlogknop. Er zijn geen e-mails of wachtwoorden.

**Eenmalig instellen** in **Authentication → Sign In / Providers**:

1. Zet **Allow new users to sign up** aan.
2. Zet **Allow anonymous sign-ins** aan.

Dat lijkt open, maar zonder de code ziet niemand iets: de database laat alleen mensen die de juiste code hebben ingevuld bij de recepten.

**De code instellen of veranderen**: ga naar **SQL Editor → New query** en draai:

```sql
select public.set_access_code('Spaghetti-2026');
```

Kies zelf iets dat makkelijk te onthouden en lastig te raden is, minstens 6 letters of cijfers. Hoofdletters, spaties en streepjes maken bij het invullen niet uit. Verander je de code later, dan blijft iedereen die al binnen is gewoon binnen; alleen nieuwe mensen hebben de nieuwe code nodig.

**Wie is er binnen?**

```sql
select display_name from public.profiles order by display_name;
```

**Iemand de toegang afnemen**: zoek de persoon op bij **Authentication → Users** (te herkennen aan "Anonymous") en verwijder de gebruiker. Hun recepten blijven staan. Verander daarna de code, anders kan diegene opnieuw binnenkomen.

**Goed om te weten**:

- De inlog hoort bij het apparaat en de browser. Op een nieuw apparaat, of na het wissen van de browsergegevens, vult iemand gewoon opnieuw de code en **dezelfde** voor- en achternaam in. Dan komt diegene terug in zijn eigen account, met favorieten en de recepten op zijn naam. Op het oude apparaat moet diegene daarna opnieuw de code invullen.
- Dezelfde volledige naam betekent dus hetzelfde account. Wie de code heeft én iemands voor- en achternaam kent, kan als die persoon binnenkomen.
- **Een naam aanpassen** (bijvoorbeeld een tikfout): `update public.profiles set display_name = 'Riet de Vries' where display_name = 'Riet de vries';`
- **iPhone/iPad**: zet de app eerst op het beginscherm en vul de code dáár in. Safari en de app op het beginscherm onthouden je los van elkaar, en Safari wist gegevens van sites die je een week niet hebt bezocht.
- Na 10 foute codes op een apparaat blokkeert de app verdere pogingen vanaf dat apparaat.

### 3. Adres van de app

Ga naar **Authentication → URL Configuration** en vul bij **Site URL** het adres van de app op Vercel in: `https://onskookboek.vercel.app`.

### 4. Code op GitHub

De code staat in [github.com/Stormriderguy/OnsKookboek](https://github.com/Stormriderguy/OnsKookboek).

### 5. Vercel

1. Importeer de GitHub-repository in Vercel (**Add New → Project**). Kies bij **Application Preset** de optie **Vite**.
2. Ga naar **Settings → Environment Variables** en voeg toe, allebei als type **Config**, voor alle omgevingen:
   - `VITE_SUPABASE_URL`: de Project URL uit Supabase (knop **Connect**)
   - `VITE_SUPABASE_ANON_KEY` (of `VITE_SUPABASE_PUBLISHABLE_KEY`, zoals Supabase hem noemt): de **publishable**- of **anon**-sleutel uit Supabase
   - `VITE_SCAN_URL` (optioneel): het adres van de scanner op jullie eigen computer, zie [scanner/README.md](scanner/README.md). Laat je dit leeg, dan heeft de app geen scanknop.
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

## Recept scannen van een foto

In het receptformulier staat de knop **Recept scannen van foto**. De app stuurt de foto naar een AI-model (Ollama) op jullie eigen Linuxcomputer. Dat model leest het recept, ook bij pagina's met twee kolommen, en vult de naam, het aantal personen, de tijd, de ingrediënten en de stappen in. Controleer het resultaat altijd even.

- Het instellen van die computer staat in [scanner/README.md](scanner/README.md).
- Een scan duurt ongeveer 1 tot 3 minuten. Als iemand anders al aan het scannen is, wacht je even in de rij.
- Iedereen kan maximaal 30 foto's per dag laten lezen. Staat de computer uit, of is het maximum bereikt, dan meldt de app: "Er kunnen vandaag geen foto's meer worden verwerkt."
- Onder **Herkende tekst bekijken** staat alles wat gelezen is.

## Goed om te weten

- Foto's worden in de browser verkleind (maximaal 1600 px, JPEG) voordat ze worden geüpload. Zo blijft het ruim binnen de gratis 1 GB opslag van Supabase.
- Foto's zijn te zien voor wie de exacte link heeft. Recepten zelf zijn alleen zichtbaar na inloggen.
- Supabase pauzeert gratis projecten na een week zonder gebruik. Je kunt het project dan in het dashboard met één klik weer starten.
