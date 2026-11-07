import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";

/** iPhone/iPad in Safari, not yet opened from the home screen. Safari and the home-screen app don't share the login. */
function isIosBrowser(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/** One-time entry: a code from the owner proves access, the person picks their own name. */
export function Join({ onJoined }: { onJoined: (name: string) => void }) {
  const db = supabase!;
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setErr("Vul de code en je naam in.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      // Reuse the session from an earlier attempt, so a typo doesn't create a new account each time.
      const { data } = await db.auth.getSession();
      if (!data.session) {
        const { error } = await db.auth.signInAnonymously();
        if (error) {
          setErr(
            error.status === 429
              ? "Te veel pogingen. Wacht een paar minuten en probeer het opnieuw."
              : "Het kookboek laat op dit moment niemand nieuw toe. Vraag de eigenaar om hulp.",
          );
          return;
        }
      }
      const { data: saved, error } = await db.rpc("redeem_invite", { p_code: code, p_name: name });
      if (!error) {
        onJoined(typeof saved === "string" ? saved : name.trim());
        return;
      }
      const m = error.message;
      if (m.includes("invalid_code")) setErr("Deze code klopt niet of is al gebruikt.");
      else if (m.includes("name_taken")) setErr("Deze naam is al in gebruik. Kies een andere naam.");
      else if (m.includes("invalid_name")) setErr("Kies een naam van maximaal 40 tekens.");
      else if (m.includes("already_member")) window.location.reload();
      else setErr("Het is niet gelukt. Controleer je verbinding en probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit} noValidate>
        <h1>Ons Kookboek</h1>
        <p>Vul de code in die je van de eigenaar hebt gekregen, en kies de naam waaronder je recepten toevoegt.</p>
        {isIosBrowser() && (
          <p className="note">
            Op een iPhone of iPad: zet de app eerst op je beginscherm (Delen → <strong>Zet op beginscherm</strong>) en vul de code dáár
            in. Anders moet je later opnieuw een code vragen.
          </p>
        )}
        <div className="field">
          <label htmlFor="join-code">Code</label>
          <input
            className="in"
            id="join-code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Bijv. K7PM-Q2XD"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="join-name">Je naam</label>
          <input
            className="in"
            id="join-name"
            autoComplete="nickname"
            maxLength={40}
            placeholder="Bijv. Oma Riet"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="hint">Deze naam staat bij de recepten die je toevoegt. Je kiest hem één keer.</span>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Even geduld…" : "Naar het kookboek"}
        </button>
        <p className="hint">Daarna blijf je op dit apparaat ingelogd. Een code werkt maar één keer.</p>
      </form>
    </div>
  );
}
