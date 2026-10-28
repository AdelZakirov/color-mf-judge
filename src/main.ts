import "./style.css";
import { flush, newSessionId, onPending, pendingCount, rejectedCount, save } from "./firebase";
import { funnyName } from "./names";
import { fmt, strings, type Lang, type Strings } from "./i18n";

type Pool = {
  version: string;
  methods: string[];
  images: string[];
  catch: { methods: [string, string]; images: string[] };
  hero: string;
  /** real pairs per batch for each method pair; counts sum to BATCH - CATCH_PER_BATCH */
  design?: { id: string; pairs: [string, string, number][] };
};
type Trial = { idx: number; kind: "main" | "catch"; image: string; first: string; second: string };
type Answer = { chosen: string; rev: number; rt: number };
type Session = {
  sid: string;
  name: string;
  pool: string;
  trials: Trial[];
  answers: Record<number, Answer>;
  cursor: number;
  batchStart: number;
};

const BATCH = 20;
const CATCH_PER_BATCH = 2;
const CHOICE_PAUSE_MS = 380;

const app = document.querySelector<HTMLDivElement>("#app")!;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const columnLayout = matchMedia("(max-aspect-ratio: 1/1)");

// ---------- storage ----------

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

let lang: Lang = read<Lang>("tc.lang") ?? (navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en");
let t: Strings = strings[lang];
const client = read<string>("tc.client") ?? crypto.randomUUID().slice(0, 18);
write("tc.client", client);

let pool: Pool;
let session: Session | null = read<Session>("tc.session");

// ---------- sampling ----------

const rand = (n: number) => Math.floor(Math.random() * n);
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Method pairs for one batch, as many of each as pool.design says (equal split without it). */
function pairPlan(nMain: number): [string, string][] {
  const d = pool.design;
  if (d && d.pairs.reduce((s, [, , n]) => s + n, 0) === nMain) {
    return d.pairs.flatMap(([a, b, n]) => Array.from({ length: n }, (): [string, string] => [a, b]));
  }
  const m = pool.methods;
  const pairs: [string, string][] = [];
  for (let a = 0; a < m.length; a++) for (let b = a + 1; b < m.length; b++) pairs.push([m[a], m[b]]);
  return Array.from({ length: nMain }, (_, k) => pairs[k % pairs.length]);
}

/** Fresh images first, across sessions on this device; method pairs per the design; random sides. */
function makeBatch(start: number): Trial[] {
  const seen = new Set(read<string[]>("tc.seen") ?? []);
  let fresh = pool.images.filter((i) => !seen.has(i));
  if (fresh.length < BATCH) {
    seen.clear();
    fresh = pool.images;
  }
  const nMain = BATCH - CATCH_PER_BATCH;
  const images = shuffle(fresh).slice(0, nMain);
  images.forEach((i) => seen.add(i));
  write("tc.seen", [...seen]);

  const pairSeq = shuffle(pairPlan(nMain));

  const trials: Omit<Trial, "idx">[] = images.map((image, k) => {
    const [a, b] = Math.random() < 0.5 ? pairSeq[k] : [pairSeq[k][1], pairSeq[k][0]];
    return { kind: "main", image, first: a, second: b };
  });
  // one catch trial per segment of the batch, never in the first three, so the task opens with
  // real pairs and attention is checked early and late
  const catches = shuffle(pool.catch.images).slice(0, CATCH_PER_BATCH);
  const seg = (BATCH - 3) / CATCH_PER_BATCH;
  catches.forEach((image, k) => {
    const [real, fake] = pool.catch.methods;
    const [a, b] = Math.random() < 0.5 ? [real, fake] : [fake, real];
    trials.splice(3 + Math.floor(seg * k) + rand(Math.floor(seg)), 0, { kind: "catch", image, first: a, second: b });
  });
  return trials.map((tr, k) => ({ ...tr, idx: start + k }));
}

const src = (method: string, image: string) => `/img/${method}/${image}.webp`;

const loaded = new Map<string, Promise<void>>();
function preload(url: string): Promise<void> {
  let p = loaded.get(url);
  if (!p) {
    const img = new Image();
    // load event, then a bounded decode: decode() alone can stall while the page is not painting
    p = new Promise<void>((resolve) => {
      img.onload = img.onerror = () => resolve();
      img.src = url;
    }).then(() => Promise.race([img.decode().catch(() => undefined), new Promise((r) => setTimeout(r, 250))]))
      .then(() => undefined);
    loaded.set(url, p);
  }
  return p;
}
function preloadTrial(tr?: Trial) {
  if (!tr) return Promise.resolve();
  return Promise.all([preload(src(tr.first, tr.image)), preload(src(tr.second, tr.image))]).then(() => undefined);
}

// ---------- helpers ----------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function persistSession() {
  if (session) write("tc.session", session);
}

