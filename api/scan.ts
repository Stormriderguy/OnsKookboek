// Scanfunctie voor Ons Kookboek (Vercel). Leest één of meer foto's van een recept met Claude Haiku.
// Alleen leden mogen scannen, maximaal 100 keer per dag (zie use_scan in supabase/schema.sql).
// De API-sleutel staat alleen in Vercel (ANTHROPIC_API_KEY) en komt nooit in de browser.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-5-5";
const MAX_BYTES = 4.4 * 1024 * 1024; // Vercel accepteert tot 4,5 MB
const MAX_PHOTOS = 4;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    servings: { type: "integer" },
    minutes: { type: "integer" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: { qty: { type: "string" }, unit: { type: "string" }, name: { type: "string" } },
        required: ["qty", "unit", "name"],
        additionalProperties: false,
      },
    },
    steps: { type: "array", items: { type: "string" } },
    photo_search: { type: "string" },
    dish_photo: {
      type: "object",
      properties: {
        photo: { type: "integer" },
        left: { type: "integer" },
        top: { type: "integer" },
        right: { type: "integer" },
        bottom: { type: "integer" },
      },
      required: ["photo", "left", "top", "right", "bottom"],
      additionalProperties: false,
    },
  },
  required: ["title", "description", "servings", "minutes", "ingredients", "steps", "photo_search", "dish_photo"],
  additionalProperties: false,
};

const PROMPT = `Je krijgt een foto van een recept, bijvoorbeeld een pagina uit een kookboek. Lees de tekst en geef het recept terug als JSON.

Regels:
- Neem de tekst letterlijk over, in de taal van de foto. Verzin niets, vertaal niets en vul niets aan.
- De pagina kan meerdere kolommen hebben (bijvoorbeeld de bereiding links en de ingrediënten rechts). Lees elke kolom apart van boven naar beneden en meng geen regels uit verschillende kolommen.
- title: de naam van het recept.
- description: de korte inleiding als die er staat, anders een lege tekst.
- servings: het aantal personen als getal, of 0 als het er niet staat.
- minutes: de totale bereidingstijd in minuten als getal, of 0 als het er niet staat.
- ingredients: elk ingrediënt apart. qty is de hoeveelheid zoals "200", "1,5" of "1/2" (leeg als er geen is). unit is de eenheid zoals g, kg, ml, dl, l, el, tl, snufje, stuks, teen, blik, bos, plak, kopje of naar smaak (leeg als er geen is). name is de rest van de regel. Zet elk woord in maar één veld. Voorbeelden: "200 g bloem" → qty "200", unit "g", name "bloem"; "2 kleine uien" → qty "2", unit "", name "kleine uien"; "zout" → qty "", unit "", name "zout".
- steps: de bereiding in de juiste volgorde. Elke alinea is één stap: neem de hele alinea over als één tekst en splits hem niet op in losse zinnen. Zijn de stappen in het recept genummerd, dan is elk nummer één stap. Laat de nummers zelf weg.
- dish_photo: staat er op een foto een afbeelding van het klaargemaakte gerecht (het eten zelf, bijvoorbeeld de foto naast de tekst in een kookboek, of een foto van het bord)? Geef dan photo = het nummer van die foto (1 voor de eerste) en de randen van alleen die afbeelding van het eten, in procenten van de breedte en hoogte van de foto: left en right van links gemeten, top en bottom van boven gemeten (0 tot 100). Neem geen tekst, kantlijn of tafel mee als dat kan. Kies bij meer afbeeldingen de grootste. Is er geen afbeelding van het gerecht, of is het eten maar half of als smal randje te zien (bijvoorbeeld de rand van de volgende pagina), geef dan photo 0 en alle randen 0.
- photo_search: een korte Engelse zoekterm (2 tot 4 woorden) om een foto van dit gerecht te vinden in een fotobank, bijvoorbeeld "chocolate biscuit cake" of "avocado tomato omelette". Beschrijf het eten zelf, geen merknamen.`;

