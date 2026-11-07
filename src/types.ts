export const MEALS = ["Ontbijt", "Lunch", "Diner", "Snack", "Dessert", "Bijgerecht"] as const;
export const TASTES = ["Zoet", "Zout", "Hartig", "Pittig", "Zuur", "Fris"] as const;
export const UNITS = [
  "", "g", "kg", "ml", "dl", "l", "el", "tl", "snufje", "stuk(s)",
  "teen", "blik", "bos", "plak", "kopje", "naar smaak",
] as const;

export type Ingredient = { qty: string; unit: string; name: string };

export type Recipe = {
  id: string;
  title: string;
  description: string | null;
  meals: string[] | null;
  tastes: string[] | null;
  minutes: number | null;
  servings: number | null;
  ingredients: Ingredient[] | null;
  steps: string[] | null;
  photos: string[] | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
};

/** The fields the editor writes; who/when is filled in by the database. */
export type RecipeInput = Pick<
  Recipe,
  "title" | "description" | "meals" | "tastes" | "minutes" | "servings" | "ingredients" | "steps" | "photos"
>;

export type SortKey = "new" | "az" | "time";
