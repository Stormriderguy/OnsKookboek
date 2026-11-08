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

/**
 * Cuts the picture of the dish out of a scanned photo (edges as fractions 0-1) and makes it as small
 * as is still nice to look at: max 900 px, WebP 0.6 (JPEG 0.65 where the browser can't make WebP).
 */
export async function cropSmall(
  file: Blob,
  box: { left: number; top: number; right: number; bottom: number },
  MAX = 900,
): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const sx = Math.round(box.left * bitmap.width);
    const sy = Math.round(box.top * bitmap.height);
    const sw = Math.max(1, Math.round((box.right - box.left) * bitmap.width));
    const sh = Math.max(1, Math.round((box.bottom - box.top) * bitmap.height));
    // A narrow strip (the edge of the next page) or a tiny picture is no use as a recipe photo.
    if (sw / sh < 0.4 || sw / sh > 2.5 || Math.max(sw, sh) < 250) {
      bitmap.close();
      return null;
    }
    const scale = Math.min(1, MAX / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const toBlob = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
    const webp = await toBlob("image/webp", 0.6);
    if (webp?.type === "image/webp") return webp;
    return await toBlob("image/jpeg", 0.65);
  } catch {
    return null;
  }
}

/** Scale a photo down to max 1600 px (or `MAX`) on the longest side, as JPEG 0.85. */
export async function shrink(file: File, MAX = 1600): Promise<Blob> {
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
