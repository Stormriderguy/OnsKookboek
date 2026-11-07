# Overdracht Ons Kookboek (stand 7 november 2026)

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
Vite + React + TypeScript, gewone CSS met design tokens (basilicumgroen, licht en donker thema), `@supabase/supabase-js`, en `tesseract.js` voor het scannen.
- `src/App.tsx`: sessie en profiel; toont het codescherm (`Join`) of het kookboek (`Cookbook`).
- `src/components/Join.tsx`: gezamenlijke code + voornaam + achternaam.
- `src/components/Cookbook.tsx`: kopbalk, live recepten (Realtime), favorieten, filters en zoeken, kaarten.
- `src/components/FilterMenu.tsx`: uitklapmenu rechtsboven; op de telefoon over de volle breedte met inklapbare kopjes (+/−).
- `src/components/RecipeDetail.tsx` en `RecipeEditor.tsx`: recept bekijken, en toevoegen/bewerken met foto's en de scanknop.
- `src/ocr.ts` en `src/parseRecipe.ts`: tekst van een foto lezen (Tesseract, Nederlands) en omzetten naar receptvelden.
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

## Scannen met Ollama (gekozen 7 nov 2026)
Tesseract is uit de app gehaald. De scan loopt nu via Ollama op de eigen Linuxcomputer van de gebruiker: een HP Z240 SFF met een i7-6700, 16 GB werkgeheugen en geen bruikbare videokaart. Een scan duurt daar ongeveer 1 tot 3 minuten.
- `scanner/`: de poortwachter (`server.mjs`, Node zonder extra pakketten), een systemd-unit, `scanner.env.example` en een `README.md` met de installatiestappen. Hij controleert het Supabase-token via `rpc/is_member`, houdt een wachtrij bij (1 scan tegelijk, maximaal 10 wachtend) en een daglimiet (30 per persoon; een scan die mislukt omdat Ollama uit staat, telt niet mee). Foto's mogen maximaal 8 MB zijn, CORS staat alleen open voor de app, en foto's worden niet bewaard.
- Verbinding: Tailscale Funnel (`tailscale funnel --bg 8787`) → https-adres `*.ts.net`. Ollama blijft op 127.0.0.1.
- App: `src/aiScan.ts` (versturen en elke 2 seconden de stand opvragen, maximaal 10 minuten) en `normalizeParsed` in `src/parseRecipe.ts`. Is de scanner onbereikbaar of het limiet bereikt, dan meldt de app: "Er kunnen vandaag geen foto's meer worden verwerkt." Zonder `VITE_SCAN_URL` is er geen scanknop.
- Getest: de poortwachter met een nep-Ollama (login, lidmaatschap, CORS, limieten, wachtrij), en de hele keten lokaal met de echte Supabase-login. **Nog niet getest met het echte model op de Linuxcomputer.**
- Nog te doen door de gebruiker: de Linuxcomputer inrichten volgens `scanner/README.md`, `VITE_SCAN_URL` in Vercel invullen en opnieuw online zetten. Daarna de omeletfoto testen met `qwen2.5vl:3b` en eventueel `qwen2.5vl:7b`.

## Nog te controleren bij de gebruiker
- Is de laatste versie van `supabase/schema.sql` gedraaid? Daarin zitten de regel dat alleen de plaatser bewerkt en verwijdert, en de opgeslagen namen. Controleren kan met de publishable key: `GET /rest/v1/recipes?select=created_by_name` geeft `[]` (en geen foutmelding) als het script gedraaid is.
- Bestaande profielen met alleen een voornaam aanvullen met de achternaam, bijvoorbeeld: `update public.profiles set display_name = 'Marcel Santifort' where display_name = 'Marcel';`
