// Het hele kookboek als PDF (Vercel). Elke week maakt Vercel hem automatisch (zie "crons" in vercel.json);
// een lid kan hem ook meteen laten bijwerken met de knop in de app. Alleen de nieuwste wordt bewaard,
// als kookboek-pdf/Ons-Kookboek.pdf in Supabase. Leden downloaden hem via de app.
//
// Nodig in Vercel: SUPABASE_SECRET_KEY (de geheime sleutel van Supabase, om alle recepten te lezen en het bestand
// op te slaan; komt nooit in de browser) en CRON_SECRET (een zelfgekozen wachtwoord waarmee Vercel de wekelijkse
// taak start).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import sharp from "sharp";

const BUCKET_PHOTOS = "recipe-photos";
const BUCKET_PDF = "kookboek-pdf";
const FILE = "Ons-Kookboek.pdf";
const MIN_MINUTES_BETWEEN = 10; // a member can ask for a fresh PDF at most this often

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const PUBLIC_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

type Ingredient = { qty?: string; unit?: string; name?: string };
type Row = {
  title: string;
  description: string | null;
  meals: string[] | null;
  tastes: string[] | null;
  kinds: string[] | null;
  mains: string[] | null;
  minutes: number | null;
  servings: number | null;
  ingredients: Ingredient[] | null;
  steps: string[] | null;
  photos: string[] | null;
  created_at: string;
  created_by_name: string | null;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// ---------------------------------------------------------------------------
// Who may start it
// ---------------------------------------------------------------------------

/** Vercel's weekly job: it sends CRON_SECRET along. */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return json(401, { error: "niet_toegestaan" });
  return run();
}

/** "Nu bijwerken" in the app: only members, and not more often than every few minutes. */
export async function POST(request: Request): Promise<Response> {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token || !SUPABASE_URL || !PUBLIC_KEY) return json(401, { error: "niet_ingelogd" });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_member`, {
    method: "POST",
    headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok || (await res.json().catch(() => false)) !== true) return json(401, { error: "niet_ingelogd" });

  // One recipe, to share or print: { recipe: "<id>" }. Read as the member, so no secret key is needed.
  const body = (await request.json().catch(() => ({}))) as { recipe?: unknown };
  if (typeof body.recipe === "string" && body.recipe) return oneRecipe(body.recipe, token);

  const admin = adminClient();
  if (!admin) return json(503, { error: "niet_ingesteld" });
  const updated = await lastUpdate(admin);
  if (updated && Date.now() - updated.getTime() < MIN_MINUTES_BETWEEN * 60_000) {
    return json(200, { ok: true, updated: updated.toISOString(), fresh: false });
  }
  return run();
}

function adminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SECRET_KEY) return null;
  return createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function lastUpdate(admin: SupabaseClient): Promise<Date | null> {
  const { data } = await admin.storage.from(BUCKET_PDF).list("", { search: FILE, limit: 1 });
  const when = data?.find((f) => f.name === FILE)?.updated_at;
  return when ? new Date(when) : null;
}

async function run(): Promise<Response> {
  const admin = adminClient();
  if (!admin) {
    console.error("PDF: SUPABASE_SECRET_KEY of VITE_SUPABASE_URL ontbreekt");
    return json(503, { error: "niet_ingesteld" });
  }
  const started = Date.now();
  const { data, error } = await admin.from("recipes").select("*");
  if (error) {
    console.error("PDF: recepten ophalen mislukt:", error.message);
    return json(503, { error: "supabase" });
  }
  const recipes = (data as Row[]).sort((a, b) => (a.title || "").localeCompare(b.title || "", "nl"));
  const bytes = await makeBook(admin, recipes);
  const { error: upErr } = await admin.storage
    .from(BUCKET_PDF)
    .upload(FILE, bytes, { upsert: true, contentType: "application/pdf", cacheControl: "60" });
  if (upErr) {
    console.error("PDF: opslaan mislukt:", upErr.message);
    return json(503, { error: "opslaan" });
  }
  console.log(`PDF klaar: ${recipes.length} recepten, ${Math.round(bytes.length / 1024)} kB, ${Date.now() - started} ms`);
  return json(200, { ok: true, updated: new Date().toISOString(), recipes: recipes.length, fresh: true });
}

/** A PDF of one recipe, sent straight back to the app (to share, mail or print). */
async function oneRecipe(id: string, token: string): Promise<Response> {
  const asMember = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await asMember.from("recipes").select("*").eq("id", id).maybeSingle();
  if (error) return json(503, { error: "supabase" });
  if (!data) return json(404, { error: "niet_gevonden" });
  const row = data as Row;

  const doc = await PDFDocument.create();
  doc.setTitle(row.title || "Recept");
  doc.setAuthor(row.created_by_name || "Ons Kookboek");
  doc.setLanguage("nl-NL");
  const f = await fonts(doc);
  const photo = row.photos?.[0] ? await smallPhoto(asMember, row.photos[0]) : null;
  const image = photo ? await doc.embedJpg(photo).catch(() => null) : null;
  recipePages(doc, f, row, image);
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const text = pages.length > 1 ? `Uit Ons Kookboek  ·  ${i + 1}/${pages.length}` : "Uit Ons Kookboek";
    page.drawText(text, { x: A4[0] / 2 - f.body.widthOfTextAtSize(text, 9) / 2, y: 26, size: 9, font: f.body, color: MUTED });
  });
  const bytes = await doc.save();
  const name = (row.title || "Recept").replace(/[\\/:*?"<>|]+/g, "").trim() || "Recept";
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="recept.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`,
      "Cache-Control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// Photos: the first photo of each recipe, small (max 700 px, JPEG), so the PDF stays a few MB
