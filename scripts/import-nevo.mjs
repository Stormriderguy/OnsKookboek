// Zet het NEVO-bestand van het RIVM in de tabel public.nevo in Supabase. Draai met: npm run nevo [bestand]
// - Het bestand downloadt de eigenaar zelf op rivm.nl (voorwaarden accepteren) en zet het in de projectmap.
//   Het gaat niet in Git (zie .gitignore).
// - Nodig in .env: VITE_SUPABASE_URL en SUPABASE_SECRET_KEY (de geheime sleutel, alleen op deze computer).
// - De waarden worden ongewijzigd overgenomen (alleen de kolommen die de app gebruikt). Opnieuw draaien bij een nieuwe versie.
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TEST = process.argv.includes("--test"); // alleen inlezen en een voorbeeld tonen, niets opslaan
const args = process.argv.slice(2).filter((a) => a !== "--test");

// .env lezen zonder extra pakket
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!TEST && (!url || !key)) {
  console.error("Zet VITE_SUPABASE_URL en SUPABASE_SECRET_KEY in .env (de geheime sleutel uit Supabase → Project Settings → API Keys).");
  process.exit(1);
}

const file = args[0] || readdirSync(".").find((f) => /nevo.*\.(csv|txt)$/i.test(f));
if (!file) {
  console.error("Geen NEVO-bestand gevonden. Zet het CSV-bestand in de projectmap of geef de naam mee: npm run nevo NEVO2025.csv");
  process.exit(1);
}

// CSV met | ; of , als scheidingsteken, en "…" rond velden.
const text = readFileSync(file, "utf8");
const lines = text.split(/\r?\n/).filter((l) => l.trim());
const sep = ["|", ";", "\t", ","].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
const split = (line) => {
  const out = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
};
const head = split(lines[0]);
const col = (re) => {
  const i = head.findIndex((h) => re.test(h));
  return i;
};
const C = {
  code: col(/nevo.?code/i),
  naam: col(/voedingsmiddelnaam|dutch food name/i),
  synoniem: col(/^synoniem/i),
  groep: col(/voedingsmiddelgroep/i),
  hoeveelheid: col(/hoeveelheid|quantity/i),
  kcal: col(/^ENERCC\b/i),
  eiwit: col(/^PROT\b/i),
  koolh: col(/^CHO\b/i),
  suikers: col(/^SUGAR\b/i),
  vet: col(/^FAT\b/i),
  verz_vet: col(/^FASAT\b/i),
  vezels: col(/^FIBT\b/i),
  natrium_mg: col(/^NA\b/i),
};
const absent = Object.entries(C).filter(([, i]) => i < 0).map(([k]) => k);
if (absent.some((k) => !["groep", "hoeveelheid", "synoniem"].includes(k))) {
  console.error("Deze kolommen vond ik niet:", absent.join(", "));
  console.error("Kolommen in het bestand:", head.join(" | "));
  process.exit(1);
}

const num = (s) => {
  if (s == null || s === "") return null;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const rows = lines
  .slice(1)
  .map(split)
  .map((c) => ({
    code: Number(c[C.code]),
    naam: c[C.naam],
    synoniem: C.synoniem >= 0 ? c[C.synoniem] : "",
    groep: C.groep >= 0 ? c[C.groep] : "",
    eenheid: C.hoeveelheid >= 0 && /ml/i.test(c[C.hoeveelheid]) ? "ml" : "g",
    kcal: num(c[C.kcal]),
    eiwit: num(c[C.eiwit]),
    koolh: num(c[C.koolh]),
    suikers: num(c[C.suikers]),
    vet: num(c[C.vet]),
    verz_vet: num(c[C.verz_vet]),
    vezels: num(c[C.vezels]),
    natrium_mg: num(c[C.natrium_mg]),
  }))
  .filter((r) => Number.isInteger(r.code) && r.naam);

console.log(`${rows.length} producten gelezen uit ${file}. Voorbeeld:`, rows[0]);
if (TEST) {
  for (const naam of ["Ei kippen- rauw", "Biscuit Maria", "Margarine", "Cacaopoeder"]) {
    const r = rows.find((x) => x.naam.toLowerCase().startsWith(naam.toLowerCase()));
    console.log(naam, "→", r ? `${r.code} ${r.naam} | ${r.groep} | ${r.kcal} kcal, eiwit ${r.eiwit}, suikers ${r.suikers}, verz. vet ${r.verz_vet}, natrium ${r.natrium_mg} mg (${r.eenheid})` : "niet gevonden");
  }
  console.log("Groepen:", [...new Set(rows.map((r) => r.groep))].join(" · "));
  process.exit(0);
}
const db = createClient(url, key, { auth: { persistSession: false } });
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await db.from("nevo").upsert(rows.slice(i, i + 500));
  if (error) {
    console.error("Opslaan mislukt:", error.message);
    process.exit(1);
  }
}
console.log(`Klaar: ${rows.length} producten staan in de tabel nevo.`);
