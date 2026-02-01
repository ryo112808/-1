/* addon.js (MOBILE TEST COMPLETE)
   - Theme toggle
   - Storage capture (setItem hook) to find word list
   - Fullscreen test with Start screen + range controls + touch buttons
*/

(() => {
  "use strict";

  // ========= Theme =========
  const THEME_KEY = "vp_theme";
  const root = document.documentElement;

  function applyTheme(theme){
    root.dataset.theme = theme;
    try{ localStorage.setItem(THEME_KEY, theme); }catch{}
  }
  function initTheme(){
    let saved = "";
    try{ saved = localStorage.getItem(THEME_KEY) || ""; }catch{}
    if (saved) return applyTheme(saved);
    const prefersLight = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    applyTheme(prefersLight ? "light" : "dark");
  }
  function toggleTheme(){
    applyTheme((root.dataset.theme || "dark") === "dark" ? "light" : "dark");
  }

  // ========= Word parsing =========
  const WORD_FIELDS = ["word","term","headword","title","en","english"];
  const JA_FIELDS   = ["ja","jp","meaning","translation","japanese"];
  const DEF_FIELDS  = ["def","definition","enDef","englishDefinition"];
  const MEM_FIELDS  = ["mem","memory","level","rank","stage"]; // optional

  function safeParse(s){ try{ return JSON.parse(s); }catch{ return null; } }
  function pickStr(obj, fields){
    for (const k of fields){
      if (typeof obj?.[k] === "string" && obj[k].trim()) return obj[k].trim();
    }
    return "";
  }
  function pickNum(obj, fields){
    for (const k of fields){
      const v = obj?.[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim()){
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }
  function normalizeEntry(raw){
    return {
      word: pickStr(raw, WORD_FIELDS),
      ja:   pickStr(raw, JA_FIELDS),
      def:  pickStr(raw, DEF_FIELDS),
      mem:  pickNum(raw, MEM_FIELDS), // 0..4 maybe
      raw
    };
  }
  function extractArray(parsed){
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object"){
      for (const p of ["words","items","list","data"]){
        if (Array.isArray(parsed[p])) return parsed[p];
      }
    }
    return null;
  }
  function scoreArray(arr){
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    let s = 0;
    for (let i=0; i<Math.min(arr.length, 30); i++){
      const x = arr[i];
      if (!x || typeof x !== "object") continue;
      if (pickStr(x, WORD_FIELDS)) s += 5;
      if (pickStr(x, JA_FIELDS)) s += 2;
      if (pickStr(x, DEF_FIELDS)) s += 1;
    }
    s += Math.min(arr.length, 500) / 50;
    return s;
  }

  // ========= Capture best storage key =========
  const CAP_KEY = "vp_capture_best_v2";
  function getCap(){
    const obj = safeParse(localStorage.getItem(CAP_KEY) || "{}");
    return (obj && typeof obj === "object") ? obj : {};
  }
  function setCap(obj){
    try{ localStorage.setItem(CAP_KEY, JSON.stringify(obj)); }catch{}
  }
  function considerCandidate(source, key, rawValue){
    const parsed = safeParse(rawValue);
    if (!parsed) return;
    const arr = extractArray(parsed);
    const sc = scoreArray(arr);
    if (sc < 6) return;

    const cap = getCap();
    if ((cap.score || 0) < sc){
      setCap({ source, key, score: sc, len: arr?.length || 0, seenAt: Date.now() });
    }
  }
  function initialScan(){
    for (let i=0; i<localStorage.length; i++){
      const k = localStorage.key(i);
      const v = k ? localStorage.getItem(k) : null;
      if (typeof v === "string" && v.length > 10) considerCandidate("localStorage", k, v);
    }
    try{
      for (let i=0; i<sessionStorage.length; i++){
        const k = sessionStorage.key(i);
        const v = k ? sessionStorage.getItem(k) : null;
        if (typeof v === "string" && v.length > 10) considerCandidate("sessionStorage", k, v);
      }
    }catch{}
  }
  function hookSetItem(){
    const orig = Storage.prototype.setItem;
    if (orig.__vp_hooked) return;
    Storage.prototype.setItem = function(key, value){
      try{
        if (typeof value === "string" && value.length > 10){
          const source = (this === localStorage) ? "localStorage" : (this === sessionStorage) ? "sessionStorage" : "storage";
          considerCandidate(source, String(key), value);
        }
      }catch{}
      return orig.call(this, key, value);
    };
    Storage.prototype.setItem.__vp_hooked = true;
  }
  function loadEntries(){
    const cap = getCap();
    if (!cap.key || !cap.source) return [];
    let raw = null;
    if (cap.source === "localStorage") raw = localStorage.getItem(cap.key);
    else if (cap.source === "sessionStorage") { try{ raw = sessionStorage.getItem(cap.key); }catch{ raw = null; } }
    if (typeof raw !== "string") return [];
    const parsed = safeParse(raw);
    const arr = parsed ? extractArray(parsed) : null;
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizeEntry).filter(e => e.word);
  }

  // ========= CEFR auto (simple + cached) =========
  // Uses Datamuse frequency tag f: (occurrences per million) (see Datamuse API docs)
  const CEFR_CACHE_KEY = "vp_cefr_cache_v2";
  const CEFR_TTL = 1000 * 60 * 60 * 24 * 30;

  function getCefrCache(){
    const obj = safeParse(localStorage.getItem(CEFR_CACHE_KEY) || "{}");
    return (obj && typeof obj === "object") ? obj : {};
  }
  function setCefrCache(cache){
    try{ localStorage.setItem(CEFR_CACHE_KEY, JSON.stringify(cache)); }catch{}
  }
  function freqToCEFR(f){
    if (f >= 120) return "A1";
    if (f >= 60)  return "A2";
    if (f >= 20)  return "B1";
    if (f >= 7)   return "B2";
    if (f >= 2)   return "C1";
    return "C2";
  }
  async function fetchFreq(word){
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
  async function getCEFR(word){
    const w = (word || "").trim().toLowerCase();
    if (!w) return "";
    const cache = getCefrCache();
    const rec = cache[w];
    const now = Date.now();
    if (rec && rec.c && (now - rec.t) < CEFR_TTL) return rec.c;
    let f = null;
    try{ f = await fetchFreq(w); }catch{ f = null; }
    const c = freqToCEFR(f ?? 1.0);
    cache[w] = { c, f, t: now };
    setCefrCache(cache);
    return c;
  }
  function cefrRank(c){
    const map = {A1:1,A2:2,B1:3,B2:4,C1:5,C2:6};
    return map[c] || 0;
  }

  // ========= UI =========
  let backdrop, testEl;
  let state = {
    stage: "start",   // "start" | "quiz" | "result"
    session: null,
    settings: {
      count: 20,
      cefrMin: "A2",
      memMode: "all", // "all" | "low" | "unrated"
      shuffle: true
    }
  };

  function ensureUI(){
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

        <div class="vp-test-bottom" id="vpBottom"></div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(testEl);

    testEl.querySelector("#vpExit").addEventListener("click", closeTest);

    // Mobile-friendly: no keyboard required
    window.addEventListener("keydown", (e) => {
      if (testEl.style.display !== "block") return;
      if (e.key === "Escape") closeTest();
    });
  }

  function openTest(){
    ensureUI();
    document.documentElement.classList.add("vp-noscreen-scroll");
    document.body.classList.add("vp-noscreen-scroll");
    backdrop.style.display = "block";
    testEl.style.display = "block";
    state.stage = "start";
    state.session = null;
    render();
  }

  function closeTest(){
    if (!testEl) return;
    backdrop.style.display = "none";
    testEl.style.display = "none";
    document.documentElement.classList.remove("vp-noscreen-scroll");
    document.body.classList.remove("vp-noscreen-scroll");
  }

  function setTop(prog, done, cefr){
    testEl.querySelector("#vpProg").textContent = prog;
    testEl.querySelector("#vpDone").textContent = String(done);
    testEl.querySelector("#vpCefr").textContent = cefr || "—";
  }

  function setMid(html){
    testEl.querySelector("#vpMid").innerHTML = html;
  }
  function setBottom(html){
    testEl.querySelector("#vpBottom").innerHTML = html;
  }

  function render(){
    if (state.stage === "start") return renderStart();
    if (state.stage === "quiz") return renderQuiz();
    return renderResult();
  }

  function renderStart(){
    setTop("0/0", 0, "—");

    const s = state.settings;
    setMid(`
      <div class="vp-word" style="font-size:22px;">テスト設定</div>
      <div class="vp-note">スマホ用：ここで範囲を決めてから開始。</div>
      <div style="height:10px;"></div>

      <div class="vp-note" style="text-align:left; width:100%;">
        出題数
      </div>
      <div style="display:flex; gap:10px; width:100%; justify-content:center;">
        <button class="vp-btn" data-count="10">10</button>
        <button class="vp-btn" data-count="20">20</button>
        <button class="vp-btn" data-count="40">40</button>
      </div>

      <div style="height:10px;"></div>

      <div class="vp-note" style="text-align:left; width:100%;">CEFR下限</div>
      <div style="display:flex; gap:10px; width:100%; justify-content:center; flex-wrap:wrap;">
        <button class="vp-btn" data-cefr="A2">A2+</button>
        <button class="vp-btn" data-cefr="B1">B1+</button>
        <button class="vp-btn" data-cefr="B2">B2+</button>
        <button class="vp-btn" data-cefr="C1">C1+</button>
      </div>

      <div style="height:10px;"></div>

      <div class="vp-note" style="text-align:left; width:100%;">対象</div>
      <div style="display:flex; gap:10px; width:100%; justify-content:center; flex-wrap:wrap;">
        <button class="vp-btn" data-mem="all">全部</button>
        <button class="vp-btn" data-mem="low">未習得優先</button>
        <button class="vp-btn" data-mem="unrated">評価なし</button>
      </div>

      <div style="height:10px;"></div>

      <div style="display:flex; gap:10px; width:100%; justify-content:center;">
        <button class="vp-btn" id="vpShuffle">${s.shuffle ? "シャッフルON" : "シャッフルOFF"}</button>
      </div>

      <div style="height:14px;"></div>
      <button class="vp-btn" id="vpStart" style="padding:14px 18px; font-size:15px;">Start</button>
    `);

    setBottom(`
      <div class="vp-note">操作：Start → 「答え表示」→ 1〜4で自己評価。スクロールなし。</div>
    `);

    // wire
    testEl.querySelectorAll("[data-count]").forEach(b => b.onclick = () => { state.settings.count = Number(b.dataset.count); renderStart(); });
    testEl.querySelectorAll("[data-cefr]").forEach(b => b.onclick = () => { state.settings.cefrMin = b.dataset.cefr; renderStart(); });
    testEl.querySelectorAll("[data-mem]").forEach(b => b.onclick = () => { state.settings.memMode = b.dataset.mem; renderStart(); });
    testEl.querySelector("#vpShuffle").onclick = () => { state.settings.shuffle = !state.settings.shuffle; renderStart(); };
    testEl.querySelector("#vpStart").onclick = () => startSession();
  }

  async function startSession(){
    // Build pool based on settings
    const entries = loadEntries();
    if (!entries.length){
      state.stage = "start";
      setMid(`<div class="vp-word" style="font-size:22px;">単語が見つからない</div>
              <div class="vp-note">先に単語を追加してからStartして。</div>`);
      setBottom(`<button class="vp-btn" id="vpRescan">再検出</button>`);
      testEl.querySelector("#vpRescan").onclick = () => { initialScan(); renderStart(); };
      return;
    }

    // CEFR filter (async): we do quick prefetch for up to 120 to keep it snappy
    const s = state.settings;
    const minRank = cefrRank(s.cefrMin);

    // shallow copy
    let pool = entries.slice();

    // mem filter (best-effort)
    if (s.memMode === "unrated") pool = pool.filter(e => e.mem == null);
    if (s.memMode === "low") pool = pool.filter(e => (e.mem == null) || e.mem <= 2);

    // shuffle early
    if (s.shuffle){
      for (let i=pool.length-1; i>0; i--){
        const j = Math.floor(Math.random()*(i+1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }

    // CEFR filter with caching (avoid long waits)
    const filtered = [];
    for (let i=0; i<pool.length && i<120; i++){
      const c = await getCEFR(pool[i].word);
      if (cefrRank(c) >= minRank) filtered.push({ ...pool[i], cefr: c });
    }

    const use = (filtered.length >= 3 ? filtered : pool.map(e => ({...e, cefr:""})));
    const items = use.slice(0, Math.min(s.count, use.length));

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

  function current(){
    return state.session?.items?.[state.session.i] || null;
  }

  function renderQuiz(){
    const sess = state.session;
    if (!sess || !sess.items || sess.items.length === 0){
      state.stage = "start";
      return renderStart();
    }

    const total = sess.items.length;
    const cur = current();

    if (!cur){
      state.stage = "result";
      return renderResult();
    }

    setTop(`${sess.i+1}/${total}`, sess.done, cur.cefr || "—");

    setMid(`
      <div class="vp-word">${escapeHTML(cur.word)}</div>
      <div class="vp-answer" id="vpAns" style="${sess.answersShown ? "display:block;" : "display:none;"}">
        ${escapeHTML(cur.ja || "—")}
      </div>
      <div class="vp-note">
        <span class="vp-kbd">答え表示</span> を押してから自己評価。<br/>
        スマホで完結。
      </div>
    `);

    setBottom(`
      <button class="vp-btn" id="vpShow">答え表示</button>
      <button class="vp-btn" data-rate="1">1</button>
      <button class="vp-btn" data-rate="2">2</button>
      <button class="vp-btn" data-rate="3">3</button>
      <button class="vp-btn" data-rate="4">4</button>
      <button class="vp-btn" id="vpSkip">次へ</button>
    `);

    testEl.querySelector("#vpShow").onclick = () => {
      sess.answersShown = true;
      testEl.querySelector("#vpAns").style.display = "block";
    };

    testEl.querySelectorAll("[data-rate]").forEach(btn => {
      btn.onclick = () => {
        const r = Number(btn.dataset.rate);
        sess.logs.push({ word: cur.word, rate: r, t: Date.now() });
        sess.done++;
        sess.answersShown = false;
        sess.i++;
        renderQuiz();
      };
    });

    testEl.querySelector("#vpSkip").onclick = () => {
      sess.logs.push({ word: cur.word, rate: 0, t: Date.now() });
      sess.answersShown = false;
      sess.i++;
      renderQuiz();
    };
  }

  function renderResult(){
    const sess = state.session;
    const total = sess?.items?.length || 0;
    const done = sess?.done || 0;

    setTop(`${total}/${total}`, done, "—");

    setMid(`
      <div class="vp-word" style="font-size:22px;">結果</div>
      <div class="vp-note">評価済：${done} / ${total}</div>
      <div style="height:10px;"></div>
      <div class="vp-note">もう一回やるなら「再スタート」。</div>
    `);

    setBottom(`
      <button class="vp-btn" id="vpRestart">再スタート</button>
      <button class="vp-btn" id="vpClose">閉じる</button>
    `);

    testEl.querySelector("#vpRestart").onclick = () => {
      state.stage = "start";
      state.session = null;
      renderStart();
    };
    testEl.querySelector("#vpClose").onclick = closeTest;
  }

  function escapeHTML(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  // ========= Fixed buttons =========
  function mountFixedBar(){
    const bar = document.createElement("div");
    bar.className = "vp-fixedbar";
    bar.innerHTML = `
      <button class="vp-btn" type="button" id="vpThemeBtn">☀︎/🌙 Light</button>
      <button class="vp-btn" type="button" id="vpTestBtn">🧠 Test</button>
    `;
    document.body.appendChild(bar);
    bar.querySelector("#vpThemeBtn").onclick = toggleTheme;
    bar.querySelector("#vpTestBtn").onclick = openTest;
  }

  // ========= Boot =========
  function boot(){
    initTheme();
    hookSetItem();
    initialScan();
    mountFixedBar();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

})();