// ---------------------------------------------------------------------------

async function smallPhoto(admin: SupabaseClient, path: string): Promise<Buffer | null> {
  try {
    const { data } = await admin.storage.from(BUCKET_PHOTOS).download(path);
    if (!data) return null;
    const input = Buffer.from(await data.arrayBuffer());
    return await sharp(input).rotate().resize(700, 700, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 68 }).toBuffer();
  } catch (e) {
    console.error("PDF: foto overgeslagen:", path, String(e));
    return null;
  }
}

/** Runs `fn` over the items, a few at a time. */
async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

// ---------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------

const A4: [number, number] = [595.28, 841.89];
const M = 50; // margin
const ROSE = rgb(0.702, 0.302, 0.431); // #B34D6E
const ROSE_DARK = rgb(0.612, 0.243, 0.369); // #9C3E5E
const ROSE_SOFT = rgb(0.965, 0.867, 0.894); // #F6DDE4
const INK = rgb(0.227, 0.133, 0.161); // #3A2229
const MUTED = rgb(0.522, 0.4, 0.431); // #85666E
const SAGE = rgb(0.369, 0.498, 0.384); // #5E7F62

const months = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const dutchDate = (d: Date) => {
  const nl = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  return `${nl.getDate()} ${months[nl.getMonth()]} ${nl.getFullYear()}`;
};

