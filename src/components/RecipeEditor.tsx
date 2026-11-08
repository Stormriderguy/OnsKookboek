import { useEffect, useRef, useState } from "react";
import { ScanError, scanWithAI } from "../aiScan";
import { parsedAsText } from "../parseRecipe";
import { BUCKET, photoUrl, supabase } from "../supabase";
import { MEALS, TASTES, UNITS, type Recipe, type RecipeInput } from "../types";
import { shrink } from "../util";
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

  async function addFiles(files: File[]) {
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const small = await shrink(file);
        const isJpeg = small.type === "image/jpeg";
        const ext = isJpeg ? "jpg" : (file.name.split(".").pop() || "img").toLowerCase();
        const path = `${uid}/${crypto.randomUUID()}.${ext}`;
        const { error } = await db.storage
          .from(BUCKET)
          .upload(path, small, { contentType: small.type || "image/jpeg", cacheControl: "31536000" });
        if (error) throw error;
        uploadedNow.current.add(path);
        setPhotos((p) => [...p, path]);
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

  async function scanPhoto(file: File) {
    setScan({ busy: true, label: "Voorbereiden…", note: "", text: "" });
    try {
      const p = await scanWithAI(file, (label) => setScan((s) => ({ ...s, label })));
      const text = parsedAsText(p);
      if (p.title && !title.trim()) setTitle(p.title);
      if (p.description && !description.trim()) setDescription(p.description);
      if (p.servings) setServings(String(p.servings));
      if (p.minutes && !minutes) setMinutes(String(p.minutes));
      if (p.ingredients.length) {
        setIngs((rows) => [
          ...rows.filter((r) => r.qty.trim() || r.name.trim()),
          ...p.ingredients.map((i) => ({ key: newKey(), qty: i.qty, unit: i.unit, name: i.name })),
        ]);
      }
      if (p.steps.length) {
        setSteps((rows) => [...rows.filter((s) => s.text.trim()), ...p.steps.map((text) => ({ key: newKey(), text }))]);
      }
      const found = p.ingredients.length + p.steps.length;
      setScan({
        busy: false,
        label: "",
        text,
        note: found
          ? `Klaar: ${p.ingredients.length} ingrediënten en ${p.steps.length} stappen gevonden. Controleer alles even, de herkenning maakt soms fouten.`
          : "Er is weinig herkend. Probeer een scherpere foto: recht van boven, met goed licht en zonder schaduw.",
      });
    } catch (e) {
      const unreadable = e instanceof ScanError && e.kind === "mislukt";
      setScan({
        busy: false,
        label: "",
        text: "",
        note: unreadable
          ? "Deze foto kon niet worden gelezen. Probeer een scherpere foto: recht van boven, met goed licht en zonder schaduw."
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
          <label className={"btn scan-btn" + (scan.busy ? " busy" : "")} aria-disabled={scan.busy}>
            <CameraIcon />
            {scan.busy ? "Bezig met scannen…" : "Recept scannen van foto"}
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              disabled={scan.busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) scanPhoto(file);
              }}
            />
          </label>
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
            <span className="hint">Maak een foto van een recept op papier. De velden hieronder worden zo goed mogelijk ingevuld.</span>
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