const MORE_PAGES = `Er zijn meerdere foto's. Samen vormen ze één recept, bijvoorbeeld pagina 1 en 2, of een foto van de ingrediënten en een van de bereiding. Geef één recept terug:
- Neem elk ingrediënt maar één keer op, ook als het op meer foto's te zien is.
- Neem elke alinea van de bereiding maar één keer op, in de juiste volgorde. Loopt een alinea door op de volgende foto, maak er dan één stap van.
- Staat er op een foto iets dat niet bij dit recept hoort (bijvoorbeeld een ander recept op dezelfde pagina), laat dat weg.`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Calls one of our Supabase functions as the signed-in user. */
function rpc(name: string, token: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
}

type StockPhoto = { type: string; data: string; credit: string; link: string; source: string };

/** Downloads the found picture, so the app needn't fetch it from another site. */
async function download(src: string, meta: Omit<StockPhoto, "type" | "data">): Promise<StockPhoto | null> {
  const img = await fetch(src, { signal: AbortSignal.timeout(8_000) });
  if (!img.ok) return null;
  const bytes = Buffer.from(await img.arrayBuffer());
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) return null;
  return { type: img.headers.get("content-type") || "image/jpeg", data: bytes.toString("base64"), ...meta };
}

/**
 * Openverse: free-to-use photos (Creative Commons) from all over the internet, mostly Flickr. No key needed.
 * Only licences that allow changing the photo (we resize it). The maker and licence must be named.
 * A long search term often finds nothing, so shorter versions are tried too ("tomato omelette", "omelette").
 */
