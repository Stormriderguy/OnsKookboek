import { normalizeParsed, type ParsedRecipe } from "./parseRecipe";
import { supabase } from "./supabase";
import { shrink } from "./util";

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
 * Sends the photos (one or more pages of the same recipe) to the scan function (api/scan.ts on Vercel)
 * and returns the recipe, read as a whole. wantStock: also look for a photo of the dish (the recipe has none yet).
 */
export async function scanWithAI(
  files: File[],
  onStatus: (label: string) => void,
  { wantStock = false }: { wantStock?: boolean } = {},
): Promise<ParsedRecipe> {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new ScanError("weg");

  onStatus(files.length > 1 ? "Foto's verkleinen…" : "Foto verkleinen…");
  // With more pages a bit smaller, so everything fits in one request.
  const side = files.length > 2 ? 1400 : 1600;
  let images: { type: string; data: string }[];
  try {
    images = await Promise.all(files.slice(0, MAX_SCAN_PHOTOS).map(async (f) => toBase64(await shrink(f, side))));
  } catch {
    throw new ScanError("mislukt");
  }

  onStatus(files.length > 1 ? `${files.length} pagina's lezen, even geduld…` : "Recept lezen, even geduld…");
  let res: Response;
  try {
    res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ images, wantStock }),
      signal: AbortSignal.timeout(150_000),
    });
  } catch {
    throw new ScanError("weg");
  }
  if (res.status === 413 || res.status === 415 || res.status === 422) throw new ScanError("mislukt");
  if (!res.ok) throw new ScanError("weg");
  return normalizeParsed(await res.json());
}
