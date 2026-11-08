import { useEffect, useRef, useState, type ReactNode } from "react";
import { KINDS, MAINS, MEALS, TASTES, type SortKey } from "../types";
import { BookPdf } from "./BookPdf";
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
  kind: string | null;
  setKind: (v: string | null) => void;
  main: string | null;
  setMain: (v: string | null) => void;
  author: string | null;
  setAuthor: (v: string | null) => void;
  authors: Author[];
  sort: SortKey;
  setSort: (v: SortKey) => void;
  activeCount: number;
  onClear: () => void;
};

const SORT_LABELS: Record<SortKey, string> = { new: "Nieuwste eerst", az: "A–Z", time: "Snelste eerst" };
const PHONE = "(max-width: 560px)";

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

/** A heading with its choices. On a phone the choices fold away behind a plus. */
function Section({ title, summary, collapsible, children }: { title: string; summary?: string; collapsible: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!collapsible) {
    return (
      <div className="menu-sec">
        <span className="flabel">{title}</span>
        {children}
      </div>
    );
  }
  return (
    <div className="menu-sec">
      <button className="sec-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="flabel">{title}</span>
        <span className="sec-sum">{summary}</span>
        <span className="plus" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && children}
    </div>
  );
}

/** The filters and sorting, in a menu that drops down from the top right. */
export function FilterMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(0);
  const isPhone = useMedia(PHONE);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    // On a phone the menu is placed just below the button, across the full width.
    if (!open && button.current) setTop(Math.round(button.current.getBoundingClientRect().bottom + 8));
    setOpen(!open);
  };

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

  const authorName = p.authors.find((a) => a.id === p.author)?.name;
  const tasteList = TASTES.filter((t) => p.tastes.has(t));

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={button}
        className={"btn menu-btn" + (p.activeCount ? " active" : "")}
        type="button"
        aria-expanded={open}
        aria-controls="filter-menu"
        aria-label={p.activeCount ? `Filters, ${p.activeCount} actief` : "Filters"}
        onClick={toggle}
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
        <div
          className={"menu-panel" + (isPhone ? " phone" : "")}
          style={isPhone ? { top, maxHeight: `calc(100dvh - ${top + 16}px)` } : undefined}
          id="filter-menu"
          ref={panel}
          role="group"
          aria-label="Filters en sorteren"
        >
          {p.myName && (
            <p className="menu-who">
              Ingelogd als <strong>{p.myName}</strong>
            </p>
          )}

          <div className="menu-sec">
            {!isPhone && <span className="flabel">Favorieten</span>}
            <div className="chips">
              <button className="chip fav" type="button" aria-pressed={p.onlyFav} onClick={() => p.setOnlyFav(!p.onlyFav)}>
                ♥ Alleen mijn favorieten
              </button>
            </div>
          </div>

          <Section title="Maaltijd" summary={p.meal ?? ""} collapsible={isPhone}>
            <div className="chips">
              {MEALS.map((m) => (
                <button key={m} className="chip meal" type="button" aria-pressed={p.meal === m} onClick={() => p.setMeal(p.meal === m ? null : m)}>
                  {m}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Smaak" summary={tasteList.join(", ")} collapsible={isPhone}>
            <div className="chips">
              {TASTES.map((t) => (
                <button key={t} className="chip taste" type="button" aria-pressed={p.tastes.has(t)} onClick={() => p.toggleTaste(t)}>
                  {t}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Soort gerecht" summary={p.kind ?? ""} collapsible={isPhone}>
            <div className="chips">
              {KINDS.map((k) => (
                <button key={k} className="chip kind" type="button" aria-pressed={p.kind === k} onClick={() => p.setKind(p.kind === k ? null : k)}>
                  {k}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Hoofdingrediënt" summary={p.main ?? ""} collapsible={isPhone}>
            <div className="chips">
              {MAINS.map((m) => (
                <button key={m} className="chip main" type="button" aria-pressed={p.main === m} onClick={() => p.setMain(p.main === m ? null : m)}>
                  {m}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Toegevoegd door" summary={authorName ?? ""} collapsible={isPhone}>
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
          </Section>

          <Section title="Sorteren" summary={p.sort === "new" ? "" : SORT_LABELS[p.sort]} collapsible={isPhone}>
            <select className="in" aria-label="Sorteren" value={p.sort} onChange={(e) => p.setSort(e.target.value as SortKey)}>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </Section>

          <div className="menu-sec">
            <span className="flabel">Het hele kookboek</span>
            <BookPdf />
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
