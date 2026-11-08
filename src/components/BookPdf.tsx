import { useEffect, useState } from "react";
import { bookLink, bookUpdated, refreshBook } from "../pdf";
import { fmtDate } from "../util";

/** In the menu: download the whole cookbook as a PDF (made every week), or have it made again now. */
export function BookPdf() {
  const [updated, setUpdated] = useState<Date | null | undefined>(undefined);
  const [busy, setBusy] = useState<"" | "download" | "refresh">("");
  const [note, setNote] = useState("");

  useEffect(() => {
    bookUpdated().then(setUpdated).catch(() => setUpdated(null));
  }, []);

  async function download() {
    setBusy("download");
    setNote("");
    let link = await bookLink();
    if (!link) {
      // There is no PDF yet: make it first.
      setNote("Het kookboek wordt gemaakt, dat kan even duren…");
      if (await refreshBook()) {
        setUpdated(await bookUpdated());
        link = await bookLink();
      }
    }
    setBusy("");
    if (!link) {
      setNote("Het kookboek kon niet worden gemaakt. Probeer het later opnieuw.");
      return;
    }
    setNote("");
    window.location.href = link;
  }

  async function refresh() {
    setBusy("refresh");
    setNote("Het kookboek wordt bijgewerkt, dat kan even duren…");
    const ok = await refreshBook();
    setUpdated(await bookUpdated());
    setBusy("");
    setNote(ok ? "Bijgewerkt." : "Bijwerken is niet gelukt. Probeer het later opnieuw.");
  }

  return (
    <div className="book-pdf">
      <button className="btn" type="button" onClick={download} disabled={!!busy}>
        {busy === "download" ? "Even geduld…" : "Kookboek als PDF"}
      </button>
      <span className="hint">
        {updated ? `Bijgewerkt op ${fmtDate(updated.toISOString())}. ` : updated === null ? "Wordt elke week bijgewerkt. " : ""}
        {updated !== undefined && (
          <button className="linkish" type="button" onClick={refresh} disabled={!!busy}>
            {busy === "refresh" ? "Bezig…" : "Nu bijwerken"}
          </button>
        )}
      </span>
      {note && (
        <span className="hint" role="status">
          {note}
        </span>
      )}
    </div>
  );
}
