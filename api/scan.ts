// Scanfunctie voor Ons Kookboek (Vercel). Leest één of meer foto's van een recept met Claude Haiku;
// handschrift wordt eerst door Claude Opus uitgeschreven.
// Alleen leden mogen scannen, maximaal 100 keer per dag (zie use_scan in supabase/schema.sql).
// De API-sleutel staat alleen in Vercel (ANTHROPIC_API_KEY) en komt nooit in de browser.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-5-5"; // rechtzetten en foto's keuren
// Lezen van het recept. In Vercel te veranderen met SCAN_READ_MODEL (bijvoorbeeld claude-sonnet-5-5).
const READ_MODEL = process.env.SCAN_READ_MODEL?.trim() || MODEL;
// Alleen voor handschrift: dit model schrijft de tekst eerst uit (in Vercel te veranderen met SCAN_HANDWRITING_MODEL).
const TRANSCRIBE_MODEL = process.env.SCAN_HANDWRITING_MODEL?.trim() || "claude-opus-5-5";
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
    dish: {
      type: "object",
      properties: {
        name_en: { type: "string" },
        search_terms: { type: "array", items: { type: "string" } },
        looks: { type: "string" },
      },
      required: ["name_en", "search_terms", "looks"],
      additionalProperties: false,
    },
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
  required: ["title", "description", "servings", "minutes", "ingredients", "steps", "dish", "dish_photo"],
  additionalProperties: false,
};

const PROMPT = `Je krijgt een foto van een recept, bijvoorbeeld een pagina uit een kookboek. Lees de tekst en geef het recept terug als JSON.

Regels:
- Neem de tekst letterlijk over, in de taal van de foto. Verzin niets, vertaal niets en vul niets aan.
- De foto kan gedraaid of scheef zijn (de tekst staat bijvoorbeeld op zijn kant). Lees de tekst in de juiste leesrichting.
- Handgeschreven tekst: lees een onduidelijk woord als het woord dat in dit recept past, zoals een bestaand ingrediënt of een bestaande eenheid. Is een getal doorgestreept en verbeterd, neem dan het verbeterde getal.
- De pagina kan meerdere kolommen hebben (bijvoorbeeld de bereiding links en de ingrediënten rechts). Lees elke kolom apart van boven naar beneden en meng geen regels uit verschillende kolommen.
- title: de naam van het recept. Is die naam handgeschreven of slecht leesbaar, kijk dan welk bekend gerecht dit is aan de hand van de ingrediënten en de bereiding, en neem de juiste, bekende naam van dat gerecht als die op de foto zo bedoeld kan zijn.
- description: de korte inleiding als die er staat, anders een lege tekst.
- servings: het aantal personen als getal, of 0 als het er niet staat.
- minutes: de totale bereidingstijd in minuten als getal, of 0 als het er niet staat.
- ingredients: elk ingrediënt apart. qty is de hoeveelheid zoals "200", "1,5" of "1/2" (leeg als er geen is). unit is de eenheid zoals g, kg, ml, dl, l, el, tl, snufje, stuks, teen, blik, bos, plak, kopje of naar smaak (leeg als er geen is). name is de rest van de regel. Zet elk woord in maar één veld. Voorbeelden: "200 g bloem" → qty "200", unit "g", name "bloem"; "2 kleine uien" → qty "2", unit "", name "kleine uien"; "zout" → qty "", unit "", name "zout".
- steps: de bereiding in de juiste volgorde. Elke alinea is één stap: neem de hele alinea over als één tekst en splits hem niet op in losse zinnen. Zijn de stappen in het recept genummerd, dan is elk nummer één stap. Laat de nummers zelf weg.
- dish_photo: staat er op een foto een afbeelding van het klaargemaakte gerecht (het eten zelf, bijvoorbeeld de foto naast de tekst in een kookboek, of een foto van het bord)? Geef dan photo = het nummer van die foto (1 voor de eerste) en de randen van alleen die afbeelding van het eten, in procenten van de breedte en hoogte van de foto: left en right van links gemeten, top en bottom van boven gemeten (0 tot 100). Neem geen tekst, kantlijn of tafel mee als dat kan. Kies bij meer afbeeldingen de grootste. Is er geen afbeelding van het gerecht, of is het eten maar half of als smal randje te zien (bijvoorbeeld de rand van de volgende pagina), geef dan photo 0 en alle randen 0.
- dish: zoek uit welk gerecht dit eigenlijk is, aan de hand van de naam, de ingrediënten en de bereiding. Bedenk ook onder welke namen hetzelfde of een vergelijkbaar gerecht in andere landen bekend is: veel gerechten hebben in Engeland, Australië, Amerika, Duitsland of Frankrijk een eigen, bekende naam, en een regionale of oudere naam in het eigen land. name_en: de naam waaronder Engelstaligen dit gerecht kennen (de echte, gangbare naam als die er is, niet een vertaling of omschrijving). search_terms: 4 korte zoektermen van 2 of hooguit 3 woorden om een foto van precies dit gerecht te vinden in een fotobank, de meest precieze eerst: eerst de bekende namen van het gerecht in andere landen (in die taal, bijvoorbeeld Engels of Duits), daarna een korte Engelse omschrijving van het eten zoals "potato gratin". Fotobanken vinden niets bij lange zoektermen. Geen merknamen. looks: in één Engelse zin hoe het klaargemaakte gerecht eruitziet (vorm, kleur, hoe het wordt opgediend).`;

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

