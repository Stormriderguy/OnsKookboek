// PDFs from api/pdf.ts: the whole cookbook (made weekly, kept in Supabase) and a single recipe to share or print.
import { supabase } from "./supabase";

const BUCKET = "kookboek-pdf";
const FILE = "Ons-Kookboek.pdf";

async function token(): Promise<string | null> {
  return (await supabase?.auth.getSession())?.data.session?.access_token ?? null;
}

/** When the cookbook PDF was last made, or null if there is none yet. */
export async function bookUpdated(): Promise<Date | null> {
  const { data } = (await supabase?.storage.from(BUCKET).list("", { search: FILE, limit: 1 })) ?? {};
  const when = data?.find((f) => f.name === FILE)?.updated_at;
  return when ? new Date(when) : null;
}

/** Makes the cookbook PDF again now (at most every few minutes; otherwise the last one stays). */
export async function refreshBook(): Promise<boolean> {
  const t = await token();
  if (!t) return false;
  const res = await fetch("/api/pdf", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(290_000),
  }).catch(() => null);
  return !!res?.ok;
}

/** A short-lived link to download the cookbook PDF, or null if there is none yet. */
export async function bookLink(): Promise<string | null> {
  const { data } = (await supabase?.storage.from(BUCKET).createSignedUrl(FILE, 120, { download: FILE })) ?? {};
  return data?.signedUrl ?? null;
}

/** A PDF of one recipe, as a file that can be shared. */
export async function recipePdf(id: string, title: string): Promise<File | null> {
  const t = await token();
  if (!t) return null;
  const res = await fetch("/api/pdf", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipe: id }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const name = (title || "Recept").replace(/[\\/:*?"<>|]+/g, "").trim() || "Recept";
  return new File([await res.blob()], `${name}.pdf`, { type: "application/pdf" });
}

/** Can this device share files (the phone's share menu: WhatsApp, mail, print …)? */
export function canShareFile(file: File): boolean {
  return typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
}

/** Opens the share menu for the file. Returns false if it was cancelled or didn't work. */
export async function shareFile(file: File, title: string): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch {
    return false;
  }
}

/** Saves the file (on a computer: to Downloads, from where it can be printed or mailed). */
export function saveFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
