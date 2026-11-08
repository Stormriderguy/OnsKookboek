import { normalizeParsed, type ParsedRecipe } from "./parseRecipe";
import { supabase } from "./supabase";
import { shrink } from "./util";

/**
 * Why a scan failed. "weg": the scanner can't be used now (not set up, daily limit reached, Claude unreachable).
 * "mislukt": the scanner worked but could not read this photo.
 */
export class ScanError extends Error {
  constructor(readonly kind: "weg" | "mislukt") {
    super(kind);
  }
}

/** Sends the photo to the scan function (api/scan.ts on Vercel) and returns the recipe. */
export async function scanWithAI(file: File, onStatus: (label: string) => void): Promise<ParsedRecipe> {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new ScanError("weg");

  onStatus("Foto verkleinen…");
  const photo = await shrink(file, 1600);

  onStatus("Recept lezen, even geduld…");
  let res: Response;
  try {
    res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": photo.type || "image/jpeg", Authorization: `Bearer ${session.access_token}` },
      body: photo,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new ScanError("weg");
  }
  if (res.status === 413 || res.status === 415 || res.status === 422) throw new ScanError("mislukt");
  if (!res.ok) throw new ScanError("weg");
  return normalizeParsed(await res.json());
}