/** What the reading step found out about the dish, used to find and check a photo. */
type Dish = { title: string; name_en: string; search_terms: string[]; looks: string };

/** A photo that might show the dish: a small preview for checking, and the bigger picture to keep. */
type Candidate = { preview: string; full: string; credit: string; link: string; source: string };

const UA = { "User-Agent": "OnsKookboek/1.0 (recepten-app)" };

/**
 * Openverse: free-to-use photos (Creative Commons) from all over the internet, mostly Flickr. No key needed.
 * Only licences that allow changing the photo (we resize it). The maker and licence must be named.
 */
async function openverse(term: string, ms: number): Promise<Candidate[]> {
  const url =
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}` +
    "&license_type=modification&category=photograph&mature=false&page_size=6";
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`Openverse gaf ${res.status}`);
  const found = (await res.json()) as {
    results?: { url: string; thumbnail: string; creator?: string; license: string; license_version?: string; foreign_landing_url: string }[];
  };
  return (found.results ?? []).map((h) => {
    const licence = `CC ${h.license.toUpperCase()}${h.license_version ? ` ${h.license_version}` : ""}`;
    return {
      preview: h.thumbnail,
      full: h.url,
      credit: h.creator ? `${h.creator} (${licence})` : licence,
      link: h.foreign_landing_url,
      source: "Openverse",
    };
  });
}

/** Pexels (free to use and to change). Only used if PEXELS_API_KEY is set (Pexels gave out no new keys on 8 Nov 2026). */
async function pexels(key: string, term: string, ms: number): Promise<Candidate[]> {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(term)}&per_page=4`;
  const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`Pexels gaf ${res.status}`);
  const found = (await res.json()) as { photos?: { url: string; photographer: string; src: { medium: string; large: string } }[] };
  return (found.photos ?? []).map((p) => ({ preview: p.src.medium, full: p.src.large, credit: p.photographer, link: p.url, source: "Pexels" }));
}

