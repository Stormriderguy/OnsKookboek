// Voedingswaarden in de app: de koppeling van een recept ophalen, zo nodig aanvullen via api/nutrition.ts,
// en NEVO-producten zoeken. Het rekenwerk zelf staat in api/_lib/nutrition.ts (ook gebruikt door de PDF).
import { lineKey, type NevoFood, type NutritionItem } from "../api/_lib/nutrition";
import { supabase } from "./supabase";
import type { Recipe } from "./types";

export type Nutrition = { items: NutritionItem[]; foods: Map<number, NevoFood> };

const linesOf = (r: Recipe) =>
  (r.ingredients ?? [])
    .map((i) => ({ qty: (i.qty ?? "").trim(), unit: i.unit ?? "", name: (i.name ?? "").trim() }))
    .filter((i) => i.name);

async function foodsFor(items: NutritionItem[]): Promise<Map<number, NevoFood>> {
  const codes = [...new Set(items.map((i) => i.nevo).filter(Boolean))];
  if (!codes.length || !supabase) return new Map();
  const { data } = await supabase.from("nevo").select("*").in("code", codes);
  return new Map(((data as NevoFood[] | null) ?? []).map((f) => [f.code, f]));
}

/**
 * The nutrition of a recipe. Lines that were linked before keep their link (also when someone corrected it);
 * new or changed lines are linked now by Claude and saved for everyone.
 */
export async function loadNutrition(r: Recipe): Promise<Nutrition> {
  const db = supabase!;
  const { data } = await db.from("recipe_nutrition").select("items").eq("recipe_id", r.id).maybeSingle();
  const known = new Map(((data?.items as NutritionItem[] | undefined) ?? []).map((it) => [lineKey(it), it]));
  const lines = linesOf(r);
  const missing = lines.filter((l) => !known.has(lineKey(l)));

  if (missing.length) {
    const token = (await db.auth.getSession()).data.session?.access_token;
    const res = token
      ? await fetch("/api/nutrition", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ lines: missing }),
          signal: AbortSignal.timeout(60_000),
        }).catch(() => null)
      : null;
    if (!res?.ok) throw new Error("koppelen");
    const { items } = (await res.json()) as { items: { nevo: number; g: number }[] };
    missing.forEach((l, i) => known.set(lineKey(l), { ...l, nevo: items[i]?.nevo ?? 0, g: items[i]?.g ?? 0 }));
  }

  const items = lines.map((l) => ({ ...known.get(lineKey(l))!, ...l }));
  // Save when something new was linked, or lines were removed from the recipe.
  if (missing.length || (data?.items as unknown[] | undefined)?.length !== items.length) await saveNutrition(r.id, items);
  return { items, foods: await foodsFor(items) };
}

/** Saves the links of a recipe (also after someone corrected one). */
export async function saveNutrition(recipeId: string, items: NutritionItem[]) {
  await supabase!.from("recipe_nutrition").upsert({ recipe_id: recipeId, items, updated_at: new Date().toISOString() });
}

/** NEVO products matching a search word, for correcting a link. */
export async function searchNevo(term: string): Promise<NevoFood[]> {
  if (!term.trim() || !supabase) return [];
  const { data } = await supabase.rpc("nevo_zoek", { term: term.trim(), aantal: 12 });
  return (data as NevoFood[] | null) ?? [];
}

export { foodsFor };
