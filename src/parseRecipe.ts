import type { Ingredient } from "./types";

/** What could be read from a recipe photo. Anything not found stays empty. */
export type ParsedRecipe = {
  title: string;
  description: string;
  servings: number | null;
  minutes: number | null;
  ingredients: Ingredient[];
  steps: string[];
};

const UNITS: [RegExp, string][] = [
  [/^(g|gr|gram|grams)\.?$/i, "g"],
  [/^(kg|kilo|kilogram)\.?$/i, "kg"],
  [/^(ml|milliliter)\.?$/i, "ml"],
  [/^(cl|centiliter)\.?$/i, "cl"],
  [/^(dl|deciliter)\.?$/i, "dl"],
  [/^(l|ltr|liter)\.?$/i, "l"],
  [/^(el|eetl|eetlepel|eetlepels)\.?$/i, "el"],
  [/^(tl|thl|theel|theelepel|theelepels)\.?$/i, "tl"],
  [/^(snufje|snuf|snufjes|mespunt|mespuntje)$/i, "snufje"],
  [/^(stuk|stuks|st|stuk\(s\))\.?$/i, "stuk(s)"],
  [/^(teen|teentje|teentjes|tenen)$/i, "teen"],
  [/^(blik|blikje|blikjes|blikken)$/i, "blik"],
  [/^(bos|bosje|bosjes)$/i, "bos"],
  [/^(plak|plakje|plakjes|plakken)$/i, "plak"],
  [/^(kop|kopje|kopjes)$/i, "kopje"],
];

const unitOf = (word: string) => UNITS.find(([re]) => re.test(word))?.[1] ?? null;

/** "1½" → "1,5", "½" → "1/2": the forms the servings counter can calculate with. */
function normalizeFractions(s: string): string {
  return s
    .replace(/(\d)\s*½/g, "$1,5")
    .replace(/(\d)\s*¼/g, "$1,25")
    .replace(/(\d)\s*¾/g, "$1,75")
    .replace(/½/g, "1/2")
    .replace(/¼/g, "1/4")
    .replace(/¾/g, "3/4")
    .replace(/⅓/g, "1/3")
    .replace(/⅔/g, "2/3");
}

const stripBullet = (s: string) => s.replace(/^[\s\-–—•·*»>]+(?=\S)/, "").trim();
const QTY = /^(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)\s*(.*)$/;

/** One ingredient line ("1½ el olijfolie") split into amount, unit and name. */
export function parseIngredient(line: string): Ingredient {
  let s = normalizeFractions(stripBullet(line)).replace(/\s+/g, " ").trim();
  let unit = "";
  if (/\bnaar smaak\b/i.test(s)) {
    unit = "naar smaak";
    s = s.replace(/[,(]?\s*naar smaak\s*\)?/i, " ").trim();
  }
  let qty = "";
  const m = s.match(QTY);
  if (m) {
    qty = m[1].replace(/\s/g, "").replace(".", ",");
    s = m[2];
  }
  if (!unit) {
    const [first, ...rest] = s.split(" ");
    const u = first ? unitOf(first) : null;
    if (u && (qty || u === "snufje")) {
      unit = u;
      s = rest.join(" ");
    }
  }
  // The app has no centiliter: 5 cl → 50 ml.
  if (unit === "cl") {
    const n = Number(qty.replace(",", "."));
    if (qty && !Number.isNaN(n)) {
      qty = String(Math.round(n * 10 * 100) / 100).replace(".", ",");
      unit = "ml";
    } else {
      unit = "";
      s = `cl ${s}`;
    }
  }
  const name = s.replace(/^(van de|van het|van)\s+/i, "").replace(/[;,.]+$/, "").trim();
  return { qty, unit, name };
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const int = (v: unknown, max: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 1 && n <= max ? Math.round(n) : null;
};

/** Cleans up what the scanner's AI model returned, so it fits the form's fields and units. */
export function normalizeParsed(raw: unknown): ParsedRecipe {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  let title = str(r.title).replace(/[:.]+$/, "");
  if (title && title === title.toUpperCase()) title = title.charAt(0) + title.slice(1).toLowerCase();

  const ingredients = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .map((i) => {
      const o = (i && typeof i === "object" ? i : {}) as Record<string, unknown>;
      // Run qty, unit and name together through the same parser as a typed line,
      // so units are mapped onto the app's list and unknown units stay in the name.
      return parseIngredient([str(o.qty), str(o.unit), str(o.name)].filter(Boolean).join(" "));
    })
    .filter((i) => i.name || i.qty);

  const steps = (Array.isArray(r.steps) ? r.steps : [])
    .map((s) => str(s).replace(/^(stap\s*)?\d{1,2}\s*[.):]\s*/i, ""))
    .filter((s) => s.length > 2);

  return {
    title,
    description: str(r.description).slice(0, 400),
    servings: int(r.servings, 99),
    minutes: int(r.minutes, 1440),
    ingredients,
    steps,
  };
}

/** The result as readable text, for "Herkende tekst bekijken". */
export function parsedAsText(p: ParsedRecipe): string {
  const meta = [p.servings && `${p.servings} personen`, p.minutes && `${p.minutes} minuten`].filter(Boolean).join(" · ");
  const lines = [p.title, p.description, meta].filter(Boolean);
  if (p.ingredients.length) lines.push("", "Ingrediënten", ...p.ingredients.map((i) => `- ${[i.qty, i.unit, i.name].filter(Boolean).join(" ")}`));
  if (p.steps.length) lines.push("", "Bereiding", ...p.steps.map((s, n) => `${n + 1}. ${s}`));
  return lines.join("\n").trim();
}