/** Fetches a picture as base64, or null if that doesn't work (in time). */
async function fetchImage(src: string, ms: number, maxBytes: number): Promise<{ type: ImageType; data: string } | null> {
  try {
    const res = await fetch(src, { headers: UA, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim().toLowerCase() as ImageType;
    if (!IMAGE_TYPES.includes(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length && bytes.length <= maxBytes ? { type, data: bytes.toString("base64") } : null;
  } catch {
    return null;
  }
}

/**
 * Finds a photo of the dish for a recipe without one. Collects a few candidates from Openverse (all over the
 * internet, Creative Commons) and, if it has a key, Pexels; then Claude looks at them and only a photo
 * that clearly shows this dish is used. No photo is better than a wrong one. At most about 35 seconds.
 */
async function stockPhoto(client: Anthropic, dish: Dish): Promise<StockPhoto | null> {
  const deadline = Date.now() + 35_000;
  const left = () => deadline - Date.now();
  // Photo banks find little with long search terms ("no-bake chocolate fridge cake": nothing, "biscuit cake": a lot),
  // so every pair of words next to each other is tried too ("chocolate biscuit", "biscuit cake", …), after the
  // full terms. Pairs with only general words would give random photos.
  const general = ["dish", "dishes", "food", "meal", "recipe", "plate", "bowl", "homemade", "slice", "slices", "cake", "dutch", "no-bake", "with"];
  const full = [...dish.search_terms, dish.name_en]
    .map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean);
  const pairs = full.flatMap((t) => {
    const w = t.split(" ");
    return w.slice(0, -1).map((_, i) => `${w[i]} ${w[i + 1]}`);
  });
  const terms = [...new Set([...full, ...pairs])]
    .filter((t) => t.length >= 4 && t.split(" ").some((w) => !general.includes(w)))
    .slice(0, 12);
  if (!terms.length) return null;

  // 1. Candidates. Openverse first, three search terms at a time (it gets stuck with more), until there are enough.
  //    Pexels (only with a key) searches at the same time; its photos come after Openverse's.
  //    From Vercel's servers Openverse sometimes doesn't answer at all: if a whole round gets no answer, stop asking it.
  const settle = async (jobs: Promise<Candidate[]>[]) => {
    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === "rejected") console.error("Fotobank:", String(r.reason));
    return { photos: results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])), answered: results.some((r) => r.status === "fulfilled") };
  };
  const pexKey = process.env.PEXELS_API_KEY;
  const reserves = settle(pexKey ? terms.slice(0, 8).map((t) => pexels(pexKey, t, 8_000)) : []);
  let found: Candidate[] = [];
  for (let i = 0; i < terms.length && found.length < 6 && left() > 20_000; i += 3) {
    const round = await settle(terms.slice(i, i + 3).map((t) => openverse(t, 6_000)));
    found = found.concat(round.photos);
    if (!round.answered) {
      console.log("Openverse geeft geen antwoord");
      break;
    }
  }
  const fromOpenverse = found.length;
  found = found.concat((await reserves).photos);
  const seen = new Set<string>();
  const unique = found.filter((c) => !seen.has(c.full) && seen.add(c.full)).slice(0, 8);
  console.log(`Foto zoeken: ${fromOpenverse} van Openverse, ${found.length - fromOpenverse} van Pexels (${terms.join(" | ")})`);
  if (!unique.length) return null;
  if (left() < 8_000) {
    console.log("Foto zoeken: te weinig tijd over om de foto's te keuren");
    return null;
  }

  // 2. Small previews, so Claude can look at them all at once.
  const previews = await Promise.all(unique.map((c) => fetchImage(c.preview, Math.min(6_000, left() - 6_000), 1.5 * 1024 * 1024)));
  const shown = unique.map((c, i) => ({ c, img: previews[i] })).filter((x) => x.img) as { c: Candidate; img: { type: ImageType; data: string } }[];
  if (!shown.length) {
    console.log(`Foto zoeken: geen van de ${unique.length} voorbeelden kon worden opgehaald`);
    return null;
  }
  if (left() < 4_000) {
    console.log("Foto zoeken: te weinig tijd over om de foto's te keuren");
    return null;
  }

  // 3. Claude picks the photo that really shows this dish, or none.
  const check = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 2000,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: { type: "object", properties: { choice: { type: "integer" } }, required: ["choice"], additionalProperties: false },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            ...shown.flatMap(({ img }, n): Anthropic.ContentBlockParam[] => [
              { type: "text", text: `Foto ${n + 1}:` },
              { type: "image", source: { type: "base64", media_type: img.type, data: img.data } },
            ]),
            {
              type: "text",
              text:
                `Gerecht: ${dish.title} (in het Engels: ${dish.name_en}). Zo ziet het eruit: ${dish.looks}\n\n` +
                "Welke foto laat duidelijk precies dit gerecht zien, als hoofdonderwerp, zodat hij geschikt is als foto bij het recept? " +
                "Kies geen foto met mensen, gebouwen of een ander gerecht als hoofdonderwerp, geen foto met grote tekst, logo's of verpakkingen, en geen onscherpe of donkere foto. " +
                "Twijfel je, kies dan niets. Geef choice = het nummer van de beste foto, of 0 als geen enkele foto past.",
            },
          ],
        },
      ],
    },
    { timeout: Math.max(3_000, left()) },
  );
  const text = check.content.find((b) => b.type === "text")?.text ?? "";
  const choice = Number((JSON.parse(text || "{}") as { choice?: unknown }).choice);
  const pick = Number.isInteger(choice) && choice >= 1 ? shown[choice - 1] : undefined;
  if (!pick) {
    console.log(`Fotocheck: geen van de ${shown.length} foto's past bij "${dish.name_en}"`);
    return null;
  }

  // 4. The bigger version of the chosen photo; the preview will do if that fails.
  const big = left() > 2_000 ? await fetchImage(pick.c.full, Math.min(8_000, left()), 2 * 1024 * 1024) : null;
  const img = big ?? pick.img;
  console.log(`Foto gekozen: ${pick.c.source}, ${pick.c.credit}, ${pick.c.link}`);
  return { ...img, credit: pick.c.credit, link: pick.c.link, source: pick.c.source };
}

