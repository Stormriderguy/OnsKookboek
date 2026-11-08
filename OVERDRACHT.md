# Overdracht Ons Kookboek (stand 8 november 2026)

Lees ook `CLAUDE.md` (projectopdracht) en `README.md` (stappen voor de eigenaar).

## Waar alles staat
- **Code:** `C:\Users\marcel\Claude\OnsKookboek`, GitHub `Stormriderguy/OnsKookboek` (branch `main`).
- **Live app:** https://onskookboek.vercel.app. Vercel-team "santifort" (Hobby), project `onskookboek`, preset Vite. Elke push naar `main` zet de app automatisch online.
- **Supabase:** project `tawzjhnropjocehnkopx`. In Vercel staan `VITE_SUPABASE_URL` en `VITE_SUPABASE_PUBLISHABLE_KEY`; de app accepteert ook `VITE_SUPABASE_ANON_KEY`. Lokaal staan ze in `.env` (genegeerd door Git).
- **Git-identiteit:** Marcel <m.santifort@live.nl>.

## Werkafspraken op deze computer
- Git staat niet in PATH: gebruik `C:\Program Files\Git\cmd\git.exe`. Node staat in `C:\Program Files\nodejs` (in PowerShell eerst `$env:Path = "C:\Program Files\nodejs;" + $env:Path`).
- **Pushen** vraagt een interactieve GitHub-login, dus push via een terminaltab, niet via de gewone shell.
- Lokaal testen: dev-server via `.claude/launch.json` ("dev", poort 5173).
- Opmaak testen zonder in te loggen: tijdelijk `?demo` inbouwen met nepdata in `App.tsx` en `Cookbook.tsx`, en die regels (gemarkeerd met `TEMP-DEMO`) vóór de commit weer weghalen.
- Na elke wijziging aan `supabase/schema.sql` moet de eigenaar dat script opnieuw draaien in Supabase (SQL Editor → Run). Het script kan veilig opnieuw draaien; als resultaat verschijnt "off".

## Stack en opbouw
Vite + React + TypeScript, gewone CSS met design tokens (basilicumgroen, licht en donker thema), `@supabase/supabase-js`, en `@anthropic-ai/sdk` voor het scannen (alleen in de Vercel-functie).
- `src/App.tsx`: sessie en profiel; toont het codescherm (`Join`) of het kookboek (`Cookbook`).
- `src/components/Join.tsx`: gezamenlijke code + voornaam + achternaam.
- `src/components/Cookbook.tsx`: kopbalk, live recepten (Realtime), favorieten, filters en zoeken, kaarten.
- `src/components/FilterMenu.tsx`: uitklapmenu rechtsboven; op de telefoon over de volle breedte met inklapbare kopjes (+/−).
- `src/components/RecipeDetail.tsx` en `RecipeEditor.tsx`: recept bekijken, en toevoegen/bewerken met foto's en de scanknop.
- `api/scan.ts`: Vercel-functie die een receptfoto laat lezen door Claude Haiku 5.5. `src/aiScan.ts` roept hem aan, `normalizeParsed` in `src/parseRecipe.ts` maakt het resultaat passend.
- `supabase/schema.sql`: tabellen, beveiliging, toegangscode, foto-opslag en Realtime.

## Toegang en inloggen (zo gewenst door de gebruiker)
- **Eén gezamenlijke code** voor iedereen. De eigenaar stelt die in met `select public.set_access_code('...');`.
- In de app: code + **voornaam en achternaam** invullen. Er wordt anoniem ingelogd bij Supabase, en de RPC `join_cookbook` controleert de code en maakt het profiel aan. Na 10 foute codes is dat apparaat geblokkeerd.
- **Dezelfde volledige naam = hetzelfde account.** Wie op een nieuw apparaat binnenkomt met een bestaande naam, neemt dat account over, met favorieten en recepten.
- **Geen uitlogknop.** De gebruiker blijft ingelogd op het apparaat.
- In Supabase staan "Allow new users to sign up" en "Allow anonymous sign-ins" aan.
- Alleen leden (`public.is_member()`) zien en wijzigen gegevens.

## Wat de app kan
- Recepten in een raster: 2 kolommen op de telefoon, 3 op de iPad staand, 4 liggend en op de computer.
- Detailweergave met fotogalerij, personenteller die de hoeveelheden omrekent, en "Toegevoegd door … op …".
- De naam van wie een recept plaatst, wordt in het recept zelf opgeslagen (`created_by_name`), en staat op elke kaart ("door …").
- **Alleen wie een recept plaatste, mag het bewerken en verwijderen**, in de app én in de database. De gebruiker bevestigde ook verwijderen voor alleen de plaatser.
- Filters in het menu rechtsboven: favorieten, maaltijd, smaak, **Toegevoegd door**, sorteren. Actieve filters staan als knopjes onder de kopbalk.
- Het aantal recepten volgt filters en zoeken; op de telefoon staat het rechts uitgelijnd.
- Telefoonindeling: titel bovenaan, daaronder Filters en + Recept naast elkaar, daaronder de zoekbalk.
- Foto's worden verkleind voor het uploaden; ongebruikte foto's worden opgeruimd.
- Te installeren op de telefoon (webmanifest en iconen); geen inzoomen op iPhone bij het typen.

