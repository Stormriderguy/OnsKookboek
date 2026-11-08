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
2. Ga naar **Settings → Environment Variables** en voeg toe:
   - `VITE_SUPABASE_URL`: de Project URL uit Supabase (knop **Connect**)
   - `VITE_SUPABASE_ANON_KEY` (of `VITE_SUPABASE_PUBLISHABLE_KEY`, zoals Supabase hem noemt): de **publishable**- of **anon**-sleutel uit Supabase
   - `ANTHROPIC_API_KEY`: de API-sleutel van Claude voor het scannen (maken op console.anthropic.com → **API Keys**). Alleen voor **Production**, en zet **Sensitive** aan. Deze naam begint bewust niet met `VITE_`: zo blijft de sleutel op de server van Vercel en komt hij nooit in de browser.
   - `SUPABASE_SECRET_KEY`: de **geheime** sleutel van Supabase (Project Settings → API Keys → Secret keys, begint met `sb_secret_`). Alleen voor de wekelijkse PDF: daarmee leest de functie alle recepten en slaat ze de PDF op. Alleen **Production**, **Sensitive** aan. Nooit met `VITE_` ervoor en nooit in de app of in Git.
   - `CRON_SECRET`: een zelfbedacht lang wachtwoord (bijvoorbeeld 30 willekeurige letters en cijfers). Vercel stuurt het mee als het de wekelijkse taak start, zodat niemand anders die kan starten. Alleen **Production**, **Sensitive** aan.
   - `PEXELS_API_KEY` (optioneel): sleutel van pexels.com/api, als extra bron voor een passende foto naast Openverse. Pexels gaf in november 2026 geen nieuwe sleutels uit; zonder deze sleutel werkt alles gewoon.
3. Start een nieuwe deploy (**Deployments → ⋯ → Redeploy**), zodat de sleutels worden meegenomen.

Gebruik nooit de `service_role`- of `secret`-sleutel: die geeft volledige toegang tot de database.

## Kookboek als PDF, delen en kopiëren

- **Het hele kookboek als PDF:** elke maandagnacht maakt Vercel automatisch een PDF van alle recepten (voorblad, inhoudsopgave, per recept een pagina met een kleine foto). Alleen de nieuwste wordt bewaard, in Supabase (map `kookboek-pdf`, alleen voor leden). Downloaden kan in het menu **Filters** → **Kookboek als PDF**. Met **Nu bijwerken** maak je hem meteen opnieuw (hooguit eens per 10 minuten).
- **Eén recept delen of afdrukken:** in een recept staat **Delen of afdrukken**. Op de telefoon opent het deelmenu (WhatsApp, mail, afdrukken …); op de computer wordt de PDF gedownload.
- **Recepten passen op één pagina:** is een recept lang, dan wordt de foto kleiner en komen ingrediënten en bereiding naast elkaar te staan. Alleen een heel lang recept loopt door op een volgende pagina.
- **Kopiëren:** met **Kopiëren** maak je een eigen versie van een recept van iemand anders. Je past aan wat je wilt en slaat het op als nieuw recept op je eigen naam; het origineel blijft zoals het is. De foto's worden mee gekopieerd.

Voor de PDF moet `supabase/schema.sql` één keer opnieuw gedraaid worden (nieuwe map `kookboek-pdf`), en moeten `SUPABASE_SECRET_KEY` en `CRON_SECRET` in Vercel staan (zie hierboven).

## Dag- en nachtmodus

De app volgt de instelling van je telefoon (licht of donker). Met het maantje of zonnetje rechtsboven kies je het zelf; dat onthoudt de app op dat apparaat.

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

## Categorieën

Een recept kan labels krijgen in vier groepen: **Maaltijd** (ontbijt, diner, …), **Smaak** (zoet, hartig, …), **Soort gerecht** (soep, taart & cake, …) en **Hoofdingrediënt** (vlees, vis, vegetarisch, …). In het filtermenu kun je op elke groep filteren. De lijsten staan in `src/types.ts`; wil je er woorden bij, pas ze daar aan (en in `api/scan.ts`, zodat het scannen ze ook kent).

Na het toevoegen van Soort gerecht en Hoofdingrediënt moet `supabase/schema.sql` één keer opnieuw gedraaid worden (SQL Editor → plakken → Run).

## Recept scannen van een foto

