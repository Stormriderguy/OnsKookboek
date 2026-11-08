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
  },
  required: ["title", "description", "servings", "minutes", "ingredients", "steps"],
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
- steps: de bereiding in de juiste volgorde. Elke alinea is één stap: neem de hele alinea over als één tekst en splits hem niet op in losse zinnen. Zijn de stappen in het recept genummerd, dan is elk nummer één stap. Laat de nummers zelf weg.`;

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

export async function POST(request: Request): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error("Scan: omgevingsvariabelen ontbreken");
    return json(503, { error: "niet_ingesteld" });
  }

  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { error: "niet_ingelogd" });

  // Body: { images: [{ type: "image/jpeg", data: "<base64>" }, ...] }, één of meer pagina's van hetzelfde recept.
  const body = await request.text();
  if (body.length > MAX_BYTES) return json(413, { error: "te_groot" });
  let images: { type: ImageType; data: string }[];
  try {
    const raw = (JSON.parse(body) as { images?: unknown }).images;
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
    return json(200, JSON.parse(text));
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