/**
 * For each photo: how many degrees it must be turned clockwise so the text stands upright and level
 * (for example 90 for a page on its side, or -4 for a slightly crooked photo), and whether the recipe
 * text is handwritten. The app does the turning.
 */
async function inspectPhotos(
  client: Anthropic,
  images: { type: ImageType; data: string }[],
): Promise<{ turns: number[]; handwritten: boolean[] }> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            photos: {
              type: "array",
              items: {
                type: "object",
                properties: { turn: { type: "integer" }, handwritten: { type: "boolean" } },
                required: ["turn", "handwritten"],
                additionalProperties: false,
              },
            },
          },
          required: ["photos"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: [
          ...images.flatMap((img, n): Anthropic.ContentBlockParam[] => [
            { type: "text", text: `Foto ${n + 1}:` },
            { type: "image", source: { type: "base64", media_type: img.type, data: img.data } },
          ]),
          {
            type: "text",
            text:
              "Dit zijn foto's van een recept. Kijk per foto naar de tekst.\n" +
              "- turn: hoeveel graden moet de foto met de klok mee gedraaid worden zodat de tekst rechtop en recht staat, " +
              "zodat je hem gewoon van links naar rechts kunt lezen? Staat de tekst op zijn kant met de bovenkant van de regels naar links, " +
              "dan is dat 90; met de bovenkant naar rechts -90; op zijn kop 180. Staat de tekst al bijna recht, geef dan de kleine schuinte " +
              "(bijvoorbeeld 4 of -3), of 0 als hij recht staat.\n" +
              "- handwritten: true als het recept (of een groot deel ervan) met de hand geschreven is, false als het gedrukt of getypt is.\n" +
              `Geef photos: een lijst met ${images.length} ${images.length === 1 ? "item" : "items"}, één per foto, in dezelfde volgorde.`,
          },
        ],
      },
    ],
  });
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const photos = (JSON.parse(text || "{}") as { photos?: unknown }).photos;
  const at = (i: number) => (Array.isArray(photos) ? ((photos[i] ?? {}) as { turn?: unknown; handwritten?: unknown }) : {});
  return {
    turns: images.map((_, i) => {
      const t = Number(at(i).turn);
      if (!Number.isFinite(t)) return 0;
      const n = ((Math.round(t) % 360) + 540) % 360 - 180; // -180 … 179
      return Math.abs(n) < 2 ? 0 : n;
    }),
    handwritten: images.map((_, i) => at(i).handwritten === true),
  };
}

const TRANSCRIBE_PROMPT = `Dit is een foto van een handgeschreven recept. Schrijf alle tekst letterlijk over, regel voor regel, in de taal van het recept. Verzin niets en vertaal niets.
- De foto staat rechtop, maar het handschrift kan slordig zijn. Lees een onduidelijk woord als het woord dat in dit recept past: een bestaand ingrediënt, een eenheid, of de bekende naam van het gerecht.
- Is een getal of woord doorgestreept en verbeterd, schrijf dan alleen de verbetering.
- Laat een lege regel tussen alinea's staan.
- Geef alleen de tekst, zonder uitleg.`;

/**
 * Handwriting is hard to read: Opus writes it out first (only the text, so it stays cheap).
 * Returns the text, or null if that didn't work (then the reading step gets the photo itself).
 */
async function transcribe(client: Anthropic, img: { type: ImageType; data: string }): Promise<string | null> {
  try {
    const response = await client.messages.create({
      model: TRANSCRIBE_MODEL,
      max_tokens: 8000,
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: img.type, data: img.data } },
            { type: "text", text: TRANSCRIBE_PROMPT },
          ],
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text")?.text?.trim();
    console.log(`Handschrift uitgeschreven door ${response.model}: ${response.usage.input_tokens} in, ${response.usage.output_tokens} uit`);
    return response.stop_reason === "end_turn" && text ? text : null;
  } catch (e) {
    console.error("Uitschrijven mislukt:", e);
    return null;
  }
}

/**
 * Reads the (upright) photos as one recipe. Handwritten photos are first written out by Opus;
 * Haiku then gets that text instead of the photo, and fills in the form (and reads printed photos itself).
 */
