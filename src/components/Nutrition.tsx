import { useEffect, useId, useState } from "react";
import { NEVO_SOURCE, nl, nutriScore, scaled, totals, type NevoFood, type NutritionItem, type Totals } from "../../api/_lib/nutrition";
import { foodsFor, loadNutrition, saveNutrition, searchNevo, type Nutrition as Data } from "../nutrition";
import type { Recipe } from "../types";

type Props = {
  recipe: Recipe;
  /** The number of people the recipe is written for, and the number shown by the counter. */
  base: number;
  servings: number;
};

const LETTERS = ["A", "B", "C", "D", "E"] as const;

/** "Voedingswaarde": per person and for the whole recipe, with a Nutri-Score as an indication. */
export function Nutrition({ recipe: r, base, servings }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"busy" | "ok" | "error">("busy");
  const [editing, setEditing] = useState(false);
  const ingredientsKey = JSON.stringify(r.ingredients ?? []);

  useEffect(() => {
    let active = true;
    setState("busy");
    loadNutrition(r)
      .then((d) => active && (setData(d), setState("ok")))
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
    // Only again when the ingredients change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id, ingredientsKey]);

  if (!(r.ingredients ?? []).some((i) => i.name)) return null;

  return (
    <div className="nutrition">
      <h4>Voedingswaarde</h4>
      {state === "busy" && <p className="hint">Voedingswaarden berekenen…</p>}
      {state === "error" && <p className="hint">De voedingswaarden konden niet worden berekend. Probeer het later opnieuw.</p>}
      {state === "ok" && data && (
        <Values data={data} base={base} servings={servings} onEdit={() => setEditing(!editing)} editing={editing} />
      )}
      {state === "ok" && data && editing && (
        <Links
          data={data}
          onChange={async (items) => {
            await saveNutrition(r.id, items);
            setData({ items, foods: await foodsFor(items) });
          }}
        />
      )}
    </div>
  );
}

function Values({ data, base, servings, editing, onEdit }: { data: Data; base: number; servings: number; editing: boolean; onEdit: () => void }) {
  const total = totals(data.items, data.foods);
  const score = nutriScore(total);
  const missing = data.items.filter((i) => !i.nevo || !(i.g > 0) || !data.foods.has(i.nevo)).map((i) => i.name);
  // The counter changes how much you make: per person stays the same, the total grows with it.
  const factor = base > 0 ? servings / base : 1;
  const perPerson = base > 0 ? scaled(total, 1 / base) : null;
  const whole = scaled(total, factor);

  return (
    <>
      {score && (
        <div className="nscore" aria-label={`Nutri-Score ${score.letter}, indicatie`}>
          <div className="nscore-bar" aria-hidden="true">
            {LETTERS.map((l) => (
              <span key={l} className={`ns-${l.toLowerCase()}` + (l === score.letter ? " on" : "")}>
                {l}
              </span>
            ))}
          </div>
          <span className="hint">Nutri-Score (indicatie, per 100 g)</span>
        </div>
      )}
      {perPerson ? (
        <>
          <p className="nut-head">Per persoon</p>
          <Table t={perPerson} />
        </>
      ) : (
        <Table t={whole} />
      )}
      {perPerson && (
        <p className="nut-total">
          <strong>{servings === 1 ? "Voor 1 persoon" : `Voor ${servings} personen`}:</strong> {nl(whole.kcal)} kcal · eiwit {nl(whole.eiwit)} g ·
          koolhydraten {nl(whole.koolh)} g · vet {nl(whole.vet)} g · zout {nl(whole.zout, 1)} g
        </p>
      )}
      {missing.length > 0 && <p className="hint">Niet meegeteld: {missing.join(", ")}.</p>}
      <button className="btn" type="button" aria-expanded={editing} onClick={onEdit}>
        {editing ? "Koppelingen sluiten" : "Koppelingen bekijken"}
      </button>
      <p className="hint nut-src">{NEVO_SOURCE}</p>
    </>
  );
}

function Table({ t }: { t: Totals }) {
  const rows: [string, string, boolean?][] = [
    ["Energie", `${nl(t.kcal)} kcal`],
    ["Eiwit", `${nl(t.eiwit)} g`],
    ["Koolhydraten", `${nl(t.koolh)} g`],
    ["waarvan suikers", `${nl(t.suikers)} g`, true],
    ["Vet", `${nl(t.vet)} g`],
    ["waarvan verzadigd", `${nl(t.verzVet)} g`, true],
    ["Vezels", `${nl(t.vezels)} g`],
    ["Zout", `${nl(t.zout, 1)} g`],
  ];
  return (
    <table className="nut-table">
      <tbody>
        {rows.map(([label, value, sub]) => (
          <tr key={label} className={sub ? "sub" : ""}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Per ingredient: the NEVO product and the grams. Anyone can correct them. */
function Links({ data, onChange }: { data: Data; onChange: (items: NutritionItem[]) => Promise<void> }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ul className="nut-links">
      {data.items.map((it, ix) => {
        const food = data.foods.get(it.nevo);
        return (
          <li key={ix}>
            <span className="nut-line">{[it.qty, it.unit, it.name].filter(Boolean).join(" ")}</span>
            <span className={"nut-match" + (food ? "" : " none")}>
              {food ? (
                <>
                  → <strong>{food.naam}</strong> · {nl(it.g)} g
                </>
              ) : (
                "Niet meegeteld"
              )}{" "}
              <button className="linkish" type="button" onClick={() => setOpen(open === ix ? null : ix)}>
                {food ? "wijzig" : "koppelen"}
              </button>
            </span>
            {open === ix && (
              <LinkEditor
                item={it}
                food={food}
                onSave={async (nevo, g) => {
                  const items = data.items.map((x, i) => (i === ix ? { ...x, nevo, g } : x));
                  await onChange(items);
                  setOpen(null);
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LinkEditor({ item, food, onSave }: { item: NutritionItem; food?: NevoFood; onSave: (nevo: number, g: number) => Promise<void> }) {
  const [term, setTerm] = useState(food?.naam.split(/[ ,]/)[0] || item.name);
  const [found, setFound] = useState<NevoFood[]>([]);
  const [pick, setPick] = useState<number>(item.nevo);
  const [grams, setGrams] = useState(item.g ? String(item.g).replace(".", ",") : "");
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    const t = setTimeout(() => searchNevo(term).then(setFound), 250);
    return () => clearTimeout(t);
  }, [term]);

  const g = Number(grams.replace(",", "."));
  return (
    <div className="nut-edit">
      <label className="sr-only" htmlFor={`${id}-q`}>
        Product zoeken
      </label>
      <input id={`${id}-q`} className="in" placeholder="Zoek een product" value={term} onChange={(e) => setTerm(e.target.value)} />
      <div className="nut-options" aria-label="Producten">
        {found.map((f) => (
          <button key={f.code} type="button" className="chip main" aria-pressed={pick === f.code} onClick={() => setPick(f.code)}>
            {f.naam}
          </button>
        ))}
        {!found.length && <span className="hint">Niets gevonden. Probeer een ander woord.</span>}
      </div>
      <div className="nut-grams">
        <label htmlFor={`${id}-g`}>Gram</label>
        <input id={`${id}-g`} className="in" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
        <button
          className="btn primary"
          type="button"
          disabled={busy || !pick || !(g > 0)}
          onClick={async () => {
            setBusy(true);
            await onSave(pick, g);
            setBusy(false);
          }}
        >
          Opslaan
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(0, 0);
            setBusy(false);
          }}
        >
          Niet meetellen
        </button>
      </div>
    </div>
  );
}
