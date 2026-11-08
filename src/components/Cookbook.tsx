import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BUCKET, photoUrl, supabase } from "../supabase";
import type { Recipe, SortKey } from "../types";
import { FilterMenu, type Author } from "./FilterMenu";
import { ClockIcon, HeartIcon, SearchIcon } from "./Icons";
import { RecipeDetail } from "./RecipeDetail";
import { RecipeEditor } from "./RecipeEditor";
import { ThemeButton } from "./ThemeButton";

type Props = { uid: string; myName: string };

export function Cookbook({ uid, myName }: Props) {
  const db = supabase!;
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});

  const [q, setQ] = useState("");
  const [meal, setMeal] = useState<string | null>(null);
  const [tastes, setTastes] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<string | null>(null);
  const [main, setMain] = useState<string | null>(null);
  const [onlyFav, setOnlyFav] = useState(false);
  const [author, setAuthor] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("new");

  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ recipe: Recipe | null; copyOf?: Recipe } | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(""), 2600);
  }, []);

  const upsertLocal = useCallback((row: Recipe) => {
    setRecipes((rs) => {
      const i = rs.findIndex((r) => r.id === row.id);
      if (i < 0) return [row, ...rs];
      const copy = rs.slice();
      copy[i] = row;
      return copy;
    });
  }, []);

  const loadNames = useCallback(async () => {
    const { data } = await db.from("profiles").select("id, display_name");
    if (data) setNames(Object.fromEntries(data.map((p) => [p.id, p.display_name])));
  }, [db]);

  // Recipes, kept live with Realtime. Reload when the tab comes back, since phones drop the connection.
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await db.from("recipes").select("*");
      if (!active) return;
      if (error) setLoadError("De recepten konden niet worden geladen. Controleer je internetverbinding.");
      else {
        setRecipes(data as Recipe[]);
        setLoadError("");
      }
      setLoaded(true);
    };
    const channel = db
      .channel("recipes-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "recipes" }, (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id?: string }).id;
          setRecipes((rs) => rs.filter((r) => r.id !== id));
        } else {
          upsertLocal(p.new as Recipe);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    load();
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      db.removeChannel(channel);
    };
  }, [db, upsertLocal]);

  useEffect(() => {
    loadNames();
    db.from("favorites")
      .select("recipe_id")
      .then(({ data }) => {
        if (data) setFavs(new Set(data.map((f) => f.recipe_id as string)));
      });
  }, [db, loadNames]);

  const toggleFav = useCallback(
    async (id: string) => {
      const wasFav = favs.has(id);
      const flip = (on: boolean) =>
        setFavs((s) => {
          const n = new Set(s);
          if (on) n.add(id);
          else n.delete(id);
          return n;
        });
      flip(!wasFav);
      const { error } = wasFav
        ? await db.from("favorites").delete().eq("user_id", uid).eq("recipe_id", id)
        : await db.from("favorites").insert({ user_id: uid, recipe_id: id });
      if (error) {
        flip(wasFav);
        toast("Favoriet opslaan is niet gelukt.");
      }
    },
    [db, favs, toast, uid],
  );

  const deleteRecipe = useCallback(
    async (r: Recipe) => {
      const { error } = await db.from("recipes").delete().eq("id", r.id);
      if (error) {
        toast("Verwijderen is niet gelukt.");
        return;
      }
      if (r.photos?.length) await db.storage.from(BUCKET).remove(r.photos);
      setRecipes((rs) => rs.filter((x) => x.id !== r.id));
      setOpenId(null);
      toast("Recept verwijderd");
    },
    [db, toast],
  );

  const authorName = useCallback(
    (r: Recipe) => r.created_by_name || (r.created_by ? names[r.created_by] : "") || "",
    [names],
  );

  // Everyone who posted at least one recipe, A–Z.
  const authors = useMemo<Author[]>(() => {
    const map = new Map<string, string>();
    for (const r of recipes) {
      const name = authorName(r);
      if (r.created_by && name) map.set(r.created_by, name);
    }
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "nl"));
  }, [recipes, authorName]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = recipes.filter((r) => {
      if (onlyFav && !favs.has(r.id)) return false;
      if (author && r.created_by !== author) return false;
      if (meal && !(r.meals ?? []).includes(meal)) return false;
      for (const t of tastes) if (!(r.tastes ?? []).includes(t)) return false;
      if (kind && !(r.kinds ?? []).includes(kind)) return false;
      if (main && !(r.mains ?? []).includes(main)) return false;
      if (needle) {
        const hay = [r.title, r.description ?? "", ...(r.ingredients ?? []).map((i) => i.name)].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    if (sort === "az") list.sort((a, b) => (a.title || "").localeCompare(b.title || "", "nl"));
    else if (sort === "time") list.sort((a, b) => (a.minutes || 9999) - (b.minutes || 9999));
    else list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return list;
  }, [recipes, q, meal, tastes, kind, main, onlyFav, author, favs, sort]);

  const toggleTaste = (t: string) =>
    setTastes((s) => {
      const n2 = new Set(s);
      if (n2.has(t)) n2.delete(t);
      else n2.add(t);
      return n2;
    });

  const clearFilters = () => {
    setMeal(null);
    setTastes(new Set());
    setKind(null);
    setMain(null);
    setOnlyFav(false);
    setAuthor(null);
  };

  // The active filters, shown under the header so it's clear why recipes are missing.
  const active: { key: string; label: string; remove: () => void }[] = [];
  if (onlyFav) active.push({ key: "fav", label: "♥ Favorieten", remove: () => setOnlyFav(false) });
  if (meal) active.push({ key: "meal", label: meal, remove: () => setMeal(null) });
  for (const t of tastes) active.push({ key: "t-" + t, label: t, remove: () => toggleTaste(t) });
  if (kind) active.push({ key: "kind", label: kind, remove: () => setKind(null) });
  if (main) active.push({ key: "main", label: main, remove: () => setMain(null) });
  if (author) {
    const a = authors.find((x) => x.id === author);
    active.push({ key: "author", label: `Door ${a?.name ?? "iemand"}`, remove: () => setAuthor(null) });
  }

  const open = openId ? recipes.find((r) => r.id === openId) : undefined;
  // Someone else deleted the recipe that is open: close it.
  useEffect(() => {
    if (openId && loaded && !open && !editing) setOpenId(null);
  }, [openId, open, loaded, editing]);

  const n = recipes.length;
  // With filters or a search term, count only the recipes that match.
  const shown = visible.length;

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="bar">
            <div className="brand">
              <h1>Ons Kookboek</h1>
              <span className="brand-side">
                <span className="count" aria-live="polite">
                  {loaded ? (shown === 1 ? "1 recept" : `${shown} recepten`) : ""}
                </span>
                <ThemeButton />
              </span>
            </div>
            <div className="search">
              <SearchIcon />
              <label className="sr-only" htmlFor="q">Zoeken</label>
              <input
                id="q"
                type="search"
                placeholder="Recept of ingrediënt"
                autoComplete="off"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <button className="btn primary add-btn" type="button" onClick={() => setEditing({ recipe: null })}>
              + Recept
            </button>
            <FilterMenu
              myName={myName}
              onlyFav={onlyFav}
              setOnlyFav={setOnlyFav}
              meal={meal}
              setMeal={setMeal}
              tastes={tastes}
              toggleTaste={toggleTaste}
              kind={kind}
              setKind={setKind}
              main={main}
              setMain={setMain}
              author={author}
              setAuthor={setAuthor}
              authors={authors}
              sort={sort}
              setSort={setSort}
              activeCount={active.length}
              onClear={clearFilters}
            />
          </div>
        </div>
      </header>

      <main>
        <div className="wrap">
          {loadError && <div className="note" role="status">{loadError}</div>}
          {active.length > 0 && (
            <div className="active-filters" aria-label="Actieve filters">
              {active.map((f) => (
                <button key={f.key} className="chip on" type="button" onClick={f.remove} aria-label={`Filter ${f.label} weghalen`}>
                  {f.label} <span aria-hidden="true">×</span>
                </button>
              ))}
              <button className="btn ghost" type="button" onClick={clearFilters}>
                Wissen
              </button>
            </div>
          )}
          {!loaded ? (
            <div className="empty">
              <h2>Recepten laden…</h2>
              <p>Hier verschijnen alle recepten van iedereen die dit kookboek gebruikt.</p>
            </div>
          ) : n === 0 ? (
            <div className="empty">
              <h2>Nog geen recepten</h2>
              <p>Voeg het eerste recept toe met ingrediënten, bereiding en een foto. Iedereen met wie je dit kookboek deelt, ziet het meteen.</p>
              <button className="btn primary" type="button" onClick={() => setEditing({ recipe: null })}>
                + Eerste recept toevoegen
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <h2>Geen recepten gevonden</h2>
              <p>Pas je zoekterm of filters aan.</p>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  clearFilters();
                  setQ("");
                }}
              >
                Filters wissen
              </button>
            </div>
          ) : (
            <div className="grid">
              {visible.map((r) => (
                <RecipeCard
                  key={r.id}
                  recipe={r}
                  author={authorName(r)}
                  fav={favs.has(r.id)}
                  onOpen={() => setOpenId(r.id)}
                  onFav={() => toggleFav(r.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {open && !editing && (
        <RecipeDetail
          recipe={open}
          canEdit={open.created_by === uid}
          names={names}
          fav={favs.has(open.id)}
          onFav={() => toggleFav(open.id)}
          onEdit={() => open.created_by === uid && setEditing({ recipe: open })}
          onCopy={() => setEditing({ recipe: null, copyOf: open })}
          onDelete={() => deleteRecipe(open)}
          onClose={() => setOpenId(null)}
          onNeedNames={loadNames}
        />
      )}
      {editing && (
        <RecipeEditor
          recipe={editing.recipe}
          copyOf={editing.copyOf}
          uid={uid}
          onCancel={() => setEditing(null)}
          onSaved={(row, isNew) => {
            upsertLocal(row);
            setEditing(null);
            setOpenId(row.id);
            toast(editing.copyOf ? "Kopie opgeslagen" : isNew ? "Recept toegevoegd" : "Recept bijgewerkt");
          }}
        />
      )}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </>
  );
}

type CardProps = { recipe: Recipe; author: string; fav: boolean; onOpen: () => void; onFav: () => void };

function RecipeCard({ recipe: r, author, fav, onOpen, onFav }: CardProps) {
  const [broken, setBroken] = useState(false);
  const photo = r.photos?.[0];
  return (
    <article className="card">
      <div className="thumb">
        {photo && !broken ? (
          <img src={photoUrl(photo)} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <div className="ph" aria-hidden="true">{(r.title || "?")[0].toUpperCase()}</div>
        )}
        <button
          className={"heart" + (fav ? " on" : "")}
          type="button"
          aria-label={fav ? `${r.title} uit favorieten halen` : `${r.title} als favoriet bewaren`}
          aria-pressed={fav}
          onClick={onFav}
        >
          <HeartIcon filled={fav} />
        </button>
      </div>
      <div className="cbody">
        <h3>{r.title || "Naamloos recept"}</h3>
        <Meta recipe={r} />
        {author && <p className="card-by">door {author}</p>}
      </div>
      <button className="card-open" type="button" onClick={onOpen} aria-label={`${r.title} openen`} />
    </article>
  );
}

export function Meta({ recipe: r }: { recipe: Recipe }) {
  return (
    <div className="meta">
      {(r.meals ?? []).map((m) => (
        <span key={m} className="tag meal">{m}</span>
      ))}
      {(r.tastes ?? []).map((t) => (
        <span key={t} className="tag taste">{t}</span>
      ))}
      {(r.kinds ?? []).map((k) => (
        <span key={k} className="tag kind">{k}</span>
      ))}
      {(r.mains ?? []).map((m) => (
        <span key={m} className="tag main">{m}</span>
      ))}
      {r.minutes ? (
        <span className="time">
          <ClockIcon /> {r.minutes} min
        </span>
      ) : null}
    </div>
  );
}