## Scannen met Claude Haiku (gekozen 8 nov 2026)
De gebruiker wil de Linuxcomputer niet meer gebruiken. Ollama (±3½ min per scan) is vervangen door Claude Haiku 5.5 via een Vercel-functie.
- **Proef 8 nov 2026** (omeletfoto, twee kolommen): titel, alle 11 ingrediënten en 3 stappen correct in ±8 s, ±0,15 cent per scan. Effort `low` en `medium` gaven precies hetzelfde resultaat; de functie gebruikt `low`.
- `api/scan.ts`: POST met de foto als body en het Supabase-token. Roept eerst `rpc/use_scan` aan (lid + daglimiet 100, telt meteen één scan), dan Claude met structured output (zelfde opdracht en schema als de oude scanner). Bij een fout `rpc/refund_scan`. Antwoorden: 200 recept, 401, 413/415/422 (foto onleesbaar → "mislukt"), 429 limiet, 503 (→ "Er kunnen vandaag geen foto's meer worden verwerkt").
- Omgevingsvariabelen in Vercel: `ANTHROPIC_API_KEY` (Production, Sensitive; door de gebruiker toegevoegd 8 nov 2026). De functie leest ook `VITE_SUPABASE_URL` en `VITE_SUPABASE_PUBLISHABLE_KEY`/`VITE_SUPABASE_ANON_KEY`.
- `supabase/schema.sql` kreeg de tabel `scan_usage` en de functies `use_scan()` en `refund_scan()`. **De eigenaar moet het script opnieuw draaien**, anders geeft elke scan de melding dat er vandaag niets meer kan.
- De app toont de scanknop nu altijd. De Linuxcomputer (Ollama, poortwachter, Tailscale Funnel) is niet meer nodig en kan uit; de map `scanner/` kan uit de repo.
- **Meerdere foto's per scan** (maximaal 4, pagina's van één recept): in het formulier gaan gemaakte foto's eerst als tegeltjes in het scanblok (`pending` in `RecipeEditor.tsx`); met "+ Nog een foto" komt de volgende pagina erbij, en pas "Recept lezen" stuurt ze samen. Mislukt het lezen, dan blijven de foto's staan. Technisch: de app stuurt JSON `{ images: [{ type, data }] }` (1600 px, bij 3-4 foto's 1400 px; Vercel-limiet 4,5 MB, de functie weigert boven 4,4 MB). Claude krijgt dan een extra opdracht (`MORE_PAGES`) om alles als één recept te lezen. Telt als één scan voor de daglimiet.
- **Geen dubbelen:** `mergeIngredients` en `mergeSteps` in `src/parseRecipe.ts` voegen het resultaat samen met wat al in het formulier staat. Ingrediënt dubbel = zelfde naam (zonder hoofdletters/accenten, meervoud-en/-s weg) en zelfde hoeveelheid, of een van beide zonder hoeveelheid. Stap dubbel = zelfde tekst, of een stuk van ≥30 tekens dat in een langere stap staat (de langere blijft). De melding zegt hoeveel er is overgeslagen.
- **Foto van het gerecht:** het schema heeft `dish_photo` {photo (1-based, 0 = geen), left/top/right/bottom in %}. `normalizeParsed` maakt er `dishPhoto` van (index 0-based, randen 0-1; onbruikbare randen = hele foto). `addDishPhoto` in `RecipeEditor.tsx` knipt het uit met `cropSmall` (`src/util.ts`: max 900 px, WebP 0,6, anders JPEG 0,65; slaat over bij verhouding <0,4 of >2,5 of <250 px) en uploadt het via `uploadPhoto`. Getest met de omeletfoto: uitsnede ±30-50 kB, hele foto op 900 px 29 kB (gewone upload 229 kB). Of Claude de randen goed aanwijst, is nog niet live getest.
- **Test 8 nov 2026 met handgeschreven arretjescake (foto op zijn kant):** Haiku las "Amaretticake" en de app zette er een foto van een taart met een persoon voor een gebouw bij. Daarom: (1) **rechtzetten**: `aiScan.ts` vraagt eerst `/api/scan` met `orient: true` (kleine versies, 640 px; telt niet voor de daglimiet, wel lidcheck via `is_member`) hoeveel graden elke foto gedraaid moet worden (`uprightTurns`), en draait ze met `turnImage` (`util.ts`, elke hoek, witte hoeken); de rechtgezette pagina's worden gelezen en gebruikt voor het uitknippen van de gerechtfoto. (2) **leesopdracht**: gedraaide foto, handschrift, doorgestreepte getallen, bekende gerechtnaam als de titel slecht leesbaar is; effort `medium`. (3) **gerecht uitzoeken**: schemaveld `dish` {name_en, search_terms (2-3), looks} vervangt `photo_search`. (4) **foto keuren**: `stockPhoto` haalt kandidaten op (Openverse per zoekterm, Pixabay/Pexels als Openverse <4 geeft; max 8), laadt kleine voorbeelden en laat Haiku kiezen (`choice`, 0 = geen); daarna de grotere versie. Samen max ±30 s. Lokaal gezien: kandidaten voor "hedgehog slice"/"chocolate biscuit cake" bevatten een goede arretjescake maar ook mango en een speelgoedvarken, dus de keuring is nodig. Testscript met echte Claude-aanroepen: `haiku-test/test-keten.mjs` in de notitiemap (maakt een tijdelijke kopie `src/__tmp_scan_test.ts` en ruimt die op).
- **Modelvergelijking handschrift (arretjescake, 8 nov 2026):** Haiku las "Marietjescake", Sonnet 5.5 "Narrietjescake" + "leeuws meisje", Opus 5.5 alles goed incl. "Arretjescake" (±4 cent als Opus alles leest). Gekozen: **Opus schrijft alleen handschrift uit, Haiku vult in**. `inspectPhotos` (orient-stap, Haiku) geeft per foto `turn` én `handwritten`; de app stuurt `handwritten` mee; `readRecipe` laat handgeschreven foto's eerst door `transcribe` (Opus, effort low, platte tekst) uitschrijven en geeft Haiku die tekst in plaats van de foto. Mislukt uitschrijven, dan krijgt Haiku de foto zelf. Instelbaar in Vercel: `SCAN_READ_MODEL` (invullen, standaard Haiku) en `SCAN_HANDWRITING_MODEL` (uitschrijven, standaard claude-opus-5-5). Getest (arretjescake): Opus schreef uit (2734 in / 609 uit), Haiku vulde in: alles goed incl. titel, ±2,4 cent. Daarna geen foto gevonden: Openverse vindt niets bij lange zoektermen ("chocolate fridge cake": 0, "biscuit cake": 240) en gaf soms 504/time-outs. Daarom: korte zoektermen gevraagd, ook alle woordparen geprobeerd (max 12 termen), Openverse per 3 tegelijk tot ≥6 kandidaten, Pixabay/Pexels zoeken meteen tegelijk mee (foto's na die van Openverse), totaal max 35 s.
- **Passende foto: Openverse eerst** (gekozen 8 nov 2026: "van internet", maar alleen Creative Commons). `fromOpenverse` in `api/scan.ts`: geen sleutel, `license_type=modification` (wij verkleinen), `category=photograph`, liggende foto ≥500 px bij voorkeur; downloadt `url`, anders Openverse-`thumbnail`. Lange zoektermen vinden vaak niets, dus ook de laatste 2 woorden en het laatste woord (niet bij algemene woorden als dish/food). Openverse was soms traag (6-10 s): samen maximaal 25 s. Credit = maker + licentie ("CC BY 2.0"), staat alleen in de scanmelding. Lokaal getest: chocolate biscuit cake en avocado tomato omelette (via "tomato omelette") vinden een foto.
- **Reserve:** eerst Pexels gekozen, maar Pexels gaf op 8 nov 2026 geen nieuwe API-sleutels uit; daarom ook Pixabay (`PIXABAY_API_KEY`, wordt eerst geprobeerd: `category=food`, liggend, `largeImageURL` downloaden, niet linken). Daarna Pexels als die sleutel er is. Claude geeft `photo_search` (Engelse zoekterm). Stuurt de app `wantStock: true` (recept heeft nog geen foto) én wijst Claude geen gerecht op de scan aan (`dish_photo.photo` = 0), dan zoekt `stockPhoto()` in `api/scan.ts` (Pixabay, anders Pexels met `PEXELS_API_KEY` (`/v1/search`, 1 resultaat, liggend, zoekterm + " food"), haalt `src.large` op en stuurt die als base64 mee (`stock_photo` met fotograaf, link en `source`). `addDishPhoto` in de editor gebruikt eerst de uitgeknipte gerechtfoto en anders de fotobankfoto, via `cropSmall` (hele foto, WebP 900 px; test: 68 kB → 14 kB). Nog niet live getest; testmateriaal: handgeschreven arretjescake (gedraaide foto, geen afbeelding van het gerecht).
- `VITE_SCAN_URL` is uit Vercel verwijderd (8 nov 2026); scannen met Haiku werkt live.
- Bij `npm run dev` werkt scannen niet (geen `/api` lokaal); testen gaat op de live app.
- Proefscript: `haiku-test/test-haiku.mjs` in de gedeelde notitiemap van de sessie (buiten de repo).

## Nog te controleren bij de gebruiker
- Is de laatste versie van `supabase/schema.sql` gedraaid? Daarin zitten de regel dat alleen de plaatser bewerkt en verwijdert, en de opgeslagen namen. Controleren kan met de publishable key: `GET /rest/v1/recipes?select=created_by_name` geeft `[]` (en geen foutmelding) als het script gedraaid is.
- Bestaande profielen met alleen een voornaam aanvullen met de achternaam, bijvoorbeeld: `update public.profiles set display_name = 'Marcel Santifort' where display_name = 'Marcel';`