async function readRecipe(client: Anthropic, images: { type: ImageType; data: string }[], handwritten: boolean[] = []) {
  const texts = await Promise.all(images.map((img, i) => (handwritten[i] ? transcribe(client, img) : Promise.resolve(null))));
  const anyText = texts.some(Boolean);
  const label = images.length > 1 || anyText;
  const content = images.flatMap((img, n): Anthropic.ContentBlockParam[] => {
    const text = texts[n];
    if (text) return [{ type: "text", text: `Foto ${n + 1} is handgeschreven. Dit is de uitgeschreven tekst ervan:\n"""\n${text}\n"""` }];
    return [
      ...(label ? [{ type: "text" as const, text: `Foto ${n + 1}:` }] : []),
      { type: "image", source: { type: "base64", media_type: img.type, data: img.data } },
    ];
  });
  const extra = anyText
    ? "\n\nVan een handgeschreven foto krijg je de uitgeschreven tekst in plaats van de foto. Neem die tekst over zoals hij is uitgeschreven (ook de naam van het recept); verbeter hem niet. Op zo'n foto staat geen afbeelding van het gerecht."
    : "";
  const response = await client.messages.create({
    model: READ_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [...content, { type: "text", text: (images.length > 1 ? `${PROMPT}\n\n${MORE_PAGES}` : PROMPT) + extra }],
      },
    ],
  });
  return Object.assign(response, { transcribed: texts.filter(Boolean).length });
}

export async function POST(request: Request): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error("Scan: omgevingsvariabelen ontbreken");
    return json(503, { error: "niet_ingesteld" });
  }

  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { error: "niet_ingelogd" });

  // Body: { images: [{ type: "image/jpeg", data: "<base64>" }, ...], wantStock?, orient?, handwritten? }:
  // één of meer pagina's van hetzelfde recept. orient = eerst alleen kijken hoe ze rechtop moeten en of ze
  // handgeschreven zijn; wantStock = het recept heeft nog geen foto; handwritten = per foto, uit die eerste stap.
  const body = await request.text();
  if (body.length > MAX_BYTES) return json(413, { error: "te_groot" });
  let images: { type: ImageType; data: string }[];
  let wantStock = false;
  let orient = false;
  let handwritten: boolean[] = [];
  try {
    const parsed = JSON.parse(body) as { images?: unknown; wantStock?: unknown; orient?: unknown; handwritten?: unknown };
    wantStock = parsed.wantStock === true;
    orient = parsed.orient === true;
    handwritten = Array.isArray(parsed.handwritten) ? parsed.handwritten.map((h) => h === true) : [];
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

  // First step of a scan: how far must each photo be turned to stand upright? Doesn't count as a scan.
  if (orient) {
    let member: Response;
    try {
      member = await rpc("is_member", token);
    } catch {
      return json(503, { error: "supabase" });
    }
    if (member.status === 401 || member.status === 403) return json(401, { error: "niet_ingelogd" });
    if (!member.ok) return json(503, { error: "supabase" });
    if ((await member.json().catch(() => false)) !== true) return json(401, { error: "niet_ingelogd" });
    try {
      return json(200, await inspectPhotos(new Anthropic({ timeout: 30_000, maxRetries: 1 }), images));
    } catch (e) {
      // Not being able to check is no reason to stop: read the photos as they are.
      console.error("Rechtzetten mislukt:", e);
      return json(200, { turns: images.map(() => 0), handwritten: images.map(() => false) });
    }
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
    const client = new Anthropic({ timeout: 120_000, maxRetries: 1 });
    const response = await readRecipe(client, images, handwritten);
    const text = response.content.find((b) => b.type === "text")?.text;
    if (response.stop_reason !== "end_turn" || !text) {
      console.error("Scan: geen bruikbaar antwoord, stop_reason", response.stop_reason);
      await refund();
      return json(422, { error: "onleesbaar" });
    }
    console.log(`Scan klaar: ${response.usage.input_tokens} in, ${response.usage.output_tokens} uit`);
    const recipe = JSON.parse(text) as { title?: string; dish?: Omit<Dish, "title">; dish_photo?: { photo?: number } };
    // Only look on the internet when the scanned photos show no picture of the dish.
    const dishOnScan = (recipe.dish_photo?.photo ?? 0) >= 1;
    let stock: StockPhoto | null = null;
    if (wantStock && !dishOnScan && recipe.dish) {
      stock = await stockPhoto(client, { ...recipe.dish, title: recipe.title ?? "" }).catch((e) => {
        console.error("Foto zoeken mislukt:", e);
        return null;
      });
    }
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
