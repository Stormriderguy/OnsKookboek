import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";

/** Usernames are stored in Supabase as an internal address; no mail is ever sent to it. */
export const LOGIN_DOMAIN = "onskookboek.app";

export function usernameToEmail(name: string): string {
  const n = name.trim().toLowerCase();
  if (n.includes("@")) return n; // a full e-mail address also works
  return `${n.replace(/\s+/g, "-")}@${LOGIN_DOMAIN}`;
}

export function Login() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code) {
      setErr("Vul je naam en je code in.");
      return;
    }
    setErr("");
    setBusy(true);
    const { error } = await supabase!.auth.signInWithPassword({ email: usernameToEmail(name), password: code });
    setBusy(false);
    if (!error) return; // the app switches to the cookbook by itself
    if (error.status === 429) setErr("Te veel pogingen. Wacht een paar minuten en probeer het opnieuw.");
    else if (error.status === 400) setErr("Naam of code klopt niet. Vraag de eigenaar van het kookboek als je je code kwijt bent.");
    else setErr("Inloggen is niet gelukt. Controleer je verbinding en probeer het opnieuw.");
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit} noValidate>
        <h1>Ons Kookboek</h1>
        <p>Log in met de naam en de code die je van de eigenaar van het kookboek hebt gekregen.</p>
        <div className="field">
          <label htmlFor="login-name">Naam</label>
          <input
            className="in"
            id="login-name"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Bijv. riet"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="login-code">Code</label>
          <input
            className="in"
            id="login-code"
            type="password"
            autoComplete="current-password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Inloggen…" : "Inloggen"}
        </button>
        <p className="hint">Je blijft ingelogd op dit apparaat tot je zelf uitlogt.</p>
      </form>
    </div>
  );
}
