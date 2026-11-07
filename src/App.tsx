import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { Login } from "./components/Login";
import { NameSetup } from "./components/NameSetup";
import { Cookbook } from "./components/Cookbook";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [myName, setMyName] = useState<string | null | undefined>(undefined);
  const uid = session?.user.id;

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Look up the display name once per signed-in user.
  useEffect(() => {
    if (!supabase || !uid) {
      setMyName(undefined);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        // On a network error, carry on with an empty name rather than blocking the app.
        setMyName(error ? "" : (data?.display_name ?? null));
      });
    return () => {
      active = false;
    };
  }, [uid]);

  const signOut = () => {
    supabase?.auth.signOut();
  };

  if (!supabase) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>Ons Kookboek</h1>
          <p>
            De app is nog niet gekoppeld aan Supabase. Vul <code>VITE_SUPABASE_URL</code> en{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> in (in <code>.env</code> of in Vercel) en start de app opnieuw.
          </p>
        </div>
      </div>
    );
  }
  if (session === undefined || (session && myName === undefined)) {
    return (
      <div className="gate" aria-busy="true">
        <p className="hint">Laden…</p>
      </div>
    );
  }
  if (!session || !uid) return <Login />;
  if (myName === null) return <NameSetup uid={uid} onDone={setMyName} onSignOut={signOut} />;
  return <Cookbook uid={uid} myName={myName ?? ""} onSignOut={signOut} />;
}