function screen(html: string, cls: string) {
  app.className = cls;
  app.innerHTML = html;
  if (!reducedMotion) app.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" });
}

const langSwitch = () =>
  `<button class="lang" data-lang aria-label="Language">${lang === "en" ? "RU" : "EN"}</button>`;

function bindLang(rerender: () => void) {
  app.querySelector("[data-lang]")?.addEventListener("click", () => {
    lang = lang === "en" ? "ru" : "en";
    t = strings[lang];
    write("tc.lang", lang);
    document.documentElement.lang = lang;
    rerender();
  });
}

const wordmark = (colored: boolean) =>
  `<span class="wordmark${colored ? " colored" : ""}" aria-label="true colors">${[..."true colors"]
    .map((ch, i) => `<span style="--i:${i}">${ch === " " ? "&nbsp;" : ch}</span>`)
    .join("")}</span>`;

// ---------- intro ----------

function renderIntro() {
  const inProgress = session && session.pool === pool.version && session.cursor < session.trials.length;
  const done = inProgress ? session!.cursor - session!.batchStart : 0;
  const storedName = read<string>("tc.name");
  const name = session?.name ?? storedName ?? funnyName(lang);
  const hero = pool.hero;

  screen(
    `<header class="top">${wordmark(true)}${langSwitch()}</header>
    <section class="intro">
      <div class="hero-box">
        <figure class="hero" aria-hidden="true">
          <img class="hero-color" src="${src(pool.catch.methods[0], hero)}" alt="" draggable="false" />
          <img class="hero-gray" src="${src(pool.catch.methods[0], hero)}" alt="" draggable="false" />
          <i class="hero-edge"></i>
        </figure>
      </div>
      <div class="copy">
        <h1>${t.title}</h1>
        <p class="lead">${t.lead}</p>
        <ul class="rules">${t.rules.map((r) => `<li>${r}</li>`).join("")}</ul>
        <form class="start" autocomplete="off">
          <label for="name">${t.nameLabel}</label>
          <div class="name-row">
            <input id="name" name="name" maxlength="40" value="${esc(name)}" spellcheck="false" ${inProgress ? "readonly" : ""} />
            ${inProgress ? "" : `<button type="button" class="dice" data-reroll aria-label="${t.reroll}" title="${t.reroll}">${diceIcon}</button>`}
          </div>
          <button class="primary" type="submit">${inProgress ? fmt(t.resume, { n: done, total: BATCH }) : t.start}<span class="arrow">→</span></button>
        </form>
        <p class="note">${t.note}</p>
      </div>
    </section>`,
    "s-intro",
  );
  bindLang(renderIntro);

  const input = app.querySelector<HTMLInputElement>("#name")!;
  app.querySelector("[data-reroll]")?.addEventListener("click", (e) => {
    input.value = funnyName(lang, input.value);
    const b = e.currentTarget as HTMLElement;
    if (!reducedMotion) b.animate([{ transform: "rotate(0)" }, { transform: "rotate(200deg)" }], { duration: 380, easing: "cubic-bezier(.3,.7,.3,1)" });
  });
  app.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!inProgress) startSession(input.value.trim() || funnyName(lang));
    renderTrial();
  });
  // warm the cache while the participant reads
  if (inProgress) void preloadTrial(session!.trials[session!.cursor]);
}

const diceIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/></svg>`;

function startSession(name: string) {
  write("tc.name", name);
  const sid = newSessionId();
  session = { sid, name, pool: pool.version, trials: makeBatch(0), answers: {}, cursor: 0, batchStart: 0 };
  persistSession();
  save(`sessions/${sid}`, {
    name,
    client,
    lang,
    pool: pool.version,
    design: pool.design?.id ?? "equal",
    ua: navigator.userAgent.slice(0, 300),
    vw: innerWidth,
    vh: innerHeight,
    dpr: devicePixelRatio,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
  });
}

// ---------- trial ----------

let shownAt = 0;
let locked = false;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

function setKeys(fn: ((e: KeyboardEvent) => void) | null) {
  if (keyHandler) removeEventListener("keydown", keyHandler);
  keyHandler = fn;
  if (fn) addEventListener("keydown", fn);
}

function renderTrial() {
  const s = session!;
  const tr = s.trials[s.cursor];
  if (!tr) return renderDone();
  const n = s.cursor - s.batchStart;

  if (app.className !== "s-trial") {
    screen(
      `<header class="bar">
        <button class="ghost" data-back><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>${t.back}</button>
        <div class="count" aria-live="polite"><b data-n></b><span> / ${BATCH}</span></div>
        ${langSwitch()}
      </header>
      <div class="progress" aria-hidden="true"><i data-progress></i></div>
      <p class="question">${t.question}</p>
      <main class="pair" data-pair>
        <div class="cell"><button class="pick" data-slot="0"><img alt="" draggable="false" /></button></div>
        <div class="cell"><button class="pick" data-slot="1"><img alt="" draggable="false" /></button></div>
      </main>
      <p class="hint" data-hint></p>`,
      "s-trial",
    );
    bindLang(() => {
      app.className = "";
      renderTrial();
    });
    app.querySelector("[data-back]")!.addEventListener("click", back);
    app.querySelectorAll<HTMLButtonElement>(".pick").forEach((b) =>
      b.addEventListener("click", () => choose(Number(b.dataset.slot))),
    );
    setKeys((e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (["ArrowLeft", "ArrowUp", "1"].includes(e.key)) choose(0);
      else if (["ArrowRight", "ArrowDown", "2"].includes(e.key)) choose(1);
      else if (e.key === "Backspace") back();
      else return;
      e.preventDefault();
    });
  }

  app.querySelector<HTMLElement>("[data-n]")!.textContent = String(n + 1).padStart(2, "0");
  app.querySelector<HTMLElement>("[data-progress]")!.style.width = `${(n / BATCH) * 100}%`;
  app.querySelector<HTMLButtonElement>("[data-back]")!.disabled = n === 0;
  updateHint();

  const pair = app.querySelector<HTMLElement>("[data-pair]")!;
  const imgs = pair.querySelectorAll("img");
  locked = true;
  pair.classList.add("loading");
  pair.querySelectorAll(".pick").forEach((p) => p.classList.remove("chosen"));
  pair.classList.remove("decided");

  const slow = setTimeout(() => pair.setAttribute("data-loading", t.loading), 600);
  void preloadTrial(tr).then(() => {
    if (session?.cursor !== tr.idx) return; // participant moved on meanwhile
    clearTimeout(slow);
    pair.removeAttribute("data-loading");
    imgs[0].src = src(tr.first, tr.image);
    imgs[1].src = src(tr.second, tr.image);
    // a timer, not rAF: rAF stalls in background tabs and would leave the pair locked
    setTimeout(() => {
      pair.classList.remove("loading");
      shownAt = performance.now();
      locked = false;
    }, 20);
    void preloadTrial(s.trials[s.cursor + 1]).then(() => preloadTrial(s.trials[s.cursor + 2]));
  });
}

function updateHint() {
  const h = app.querySelector<HTMLElement>("[data-hint]");
  if (h) h.textContent = columnLayout.matches ? t.hintCol : t.hintRow;
}
columnLayout.addEventListener("change", updateHint);

function choose(slot: number) {
  const s = session;
  if (!s || locked) return;
  locked = true;
  const tr = s.trials[s.cursor];
  const rt = Math.round(performance.now() - shownAt);
  const chosen = slot === 0 ? tr.first : tr.second;
  const rev = tr.idx in s.answers ? s.answers[tr.idx].rev + 1 : 0;
  s.answers[tr.idx] = { chosen, rev, rt };
  s.cursor += 1;
  persistSession();
  save(`answers/${s.sid}_${String(tr.idx).padStart(3, "0")}_${rev}`, {
    sid: s.sid,
    idx: tr.idx,
    rev,
    kind: tr.kind,
    image: tr.image,
    first: tr.first,
    second: tr.second,
    chosen,
    layout: columnLayout.matches ? "column" : "row",
    rt,
  });

  const pair = app.querySelector<HTMLElement>("[data-pair]")!;
  pair.querySelectorAll(".pick")[slot].classList.add("chosen");
  pair.classList.add("decided");
  const n = s.cursor - s.batchStart;
  app.querySelector<HTMLElement>("[data-progress]")!.style.width = `${(n / BATCH) * 100}%`;
  setTimeout(() => {
    pair.classList.add("loading");
    setTimeout(renderTrial, reducedMotion ? 0 : 140);
  }, reducedMotion ? 120 : CHOICE_PAUSE_MS);
}

function back() {
  const s = session;
  if (!s || s.cursor <= s.batchStart) return;
  s.cursor -= 1;
  persistSession();
  renderTrial();
}

// ---------- done ----------

function renderDone() {
  setKeys(null);
  const s = session!;
  const batch = s.trials.slice(s.batchStart, s.batchStart + BATCH);
  const rts = batch.map((tr) => s.answers[tr.idx]?.rt ?? 0).sort((a, b) => a - b);
  const total = rts.reduce((a, b) => a + b, 0);
  const median = rts.length ? rts[Math.floor(rts.length / 2)] : 0;
  const mmss = `${Math.floor(total / 60000)}:${String(Math.round((total % 60000) / 1000)).padStart(2, "0")}`;

  screen(
    `<header class="top">${wordmark(true)}${langSwitch()}</header>
    <section class="done">
      <h1>${fmt(t.doneTitle, { name: esc(s.name) })}</h1>
      <p class="lead">${t.doneLead}</p>
      <dl class="stats">
        <div><dt>${t.statPairs}</dt><dd data-count="${batch.length}">0</dd></div>
        <div><dt>${t.statTime}</dt><dd>${mmss}</dd></div>
        <div><dt>${t.statMedian}</dt><dd>${(median / 1000).toFixed(1)}<small> s</small></dd></div>
      </dl>
      <p class="sync" data-sync></p>
      <div class="actions">
        <button class="primary" data-more>${t.more}<span class="arrow">→</span></button>
        <button class="secondary" data-share>${t.share}</button>
      </div>
    </section>`,
    "s-done",
  );
  bindLang(renderDone);

  const dd = app.querySelector<HTMLElement>("[data-count]")!;
  const target = Number(dd.dataset.count);
  dd.textContent = String(target);
  if (!reducedMotion) {
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 700);
      dd.textContent = String(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const sync = app.querySelector<HTMLElement>("[data-sync]")!;
  const showSync = (pending: number) => {
    const lost = rejectedCount();
    sync.textContent = pending
      ? navigator.onLine ? t.saving : fmt(t.pending, { n: pending })
      : lost ? fmt(t.rejected, { n: lost }) : t.saved;
    sync.classList.toggle("ok", !pending && !lost);
  };
  onPending(showSync);
  void flush();

  app.querySelector("[data-more]")!.addEventListener("click", () => {
    s.batchStart = s.trials.length;
    s.trials.push(...makeBatch(s.trials.length));
    s.cursor = s.batchStart;
    persistSession();
    renderTrial();
  });
  app.querySelector("[data-share]")!.addEventListener("click", async (e) => {
    const url = location.origin;
    const b = e.currentTarget as HTMLButtonElement;
    if (navigator.share) {
      try {
        await navigator.share({ title: "True Colors", text: t.title, url });
      } catch {
        /* dismissed */
      }
      return;
    }
    await navigator.clipboard?.writeText(url);
    b.textContent = t.copied;
  });
}

addEventListener("beforeunload", (e) => {
  if (pendingCount()) e.preventDefault();
});

// ---------- boot ----------

document.documentElement.lang = lang;
fetch("/pool.json")
  .then((r) => r.json())
  .then((p: Pool) => {
    pool = p;
    if (session && session.pool !== pool.version) session = null;
    if (session && session.cursor >= session.trials.length) session = null; // finished: new session next time
    renderIntro();
  });
