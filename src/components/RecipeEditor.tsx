import { useEffect, useRef, useState } from "react";
import { MAX_SCAN_PHOTOS, ScanError, scanWithAI } from "../aiScan";
import { mergeIngredients, mergeSteps, parsedAsText, type ParsedRecipe } from "../parseRecipe";
import { BUCKET, photoUrl, supabase } from "../supabase";
import { KINDS, MAINS, MEALS, TASTES, UNITS, type Recipe, type RecipeInput } from "../types";
import { cropSmall, shrink } from "../util";
import { CameraIcon, XIcon } from "./Icons";
import { Sheet } from "./Sheet";

type IngRow = { key: string; qty: string; unit: string; name: string };
type StepRow = { key: string; text: string };

const newKey = () => crypto.randomUUID();
const emptyIng = (): IngRow => ({ key: newKey(), qty: "", unit: "", name: "" });
const emptyStep = (): StepRow => ({ key: newKey(), text: "" });

type Props = {
  recipe: Recipe | null;
  uid: string;
  onCancel: () => void;
  onSaved: (row: Recipe, isNew: boolean) => void;
};

export function RecipeEditor({ recipe: r, uid, onCancel, onSaved }: Props) {
  const db = supabase!;
  const isNew = !r;
  const [title, setTitle] = useState(r?.title ?? "");
  const [description, setDescription] = useState(r?.description ?? "");
  const [meals, setMeals] = useState<Set<string>>(new Set(r?.meals ?? []));
  const [tastes, setTastes] = useState<Set<string>>(new Set(r?.tastes ?? []));
  const [kinds, setKinds] = useState<Set<string>>(new Set(r?.kinds ?? []));
  const [mains, setMains] = useState<Set<string>>(new Set(r?.mains ?? []));
  const [minutes, setMinutes] = useState(r?.minutes ? String(r.minutes) : "");
  const [servings, setServings] = useState(r?.servings ? String(r.servings) : "4");
  const [ings, setIngs] = useState<IngRow[]>(() => {
    const rows = (r?.ingredients ?? []).map((i) => ({ key: newKey(), qty: i.qty ?? "", unit: i.unit ?? "", name: i.name ?? "" }));
    return rows.length ? rows : [emptyIng(), emptyIng(), emptyIng()];
  });
  const [steps, setSteps] = useState<StepRow[]>(() => {
    const rows = (r?.steps ?? []).map((text) => ({ key: newKey(), text }));
    return rows.length ? rows : [emptyStep(), emptyStep()];
  });
  const [photos, setPhotos] = useState<string[]>(r?.photos ?? []);
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const original = useRef(new Set(r?.photos ?? []));
  const uploadedNow = useRef(new Set<string>());
  const titleRef = useRef<HTMLInputElement>(null);
  const focusLast = useRef<"ing" | "step" | null>(null);
  const ingBox = useRef<HTMLDivElement>(null);
  const stepBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [isNew]);

  // After "+ Ingrediënt" or "+ Stap", put the cursor in the new row.
  useEffect(() => {
    if (focusLast.current === "ing") ingBox.current?.querySelector<HTMLInputElement>(".ingrow:last-child input")?.focus();
    if (focusLast.current === "step") stepBox.current?.querySelector<HTMLTextAreaElement>(".stepform:last-child textarea")?.focus();
    focusLast.current = null;
  }, [ings.length, steps.length]);

  async function removeFromBucket(paths: string[]) {
    if (paths.length) await db.storage.from(BUCKET).remove(paths);
  }

  /** Puts a photo in the bucket and adds it to this recipe's photos. */
  async function uploadPhoto(blob: Blob, ext: string, first = false) {
    const path = `${uid}/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: blob.type || "image/jpeg", cacheControl: "31536000" });
    if (error) throw error;
    uploadedNow.current.add(path);
    setPhotos((p) => (first ? [path, ...p] : [...p, path]));
  }

  async function addFiles(files: File[]) {
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const small = await shrink(file);
        const isJpeg = small.type === "image/jpeg";
        await uploadPhoto(small, isJpeg ? "jpg" : (file.name.split(".").pop() || "img").toLowerCase());
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        setErr(
          /size|large/i.test(msg)
            ? "Deze foto is te groot."
            : /mime|type/i.test(msg)
              ? "Dit bestandstype wordt niet ondersteund. Gebruik JPG of PNG."
              : "Uploaden is niet gelukt. Probeer het opnieuw.",
        );
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function cancel() {
    // Nothing was saved: remove the photos that were uploaded during this edit.
    removeFromBucket([...uploadedNow.current]);
    onCancel();
  }

  async function save() {
    if (!title.trim()) {
      setErr("Geef het recept een naam.");
      titleRef.current?.focus();
      return;
    }
    if (uploading) {
      setErr("Wacht tot de foto's klaar zijn met uploaden.");
      return;
    }
    setSaving(true);
    setErr("");
    const body: RecipeInput = {
      title: title.trim(),
      description: description.trim(),
      meals: MEALS.filter((m) => meals.has(m)),
      tastes: TASTES.filter((t) => tastes.has(t)),
      kinds: KINDS.filter((k) => kinds.has(k)),
      mains: MAINS.filter((m) => mains.has(m)),
      minutes: parseInt(minutes, 10) || null,
      servings: parseInt(servings, 10) || null,
      ingredients: ings
        .map((i) => ({ qty: i.qty.trim(), unit: i.unit, name: i.name.trim() }))
        .filter((i) => i.name || i.qty),
      steps: steps.map((s) => s.text.trim()).filter(Boolean),
      photos,
    };
    const { data, error } = isNew
      ? await db.from("recipes").insert(body).select().single()
      : await db.from("recipes").update(body).eq("id", r.id).select().single();
    if (error || !data) {
      setSaving(false);
      setErr(
        error?.code === "PGRST116"
          ? "Dit recept is intussen door iemand anders verwijderd."
          : "Opslaan is niet gelukt. Controleer je verbinding en probeer het opnieuw.",
      );
      return;
    }
    // Photos taken out of the recipe are no longer used anywhere.
    const kept = new Set(photos);
    removeFromBucket([...original.current, ...uploadedNow.current].filter((p) => !kept.has(p)));
    onSaved(data as Recipe, isNew);
  }

  // Scan: read a photo of a paper recipe and fill in what's still empty.
  const [scan, setScan] = useState<{ busy: boolean; label: string; note: string; text: string }>({
    busy: false,
    label: "",
    note: "",
    text: "",
  });

  // Photos waiting to be read: you can take several (pages of one recipe) before sending them together.
  const [pending, setPending] = useState<{ key: string; file: File; url: string }[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  function addPending(files: File[]) {
    const room = MAX_SCAN_PHOTOS - pending.length;
    const added = files.slice(0, Math.max(room, 0)).map((file) => ({ key: newKey(), file, url: URL.createObjectURL(file) }));
    if (added.length) setPending((list) => [...list, ...added]);
    setScan((s) => ({
      ...s,
      text: "",
      note: files.length > room ? `Er kunnen maximaal ${MAX_SCAN_PHOTOS} foto's tegelijk gelezen worden.` : "",
    }));
  }

  function removePending(key: string) {
    const gone = pending.find((p) => p.key === key);
    if (gone) URL.revokeObjectURL(gone.url);
    setPending((list) => list.filter((p) => p.key !== key));
  }

  function clearPending() {
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    setPending([]);
  }

  /**
   * Adds a photo of the dish to the recipe, as small as possible, and returns a line for the scan note.
   * First choice: the picture of the dish on a scanned photo, cut out. Otherwise, if the recipe has no photo yet,
   * the matching photo the scan function found on the internet (Openverse, or Pexels).
   */
  async function addDishPhoto(files: Blob[], p: ParsedRecipe): Promise<string> {
    const add = async (small: Blob | null) => {
      if (!small) return 0;
      try {
        await uploadPhoto(small, small.type === "image/webp" ? "webp" : "jpg", photos.length === 0);
        return Math.max(1, Math.round(small.size / 1024));
      } catch {
        return 0;
      }
    };
    const whole = { left: 0, top: 0, right: 1, bottom: 1 };

    const file = p.dishPhoto ? files[p.dishPhoto.index] : undefined;
    if (p.dishPhoto && file) {
      setScan((s) => ({ ...s, label: "Foto van het gerecht toevoegen…" }));
      const kB = await add(await cropSmall(file, p.dishPhoto));
      if (kB) return `De foto van het gerecht staat bij de foto's (${kB} kB); haal hem weg als hij niet goed is. `;
    }

    if (p.stockPhoto && photos.length === 0) {
      setScan((s) => ({ ...s, label: "Passende foto toevoegen…" }));
      const bytes = Uint8Array.from(atob(p.stockPhoto.data), (c) => c.charCodeAt(0));
      const kB = await add(await cropSmall(new Blob([bytes], { type: p.stockPhoto.type }), whole));
      if (kB) {
        const by = p.stockPhoto.credit ? ` van ${p.stockPhoto.credit}` : "";
        return `Er stond geen foto van het gerecht bij, daarom is er een passende foto${by} via ${p.stockPhoto.source} toegevoegd (${kB} kB); haal hem weg als hij niet past. `;
      }
    }
    return "";
  }

  async function scanPhotos(files: File[]) {
    setScan({ busy: true, label: "Voorbereiden…", note: "", text: "" });
    try {
      const { recipe: p, pages } = await scanWithAI(files, (label) => setScan((s) => ({ ...s, label })), {
        wantStock: photos.length === 0 && uploading === 0,
      });
      clearPending();
      const text = parsedAsText(p);
      if (p.title && !title.trim()) setTitle(p.title);
      if (p.description && !description.trim()) setDescription(p.description);
      if (p.servings) setServings(String(p.servings));
      if (p.minutes && !minutes) setMinutes(String(p.minutes));
      // Categories: only for a group where nothing is chosen yet, so your own choice stays.
      const suggested: string[] = [];
      const suggest = (have: Set<string>, found: string[], set: (s: Set<string>) => void) => {
        if (have.size || !found.length) return;
        set(new Set(found));
        suggested.push(...found);
      };
      suggest(meals, p.meals, setMeals);
      suggest(tastes, p.tastes, setTastes);
      suggest(kinds, p.kinds, setKinds);
      suggest(mains, p.mains, setMains);
      // Add only what isn't in the form yet, so scanning a second page (or the same page again) adds no doubles.
      const ingMerge = mergeIngredients(
        ings.filter((r) => r.qty.trim() || r.name.trim()),
        p.ingredients,
        (i) => ({ key: newKey(), qty: i.qty, unit: i.unit, name: i.name }),
      );
      const stepMerge = mergeSteps(
        steps.filter((s) => s.text.trim()),
        p.steps,
        (text) => ({ key: newKey(), text }),
      );
      if (p.ingredients.length) setIngs(ingMerge.rows.length ? ingMerge.rows : [emptyIng()]);
      if (p.steps.length) setSteps(stepMerge.rows.length ? stepMerge.rows : [emptyStep()]);
      const addedIngs = p.ingredients.length - ingMerge.skipped;
      const addedSteps = p.steps.length - stepMerge.skipped;
      const skipped = ingMerge.skipped + stepMerge.skipped;
      const found = p.ingredients.length + p.steps.length;
      const dish = await addDishPhoto(pages, p);
      setScan({
        busy: false,
        label: "",
        text,
        note: !found
          ? "Er is weinig herkend. Probeer een scherpere foto: recht van boven, met goed licht en zonder schaduw."
          : `Klaar: ${addedIngs} ingrediënten en ${addedSteps} stappen toegevoegd` +
            (skipped ? ` (${skipped} stond${skipped === 1 ? "" : "en"} er al en ${skipped === 1 ? "is" : "zijn"} overgeslagen)` : "") +
            ". " +
            dish +
            (suggested.length ? `Categorieën voorgesteld: ${suggested.join(", ")}. ` : "") +
            "Controleer alles even, de herkenning maakt soms fouten.",
      });
    } catch (e) {
      const unreadable = e instanceof ScanError && e.kind === "mislukt";
      setScan({
        busy: false,
        label: "",
        text: "",
        note: unreadable
          ? "De foto kon niet worden gelezen. Probeer een scherpere foto: recht van boven, met goed licht en zonder schaduw."
          : "Er kunnen vandaag geen foto's meer worden verwerkt. Probeer het morgen opnieuw.",
      });
    }
  }

  const toggle = (set: Set<string>, v: string, update: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    update(n);
  };

  const setIng = (key: string, patch: Partial<IngRow>) => setIngs((rows) => rows.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <Sheet label={isNew ? "Nieuw recept" : "Recept bewerken"} onClose={cancel}>
      <div className="sheet-head">
        <button className="close" type="button" aria-label="Annuleren" onClick={cancel}>
          <XIcon />
        </button>
        <strong className="grow sheet-title">{isNew ? "Nieuw recept" : "Recept bewerken"}</strong>
      </div>

      <div className="sec">
        <div className="scanbox">
          {pending.length === 0 ? (
            <label className="btn scan-btn">
              <CameraIcon />
              Recept scannen van foto
              <input
                className="sr-only"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  addPending(files);
                }}
              />
            </label>
          ) : (
            <>
              <div className="photos scan-photos" aria-label="Foto's om te lezen">
                {pending.map((p, ix) => (
                  <div key={p.key} className="pthumb">
                    <img src={p.url} alt={`Pagina ${ix + 1}`} />
                    {!scan.busy && (
                      <button className="x" type="button" aria-label={`Pagina ${ix + 1} weghalen`} onClick={() => removePending(p.key)}>
                        <XIcon />
                      </button>
                    )}
                  </div>
                ))}
                {!scan.busy && pending.length < MAX_SCAN_PHOTOS && (
                  <label className="addphoto">
                    + Nog een foto
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        addPending(files);
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="scan-actions">
                <button
                  className={"btn primary" + (scan.busy ? " busy" : "")}
                  type="button"
                  disabled={scan.busy}
                  onClick={() => scanPhotos(pending.map((p) => p.file))}
                >
                  {scan.busy ? "Bezig met lezen…" : pending.length > 1 ? `Recept lezen (${pending.length} foto's)` : "Recept lezen"}
                </button>
                {!scan.busy && (
                  <button className="btn ghost" type="button" onClick={clearPending}>
                    Annuleren
                  </button>
                )}
              </div>
            </>
          )}
          {scan.busy ? (
            <div className="scan-progress" role="status">
              <div className="bar-track">
                <div className="bar-fill bar-busy" />
              </div>
              <span className="hint">{scan.label}</span>
            </div>
          ) : scan.note ? (
            <p className="scan-note" role="status">{scan.note}</p>
          ) : (
            <span className="hint">
              {pending.length === 0
                ? "Maak een foto van een recept op papier. Staat het op meer pagina's, dan kun je daarna nog een foto toevoegen."
                : `Staat het recept op meer pagina's? Voeg dan met "+ Nog een foto" de volgende pagina toe (maximaal ${MAX_SCAN_PHOTOS}). Druk daarna op "Recept lezen". Wat al in het formulier staat, wordt niet dubbel toegevoegd.`}
            </span>
          )}
          {scan.text && !scan.busy && (
            <details className="scan-text">
              <summary>Herkende tekst bekijken</summary>
              <pre>{scan.text}</pre>
            </details>
          )}
        </div>

        <div className="field">
          <label htmlFor="title-in">Naam van het recept</label>
          <input
            ref={titleRef}
            className="in"
            id="title-in"
            placeholder="Bijv. Appeltaart van oma"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="desc-in">Korte omschrijving</label>
          <textarea
            className="in"
            id="desc-in"
            rows={2}
            placeholder="Waar komt het vandaan, waarom is het lekker?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <fieldset className="field">
          <legend className="legend">Maaltijd</legend>
          <div className="chips">
            {MEALS.map((m) => (
              <button key={m} className="chip meal" type="button" aria-pressed={meals.has(m)} onClick={() => toggle(meals, m, setMeals)}>
                {m}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend className="legend">Smaak</legend>
          <div className="chips">
            {TASTES.map((t) => (
              <button key={t} className="chip taste" type="button" aria-pressed={tastes.has(t)} onClick={() => toggle(tastes, t, setTastes)}>
                {t}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend className="legend">Soort gerecht</legend>
          <div className="chips">
            {KINDS.map((k) => (
              <button key={k} className="chip kind" type="button" aria-pressed={kinds.has(k)} onClick={() => toggle(kinds, k, setKinds)}>
                {k}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend className="legend">Hoofdingrediënt</legend>
          <div className="chips">
            {MAINS.map((m) => (
              <button key={m} className="chip main" type="button" aria-pressed={mains.has(m)} onClick={() => toggle(mains, m, setMains)}>
                {m}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="row2">
          <div className="field">
            <label htmlFor="min-in">Bereidingstijd (min)</label>
            <input className="in" id="min-in" type="number" min={0} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="serv-in">Aantal personen</label>
            <input className="in" id="serv-in" type="number" min={1} inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} />
          </div>
        </div>

        <fieldset className="field">
          <legend className="legend">Foto's</legend>
          <div className="photos">
            {photos.map((p, ix) => (
              <div key={p} className="pthumb">
                <img src={photoUrl(p)} alt={`Foto ${ix + 1}`} />
                <button
                  className="x"
                  type="button"
                  aria-label={`Foto ${ix + 1} verwijderen`}
                  onClick={() => setPhotos((list) => list.filter((x) => x !== p))}
                >
                  <XIcon />
                </button>
              </div>
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <div key={`busy-${i}`} className="pthumb busy" role="status">
                Uploaden…
              </div>
            ))}
            <label className="addphoto">
              + Foto toevoegen
              <input
                className="sr-only"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  addFiles(files);
                }}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="legend">Ingrediënten</legend>
          <span className="hint">Hoeveelheden worden automatisch omgerekend als je het aantal personen aanpast.</span>
          <div className="rows" ref={ingBox}>
            {ings.map((ing, ix) => (
              <div key={ing.key} className="ingrow">
                <input
                  className="in"
                  inputMode="decimal"
                  placeholder="250"
                  aria-label={`Hoeveelheid ingrediënt ${ix + 1}`}
                  value={ing.qty}
                  onChange={(e) => setIng(ing.key, { qty: e.target.value })}
                />
                <select
                  className="in"
                  aria-label={`Eenheid ingrediënt ${ix + 1}`}
                  value={ing.unit}
                  onChange={(e) => setIng(ing.key, { unit: e.target.value })}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u || "—"}
                    </option>
                  ))}
                  {ing.unit && !(UNITS as readonly string[]).includes(ing.unit) && <option value={ing.unit}>{ing.unit}</option>}
                </select>
                <input
                  className="in"
                  placeholder="bloem"
                  aria-label={`Ingrediënt ${ix + 1}`}
                  value={ing.name}
                  onChange={(e) => setIng(ing.key, { name: e.target.value })}
                />
                <button
                  className="x"
                  type="button"
                  aria-label={`Ingrediënt ${ix + 1} verwijderen`}
                  onClick={() => setIngs((rows) => rows.filter((x) => x.key !== ing.key))}
                >
                  <XIcon />
                </button>
              </div>
            ))}
          </div>
          <div>
            <button
              className="btn"
              type="button"
              onClick={() => {
                focusLast.current = "ing";
                setIngs((rows) => [...rows, emptyIng()]);
              }}
            >
              + Ingrediënt
            </button>
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="legend">Bereiding</legend>
          <div className="rows" ref={stepBox}>
            {steps.map((s, ix) => (
              <div key={s.key} className="stepform">
                <span className="n" aria-hidden="true">{ix + 1}</span>
                <textarea
                  className="in"
                  rows={2}
                  placeholder={ix === 0 ? "Verwarm de oven voor op 180 °C." : "Volgende stap"}
                  aria-label={`Stap ${ix + 1}`}
                  value={s.text}
                  onChange={(e) => setSteps((rows) => rows.map((x) => (x.key === s.key ? { ...x, text: e.target.value } : x)))}
                />
                <button
                  className="x"
                  type="button"
                  aria-label={`Stap ${ix + 1} verwijderen`}
                  onClick={() => setSteps((rows) => rows.filter((x) => x.key !== s.key))}
                >
                  <XIcon />
                </button>
              </div>
            ))}
          </div>
          <div>
            <button
              className="btn"
              type="button"
              onClick={() => {
                focusLast.current = "step";
                setSteps((rows) => [...rows, emptyStep()]);
              }}
            >
              + Stap
            </button>
          </div>
        </fieldset>
      </div>

      <div className="formfoot">
        <span className="err" role="alert">{err}</span>
        <button className="btn" type="button" onClick={cancel}>
          Annuleren
        </button>
        <button className="btn primary" type="button" onClick={save} disabled={saving || uploading > 0}>
          {saving ? "Opslaan…" : uploading > 0 ? "Foto's uploaden…" : isNew ? "Recept opslaan" : "Wijzigingen opslaan"}
        </button>
      </div>
    </Sheet>
  );
}
