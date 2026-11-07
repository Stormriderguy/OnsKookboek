import { normalizeParsed, type ParsedRecipe } from "./parseRecipe";
import { supabase } from "./supabase";
import { shrink } from "./util";

/** The scanner on the own Linux computer (see scanner/README.md). Empty = no scan button. */
export const SCAN_URL = ((import.meta.env.VITE_SCAN_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");

/**
 * Why a scan failed. "weg": the scanner is off, unreachable, too busy or the daily limit is reached.
 * "mislukt": the scanner was there but could not read this photo.
 */
export class ScanError extends Error {
  constructor(readonly kind: "weg" | "mislukt") {
    super(kind);
  }
}

const POLL_MS = 2000;
const MAX_WAIT_MS = 10 * 60_000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

async function call(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new ScanError("weg");
  try {
    return await fetch(`${SCAN_URL}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${session.access_token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ScanError("weg");
  }
}

/** Sends the photo to the scanner and waits for the recipe. Reports progress as a Dutch label. */
export async function scanWithAI(file: File, onStatus: (label: string) => void): Promise<ParsedRecipe> {
  if (!SCAN_URL) throw new ScanError("weg");
  onStatus("Foto verkleinen…");
  // Smaller than a recipe photo: the model works on the processor, and every pixel costs time.
  const photo = await shrink(file, 1280);

  onStatus("Foto versturen…");
  const sent = await call("/scan", { method: "POST", headers: { "Content-Type": photo.type || "image/jpeg" }, body: photo }, 60_000);
  if (sent.status === 415 || sent.status === 413) throw new ScanError("mislukt");
  if (!sent.ok) throw new ScanError("weg");
  const { id } = (await sent.json()) as { id: string };

  const start = Date.now();
  let misses = 0;
  while (Date.now() - start < MAX_WAIT_MS) {
    await wait(POLL_MS);
    let res: Response;
    try {
      res = await call(`/scan/${id}`, { method: "GET" }, 15_000);
      misses = 0;
    } catch (e) {
      // A short hiccup (phone switching networks): try again, but not forever.
      if (++misses >= 5) throw e;
      continue;
    }
    if (!res.ok) throw new ScanError("weg");
    const job = (await res.json()) as { status: string; plek?: number; result?: unknown; error?: string };
    const elapsed = clock(Date.now() - start);
    if (job.status === "klaar") return normalizeParsed(job.result);
    if (job.status === "fout") throw new ScanError(job.error === "onbereikbaar" ? "weg" : "mislukt");
    if (job.status === "wacht") onStatus(`Wachten op de scanner${job.plek && job.plek > 1 ? ` (${job.plek}e in de rij)` : ""}… ${elapsed}`);
    else onStatus(`Recept lezen, dit duurt een paar minuten… ${elapsed}`);
  }
  throw new ScanError("weg");
}
