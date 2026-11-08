// Koppelt de ingrediënten van een recept aan NEVO-producten (voor de voedingswaarden). Alleen voor leden.
// Body: { lines: [{ qty, unit, name }] } → { items: [{ nevo, g }] }. Telt niet mee voor de scan-daglimiet.
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { linkIngredients } from "./_lib/match.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const PUBLIC_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  if (!SUPABASE_URL || !PUBLIC_KEY || !process.env.ANTHROPIC_API_KEY) return json(503, { error: "niet_ingesteld" });
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { error: "niet_ingelogd" });

  // As the member: only members can search NEVO, so this also checks membership.
  const db = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: member } = await db.rpc("is_member");
  if (member !== true) return json(401, { error: "niet_ingelogd" });

  const body = (await request.json().catch(() => ({}))) as { lines?: unknown };
  const lines = (Array.isArray(body.lines) ? body.lines : [])
    .slice(0, 60)
    .map((l: { qty?: unknown; unit?: unknown; name?: unknown }) => ({
      qty: String(l?.qty ?? "").slice(0, 20),
      unit: String(l?.unit ?? "").slice(0, 20),
      name: String(l?.name ?? "").slice(0, 120),
    }))
    .filter((l) => l.name.trim());
  if (!lines.length) return json(200, { items: [] });

  try {
    const items = await linkIngredients(new Anthropic({ timeout: 60_000, maxRetries: 1 }), db, lines);
    return json(200, { items });
  } catch (e) {
    console.error("Voeding koppelen mislukt:", e);
    return json(503, { error: "claude" });
  }
}
