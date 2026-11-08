// Voedingswaarden en Nutri-Score: rekenwerk dat de app (src/) en de PDF (api/pdf.ts) allebei gebruiken.
// Geen pakketten en niets van de server, zodat de app dit bestand ook kan laden.
// (Bestanden in api/ die met _ beginnen worden door Vercel niet als losse functie gezien.)

export const NEVO_SOURCE = "Gebaseerd op gegevens van NEVO-online versie 2025/9.0, RIVM, Bilthoven";

/** One NEVO food, values per 100 g (or 100 ml), unchanged from NEVO-online. */
export type NevoFood = {
  code: number;
  naam: string;
  synoniem?: string | null;
  groep: string | null;
  eenheid: string | null;
  kcal: number | null;
  eiwit: number | null;
  koolh: number | null;
  suikers: number | null;
  vet: number | null;
  verz_vet: number | null;
  vezels: number | null;
  natrium_mg: number | null;
};

/** One ingredient line with its link to NEVO: the product (0 = none) and the grams for the whole line. */
export type NutritionItem = { qty: string; unit: string; name: string; nevo: number; g: number };

export type Totals = {
  gram: number;
  kcal: number;
  eiwit: number;
  koolh: number;
  suikers: number;
  vet: number;
  verzVet: number;
  vezels: number;
  zout: number;
  /** Grams of fruit, vegetables and legumes (for the Nutri-Score). */
  fvlGram: number;
};

/** The key of an ingredient line: when it changes, its link has to be made again. */
export const lineKey = (i: { qty?: string; unit?: string; name?: string }) =>
  [i.qty ?? "", i.unit ?? "", i.name ?? ""].map((s) => s.trim().toLowerCase()).join("|");

/** NEVO groups that count as fruit, vegetables or legumes. */
const FVL = /groente|fruit|peulvrucht/i;

/** Adds up the linked ingredients (grams × value per 100 g). */
export function totals(items: NutritionItem[], foods: Map<number, NevoFood>): Totals {
  const t: Totals = { gram: 0, kcal: 0, eiwit: 0, koolh: 0, suikers: 0, vet: 0, verzVet: 0, vezels: 0, zout: 0, fvlGram: 0 };
  for (const it of items) {
    const f = it.nevo ? foods.get(it.nevo) : undefined;
    if (!f || !(it.g > 0)) continue;
    const k = it.g / 100;
    t.gram += it.g;
    t.kcal += (f.kcal ?? 0) * k;
    t.eiwit += (f.eiwit ?? 0) * k;
    t.koolh += (f.koolh ?? 0) * k;
    t.suikers += (f.suikers ?? 0) * k;
    t.vet += (f.vet ?? 0) * k;
    t.verzVet += (f.verz_vet ?? 0) * k;
    t.vezels += (f.vezels ?? 0) * k;
    t.zout += (((f.natrium_mg ?? 0) / 1000) * 2.5) * k; // salt = sodium × 2.5
    if (FVL.test(f.groep ?? "")) t.fvlGram += it.g;
  }
  return t;
}

export const scaled = (t: Totals, factor: number): Totals =>
  Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v * factor])) as Totals;

// ---------------------------------------------------------------------------
// Nutri-Score (updated algorithm for general foods), per 100 g of the dish.
// Officially meant for packaged products: in the app it is shown as an indication.
// ---------------------------------------------------------------------------

const points = (value: number, limits: number[]) => limits.filter((l) => value > l).length;

const ENERGY_KJ = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350];
const SUGARS = [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34, 37, 41, 44, 48, 51];
const SAT_FAT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SALT = [0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3, 3.2, 3.4, 3.6, 3.8, 4];
const PROTEIN = [2.4, 4.8, 7.2, 9.6, 12, 14, 17];
const FIBRE = [3, 4.1, 5.2, 6.3, 7.4];

export type NutriScore = { letter: "A" | "B" | "C" | "D" | "E"; score: number };

/** The Nutri-Score of the whole dish, or null when too little is known (no grams). */
export function nutriScore(t: Totals): NutriScore | null {
  if (t.gram < 50) return null;
  const per100 = (v: number) => (v / t.gram) * 100;
  const kj = per100(t.kcal) * 4.184;
  const bad = points(kj, ENERGY_KJ) + points(per100(t.suikers), SUGARS) + points(per100(t.verzVet), SAT_FAT) + points(per100(t.zout), SALT);
  const fvl = per100(t.fvlGram);
  const fvlPoints = fvl > 80 ? 5 : fvl > 60 ? 2 : fvl > 40 ? 1 : 0;
  const protein = points(per100(t.eiwit), PROTEIN);
  const fibre = points(per100(t.vezels), FIBRE);
  // With many unfavourable points, protein no longer counts.
  const score = bad - fibre - fvlPoints - (bad >= 11 ? 0 : protein);
  const letter = score <= -1 ? "A" : score <= 2 ? "B" : score <= 10 ? "C" : score <= 18 ? "D" : "E";
  return { letter, score };
}

/** Dutch number: comma, no needless decimals. */
export function nl(v: number, decimals = 0): string {
  const r = Math.round(v * 10 ** decimals) / 10 ** decimals;
  return r.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
