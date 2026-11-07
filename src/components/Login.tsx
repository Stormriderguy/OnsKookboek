import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../supabase";

/** Reads an error Supabase puts in the address after an expired or used link, then clears it. */
function linkErrorFromUrl(): string {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
  const code = params.get("error_code") || params.get("error");
  if (!code) return "";
  history.replaceState(null, "", window.location.pathname);
  if (code === "otp_expired") return "Deze inloglink is verlopen of al gebruikt. Vraag hieronder een nieuwe aan.";
  return "Inloggen met deze link is niet gelukt. Vraag hieronder een nieuwe aan.";
}

export function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState("");

  useEffect(() => {
    const e = linkErrorFromUrl();
    if (e) setErr(e);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address.includes("@")) {
      setErr("Vul een geldig e-mailadres in.");
      return;
    }
    setErr("");
    setState("sending");
    const { error } = await supabase!.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    if (!error) {
      setState("sent");
      return;
    }
    setState("idle");
    if (error.status === 429) setErr("Je hebt net al een link aangevraagd. Wacht een minuut en probeer het opnieuw.");
    else if (error.code === "otp_disabled" || /signups? not allowed/i.test(error.message))
      setErr("Dit e-mailadres is niet uitgenodigd. Vraag de eigenaar van het kookboek om een uitnodiging.");
    else setErr("Het versturen is niet gelukt. Controleer je verbinding en probeer het opnieuw.");
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit} noValidate>
        <h1>Ons Kookboek</h1>
        {state === "sent" ? (
          <>
            <p className="ok">
              We hebben een inloglink gestuurd naar <strong>{email.trim()}</strong>. Open de e-mail en tik op de link.
            </p>
            <button className="btn" type="button" onClick={() => setState("idle")}>
              Ander e-mailadres
            </button>
          </>
        ) : (
          <>
            <p>Log in met je e-mailadres. Je krijgt een link waarmee je meteen binnen bent, zonder wachtwoord.</p>
            <div className="field">
              <label htmlFor="email">E-mailadres</label>
              <input
                className="in"
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {err && <p className="err" role="alert">{err}</p>}
            <button className="btn primary" type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Versturen…" : "Stuur inloglink"}
            </button>
            <p className="hint">Alleen uitgenodigde mensen kunnen inloggen.</p>
          </>
        )}
      </form>
    </div>
  );
}
