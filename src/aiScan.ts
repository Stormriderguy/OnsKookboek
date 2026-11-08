import { normalizeParsed, type ParsedRecipe } from "./parseRecipe";
import { supabase } from "./supabase";
import { shrink, turnImage } from "./util";

/** At most this many photos per scan (pages of one recipe). Keeps the request under Vercel's 4.5 MB. */
export const MAX_SCAN_PHOTOS = 4;

/**
 * Why a scan failed. "weg": the scanner can't be used now (not set up, daily limit reached, Claude unreachable).
 * "mislukt": the scanner worked but could not read these photos.
 */
export class ScanError extends Error {
  constructor(readonly kind: "weg" | "mislukt") {
    super(kind);
  }
}

/** A photo as { type, data } with the data in base64, as the scan function expects it. */
function toBase64(blob: Blob): Promise<{ type: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ type: blob.type || "image/jpeg", data: url.slice(url.indexOf(",") + 1) });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Asks the scan function how far each photo must be turned to stand upright, and whether it is handwritten
 * (then Opus writes the text out first). 0 / false for all if that fails.
 */
async function inspectPhotos(files: File[], token: string): Promise<{ turns: number[]; handwritten: boolean[] }> {
  const none = { turns: files.map(() => 0), handwritten: files.map(() => false) };
  try {
    const images = await Promise.all(files.map(async (f) => toBase64(await shrink(f, 640))));
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ images, orient: true }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) return none;
    const { turns, handwritten } = (await res.json()) as { turns?: unknown; handwritten?: unknown };
    return {
      turns: files.map((_, i) => (Array.isArray(turns) && Number.isFinite(Number(turns[i])) ? Number(turns[i]) : 0)),
      handwritten: files.map((_, i) => Array.isArray(handwritten) && handwritten[i] === true),
    };
  } catch {
    return none;
  }
}

/**
 * Sends the photos (one or more pages of the same recipe) to the scan function (api/scan.ts on Vercel)
 * and returns the recipe, read as a whole. Photos that are on their side or crooked are first turned upright.
 * Also returns the pages as they were read (upright), so a picture of the dish can be cut out of them.
 * wantStock: also look for a photo of the dish (the recipe has none yet).
 */
export async function scanWithAI(
  files: File[],
  onStatus: (label: string) => void,
  { wantStock = false }: { wantStock?: boolean } = {},
): Promise<{ recipe: ParsedRecipe; pages: Blob[] }> {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new ScanError("weg");
  files = files.slice(0, MAX_SCAN_PHOTOS);

  onStatus(files.length > 1 ? "Foto's rechtzetten…" : "Foto rechtzetten…");
  const { turns, handwritten } = await inspectPhotos(files, session.access_token);

  // With more pages a bit smaller, so everything fits in one request.
  const side = files.length > 2 ? 1400 : 1600;
  let pages: Blob[];
  let images: { type: string; data: string }[];
  try {
    pages = await Promise.all(files.map(async (f, i) => turnImage(await shrink(f, side), turns[i])));
    images = await Promise.all(pages.map(toBase64));
  } catch {
    throw new ScanError("mislukt");
  }

  const label = files.length > 1 ? `${files.length} pagina's lezen` : "Recept lezen";
  onStatus(`${label}${handwritten.some(Boolean) ? " (handschrift, duurt iets langer)" : ""}, even geduld…`);
  let res: Response;
  try {
    res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ images, wantStock, handwritten }),
      signal: AbortSignal.timeout(150_000),
    });
  } catch {
    throw new ScanError("weg");
  }
  if (res.status === 413 || res.status === 415 || res.status === 422) throw new ScanError("mislukt");
  if (!res.ok) throw new ScanError("weg");
  return { recipe: normalizeParsed(await res.json()), pages };
}
