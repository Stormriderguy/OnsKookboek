import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Supabase's own "Connect" screen calls it PUBLISHABLE_KEY; both names work.
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined;

/** Null when the environment variables are missing; the app then shows a setup message. */
export const supabase = url && key ? createClient(url, key) : null;

export const BUCKET = "recipe-photos";

export function photoUrl(path: string): string {
  if (!supabase) return "";
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