async function makeBook(admin: SupabaseClient, recipes: Row[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Ons Kookboek");
  doc.setAuthor("Ons Kookboek");
  doc.setLanguage("nl-NL");
  const f = await fonts(doc);

  const photos = await inBatches(recipes, 6, (r) => (r.photos?.[0] ? smallPhoto(admin, r.photos[0]) : Promise.resolve(null)));
  const images = await Promise.all(photos.map((p) => (p ? doc.embedJpg(p).catch(() => null) : null)));

  // Cover
  cover(doc, f, recipes.length);

  // Recipes first, so we know their page numbers; the contents go in front of them afterwards.
  const starts: number[] = [];
  recipes.forEach((r, i) => {
    starts.push(doc.getPageCount());
    recipePages(doc, f, r, images[i]);
  });

  // Contents, inserted after the cover.
  const perPage = 34;
  const tocPages = Math.max(1, Math.ceil(recipes.length / perPage));
  for (let p = 0; p < tocPages; p++) {
    const page = doc.insertPage(1 + p, A4);
    let y = A4[1] - M;
    if (p === 0) {
      page.drawText("Inhoud", { x: M, y: y - 26, size: 30, font: f.title, color: ROSE_DARK });
      y -= 64;
    }
    for (const [j, r] of recipes.slice(p * perPage, (p + 1) * perPage).entries()) {
      const i = p * perPage + j;
      const num = String(starts[i] + tocPages + 1); // +1: page numbers start at 1
      const title = fit(clean(r.title || "Naamloos recept", f.body), f.body, 11.5, A4[0] - 2 * M - 40);
      page.drawText(title, { x: M, y, size: 11.5, font: f.body, color: INK });
      page.drawText(num, { x: A4[0] - M - f.body.widthOfTextAtSize(num, 11.5), y, size: 11.5, font: f.body, color: MUTED });
      y -= 20;
    }
  }

  // Page numbers at the bottom of every page except the cover.
  doc.getPages().forEach((page, i) => {
    if (i === 0) return;
    const n = String(i + 1);
    page.drawText(n, { x: A4[0] / 2 - f.body.widthOfTextAtSize(n, 9) / 2, y: 26, size: 9, font: f.body, color: MUTED });
  });

  return doc.save();
}

type Fonts = { title: PDFFont; serif: PDFFont; body: PDFFont; bold: PDFFont };

async function fonts(doc: PDFDocument): Promise<Fonts> {
  return {
    title: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
    serif: await doc.embedFont(StandardFonts.TimesRomanItalic),
    body: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

function cover(doc: PDFDocument, f: Fonts, count: number) {
  const page = doc.addPage(A4);
  const [w, h] = A4;
  page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(0.984, 0.957, 0.953) });
  page.drawRectangle({ x: 0, y: h * 0.42, width: w, height: h * 0.3, color: ROSE_DARK });
  // The logo: a bowl with a heart and three curls of steam.
  const cx = w / 2;
  const by = h * 0.42 + h * 0.3 * 0.56;
  page.drawSvgPath("M -60 0 L 60 0 A 60 60 0 0 1 -60 0 Z", { x: cx, y: by, color: rgb(0.984, 0.957, 0.953) });
  page.drawRectangle({ x: cx - 70, y: by - 6, width: 140, height: 12, color: rgb(0.984, 0.957, 0.953) });
  page.drawSvgPath("M 0 22 C -7 16 -19 9 -19 -1 A 9.5 9.5 0 0 1 0 -4.5 A 9.5 9.5 0 0 1 19 -1 C 19 9 7 16 0 22 Z", {
    x: cx,
    y: by - 20,
    color: ROSE_DARK,
  });
  for (const dx of [-25, 0, 25]) {
    page.drawSvgPath("M 0 0 C -11 -13 11 -22 0 -38", { x: cx + dx, y: by + 14, borderColor: rgb(0.663, 0.804, 0.678), borderWidth: 8, borderLineCap: 1 });
  }
  const title = "Ons Kookboek";
  page.drawText(title, { x: cx - f.title.widthOfTextAtSize(title, 46) / 2, y: h * 0.42 - 70, size: 46, font: f.title, color: ROSE_DARK });
  const sub = `${count === 1 ? "1 recept" : `${count} recepten`} · bijgewerkt op ${dutchDate(new Date())}`;
  page.drawText(sub, { x: cx - f.body.widthOfTextAtSize(sub, 12) / 2, y: h * 0.42 - 100, size: 12, font: f.body, color: MUTED });
}

/**
 * How a recipe is laid out. Recipes should fit on one page: the first layout that fits is used —
 * first a smaller photo, then slightly smaller letters with the ingredients and steps side by side.
 * Only a recipe that is too long even then goes on over more pages (in the first layout, with a smaller photo).
 */
type Layout = { photo: number; s: number; cols: boolean };
const LAYOUTS: Layout[] = [
  { photo: 230, s: 1, cols: false },
  { photo: 170, s: 1, cols: false },
  { photo: 170, s: 0.95, cols: true },
  { photo: 130, s: 0.9, cols: true },
  { photo: 100, s: 0.83, cols: true },
  { photo: 80, s: 0.76, cols: true },
];
const LONG: Layout = { photo: 170, s: 0.95, cols: false };

/** Writes one recipe, starting on a new page; on one page if at all possible. */
function recipePages(doc: PDFDocument, f: Fonts, r: Row, image: PDFImage | null) {
  const fits = LAYOUTS.find((L) => layoutRecipe(null, f, r, image, L) === 1);
  layoutRecipe(doc, f, r, image, fits ?? LONG);
}

type Pen = Pick<PDFPage, "drawText" | "drawImage" | "drawCircle">;
const NO_PEN: Pen = { drawText: () => {}, drawImage: () => {}, drawCircle: () => {} };

/**
 * Lays out the recipe in layout L. With doc = null it only measures. Returns the number of pages it takes;
 * a side-by-side layout never breaks pages, so it returns 2 when it doesn't fit on one.
 */
function layoutRecipe(doc: PDFDocument | null, f: Fonts, r: Row, image: PDFImage | null, L: Layout): number {
  const z = (n: number) => n * L.s;
  const width = A4[0] - 2 * M;
  const bottom = M + 20;
  let pages = 1;
  let page: Pen = doc ? doc.addPage(A4) : NO_PEN;
  let y = A4[1] - M;
  let overflow = false;
  const room = (need: number) => {
    if (y - need >= bottom) return;
    if (L.cols) {
      overflow = true;
      return;
    }
    pages++;
    page = doc ? doc.addPage(A4) : NO_PEN;
    y = A4[1] - M;
  };
  const para = (text: string, font: PDFFont, size: number, color = INK, x = M, w = width, gap = 4) => {
    for (const line of wrap(clean(text, font), font, size, w)) {
      room(size + gap);
      y -= size;
      page.drawText(line, { x, y, size, font, color });
      y -= gap;
    }
  };

  // Title
  for (const line of wrap(clean(r.title || "Naamloos recept", f.title), f.title, z(26), width)) {
    y -= z(26);
    page.drawText(line, { x: M, y, size: z(26), font: f.title, color: ROSE_DARK });
    y -= 6;
  }

  // Labels, time and servings
  const facts = [
    ...(r.meals ?? []),
    ...(r.tastes ?? []),
    ...(r.kinds ?? []),
    ...(r.mains ?? []),
    r.minutes ? `${r.minutes} min` : "",
    r.servings ? `${r.servings} ${r.servings === 1 ? "persoon" : "personen"}` : "",
  ].filter(Boolean);
  if (facts.length) {
    y -= 4;
    para(facts.join("  ·  "), f.body, z(9.5), SAGE);
  }
  y -= 8;

  // Photo
  if (image && L.photo) {
    const scale = Math.min(width / image.width, L.photo / image.height, 1.5);
    const w = image.width * scale;
    const h = image.height * scale;
    room(h + 10);
    y -= h;
    page.drawImage(image, { x: M, y, width: w, height: h });
    y -= 14;
  }

  if (r.description) {
    para(r.description, f.serif, z(12), MUTED, M, width, 5);
    y -= 8;
  }

  const ings = (r.ingredients ?? []).filter((i) => i.name || i.qty);
  const steps = (r.steps ?? []).filter(Boolean);

  /** Ingredients from y0 in a column at x, w wide; returns where it ends. */
  const ingredients = (x: number, w: number, y0: number) => {
    y = y0;
    if (!ings.length) return y;
    const qtyW = Math.min(90, w * 0.32);
    room(40);
    y -= z(14);
    page.drawText("Ingrediënten", { x, y, size: z(14), font: f.bold, color: ROSE });
    y -= 10;
    for (const i of ings) {
      const qty = clean([i.qty, i.unit].filter(Boolean).join(" "), f.bold);
      room(z(15));
      y -= z(11);
      if (qty) page.drawText(fit(qty, f.bold, z(11), qtyW - 6), { x, y, size: z(11), font: f.bold, color: ROSE });
      wrap(clean(i.name ?? "", f.body), f.body, z(11), w - qtyW).forEach((line, k) => {
        if (k > 0) {
          room(z(15));
          y -= z(14);
        }
        page.drawText(line, { x: x + qtyW, y, size: z(11), font: f.body, color: INK });
      });
      y -= z(5);
    }
    return y;
  };

  /** Steps from y0 in a column at x, w wide; returns where it ends. */
  const method = (x: number, w: number, y0: number) => {
    y = y0;
    if (!steps.length) return y;
    room(40);
    y -= z(14);
    page.drawText("Bereiding", { x, y, size: z(14), font: f.bold, color: ROSE });
    y -= 10;
    steps.forEach((s, n) => {
      wrap(clean(s, f.body), f.body, z(11), w - 24).forEach((line, k) => {
        room(z(16));
        y -= z(11);
        if (k === 0) {
          page.drawCircle({ x: x + 8, y: y + z(4), size: z(8), color: ROSE_SOFT });
          const num = String(n + 1);
          page.drawText(num, { x: x + 8 - f.bold.widthOfTextAtSize(num, z(9)) / 2, y: y + z(0.8), size: z(9), font: f.bold, color: ROSE_DARK });
        }
        page.drawText(line, { x: x + 24, y, size: z(11), font: f.body, color: INK });
        y -= z(4.5);
      });
      y -= z(7);
    });
    return y;
  };

  if (L.cols && ings.length && steps.length) {
    // Ingredients on the left, steps on the right, like in the app.
    const top = y;
    const left = Math.round(width * 0.36);
    const endL = ingredients(M, left, top);
    const endR = method(M + left + 18, width - left - 18, top);
    y = Math.min(endL, endR);
  } else {
    ingredients(M, width, y);
    y -= 8;
    method(M, width, y);
  }

  // Who added it
  if (r.created_by_name || r.created_at) {
    y -= 6;
    const when = r.created_at ? ` op ${dutchDate(new Date(r.created_at))}` : "";
    para(`Toegevoegd door ${r.created_by_name || "iemand"}${when}`, f.body, z(9), MUTED);
  }
  return overflow ? 2 : pages;
}

// ---------------------------------------------------------------------------
// Text helpers. The standard PDF fonts know Western European letters (é, ë, ½ …) but not everything:
// other characters are swapped for something close, or left out.
// ---------------------------------------------------------------------------

const SWAP: Record<string, string> = { "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "→": "->", "–": "-", "—": "-", " ": " ", "\t": " " };

function clean(text: string, font: PDFFont): string {
  let out = "";
  for (const ch of text.replace(/\r?\n/g, " ")) {
    const c = SWAP[ch] ?? ch;
    try {
      font.encodeText(c);
      out += c;
    } catch {
      // A character this font can't show (an emoji, for example): leave it out.
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    // A single word longer than the line: cut it.
    while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function fit(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t}…`;
}
