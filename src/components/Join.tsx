import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";

/** iPhone/iPad in Safari, not yet opened from the home screen. Safari and the home-screen app don't share the login. */
function isIosBrowser(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/**
 * Entry with the shared code plus first and last name.
 * Entering a name that already exists brings back that person's account (new device, cleared browser).
 */
export function Join({ onJoined }: { onJoined: (name: string) => void }) {
  const db = supabase!;
  const [code, setCode] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = `${first.trim()} ${last.trim()}`.trim();
    if (!code.trim()) {
      setErr("Vul de code in.");
      return;
    }
    if (!first.trim() || !last.trim()) {
      setErr("Vul je voornaam en je achternaam in.");
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
          // Most likely cause: "Allow anonymous sign-ins" or "Allow new users to sign up" is off in Supabase.
          setErr(
            error.status === 429
              ? "Te veel pogingen. Wacht een paar minuten en probeer het opnieuw."
              : error.code === "anonymous_provider_disabled" || error.code === "signup_disabled"
                ? "Het kookboek staat nog niet open voor nieuwe mensen. Eigenaar: zet in Supabase 'Allow new users to sign up' en 'Allow anonymous sign-ins' aan."
                : "Aanmelden is niet gelukt. Controleer je verbinding en probeer het opnieuw.",
          );
          return;
        }
      }
      const joined = await db.rpc("join_cookbook", { p_code: code, p_name: name });
      const result = joined.data as { ok: boolean; name?: string; error?: string } | null;
      if (joined.error || !result) {
        setErr("Het is niet gelukt. Controleer je verbinding en probeer het opnieuw.");
      } else if (result.ok) {
        onJoined(result.name || name);
      } else {
        setErr(
          {
            invalid_code: "Deze code klopt niet. Controleer de code die je hebt gekregen.",
            name_taken: "Dat lukte net niet. Probeer het nog een keer.",
            invalid_name: "Vul je voornaam en je achternaam in.",
            too_many_attempts: "Te veel foute codes op dit apparaat. Vraag de eigenaar om hulp.",
          }[result.error ?? ""] ?? "Het is niet gelukt. Probeer het opnieuw.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit} noValidate>
        <h1>Ons Kookboek</h1>
        <p>Vul de code van het kookboek in die je van ons hebt gekregen, en je voor- en achternaam.</p>
        {isIosBrowser() && (
          <p className="note">
            Op een iPhone of iPad: zet de app eerst op je beginscherm (Delen → <strong>Zet op beginscherm</strong>) en vul de code dáár
            in. Safari en de app op het beginscherm onthouden je los van elkaar.
          </p>
        )}
        <div className="field">
          <label htmlFor="join-code">Code</label>
          <input
            className="in"
            id="join-code"
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="join-first">Voornaam</label>
            <input
              className="in"
              id="join-first"
              autoComplete="given-name"
              autoCapitalize="words"
              maxLength={40}
              value={first}
              onChange={(e) => setFirst(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="join-last">Achternaam</label>
            <input
              className="in"
              id="join-last"
              autoComplete="family-name"
              autoCapitalize="words"
              maxLength={40}
              value={last}
              onChange={(e) => setLast(e.target.value)}
            />
          </div>
        </div>
        <span className="hint">
          Je naam staat bij de recepten die je toevoegt. Was je al eerder binnen, bijvoorbeeld op een ander apparaat? Vul dan dezelfde
          naam in, dan krijg je je favorieten terug.
        </span>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Even geduld…" : "Naar het kookboek"}
        </button>
        <p className="hint">Daarna blijf je op dit apparaat ingelogd onder je naam.</p>
      </form>
    </div>
  );
}
