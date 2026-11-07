import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";

/** Asked once, on the first login: the name others see at "Toegevoegd door". */
export function NameSetup({ uid, onDone, onSignOut }: { uid: string; onDone: (name: string) => void; onSignOut: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setErr("Vul een naam in.");
      return;
    }
    setBusy(true);
    setErr("");
    const { error } = await supabase!.from("profiles").upsert({ id: uid, display_name: n });
    setBusy(false);
    if (error) setErr("Opslaan is niet gelukt. Probeer het opnieuw.");
    else onDone(n);
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit} noValidate>
        <h1>Welkom!</h1>
        <p>Hoe mogen de anderen je noemen? Deze naam staat bij de recepten die je toevoegt.</p>
        <div className="field">
          <label htmlFor="display-name">Je naam</label>
          <input
            className="in"
            id="display-name"
            autoComplete="given-name"
            placeholder="Bijv. Oma Riet"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Opslaan…" : "Verder"}
        </button>
        <button className="btn ghost" type="button" onClick={onSignOut}>
          Uitloggen
        </button>
      </form>
    </div>
  );
}
