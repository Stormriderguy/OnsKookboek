/** Reads "250", "1,5", "0.5" or "1/2". Returns null for anything else ("snufje", "2-3"). */
export function parseQty(s: string | null | undefined): number | null {
  if (s == null) return null;
  const m = String(s).trim().replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(m)) return parseFloat(m);
  const f = m.match(/^(\d+)\/(\d+)$/);
  if (f && +f[2] !== 0) return +f[1] / +f[2];
  return null;
}

/** Dutch notation with a decimal comma; rounds big numbers to whole ones. */
export function fmtQty(n: number): string {
  const r = n >= 10 ? Math.round(n) : Math.round(n * 100) / 100;
  return String(r).replace(".", ",");
}

export function fmtDate(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

/** Scale a photo down to max 1600 px on the longest side, as JPEG 0.85. */
export async function shrink(file: File): Promise<Blob> {
  const MAX = 1600;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (blob) return blob;
  } catch {
    // Fall through: upload the original if the browser can't decode it.
  }
  return file;
}
