// Koppelt ingrediënten aan NEVO-producten, met Claude Haiku (alleen op de server: api/nutrition.ts en api/pdf.ts).
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NevoFood } from "./nutrition.js";

const MODEL = "claude-haiku-5-5";

type Line = { qty: string; unit: string; name: string };

const json = <T>(response: Anthropic.Message): T => JSON.parse(response.content.find((b) => b.type === "text")?.text || "{}") as T;

/**
 * For each ingredient line: the NEVO code (0 when nothing fits) and the grams for the whole line.
 * db must be able to call the RPC nevo_zoek (a member, or the secret key).
 */
export async function linkIngredients(client: Anthropic, db: SupabaseClient, lines: Line[]): Promise<{ nevo: number; g: number }[]> {
  if (!lines.length) return [];
  const list = lines.map((l, i) => `${i + 1}. ${[l.qty, l.unit, l.name].filter(Boolean).join(" ")}`).join("\n");

  // 1. Search words in the style of the Dutch food table, and the weight in grams.
  const first = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: { zoek: { type: "array", items: { type: "string" } }, gram: { type: "number" } },
                required: ["zoek", "gram"],
                additionalProperties: false,
              },
            },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content:
          `Dit zijn de ingrediënten van een recept:\n${list}\n\n` +
          `Geef per ingrediënt (${lines.length} in totaal, in dezelfde volgorde):\n` +
          "- zoek: 2 of 3 korte zoekwoorden om het product te vinden in het Nederlandse voedingsstoffenbestand NEVO. Gebruik de algemene productnaam zoals NEVO die schrijft, zonder merk of bereiding die er niet toe doet. Voorbeelden: \"marietjes\" → [\"biscuit maria\", \"biscuit\"]; \"Zeeuws meisje\" → [\"margarine\", \"halvarine\"]; \"2 kleine rijpe avocado's\" → [\"avocado\"]; \"kerstomaten\" → [\"tomaat\", \"cherrytomaat\"].\n" +
          "- gram: het gewicht in gram van de hele regel (hoeveelheid × eenheid). Reken eenheden om met gangbare gewichten, bijvoorbeeld 1 ei 50 g, 1 el olie 13 g, 1 el suiker 12 g, 1 tl 5 g, 1 teen knoflook 4 g, 1 middelgrote ui 100 g. Bij ml of l: ongeveer 1 g per ml. Staat er geen hoeveelheid, schat dan een gebruikelijke hoeveelheid voor dit recept. Bij \"naar smaak\" of \"snufje\": 1.",
      },
    ],
  });
  const asked = json<{ items?: { zoek?: string[]; gram?: number }[] }>(first).items ?? [];

  // 2. Candidates from NEVO for each line.
  const candidates: NevoFood[][] = await Promise.all(
    lines.map(async (_, i) => {
      const words = (asked[i]?.zoek ?? []).filter((w) => typeof w === "string" && w.trim()).slice(0, 3);
      const found = new Map<number, NevoFood>();
      for (const w of words) {
        const { data } = await db.rpc("nevo_zoek", { term: w.trim(), aantal: 6 });
        for (const f of (data as NevoFood[] | null) ?? []) if (found.size < 10) found.set(f.code, f);
      }
      return [...found.values()];
    }),
  );
  if (candidates.every((c) => !c.length)) return lines.map(() => ({ nevo: 0, g: 0 }));

  // 3. Claude picks the product that fits each line, or none.
  const options = lines
    .map((l, i) => {
      const c = candidates[i];
      const opts = c.length ? c.map((f) => `   - ${f.code}: ${f.naam}${f.synoniem ? ` (ook: ${f.synoniem})` : ""}`).join("\n") : "   (geen)";
      return `${i + 1}. ${[l.qty, l.unit, l.name].filter(Boolean).join(" ")}\n${opts}`;
    })
    .join("\n");
  const second = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { codes: { type: "array", items: { type: "integer" } } },
          required: ["codes"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content:
          `Kies per ingrediënt het NEVO-product dat er het best bij past, uit de opties eronder. Kies het product zoals het in het recept gebruikt wordt (rauw of al bereid). Past geen enkele optie redelijk, kies dan 0.\n\n${options}\n\n` +
          `Geef codes: een lijst met ${lines.length} getallen (de gekozen code of 0), in dezelfde volgorde.`,
      },
    ],
  });
  const codes = json<{ codes?: unknown[] }>(second).codes ?? [];

  return lines.map((_, i) => {
    const code = Number(codes[i]);
    const ok = Number.isInteger(code) && candidates[i].some((f) => f.code === code);
    const g = Number(asked[i]?.gram);
    return { nevo: ok ? code : 0, g: Number.isFinite(g) && g > 0 ? Math.round(g * 10) / 10 : 0 };
  });
}