In het receptformulier staat de knop **Recept scannen van foto**. De app stuurt de foto naar een kleine functie op Vercel (`api/scan.ts`), die hem laat lezen door Claude Haiku. Die leest het recept, ook bij pagina's met twee kolommen, en vult de naam, het aantal personen, de tijd, de ingrediënten en de stappen in. Controleer het resultaat altijd even.

- Een scan duurt ongeveer 10 seconden en kost ongeveer 0,15 cent per foto.
- Staat een recept op meer pagina's, maak dan eerst alle foto's: na de eerste foto kun je met **+ Nog een foto** de volgende pagina toevoegen (maximaal 4). Druk daarna op **Recept lezen**: de foto's worden samen gelezen als één recept. Je kunt ook later nog een foto scannen. Ingrediënten en stappen die al in het formulier staan, worden niet nog eens toegevoegd. Hetzelfde ingrediënt met een andere hoeveelheid blijft wel staan, want dat kan echt twee keer in een recept voorkomen.
- Nodig: `ANTHROPIC_API_KEY` in Vercel (zie hierboven) en tegoed op console.anthropic.com. Zet daar bij **Limits** een maandlimiet, bijvoorbeeld $5.
- Iedereen kan maximaal 100 foto's per dag laten lezen (bijgehouden in Supabase, functie `use_scan`). Is het maximum bereikt, of is Claude niet bereikbaar, dan meldt de app: "Er kunnen vandaag geen foto's meer worden verwerkt."
- Staat er op een gescande foto ook een afbeelding van het gerecht zelf, dan wordt die uitgeknipt en bij de foto's van het recept gezet (als eerste, als het recept nog geen foto had). Hij wordt zo klein mogelijk opgeslagen: maximaal 900 pixels, als WebP, meestal 30 à 50 kB. Een smal randje of een heel klein plaatje wordt overgeslagen. Is de uitsnede niet goed, haal hem dan weg met het kruisje.
- Staat een foto op zijn kant, op zijn kop of schuin, dan wordt hij eerst rechtgezet. Pas daarna wordt hij gelezen.
- Is een recept met de hand geschreven, dan schrijft Claude Opus de tekst eerst uit (Opus leest handschrift het best) en vult Haiku daarmee het formulier in. Een handgeschreven scan kost zo ±2 à 3 cent, een gedrukte ±0,2 cent.
- Claude zoekt bij het lezen ook uit welk gerecht het is (bijvoorbeeld dat arretjescake in het Engels "hedgehog slice" heet) en hoe het eruitziet.
- Alleen als er op de gescande foto's géén afbeelding van het gerecht staat, en het recept ook nog geen foto heeft, zoekt de app een passende foto en zet die er klein bij. Hij haalt een paar kandidaten op en Claude kiest de foto die echt dat gerecht laat zien; past er geen, dan komt er geen foto bij. Eerst via Openverse: foto's van heel internet (vooral Flickr) die vrij gebruikt mogen worden, zonder sleutel. Staat er een Pexels-sleutel in Vercel, dan zoekt Pexels mee. De melding noemt de maker en de licentie (bijvoorbeeld CC BY 2.0): die naamsvermelding hoort bij deze foto's. Past de foto niet, haal hem dan weg met het kruisje. Openverse heeft geen sleutel nodig. Geeft Openverse geen antwoord, dan komt er geen foto bij; de reden staat dan in het logboek van Vercel.
- Bij het scannen stelt Claude ook categorieën voor (maaltijd, smaak, soort en hoofdingrediënt), maar alleen voor een groep waar je zelf nog niets hebt aangevinkt.
- Onder **Herkende tekst bekijken** staat alles wat gelezen is.
- De map `scanner/` is de oude scanner via Ollama op een eigen Linuxcomputer. Die is niet meer nodig.
- Bij `npm run dev` op je eigen computer werkt scannen niet (de functie draait alleen op Vercel).

## Goed om te weten

- Foto's worden in de browser verkleind (maximaal 1600 px, JPEG) voordat ze worden geüpload. Zo blijft het ruim binnen de gratis 1 GB opslag van Supabase.
- Foto's zijn te zien voor wie de exacte link heeft. Recepten zelf zijn alleen zichtbaar na inloggen.
- Supabase pauzeert gratis projecten na een week zonder gebruik. Je kunt het project dan in het dashboard met één klik weer starten.
