/* addon.js (FULL MOBILE EDITION v4)
   - Theme toggle (light/dark) saved in localStorage
   - Captures word-store automatically (Storage.setItem hook + initial scan)
   - CEFR auto-estimation via Datamuse frequency (cached)
   - Fullscreen Test (mobile-first):
       * Start screen with range settings
       * Touch-only controls
       * Fixed bottom answer bars (CSS in addon-ui.css recommended)
       * 4 ratings with labels
   - Fix: Answer showing "—" -> robust Japanese meaning extraction (string/array/object)
*/

(() => {
  "use strict";

  // =========================
  // Theme
  // =========================
  const THEME_KEY = "vp_theme";
  const root = document.documentElement;

  function applyTheme(theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }

  function initTheme() {
    let saved = "";
    try { saved = localStorage.getItem(THEME_KEY) || ""; } catch {}
    if (saved) return applyTheme(saved);

    const prefersLight = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    applyTheme(prefersLight ? "light" : "dark");
  }

  function toggleTheme() {
    applyTheme((root.dataset.theme || "dark") === "dark" ? "light" : "dark");
  }

  // =========================
  // Helpers
  // =========================
  function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

  function escapeHTML(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function vibrate(ms = 12) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // =========================
  // Word store capture
  // =========================
  const WORD_FIELDS = ["word", "term", "headword", "title", "en", "english"];
  // ★ Robust JA fields (many possible keys)
  const JA_FIELDS = [
    "ja","jp","jaText","japanese","japaneseText",
    "meaning","meaningJa","meaningJP","meaning_jp","meaning_ja",
    "translation","trans","tr","gloss","glossJa","glossJP",
    "noteJa","noteJP","note_ja","note_jp"
  ];
  const DEF_FIELDS = ["def", "definition", "enDef", "englishDefinition"];
  const MEM_FIELDS = ["mem", "memory", "level", "rank", "stage"];

  function pickStr(obj, fields) {
    for (const k of fields) {
      if (typeof obj?.[k] === "string" && obj[k].trim()) return obj[k].trim();
    }
    return "";
  }

  function pickNum(obj, fields) {
    for (const k of fields) {
      const v = obj?.[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim()) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  // ★ Robust meaning extractor (string/array/object)
  function extractJapaneseMeaning(raw) {
    // 1) direct string fields
    let ja = pickStr(raw, JA_FIELDS);
    if (ja) return ja;

    // 2) meaning: ["..",".."]
    const m = raw?.meaning;
    if (Array.isArray(m)) {
      const joined = m.filter(x => typeof x === "string" && x.trim()).join(" / ").trim();
      if (joined) return joined;
    }

    // 3) translation: {ja:".."} / {jp:".."} / {japanese:".."}
    const t = raw?.translation;
    if (t && typeof t === "object") {
      const tja =
        (typeof t.ja === "string" && t.ja.trim()) ? t.ja.trim() :
        (typeof t.jp === "string" && t.jp.trim()) ? t.jp.trim() :
        (typeof t.japanese === "string" && t.japanese.trim()) ? t.japanese.trim() :
        "";
      if (tja) return tja;
    }

    // 4) meanings: [{ja:".."}] or [{jp:".."}] etc
    const ms = raw?.meanings;
    if (Array.isArray(ms)) {
      const pick = ms.map(x => {
        if (!x || typeof x !== "object") return "";
        if (typeof x.ja === "string" && x.ja.trim()) return x.ja.trim();
        if (typeof x.jp === "string" && x.jp.trim()) return x.jp.trim();
        if (typeof x.japanese === "string" && x.japanese.trim()) return x.japanese.trim();
        if (typeof x.meaningJa === "string" && x.meaningJa.trim()) return x.meaningJa.trim();
        return "";
      }).filter(Boolean);
      if (pick.length) return pick.join(" / ").trim();
    }

    // 5) note / memo style
    const note = raw?.note || raw?.memo;
    if (typeof note === "string" && note.trim()) return note.trim();

    // nothing found
    return "";
  }

  function normalizeEntry(raw) {
    const word = pickStr(raw, WORD_FIELDS);
    const ja = extractJapaneseMeaning(raw);
    return {
      word,
      ja,
      def: pickStr(raw, DEF_FIELDS),
      mem: pickNum(raw, MEM_FIELDS),
      raw
    };
  }

  function extractArray(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      for (const p of ["words", "items", "list", "data"]) {
        if (Array.isArray(parsed[p])) return parsed[p];
      }
    }
    return null;
  }

  function scoreArray(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    let s = 0;
    for (let i = 0; i < Math.min(arr.length, 30); i++) {
      const x = arr[i];
      if (!x || typeof x !== "object") continue;
      if (pickStr(x, WORD_FIELDS)) s += 5;
      // we score meaning using extractor (more robust)
      if (extractJapaneseMeaning(x)) s += 2;
      if (pickStr(x, DEF_FIELDS)) s += 1;
    }
    s += Math.min(arr.length, 800) / 80;
    return s;
  }

  const CAP_KEY = "vp_capture_best_v4";

  function getCap() {
    const obj = safeParse(localStorage.getItem(CAP_KEY) || "{}");
    return (obj && typeof obj === "object") ? obj : {};
  }

  function setCap(obj) {
    try { localStorage.setItem(CAP_KEY, JSON.stringify(obj)); } catch {}
  }

  function considerCandidate(source, key, rawValue) {
    const parsed = safeParse(rawValue);
    if (!parsed) return;

    const arr = extractArray(parsed);
    const sc = scoreArray(arr);
    if (sc < 6) return;

    const cap = getCap();
    if ((cap.score || 0) < sc) {
      setCap({
        source,
        key,
        score: sc,
        len: Array.isArray(arr) ? arr.length : 0,
        seenAt: Date.now()
      });
    }
  }

  function initialScan() {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k);
      if (typeof v === "string" && v.length > 10) considerCandidate("localStorage", k, v);
    }
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (!k) continue;
        const v = sessionStorage.getItem(k);
        if (typeof v === "string" && v.length > 10) considerCandidate("sessionStorage", k, v);
      }
    } catch {}
  }

  function hookSetItem() {
    const orig = Storage.prototype.setItem;
    if (orig.__vp_hooked) return;

    Storage.prototype.setItem = function (key, value) {
      try {
        if (typeof value === "string" && value.length > 10) {
          const source =
            this === localStorage ? "localStorage" :
            this === sessionStorage ? "sessionStorage" :
            "storage";
          considerCandidate(source, String(key), value);
        }
      } catch {}
      return orig.call(this, key, value);
    };

    Storage.prototype.setItem.__vp_hooked = true;
  }

  function loadEntries() {
    const cap = getCap();
    if (!cap.key || !cap.source) return [];

    let raw = null;
    if (cap.source === "localStorage") raw = localStorage.getItem(cap.key);
    else if (cap.source === "sessionStorage") {
      try { raw = sessionStorage.getItem(cap.key); } catch { raw = null; }
    }
    if (typeof raw !== "string") return [];

    const parsed = safeParse(raw);
    const arr = parsed ? extractArray(parsed) : null;
    if (!Array.isArray(arr)) return [];

    return arr.map(normalizeEntry).filter(e => e.word);
  }

  // =========================
  // CEFR auto-estimation (Datamuse) + cache
  // =========================
  const CEFR_CACHE_KEY = "vp_cefr_cache_v4";
  const CEFR_TTL = 1000 * 60 * 60 * 24 * 30;

  function getCefrCache() {
    const obj = safeParse(localStorage.getItem(CEFR_CACHE_KEY) || "{}");
    return (obj && typeof obj === "object") ? obj : {};
  }

  function setCefrCache(cache) {
    try { localStorage.setItem(CEFR_CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  function freqToCEFR(f) {
    if (f >= 120) return "A1";
    if (f >= 60) return "A2";
    if (f >= 20) return "B1";
    if (f >= 7) return "B2";
    if (f >= 2) return "C1";
    return "C2";
  }

  function cefrRank(c) {
    const map = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
    return map[c] || 0;
  }

  async function fetchFreq(word) {
    const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=f&max=1`;
    const res = await fetch(url);
    const json = await res.json();
    const item = Array.isArray(json) ? json[0] : null;
    const tags = item?.tags || [];
    const ftag = tags.find(t => typeof t === "string" && t.startsWith("f:"));
    if (!ftag) return null;
    const v = Number(ftag.slice(2));
    return Number.isFinite(v) ? v : null;
  }

  async function getCEFR(word) {
    const w = (word || "").trim().toLowerCase();
    if (!w) return "";

    const cache = getCefrCache();
    const rec = cache[w];
    const now = Date.now();
    if (rec && rec.c && (now - rec.t) < CEFR_TTL) return rec.c;

    let f = null;
    try { f = await fetchFreq(w); } catch { f = null; }
    const c = freqToCEFR(f ?? 1.0);

    cache[w] = { c, f, t: now };
    setCefrCache(cache);
    return c;
  }

  // =========================
  // UI
  // =========================
  let backdrop, testEl;

  const state = {
    stage: "start", // "start" | "quiz" | "result"
    session: null,
    settings: {
      count: 20,
      cefrMin: "A2",
      target: "all",  // all | low | unrated
      shuffle: true
    }
  };

  function ensureTestUI() {
    if (backdrop && testEl) return;

    backdrop = document.createElement("div");
    backdrop.className = "vp-test-backdrop";
    backdrop.addEventListener("click", closeTest);

    testEl = document.createElement("div");
    testEl.className = "vp-test";
    testEl.innerHTML = `
      <div class="vp-test-shell">
        <div class="vp-test-top">
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <span class="vp-chip">進行 <b id="vpProg">0/0</b></span>
            <span class="vp-chip">評価済 <b id="vpDone">0</b></span>
            <span class="vp-chip">CEFR <b id="vpCefr">—</b></span>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="vp-btn" id="vpExit" type="button">Exit</button>
          </div>
        </div>

        <div class="vp-test-mid" id="vpMid"></div>

        <div id="vpBottom"></div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(testEl);

    testEl.querySelector("#vpExit").addEventListener("click", closeTest);

    window.addEventListener("keydown", (e) => {
      if (testEl.style.display !== "block") return;
      if (e.key === "Escape") closeTest();
    });
  }

  function setTop(prog, done, cefr) {
    testEl.querySelector("#vpProg").textContent = prog;
    testEl.querySelector("#vpDone").textContent = String(done);
    testEl.querySelector("#vpCefr").textContent = cefr || "—";
  }

  function setMid(html) {
    testEl.querySelector("#vpMid").innerHTML = html;
  }

  function setBottom(html) {
    testEl.querySelector("#vpBottom").innerHTML = html;
  }

  function openTest() {
    ensureTestUI();
    document.documentElement.classList.add("vp-noscreen-scroll");
    document.body.classList.add("vp-noscreen-scroll");
    backdrop.style.display = "block";
    testEl.style.display = "block";

    state.stage = "start";
    state.session = null;
    render();
  }

  function closeTest() {
    if (!testEl) return;
    backdrop.style.display = "none";
    testEl.style.display = "none";
    document.documentElement.classList.remove("vp-noscreen-scroll");
    document.body.classList.remove("vp-noscreen-scroll");
  }

  function render() {
    if (state.stage === "start") return renderStart();
    if (state.stage === "quiz") return renderQuiz();
    return renderResult();
  }

  function renderStart() {
    const s = state.settings;
    const sel = (cond) => cond ? "vp-selected" : "";

    setTop("0/0", 0, "—");

    setMid(`
      <div class="vp-word" style="font-size:22px;">テスト設定</div>
      <div class="vp-note">スマホ用：ここで範囲を決めてから開始。</div>

      <div style="height:14px;"></div>

      <div class="vp-note" style="text-align:left; width:100%;">出題数</div>
      <div style="display:flex; gap:10px; width:100%; justify-content:center;">
        <button class="vp-btn ${sel(s.count===10)}" data-count="10">10</button>
        <button class="vp-btn ${sel(s.count===20)}" data-count="20">20</button>
        <button class="vp-btn ${sel(s.count===40)}" data-count="40">40</button>
      </div>

      <div style="height:14px;"></div>

      <div class="vp-note" style="text-align:left; width:100%;">CEFR下限</div>
      <div style="display:flex; gap:10px; width:100%; justify-content:center; flex-wrap:wrap;">
        <button class="vp-btn ${sel(s.cefrMin==='A2')}" data-cefr="A2">A2+</button>
        <button class="vp-btn ${sel(s.cefrMin==='B1')}" data-cefr="B1">B1+</button>
        <button class="vp-btn ${sel(s.cefrMin==='B2')}" data-cefr="B2">B2+</button>
        <button class="vp-btn ${sel(s.cefrMin==='C1')}" data-cefr="C1">C1+</button>
      </div>

      <div style="height:14px;"></div>

      <div class="vp-note" style="text-align:left; width:100%;">対象</div>
      <div style="display:flex; gap:10px; width:100%; justify-content:center; flex-wrap:wrap;">
        <button class="vp-btn ${sel(s.target==='all')}" data-target="all">全部</button>
        <button class="vp-btn ${sel(s.target==='low')}" data-target="low">未習得優先</button>
        <button class="vp-btn ${sel(s.target==='unrated')}" data-target="unrated">評価なし</button>
      </div>

      <div style="height:14px;"></div>

      <div style="display:flex; gap:10px; width:100%; justify-content:center;">
        <button class="vp-btn ${sel(s.shuffle)}" id="vpShuffle">${s.shuffle ? "シャッフルON" : "シャッフルOFF"}</button>
      </div>

      <div style="height:18px;"></div>
      <button class="vp-btn" id="vpStart" style="padding:14px 18px; font-size:15px;">Start</button>
    `);

    setBottom(`<div class="vp-note">Start → 答え表示 → 自己評価。スクロールなし。</div>`);

    testEl.querySelectorAll("[data-count]").forEach(b => {
      b.onclick = () => { state.settings.count = Number(b.dataset.count); vibrate(); renderStart(); };
    });
    testEl.querySelectorAll("[data-cefr]").forEach(b => {
      b.onclick = () => { state.settings.cefrMin = b.dataset.cefr; vibrate(); renderStart(); };
    });
    testEl.querySelectorAll("[data-target]").forEach(b => {
      b.onclick = () => { state.settings.target = b.dataset.target; vibrate(); renderStart(); };
    });
    testEl.querySelector("#vpShuffle").onclick = () => { state.settings.shuffle = !state.settings.shuffle; vibrate(); renderStart(); };
    testEl.querySelector("#vpStart").onclick = () => { vibrate(18); startSession(); };
  }

  async function startSession() {
    const all = loadEntries();

    if (!all.length) {
      setTop("0/0", 0, "—");
      setMid(`
        <div class="vp-word" style="font-size:22px;">単語データが見つからない</div>
        <div class="vp-note">単語を追加してからStartするとテストが回る。</div>
      `);
      setBottom(`<button class="vp-btn" id="vpRescan">再検出</button>`);
      const btn = testEl.querySelector("#vpRescan");
      if (btn) btn.onclick = () => { vibrate(); initialScan(); renderStart(); };
      return;
    }

    let pool = all.slice();

    if (state.settings.target === "unrated") pool = pool.filter(e => e.mem == null);
    if (state.settings.target === "low") pool = pool.filter(e => (e.mem == null) || e.mem <= 2);

    if (state.settings.shuffle) shuffleInPlace(pool);

    const minRank = cefrRank(state.settings.cefrMin);
    const filtered = [];

    const limitPrefetch = Math.min(pool.length, 240);
    for (let i = 0; i < limitPrefetch; i++) {
      const w = pool[i].word;
      const c = await getCEFR(w);
      if (cefrRank(c) >= minRank) filtered.push({ ...pool[i], cefr: c });
      if (filtered.length >= state.settings.count) break;
    }

    const use = (filtered.length >= 3) ? filtered : pool.map(e => ({ ...e, cefr: "" }));
    const items = use.slice(0, Math.min(state.settings.count, use.length));

    state.session = {
      items,
      i: 0,
      done: 0,
      answersShown: false,
      logs: []
    };

    state.stage = "quiz";
    renderQuiz();
  }

  function currentItem() {
    return state.session?.items?.[state.session.i] || null;
  }

  function renderQuiz() {
    const sess = state.session;
    if (!sess || !sess.items || sess.items.length === 0) {
      state.stage = "start";
      return renderStart();
    }

    const total = sess.items.length;
    const cur = currentItem();
    if (!cur) {
      state.stage = "result";
      return renderResult();
    }

    setTop(`${sess.i + 1}/${total}`, sess.done, cur.cefr || "—");

    setMid(`
      <div class="vp-word">${escapeHTML(cur.word)}</div>
      <div class="vp-answer" id="vpAns" style="${sess.answersShown ? "display:block;" : "display:none;"}">
        ${escapeHTML(cur.ja || "—")}
      </div>
      <div class="vp-note">「答え表示」→ 自己評価。スマホで完結。</div>
    `);

    setBottom(`
      <div class="vp-test-bottom vp-bar2" id="vpBarTop">
        <button class="vp-btn" id="vpShow">答え表示</button>
        <button class="vp-btn" id="vpSkip">次へ</button>
      </div>

      <div class="vp-test-bottom" id="vpBarRate">
        <button class="vp-btn" data-rate="1">1<small>未習得</small></button>
        <button class="vp-btn" data-rate="2">2<small>あやしい</small></button>
        <button class="vp-btn" data-rate="3">3<small>OK</small></button>
        <button class="vp-btn" data-rate="4">4<small>定着</small></button>
      </div>
    `);

    const showBtn = testEl.querySelector("#vpShow");
    if (showBtn) {
      showBtn.onclick = () => {
        sess.answersShown = true;
        const a = testEl.querySelector("#vpAns");
        if (a) a.style.display = "block";
        vibrate();
      };
    }

    const skipBtn = testEl.querySelector("#vpSkip");
    if (skipBtn) {
      skipBtn.onclick = () => {
        sess.logs.push({ word: cur.word, rate: 0, t: Date.now() });
        sess.answersShown = false;
        sess.i++;
        vibrate();
        renderQuiz();
      };
    }

    testEl.querySelectorAll("[data-rate]").forEach(btn => {
      btn.onclick = () => {
        const r = Number(btn.dataset.rate);
        sess.logs.push({ word: cur.word, rate: r, t: Date.now() });
        sess.done++;
        sess.answersShown = false;
        sess.i++;
        vibrate(18);
        renderQuiz();
      };
    });
  }

  function renderResult() {
    const sess = state.session;
    const total = sess?.items?.length || 0;
    const done = sess?.done || 0;

    setTop(`${total}/${total}`, done, "—");

    const rated = (sess?.logs || []).filter(x => x.rate && x.rate > 0);
    const c1 = rated.filter(x => x.rate === 1).length;
    const c2 = rated.filter(x => x.rate === 2).length;
    const c3 = rated.filter(x => x.rate === 3).length;
    const c4 = rated.filter(x => x.rate === 4).length;

    setMid(`
      <div class="vp-word" style="font-size:22px;">結果</div>
      <div class="vp-note">評価済：${done} / ${total}</div>
      <div style="height:8px;"></div>
      <div class="vp-note" style="text-align:left;">
        1 未習得：${c1}<br/>
        2 あやしい：${c2}<br/>
        3 OK：${c3}<br/>
        4 定着：${c4}
      </div>
      <div style="height:12px;"></div>
      <div class="vp-note">再スタートで設定画面に戻る。</div>
    `);

    setBottom(`
      <div class="vp-test-bottom vp-bar2" style="bottom: 80px;">
        <button class="vp-btn" id="vpRestart">再スタート</button>
        <button class="vp-btn" id="vpClose">閉じる</button>
      </div>
      <div class="vp-test-bottom">
        <button class="vp-btn" id="vpRescan2">再検出</button>
        <button class="vp-btn" id="vpLight">Light</button>
        <button class="vp-btn" id="vpDark">Dark</button>
        <button class="vp-btn" id="vpStartTop">設定へ</button>
      </div>
    `);

    const restart = testEl.querySelector("#vpRestart");
    if (restart) restart.onclick = () => { vibrate(); state.stage = "start"; state.session = null; renderStart(); };

    const close = testEl.querySelector("#vpClose");
    if (close) close.onclick = () => { vibrate(); closeTest(); };

    const rescan = testEl.querySelector("#vpRescan2");
    if (rescan) rescan.onclick = () => { vibrate(); initialScan(); };

    const light = testEl.querySelector("#vpLight");
    if (light) light.onclick = () => { applyTheme("light"); vibrate(); };

    const dark = testEl.querySelector("#vpDark");
    if (dark) dark.onclick = () => { applyTheme("dark"); vibrate(); };

    const top = testEl.querySelector("#vpStartTop");
    if (top) top.onclick = () => { vibrate(); state.stage = "start"; renderStart(); };
  }

  // =========================
  // Fixed buttons
  // =========================
  function mountFixedBar() {
    const bar = document.createElement("div");
    bar.className = "vp-fixedbar";
    bar.innerHTML = `
      <button class="vp-btn" type="button" id="vpThemeBtn">☀︎/🌙 Light</button>
      <button class="vp-btn" type="button" id="vpTestBtn">🧠 Test</button>
    `;
    document.body.appendChild(bar);

    const themeBtn = bar.querySelector("#vpThemeBtn");
    const testBtn = bar.querySelector("#vpTestBtn");

    if (themeBtn) themeBtn.onclick = () => { toggleTheme(); vibrate(); };
    if (testBtn) testBtn.onclick = () => { vibrate(); openTest(); };
  }

  // =========================
  // Boot
  // =========================
  function boot() {
    initTheme();
    hookSetItem();
    initialScan();
    mountFixedBar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})();
// ===== HARD EXIT FIX =====
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  // 表示テキスト or aria-label で Exit を判定
  if (
    btn.textContent.trim() === "Exit" ||
    btn.getAttribute("aria-label") === "Exit"
  ) {
    e.preventDefault();
    e.stopPropagation();

    // テスト状態を完全リセット
    document.body.classList.remove("test-open");

    // 内部ステートがあれば初期化
    if (window.state) {
      window.state.stage = "start";
    }

    // テストUIを強制的に隠す
    document.querySelectorAll(".vp-test").forEach(el => {
      el.style.display = "none";
    });

    // 念のためスクロール復帰
    document.body.style.overflow = "";

    console.log("[Exit] test closed");
  }
}, true);
// ===== EXIT FINAL FIX (embedded test mode) =====
(function(){
  function hardExit(){
    console.log("[Exit] hard reset");

    // テスト状態を完全初期化
    if (window.state) {
      window.state.stage = "idle";
      window.state.session = null;
      window.state.queue = [];
    }

    // テストUIを通常モードに戻す
    document.querySelectorAll(".vp-test").forEach(el=>{
      el.style.display = "block";
    });

    // 念のため test-open を外す
    document.body.classList.remove("test-open");

    // 画面をトップに戻す（スマホ用）
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Exit ボタンを常時監視（構造変わっても拾う）
  document.addEventListener("click", (e)=>{
    const el = e.target.closest("button,div");
    if (!el) return;

    const text = el.textContent?.trim();
    if (text === "Exit") {
      e.preventDefault();
      e.stopPropagation();
      hardExit();
    }
  }, true);
})();
