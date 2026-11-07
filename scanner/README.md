# Scanner op de eigen Linuxcomputer

De knop **Recept scannen van foto** stuurt de foto naar een computer bij jullie thuis. Daar leest een AI-model (Ollama) het recept. Zo loopt het:

```
telefoon ──https──► Tailscale Funnel ──► poortwachter (deze map) ──► Ollama
```

- **Ollama** draait het beeldmodel. Ollama is alleen op de computer zelf bereikbaar, nooit van buiten.
- **De poortwachter** (`server.mjs`) laat alleen ingelogde leden van het kookboek binnen. Hij houdt een wachtrij en een daglimiet bij. Foto's worden niet bewaard.
- **Tailscale Funnel** geeft een vast https-adres, zonder open poort in de router en zonder eigen domein.

De stappen hieronder gaan uit van Ubuntu of Debian. Typ de commando's in een terminal op de Linuxcomputer.

## 1. Ollama en het model

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5vl:3b
```

Controleer dat Ollama alleen op de computer zelf luistert. In de uitvoer moet `127.0.0.1:11434` staan (en niet `0.0.0.0` of `*`):

```bash
ss -tlnp | grep 11434
```

Je kunt later ook het grotere model proberen. Dat leest beter, maar is ongeveer twee keer zo traag:

```bash
ollama pull qwen2.5vl:7b
```

Zet daarna `OLLAMA_MODEL=qwen2.5vl:7b` in `scanner.env` (zie stap 3) en herstart de dienst.

## 2. Node.js

Je hebt versie 20 of nieuwer nodig:

```bash
node --version
```

Is die te oud of ontbreekt hij:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## 3. De poortwachter plaatsen

Kopieer de map `scanner` uit de repo naar de Linuxcomputer (bijvoorbeeld met een USB-stick of `git clone`). Ga in die map staan en voer uit:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin kookboek
sudo mkdir -p /opt/kookboek-scanner /etc/kookboek-scanner
sudo cp server.mjs /opt/kookboek-scanner/
sudo cp scanner.env.example /etc/kookboek-scanner/scanner.env
sudo chmod 640 /etc/kookboek-scanner/scanner.env
sudo chown root:kookboek /etc/kookboek-scanner/scanner.env
sudo nano /etc/kookboek-scanner/scanner.env
```

Vul in `scanner.env` bij `SUPABASE_KEY` de **publishable key** in. Dat is dezelfde sleutel die ook in Vercel staat. Gebruik nooit de secret- of service_role-sleutel.

Zet daarna de dienst aan:

```bash
sudo cp kookboek-scanner.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kookboek-scanner
curl http://127.0.0.1:8787/health
```

Als je `"ok":true` en `"ollama":true` ziet, werkt het.

## 4. Tailscale Funnel (de veilige verbinding)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Log in met een (gratis) Tailscale-account. Zet daarna Funnel aan:

```bash
sudo tailscale funnel --bg 8787
```

De eerste keer geeft Tailscale een link om Funnel aan te zetten in het beheerscherm (Access controls). Volg die link en voer het commando daarna opnieuw uit. Je krijgt een adres zoals `https://kookboek.tail1234.ts.net`. Controleer het vanaf je telefoon (via 4G, dus niet via de wifi):

`https://kookboek.tail1234.ts.net/health`

## 5. Het adres in de app zetten

Ga in Vercel naar Project → Settings → Environment Variables en voeg toe:

- `VITE_SCAN_URL` = het adres uit stap 4, zonder `/` aan het eind

Zet de app daarna opnieuw online (Deployments → ⋯ → Redeploy). Zolang `VITE_SCAN_URL` leeg is, toont de app geen scanknop.

## Extra afscherming (aanbevolen)

Laat de router geen poorten naar deze computer doorsturen; voor Tailscale is dat niet nodig. Zet de firewall aan, maar laat SSH toe als je dat gebruikt:

```bash
sudo ufw default deny incoming
sudo ufw allow ssh
sudo ufw enable
```

## Beheer

- Wat de scanner doet bekijken: `journalctl -u kookboek-scanner -f`
- Herstarten na een wijziging: `sudo systemctl restart kookboek-scanner`
- Nieuwe versie van `server.mjs`: opnieuw naar `/opt/kookboek-scanner/` kopiëren en herstarten.
- Funnel tijdelijk uitzetten: `sudo tailscale funnel reset` (weer aan met `sudo tailscale funnel --bg 8787`). De app meldt dan dat er vandaag geen foto's meer kunnen worden verwerkt.
- Een scan duurt op de processor ongeveer 5 à 6 minuten met qwen2.5vl:7b, en ongeveer de helft met qwen2.5vl:3b. De eerste scan na een tijd niets doen duurt langer, omdat het model dan eerst wordt geladen.
