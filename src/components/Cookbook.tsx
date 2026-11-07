import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BUCKET, photoUrl, supabase } from "../supabase";
import { MEALS, TASTES, type Recipe, type SortKey } from "../types";
import { ClockIcon, HeartIcon, LogoutIcon, SearchIcon } from "./Icons";
import { RecipeDetail } from "./RecipeDetail";
import { RecipeEditor } from "./RecipeEditor";

type Props = { uid: string; myName: string; onSignOut: () => void };

export function Cookbook({ uid, myName, onSignOut }: Props) {
  const db = supabase!;
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});

  const [q, setQ] = useState("");
  const [meal, setMeal] = useState<string | null>(null);
  const [tastes, setTastes] = useState<Set<string>>(new Set());
  const [onlyFav, setOnlyFav] = useState(false);
  const [sort, setSort] = useState<SortKey>("new");

  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ recipe: Recipe | null } | null>(null);
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

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = recipes.filter((r) => {
      if (onlyFav && !favs.has(r.id)) return false;
      if (meal && !(r.meals ?? []).includes(meal)) return false;
      for (const t of tastes) if (!(r.tastes ?? []).includes(t)) return false;
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
  }, [recipes, q, meal, tastes, onlyFav, favs, sort]);

  const clearFilters = () => {
    setQ("");
    setMeal(null);
    setTastes(new Set());
    setOnlyFav(false);
  };

  const open = openId ? recipes.find((r) => r.id === openId) : undefined;
  // Someone else deleted the recipe that is open: close it.
  useEffect(() => {
    if (openId && loaded && !open && !editing) setOpenId(null);
  }, [openId, open, loaded, editing]);

  const n = recipes.length;

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="bar">
            <div className="brand">
              <h1>Ons Kookboek</h1>
              <span className="count">{loaded ? (n === 1 ? "1 recept" : `${n} recepten`) : ""}</span>
            </div>
            <div className="who">
              <span className="who-name">{myName}</span>
              <button className="close" type="button" onClick={onSignOut} aria-label={`Uitloggen (${myName})`} title="Uitloggen">
                <LogoutIcon />
              </button>
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
            <button className="btn primary" type="button" onClick={() => setEditing({ recipe: null })}>
              + Recept
            </button>
          </div>
          <div className="filters" role="group" aria-label="Filters">
            <button className="chip fav" type="button" aria-pressed={onlyFav} onClick={() => setOnlyFav(!onlyFav)}>
              ♥ Favorieten
            </button>
            <span className="sep" />
            <span className="flabel">Maaltijd</span>
            {MEALS.map((m) => (
              <button key={m} className="chip meal" type="button" aria-pressed={meal === m} onClick={() => setMeal(meal === m ? null : m)}>
                {m}
              </button>
            ))}
            <span className="sep" />
            <span className="flabel">Smaak</span>
            {TASTES.map((t) => (
              <button
                key={t}
                className="chip taste"
                type="button"
                aria-pressed={tastes.has(t)}
                onClick={() =>
                  setTastes((s) => {
                    const n2 = new Set(s);
                    if (n2.has(t)) n2.delete(t);
                    else n2.add(t);
                    return n2;
                  })
                }
              >
                {t}
              </button>
            ))}
            <span className="sep" />
            <select className="sort" aria-label="Sorteren" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="new">Nieuwste eerst</option>
              <option value="az">A–Z</option>
              <option value="time">Snelste eerst</option>
            </select>
          </div>
        </div>
      </header>

      <main>
        <div className="wrap">
          {loadError && <div className="note" role="status">{loadError}</div>}
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
              <button className="btn" type="button" onClick={clearFilters}>
                Filters wissen
              </button>
            </div>
          ) : (
            <div className="grid">
              {visible.map((r) => (
                <RecipeCard key={r.id} recipe={r} fav={favs.has(r.id)} onOpen={() => setOpenId(r.id)} onFav={() => toggleFav(r.id)} />
              ))}
            </div>
          )}
        </div>
      </main>

      {open && !editing && (
        <RecipeDetail
          recipe={open}
          names={names}
          fav={favs.has(open.id)}
          onFav={() => toggleFav(open.id)}
          onEdit={() => setEditing({ recipe: open })}
          onDelete={() => deleteRecipe(open)}
          onClose={() => setOpenId(null)}
          onNeedNames={loadNames}
        />
      )}
      {editing && (
        <RecipeEditor
          recipe={editing.recipe}
          uid={uid}
          onCancel={() => setEditing(null)}
          onSaved={(row, isNew) => {
            upsertLocal(row);
            setEditing(null);
            setOpenId(row.id);
            toast(isNew ? "Recept toegevoegd" : "Recept bijgewerkt");
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

function RecipeCard({ recipe: r, fav, onOpen, onFav }: { recipe: Recipe; fav: boolean; onOpen: () => void; onFav: () => void }) {
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
      {r.minutes ? (
        <span className="time">
          <ClockIcon /> {r.minutes} min
        </span>
      ) : null}
    </div>
  );
}
