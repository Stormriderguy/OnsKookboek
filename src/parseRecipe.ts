import type { Ingredient } from "./types";

/** What could be read from a recipe text. Anything not found stays empty. */
export type ParsedRecipe = {
  title: string;
  description: string;
  servings: number | null;
  minutes: number | null;
  ingredients: Ingredient[];
  steps: string[];
};

const ING_HEADING = /^(ingredi[eë]nten|ingredienten|benodigdheden|boodschappen(lijst)?|wat heb je nodig|je hebt nodig|nodig)\b/i;
const STEP_HEADING = /^(bereiding(swijze)?|werkwijze|instructies|zo maak je het|aan de slag|methode)\b/i;

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
  [/^(stuk|stuks|st)\.?$/i, "stuk(s)"],
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

const stripBullet = (s: string) => s.replace(/^[\s\-–—•·*o»>]+(?=\S)/, "").trim();
const QTY = /^(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)\s*(.*)$/;
const startsWithQty = (s: string) => QTY.test(normalizeFractions(stripBullet(s)));

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
  const name = s.replace(/^(van de|van het|van)\s+/i, "").replace(/[;,.]+$/, "").trim();
  return { qty, unit, name };
}

function findServings(lines: string[]): number | null {
  for (const l of lines) {
    const m = l.match(/(\d+)\s*(personen|persoon|pers\b|porties|portie)/i) || l.match(/\bvoor\s+(\d+)\b/i);
    if (m && +m[1] > 0 && +m[1] < 100) return +m[1];
  }
  return null;
}

function minutesIn(line: string): number | null {
  const l = line.replace(",", ".");
  const h = l.match(/(\d+(?:\.\d+)?)\s*(uur|u\b)/i);
  const m = l.match(/(\d+)\s*(min\b|min\.|minuten|minuut)/i);
  if (!h && !m) return null;
  return Math.round((h ? parseFloat(h[1]) * 60 : 0) + (m ? +m[1] : 0));
}

function findMinutes(lines: string[]): number | null {
  const timed = lines.find((l) => /tijd/i.test(l) && minutesIn(l) != null);
  if (timed) return minutesIn(timed);
  for (const l of lines) {
    const n = minutesIn(l);
    if (n != null) return n;
  }
  return null;
}

/** A line that reads like a step: numbered, or a sentence of some length. */
const looksLikeStep = (l: string) => /^(stap\s*)?\d{1,2}\s*[.):]\s+\S/i.test(l) || l.split(/\s+/).length > 7;

/** A line that reads like an ingredient: starts with an amount, or is short with a unit word. */
function looksLikeIngredient(l: string): boolean {
  if (looksLikeStep(l) && !startsWithQty(l)) return false;
  if (startsWithQty(l)) return true;
  const words = stripBullet(l).split(/\s+/);
  return words.length <= 5 && words.some((w) => unitOf(w) != null) && !/[.!?]$/.test(l);
}

function buildSteps(lines: string[]): string[] {
  const steps: string[] = [];
  for (const raw of lines) {
    const numbered = raw.match(/^(?:stap\s*)?\d{1,2}\s*[.):]\s*(.*)$/i);
    const bulleted = /^[-–•·*]\s+/.test(raw);
    const text = numbered ? numbered[1].trim() : stripBullet(raw);
    if (!text) continue;
    const last = steps.length - 1;
    // A line without its own number continues the previous step until that ends in a full stop.
    if (!numbered && !bulleted && last >= 0 && !/[.!?]$/.test(steps[last])) steps[last] = `${steps[last]} ${text}`;
    else steps.push(text);
  }
  return steps.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 2);
}

/** Readable characters as a share of the line: scanner noise scores low. */
const isNoise = (l: string) => {
  const good = (l.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return good < 2 || good / l.length < 0.5;
};

export function parseRecipe(text: string): ParsedRecipe {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !isNoise(l));

  const intro: string[] = [];
  let ingLines: string[] = [];
  let stepLines: string[] = [];
  let section: "intro" | "ing" | "steps" = "intro";
  let headings = 0;

  for (const l of lines) {
    const plain = l.replace(/[:.]+$/, "");
    if (ING_HEADING.test(plain) && plain.split(/\s+/).length <= 6) {
      section = "ing";
      headings++;
      intro.push(l); // keeps "Ingrediënten (voor 4 personen)" available for the servings
      continue;
    }
    if (STEP_HEADING.test(plain) && plain.split(/\s+/).length <= 6) {
      section = "steps";
      headings++;
      continue;
    }
    if (section === "ing") ingLines.push(l);
    else if (section === "steps") stepLines.push(l);
    else intro.push(l);
  }

  // A short line with only servings or time ("4 personen", "Bereidingstijd: 45 min"), or a heading.
  const isMeta = (l: string) =>
    ING_HEADING.test(l) ||
    (l.split(/\s+/).length <= 6 && (findServings([l]) != null || minutesIn(l) != null || /^(bereidings)?tijd\b/i.test(l)));
  // The title: the first line of the text that isn't one of those.
  const titleIndex = intro.findIndex((l) => !isMeta(l) && /\p{L}{2}/u.test(l));
  let title = titleIndex >= 0 ? intro[titleIndex].replace(/[:.]+$/, "") : "";
  if (title && title === title.toUpperCase()) title = title.charAt(0) + title.slice(1).toLowerCase();
  let rest = intro.filter((_, i) => i !== titleIndex);
  let stepLike: string[] = [];

  // No headings (or only some): sort the loose lines into ingredients and steps.
  if (headings === 0 || (ingLines.length === 0 && stepLines.length > 0)) {
    const loose = rest.filter((l) => !isMeta(l));
    const firstStep = loose.findIndex((l) => looksLikeStep(l) && !looksLikeIngredient(l));
    const before = firstStep < 0 ? loose : loose.slice(0, firstStep);
    const after = firstStep < 0 ? [] : loose.slice(firstStep);
    const ingFound = before.filter(looksLikeIngredient);
    ingLines = [...ingFound, ...ingLines];
    if (headings === 0) {
      stepLines = [...after, ...stepLines];
      stepLike = after;
    }
    rest = rest.filter((l) => !ingFound.includes(l) && !after.includes(l));
  }

  // Servings and time come from the top part and the ingredients, never from the steps.
  const metaPool = [...intro.filter((l) => !stepLike.includes(l)), ...ingLines];

  const description = rest
    .filter((l) => !isMeta(l))
    .join(" ")
    .slice(0, 400)
    .trim();

  return {
    title,
    description,
    servings: findServings(metaPool),
    minutes: findMinutes(metaPool),
    ingredients: ingLines
      .filter((l) => !isMeta(l))
      .map(parseIngredient)
      .filter((i) => i.name || i.qty),
    steps: buildSteps(stepLines),
  };
}
