import { useEffect, useRef, useState } from "react";
import { photoUrl } from "../supabase";
import type { Recipe } from "../types";
import { fmtDate, fmtQty, parseQty } from "../util";
import { Meta } from "./Cookbook";
import { XIcon } from "./Icons";
import { Sheet } from "./Sheet";

type Props = {
  recipe: Recipe;
  names: Record<string, string>;
  fav: boolean;
  onFav: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onClose: () => void;
  onNeedNames: () => void;
};

export function RecipeDetail({ recipe: r, names, fav, onFav, onEdit, onDelete, onClose, onNeedNames }: Props) {
  const base = r.servings || 0;
  const [servings, setServings] = useState(base);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Someone changed the number of servings: start from the new base.
  useEffect(() => setServings(base), [base]);

  // A name we don't know yet (a new family member): fetch the names again.
  const missingName = [r.created_by, r.updated_by].some((id) => id && !(id in names));
  useEffect(() => {
    if (missingName) onNeedNames();
  }, [missingName, onNeedNames]);

  const nm = (stored: string | null | undefined, id: string | null) => stored || (id && names[id]) || "iemand";
  const by: string[] = [];
  if (r.created_at) by.push(`Toegevoegd door ${nm(r.created_by_name, r.created_by)} op ${fmtDate(r.created_at)}`);
  // Only mention an update when it came clearly later than creating it.
  if (r.updated_at && Date.parse(r.updated_at) - Date.parse(r.created_at) > 60_000)
    by.push(`bijgewerkt door ${nm(r.updated_by_name, r.updated_by)} op ${fmtDate(r.updated_at)}`);

  const ingredients = r.ingredients ?? [];
  const steps = r.steps ?? [];

  return (
    <Sheet label={r.title || "Recept"} onClose={onClose}>
      <div className="sheet-head">
        <button className="close" type="button" aria-label="Sluiten" onClick={onClose}>
          <XIcon />
        </button>
        <span className="grow" />
        <button className={"btn" + (fav ? " danger" : "")} type="button" aria-pressed={fav} onClick={onFav}>
          {fav ? "♥ Favoriet" : "♡ Favoriet"}
        </button>
        <button className="btn" type="button" onClick={onEdit}>
          Bewerken
        </button>
      </div>

      <Gallery photos={r.photos ?? []} title={r.title} />

      <div className="sec">
        <h2>{r.title || "Naamloos recept"}</h2>
        <Meta recipe={r} />
        {r.description && <p className="desc">{r.description}</p>}
        <div className="cols">
          <div>
            <h4>Ingrediënten</h4>
            {base > 0 && (
              <div className="servings">
                <button
                  className="step-btn"
                  type="button"
                  aria-label="Minder personen"
                  disabled={servings <= 1}
                  onClick={() => setServings((s) => Math.max(1, s - 1))}
                >
                  −
                </button>
                <span aria-live="polite">{servings === 1 ? "1 persoon" : `${servings} personen`}</span>
                <button className="step-btn" type="button" aria-label="Meer personen" onClick={() => setServings((s) => s + 1)}>
                  +
                </button>
              </div>
            )}
            <ul className="ing">
              {ingredients.length === 0 && (
                <li>
                  <span className="hint">Geen ingrediënten ingevuld.</span>
                </li>
              )}
              {ingredients.map((i, ix) => {
                const n = parseQty(i.qty);
                const qty = n != null && base && servings ? fmtQty((n * servings) / base) : i.qty || "";
                return (
                  <li key={ix}>
                    <span className="q">{[qty, i.unit].filter(Boolean).join(" ")}</span>
                    <span>{i.name}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h4>Bereiding</h4>
            {steps.length ? (
              <ol className="steps">
                {steps.map((s, ix) => (
                  <li key={ix}>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="hint">Geen bereiding ingevuld.</p>
            )}
          </div>
        </div>
        {by.length > 0 && <div className="by">{by.join(" · ")}</div>}
        {!confirming ? (
          <div>
            <button className="btn ghost link-danger" type="button" onClick={() => setConfirming(true)}>
              Recept verwijderen
            </button>
          </div>
        ) : (
          <div className="confirm" role="alert">
            <span>Dit recept voor iedereen verwijderen?</span>
            <button className="btn" type="button" onClick={() => setConfirming(false)} disabled={deleting}>
              Annuleren
            </button>
            <button
              className="btn danger"
              type="button"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                await onDelete();
                setDeleting(false);
              }}
            >
              {deleting ? "Verwijderen…" : "Ja, verwijderen"}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Gallery({ photos, title }: { photos: string[]; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const shown = photos.filter((p) => !broken.has(p));
  if (!shown.length) return null;
  return (
    <div>
      <div
        className="gallery"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          setCurrent(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {shown.map((p, ix) => (
          <img
            key={p}
            src={photoUrl(p)}
            alt={shown.length > 1 ? `${title}, foto ${ix + 1} van ${shown.length}` : title}
            onError={() => setBroken((b) => new Set(b).add(p))}
          />
        ))}
      </div>
      {shown.length > 1 && (
        <div className="dots" aria-hidden="true">
          {shown.map((p, ix) => (
            <span key={p} className={ix === current ? "on" : ""} />
          ))}
        </div>
      )}
    </div>
  );
}
