export const MEALS = ["Ontbijt", "Lunch", "Diner", "Snack", "Dessert", "Bijgerecht"] as const;
export const TASTES = ["Zoet", "Zout", "Hartig", "Pittig", "Zuur", "Fris"] as const;
/** Soort gerecht. */
export const KINDS = [
  "Soep", "Salade", "Pasta", "Rijst & noedels", "Ovenschotel", "Stamppot", "Stoofpot", "Wok", "Pizza",
  "Quiche & hartige taart", "Sandwich & wrap", "Saus & dip", "Brood", "Taart & cake", "Koekjes", "Gebak",
  "Toetje", "IJs", "Drankje", "Smoothie",
] as const;
/** Hoofdingrediënt. */
export const MAINS = ["Vlees", "Kip", "Vis", "Schaaldieren", "Ei", "Vegetarisch", "Veganistisch"] as const;
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
  kinds?: string[] | null;
  mains?: string[] | null;
  minutes: number | null;
  servings: number | null;
  ingredients: Ingredient[] | null;
  steps: string[] | null;
  /** Free notes: tips, variations, where the recipe comes from. */
  notes?: string | null;
  photos: string[] | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  /** Filled in by the database: the name of whoever posted / last changed it. */
  created_by_name?: string | null;
  updated_by_name?: string | null;
};

/** The fields the editor writes; who/when is filled in by the database. */
export type RecipeInput = Pick<
  Recipe,
  "title" | "description" | "meals" | "tastes" | "kinds" | "mains" | "minutes" | "servings" | "ingredients" | "steps" | "notes" | "photos"
>;

export type SortKey = "new" | "az" | "time";
