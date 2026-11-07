import { useEffect, useRef, useState } from "react";
import { MEALS, TASTES, type SortKey } from "../types";
import { FilterIcon } from "./Icons";

export type Author = { id: string; name: string };

type Props = {
  myName: string;
  onlyFav: boolean;
  setOnlyFav: (v: boolean) => void;
  meal: string | null;
  setMeal: (v: string | null) => void;
  tastes: Set<string>;
  toggleTaste: (t: string) => void;
  author: string | null;
  setAuthor: (v: string | null) => void;
  authors: Author[];
  sort: SortKey;
  setSort: (v: SortKey) => void;
  activeCount: number;
  onClear: () => void;
};

/** The filters and sorting, in a menu that drops down from the top right. */
export function FilterMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button, select")?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={button}
        className={"btn menu-btn" + (p.activeCount ? " active" : "")}
        type="button"
        aria-expanded={open}
        aria-controls="filter-menu"
        aria-label={p.activeCount ? `Filters, ${p.activeCount} actief` : "Filters"}
        onClick={() => setOpen(!open)}
      >
        <FilterIcon />
        <span className="menu-label" aria-hidden="true">Filters</span>
        {p.activeCount > 0 && (
          <span className="badge" aria-hidden="true">
            {p.activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="menu-panel" id="filter-menu" ref={panel} role="group" aria-label="Filters en sorteren">
          {p.myName && (
            <p className="menu-who">
              Ingelogd als <strong>{p.myName}</strong>
            </p>
          )}

          <div className="menu-sec">
            <span className="flabel">Favorieten</span>
            <div className="chips">
              <button className="chip fav" type="button" aria-pressed={p.onlyFav} onClick={() => p.setOnlyFav(!p.onlyFav)}>
                ♥ Alleen mijn favorieten
              </button>
            </div>
          </div>

          <div className="menu-sec">
            <span className="flabel">Maaltijd</span>
            <div className="chips">
              {MEALS.map((m) => (
                <button key={m} className="chip meal" type="button" aria-pressed={p.meal === m} onClick={() => p.setMeal(p.meal === m ? null : m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="menu-sec">
            <span className="flabel">Smaak</span>
            <div className="chips">
              {TASTES.map((t) => (
                <button key={t} className="chip taste" type="button" aria-pressed={p.tastes.has(t)} onClick={() => p.toggleTaste(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="menu-sec">
            <span className="flabel">Toegevoegd door</span>
            {p.authors.length ? (
              <div className="chips">
                {p.authors.map((a) => (
                  <button
                    key={a.id}
                    className="chip author"
                    type="button"
                    aria-pressed={p.author === a.id}
                    onClick={() => p.setAuthor(p.author === a.id ? null : a.id)}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            ) : (
              <span className="hint">Nog niemand heeft een recept toegevoegd.</span>
            )}
          </div>

          <div className="menu-sec">
            <label className="flabel" htmlFor="sort">Sorteren</label>
            <select id="sort" className="in" value={p.sort} onChange={(e) => p.setSort(e.target.value as SortKey)}>
              <option value="new">Nieuwste eerst</option>
              <option value="az">A–Z</option>
              <option value="time">Snelste eerst</option>
            </select>
          </div>

          <div className="menu-foot">
            <button className="btn ghost" type="button" onClick={p.onClear} disabled={!p.activeCount}>
              Alles wissen
            </button>
            <button className="btn primary" type="button" onClick={() => setOpen(false)}>
              Klaar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
