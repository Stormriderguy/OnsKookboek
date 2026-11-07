/**
 * Reads the text on a photo, on the device itself (Tesseract, Dutch).
 * Loaded only when someone scans, so the app itself stays small.
 * The first scan downloads the Dutch language data (a few MB); the browser keeps it after that.
 */
export async function readTextFromPhoto(file: File, onProgress: (fraction: number, label: string) => void): Promise<string> {
  onProgress(0, "Voorbereiden…");
  const [{ createWorker }, image] = await Promise.all([import("tesseract.js"), prepare(file)]);
  const worker = await createWorker("nld", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") onProgress(m.progress, "Tekst herkennen…");
      else onProgress(0, "Voorbereiden…");
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

/** Upright, grey and with more contrast: Tesseract reads that more reliably. */
async function prepare(file: File): Promise<HTMLCanvasElement | File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const MAX = 2400;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.filter = "grayscale(1) contrast(1.4)";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  } catch {
    return file;
  }
}
