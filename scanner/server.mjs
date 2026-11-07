// Scan-poortwachter voor Ons Kookboek.
// Staat tussen internet (via Tailscale Funnel) en Ollama op deze computer.
// Alleen ingelogde leden van het kookboek mogen een foto laten lezen.
// Geen extra pakketten nodig: alleen Node.js 20 of nieuwer.

import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

const env = (name, fallback) => process.env[name]?.trim() || fallback;

const CONFIG = {
  host: env("HOST", "127.0.0.1"),
  port: Number(env("PORT", "8787")),
  supabaseUrl: env("SUPABASE_URL", "").replace(/\/+$/, ""),
  supabaseKey: env("SUPABASE_KEY", ""),
  ollamaUrl: env("OLLAMA_URL", "http://127.0.0.1:11434").replace(/\/+$/, ""),
  model: env("OLLAMA_MODEL", "qwen2.5vl:3b"),
  origins: env("ALLOWED_ORIGINS", "https://onskookboek.vercel.app,http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  dailyLimit: Number(env("DAILY_LIMIT", "30")),
  maxQueue: Number(env("MAX_QUEUE", "10")),
  maxBytes: Number(env("MAX_MB", "8")) * 1024 * 1024,
  scanTimeoutMs: Number(env("SCAN_TIMEOUT_MIN", "10")) * 60_000,
};

if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
  console.error("SUPABASE_URL en SUPABASE_KEY ontbreken (zie scanner.env).");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Wat het model terug moet geven
// ---------------------------------------------------------------------------

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    servings: { type: "integer" },
    minutes: { type: "integer" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: { qty: { type: "string" }, unit: { type: "string" }, name: { type: "string" } },
        required: ["qty", "unit", "name"],
      },
    },
    steps: { type: "array", items: { type: "string" } },
  },
  required: ["title", "description", "servings", "minutes", "ingredients", "steps"],
};

const PROMPT = `Je krijgt een foto van een recept, bijvoorbeeld een pagina uit een kookboek. Lees de tekst en geef het recept terug als JSON.

Regels:
- Neem de tekst letterlijk over, in de taal van de foto. Verzin niets, vertaal niets en vul niets aan.
- De pagina kan meerdere kolommen hebben (bijvoorbeeld de bereiding links en de ingrediënten rechts). Lees elke kolom apart van boven naar beneden en meng geen regels uit verschillende kolommen.
- title: de naam van het recept.
- description: de korte inleiding als die er staat, anders een lege tekst.
- servings: het aantal personen als getal, of 0 als het er niet staat.
- minutes: de totale bereidingstijd in minuten als getal, of 0 als het er niet staat.
- ingredients: elk ingrediënt apart. qty is de hoeveelheid zoals "200", "1,5" of "1/2" (leeg als er geen is). unit is de eenheid zoals g, kg, ml, dl, l, el, tl, snufje, stuks, teen, blik, bos, plak, kopje of naar smaak (leeg als er geen is). name is de rest van de regel.
- steps: de bereiding in de juiste volgorde. Elke alinea is één stap: neem de hele alinea over als één tekst en splits hem niet op in losse zinnen. Zijn de stappen in het recept genummerd, dan is elk nummer één stap. Laat de nummers zelf weg.`;

// ---------------------------------------------------------------------------
// Lidmaatschap controleren bij Supabase
// ---------------------------------------------------------------------------

const memberCache = new Map(); // sha256(token) → { uid, ok, until }
let checksThisMinute = 0;
setInterval(() => (checksThisMinute = 0), 60_000).unref();

function tokenPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Returns { uid } for a member, or an HTTP status (401/403/503) otherwise. */
async function checkMember(authHeader) {
  const token = /^Bearer\s+(\S+)$/i.exec(authHeader ?? "")?.[1];
  if (!token) return 401;
  const payload = tokenPayload(token);
  const nowSec = Date.now() / 1000;
  if (!payload?.sub || !payload.exp || payload.exp < nowSec) return 401;

  const key = createHash("sha256").update(token).digest("hex");
  const cached = memberCache.get(key);
  if (cached && cached.until > Date.now()) return cached.ok ? { uid: cached.uid } : 403;

  // Keep unknown tokens from turning this into a way to flood Supabase.
  if (++checksThisMinute > 120) return 503;

  let res;
  try {
    res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/is_member`, {
      method: "POST",
      headers: { apikey: CONFIG.supabaseKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return 503;
  }
  if (res.status === 401 || res.status === 403) return 401;
  if (!res.ok) return 503;
  const ok = (await res.json().catch(() => false)) === true;
  // Supabase checked the signature, so the user id in the token can be trusted now.
  const until = Math.min(Date.now() + 10 * 60_000, payload.exp * 1000);
  memberCache.set(key, { uid: payload.sub, ok, until });
  return ok ? { uid: payload.sub } : 403;
}

// ---------------------------------------------------------------------------
// Daglimiet en wachtrij
// ---------------------------------------------------------------------------

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local time
const usage = new Map(); // uid → { day, count }

function useOneScan(uid) {
  const u = usage.get(uid);
  const day = today();
  if (!u || u.day !== day) {
    usage.set(uid, { day, count: 1 });
    return true;
  }
  if (u.count >= CONFIG.dailyLimit) return false;
  u.count++;
  return true;
}

const jobs = new Map(); // id → job
const queue = []; // ids waiting
let running = false;

async function work() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = jobs.get(queue.shift());
    if (!job) continue;
    job.status = "bezig";
    job.started = Date.now();
    try {
      job.result = await readRecipe(job.image);
      job.status = "klaar";
    } catch (e) {
      job.status = "fout";
      job.error = e?.code === "onbereikbaar" ? "onbereikbaar" : "mislukt";
      // Ollama was off: that scan shouldn't count towards the daily limit.
      const u = usage.get(job.uid);
      if (job.error === "onbereikbaar" && u?.count > 0) u.count--;
      console.error(`Scan ${job.id} mislukt:`, e?.message ?? e);
    } finally {
      job.image = null; // the photo is never kept
      job.finished = Date.now();
      console.log(`Scan ${job.id}: ${job.status} in ${Math.round((job.finished - job.started) / 1000)} s`);
    }
  }
  running = false;
}

// Streamed, so Ollama answers at once and keeps sending: Node's fetch gives up
// after 5 minutes without a first answer, and on a processor a scan can take longer.
async function readRecipe(imageBase64) {
  let res;
  try {
    res = await fetch(`${CONFIG.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONFIG.model,
        stream: true,
        format: SCHEMA,
        keep_alive: "30m",
        options: { temperature: 0, num_ctx: 8192 },
        messages: [{ role: "user", content: PROMPT, images: [imageBase64] }],
      }),
      signal: AbortSignal.timeout(CONFIG.scanTimeoutMs),
    });
  } catch (e) {
    const err = new Error(`Ollama niet bereikbaar: ${e?.cause?.code ?? e?.message ?? e}`);
    if (e?.cause?.code === "ECONNREFUSED") err.code = "onbereikbaar";
    throw err;
  }
  if (!res.ok) throw new Error(`Ollama gaf ${res.status}: ${(await res.text()).slice(0, 300)}`);

  let content = "";
  let rest = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    rest += decoder.decode(chunk, { stream: true });
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const part = JSON.parse(line);
      if (part.error) throw new Error(`Ollama: ${part.error}`);
      content += part.message?.content ?? "";
    }
  }
  if (rest.trim()) content += JSON.parse(rest).message?.content ?? "";
  return JSON.parse(content);
}

// Clean up finished scans after 15 minutes, and expired login checks.
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.finished && now - job.finished > 15 * 60_000) jobs.delete(id);
  for (const [k, v] of memberCache) if (v.until < now) memberCache.delete(k);
}, 60_000).unref();

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > CONFIG.maxBytes) return reject(Object.assign(new Error("te groot"), { status: 413 }));
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > CONFIG.maxBytes) {
        reject(Object.assign(new Error("te groot"), { status: 413 }));
        chunks.length = 0; // keep reading but stop storing, so the answer can still go out
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** JPEG, PNG or WebP, checked by the first bytes rather than trusting the header. */
function isImage(buf) {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  return buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
}

const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Origin");

  const origin = req.headers.origin;
  if (origin && CONFIG.origins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(origin && CONFIG.origins.includes(origin) ? 204 : 403);
    return res.end();
  }

  const url = new URL(req.url ?? "/", "http://scanner");

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const ollama = await fetch(`${CONFIG.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
        .then((r) => r.ok)
        .catch(() => false);
      return send(res, 200, { ok: true, ollama, model: CONFIG.model, inRij: queue.length });
    }

    if (req.method === "POST" && url.pathname === "/scan") {
      const who = await checkMember(req.headers.authorization);
      if (typeof who === "number") return send(res, who, { error: "geen toegang" });
      if (queue.length >= CONFIG.maxQueue) return send(res, 503, { error: "druk" });
      const body = await readBody(req);
      if (!isImage(body)) return send(res, 415, { error: "geen foto" });
      if (!useOneScan(who.uid)) return send(res, 429, { error: "limiet" });

      const id = randomUUID();
      jobs.set(id, { id, uid: who.uid, status: "wacht", image: body.toString("base64"), created: Date.now() });
      queue.push(id);
      work();
      return send(res, 202, { id });
    }

    const m = /^\/scan\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      const who = await checkMember(req.headers.authorization);
      if (typeof who === "number") return send(res, who, { error: "geen toegang" });
      const job = jobs.get(m[1]);
      if (!job || job.uid !== who.uid) return send(res, 404, { error: "onbekend" });
      return send(res, 200, {
        status: job.status,
        plek: job.status === "wacht" ? queue.indexOf(job.id) + 1 : 0,
        result: job.status === "klaar" ? job.result : undefined,
        error: job.error,
      });
    }

    send(res, 404, { error: "onbekend" });
  } catch (e) {
    if (!res.headersSent) send(res, e?.status ?? 500, { error: e?.status === 413 ? "te groot" : "fout" });
  }
});

server.requestTimeout = 60_000;
server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`Scan-poortwachter luistert op http://${CONFIG.host}:${CONFIG.port} (model ${CONFIG.model})`);
});