async function fromOpenverse(q: string, deadline: number): Promise<StockPhoto | null> {
  const words = q.split(/\s+/).filter(Boolean);
  // A general word on its own ("dish", "food") would give a random photo.
  const general = ["dish", "dishes", "food", "meal", "recipe", "plate", "bowl", "homemade"];
  const tries = [...new Set([q, words.slice(-2).join(" "), words.at(-1) ?? ""])].filter(
    (t) => t.length >= 4 && !general.includes(t.toLowerCase()),
  );
  for (const term of tries) {
    const left = deadline - Date.now();
    if (left < 2_000) break;
    const url =
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}` +
      "&license_type=modification&category=photograph&mature=false&page_size=5";
    const res = await fetch(url, { headers: { "User-Agent": "OnsKookboek/1.0 (recepten-app)" }, signal: AbortSignal.timeout(Math.min(15_000, left)) });
    if (!res.ok) {
      console.error("Openverse gaf", res.status);
      return null;
    }
    const found = (await res.json()) as {
      results?: { url: string; thumbnail: string; creator?: string; license: string; license_version?: string; foreign_landing_url: string; width?: number; height?: number }[];
    };
    const hits = found.results ?? [];
    // Prefer a landscape photo that isn't tiny: it looks best on the recipe cards.
    const hit = hits.find((h) => (h.width ?? 0) >= 500 && (h.width ?? 0) >= (h.height ?? 0)) ?? hits[0];
    if (!hit) continue;
    const licence = `CC ${hit.license.toUpperCase()}${hit.license_version ? ` ${hit.license_version}` : ""}`;
    const credit = hit.creator ? `${hit.creator} (${licence})` : licence;
    const meta = { credit, link: hit.foreign_landing_url, source: "Openverse" };
    return (await download(hit.url, meta).catch(() => null)) ?? (await download(hit.thumbnail, meta).catch(() => null));
  }
  return null;
}

/** Pixabay (free to use and to change; the picture must be downloaded, not linked to). Key: PIXABAY_API_KEY. */
async function fromPixabay(key: string, q: string): Promise<StockPhoto | null> {
  const url =
    `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}` +
    "&image_type=photo&category=food&orientation=horizontal&safesearch=true&per_page=3";
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) {
    console.error("Pixabay gaf", res.status);
    return null;
  }
  const found = (await res.json()) as { hits?: { pageURL: string; user: string; largeImageURL: string }[] };
  const hit = found.hits?.[0];
  return hit ? download(hit.largeImageURL, { credit: hit.user, link: hit.pageURL, source: "Pixabay" }) : null;
}

/** Pexels (free to use and to change). Key: PEXELS_API_KEY. */
async function fromPexels(key: string, q: string): Promise<StockPhoto | null> {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(`${q} food`)}&per_page=1&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) {
    console.error("Pexels gaf", res.status);
    return null;
  }
  const found = (await res.json()) as { photos?: { url: string; photographer: string; src: { large: string } }[] };
  const photo = found.photos?.[0];
  return photo ? download(photo.src.large, { credit: photo.photographer, link: photo.url, source: "Pexels" }) : null;
}

/** A matching photo of the dish for a recipe without a photo: Openverse first, then Pixabay and Pexels if they have a key. */
async function stockPhoto(query: string): Promise<StockPhoto | null> {
  const q = query.trim().slice(0, 80);
  if (!q) return null;
  try {
    const pixabay = process.env.PIXABAY_API_KEY;
    const pexels = process.env.PEXELS_API_KEY;
    // Openverse can be slow: give it at most 25 seconds in all, so the scan doesn't keep you waiting.
    return (
      (await fromOpenverse(q, Date.now() + 25_000).catch((e) => (console.error("Openverse mislukt:", e), null))) ??
      (pixabay ? await fromPixabay(pixabay, q) : null) ??
      (pexels ? await fromPexels(pexels, q) : null)
    );
  } catch (e) {
    console.error("Fotobank mislukt:", e);
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error("Scan: omgevingsvariabelen ontbreken");
    return json(503, { error: "niet_ingesteld" });
  }

  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { error: "niet_ingelogd" });

  // Body: { images: [{ type: "image/jpeg", data: "<base64>" }, ...], wantStock?: boolean }:
  // één of meer pagina's van hetzelfde recept; wantStock = het recept heeft nog geen foto.
  const body = await request.text();
  if (body.length > MAX_BYTES) return json(413, { error: "te_groot" });
  let images: { type: ImageType; data: string }[];
  let wantStock = false;
  try {
    const parsed = JSON.parse(body) as { images?: unknown; wantStock?: unknown };
    wantStock = parsed.wantStock === true;
    const raw = parsed.images;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PHOTOS) throw new Error("aantal");
    images = raw.map((i: { type?: unknown; data?: unknown }) => {
      const type = String(i?.type ?? "").toLowerCase() as ImageType;
      if (!IMAGE_TYPES.includes(type) || typeof i?.data !== "string" || !i.data) throw new Error("foto");
      return { type, data: i.data };
    });
  } catch {
    return json(415, { error: "geen_foto" });
  }

  // Lid en onder de daglimiet? Dit telt meteen één scan.
  let allowed: Response;
  try {
    allowed = await rpc("use_scan", token);
  } catch {
    return json(503, { error: "supabase" });
  }
  if (allowed.status === 401 || allowed.status === 403) return json(401, { error: "niet_ingelogd" });
  if (!allowed.ok) return json(503, { error: "supabase" });
  if ((await allowed.json().catch(() => false)) !== true) return json(429, { error: "limiet" });

  const refund = () => rpc("refund_scan", token).catch(() => undefined);

  try {
    const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            ...images.flatMap((img, n): Anthropic.ContentBlockParam[] => [
              ...(images.length > 1 ? [{ type: "text" as const, text: `Foto ${n + 1}:` }] : []),
              { type: "image", source: { type: "base64", media_type: img.type, data: img.data } },
            ]),
            { type: "text", text: images.length > 1 ? `${PROMPT}\n\n${MORE_PAGES}` : PROMPT },
          ],
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text")?.text;
    if (response.stop_reason !== "end_turn" || !text) {
      console.error("Scan: geen bruikbaar antwoord, stop_reason", response.stop_reason);
      await refund();
      return json(422, { error: "onleesbaar" });
    }
    console.log(`Scan klaar: ${response.usage.input_tokens} in, ${response.usage.output_tokens} uit`);
    const recipe = JSON.parse(text) as { photo_search?: string; dish_photo?: { photo?: number } };
    // Only look on the internet when the scanned photos show no picture of the dish.
    const dishOnScan = (recipe.dish_photo?.photo ?? 0) >= 1;
    const stock = wantStock && !dishOnScan ? await stockPhoto(recipe.photo_search ?? "") : null;
    return json(200, { ...recipe, stock_photo: stock });
  } catch (error) {
    await refund();
    if (error instanceof Anthropic.APIError) {
      console.error(`Scan: Claude gaf ${error.status}:`, error.message);
    } else {
      console.error("Scan mislukt:", error);
    }
    return json(503, { error: "claude" });
  }
}
