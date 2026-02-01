/* addon.js */
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
    if (saved) { applyTheme(saved); return; }
    const prefersLight = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    applyTheme(prefersLight ? "light" : "dark");
  }
  function toggleTheme(){
    const cur = root.dataset.theme || "dark";
    applyTheme(cur === "dark" ? "light" : "dark");
  }

  // ========= Word data (auto-detect from localStorage) =========
  const WORD_FIELDS = ["word","term","headword","title","en","english"];
  const JA_FIELDS = ["ja","jp","meaning","translation","japanese"];
  const DEF_FIELDS = ["def","definition","enDef","englishDefinition"];
  const LEVEL_FIELDS = ["level","mem","memory","rank","stage"]; // optional

  function safeParse(s){ try{ return JSON.parse(s); }catch{ return null; } }

  function pickStr(obj, fields){
    for (const k of fields){
      if (typeof obj?.[k] === "string" && obj[k].trim()) return obj[k].trim();
    }
    return "";
  }

  function scoreArr(arr){
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    let s = 0;
    for (let i=0; i<Math.min(arr.length, 20); i++){
      const x = arr[i];
      if (!x || typeof x !== "object") continue;
      if (pickStr(x, WORD_FIELDS)) s += 5;
      if (pickStr(x, JA_FIELDS)) s += 2;
      if (pickStr(x, DEF_FIELDS)) s += 1;
    }
    s += Math.min(arr.length, 400)/40;
    return s;
  }

  function findBestStore(){
    let best = { key:"", root:null, arr:null, arrProp:"", score:0 };

    for (let i=0; i<localStorage.length; i++){
      const key = localStorage.key(i);
      if (!key) continue;
      const raw = localStorage.getItem(key);
      if (!raw || raw.length < 10) continue;

      const parsed = safeParse(raw);
      if (!parsed) continue;

      let arr = null, arrProp = "";
      if (Array.isArray(parsed)) arr = parsed;
      else if (parsed && typeof parsed === "object"){
        for (const p of ["words","items","list","data"]){
          if (Array.isArray(parsed[p])) { arr = parsed[p]; arrProp = p; break; }
        }
      }
      const sc = scoreArr(arr);
      if (sc > best.score){
        best = { key, root: parsed, arr, arrProp, score: sc };
      }
    }
    return best.score >= 5 ? best : null;
  }

  function normalizeEntry(raw){
    const word = pickStr(raw, WORD_FIELDS);
    const ja = pickStr(raw, JA_FIELDS);
    const def = pickStr(raw, DEF_FIELDS);
    let mem = null;
    for (const k of LEVEL_FIELDS){
      if (typeof raw?.[k] === "number") { mem = raw[k]; break; }
      if (typeof raw?.[k] === "string" && raw[k].trim()){
        const n = Number(raw[k]); if (Number.isFinite(n)) { mem = n; break; }
      }
    }
    return { word, ja, def, mem, raw };
  }

  function loadEntries(){
    const store = findBestStore();
    if (!store?.arr) return [];
    return store.arr.map(normalizeEntry).filter(e => e.word);
  }

  // ========= CEFR Auto (frequency -> level) =========
  // Datamuse: tags includes "f:NUMBER" as occurrences per million words 4
  const CEFR_CACHE_KEY = "vp_cefr_cache_v1";
  const CEFR_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

  function getCefrCache(){
    const obj = safeParse(localStorage.getItem(CEFR_CACHE_KEY) || "{}");
    return (obj && typeof obj === "object") ? obj : {};
  }
  function setCefrCache(cache){
    try{ localStorage.setItem(CEFR_CACHE_KEY, JSON.stringify(cache)); }catch{}
  }

  function freqToCEFR(f){
    // f: occurrences per million words
    // 閾値は “受験用に扱いやすい” 方向で寄せた推定（完全オートの実用版）
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
    if (rec && (now - rec.t) < CEFR_CACHE_TTL_MS && rec.c) return rec.c;

    let f = null;
    try{ f = await fetchFreq(w); }catch{ f = null; }

    // 頻度が取れない語は “低頻度寄り” として扱う（実運用向け）
    const cefr = freqToCEFR(f ?? 1.0);

    cache[w] = { c: cefr, f: f ?? null, t: now };
    setCefrCache(cache);
    return cefr;
  }

  function cefrClass(c){
    if (!c) return "";
    if (c.startsWith("A")) return "vp-A";
    if (c === "B1") return "vp-B1";
    if (c === "B2") return "vp-B2";
    if (c.startsWith("C")) return "vp-C";
    return "";
  }

  // ========= UI: fixed buttons + CEFR badges =========
  function mountFixedBar(){
    const bar = document.createElement("div");
    bar.className = "vp-fixedbar";
    bar.innerHTML = `
      <button class="vp-btn" type="button" id="vpThemeBtn">☀︎/🌙 Light</button>
      <button class="vp-btn" type="button" id="vpTestBtn">🧠 Test</button>
    `;
    document.body.appendChild(bar);

    bar.querySelector("#vpThemeBtn").addEventListener("click", toggleTheme);
    bar.querySelector("#vpTestBtn").addEventListener("click", openTest);

    window.addEventListener("keydown", (e) => {
      if (e.key === "t" || e.key === "T") toggleTheme();
      if (e.key === "m" || e.key === "M") openTest();
      if (e.key === "Escape") closeTest();
    });
  }

  async function mountCefrBadges(){
    // 単語表記っぽい短いテキスト要素を拾って後ろにCEFRを付ける
    const seen = new Set();

    const tick = async () => {
      const entries = loadEntries();
      if (!entries.length) return;

      const wordSet = new Set(entries.map(e => e.word.toLowerCase()));
      const nodes = Array.from(document.querySelectorAll("body *"))
        .filter(el => el.children.length === 0 && (el.textContent || "").trim().length <= 60);

      for (const el of nodes){
        const text = (el.textContent || "").trim();
        const key = text.toLowerCase();
        if (!wordSet.has(key)) continue;
        const markKey = `${key}@@${el.tagName}`;
        if (seen.has(markKey)) continue;

        const cefr = await getCEFR(key);
        const badge = document.createElement("span");
        badge.className = `vp-cefr ${cefrClass(cefr)}`;
        badge.textContent = cefr;

        el.insertAdjacentElement("afterend", badge);
        seen.add(markKey);
      }
    };

    tick();
    setInterval(tick, 1200);
  }

  // ========= Fullscreen Self-judgement Test =========
  let backdrop, testEl;
  let session = null;

  function ensureTestUI(){
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
            <span class="vp-chip">CEFR <b id="vpLvl">—</b></span>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="vp-btn" id="vpExit" type="button">Exit <span class="vp-kbd">Esc</span></button>
          </div>
        </div>

        <div class="vp-test-mid">
          <div class="vp-word" id="vpWord">—</div>
          <div class="vp-answer" id="vpAns">—</div>
          <div class="vp-note" id="vpHint">
            <span class="vp-kbd">Space</span> 答え / <span class="vp-kbd">1-4</span> 自己評価 / <span class="vp-kbd">→</span> 次へ
          </div>
        </div>

        <div class="vp-test-bottom">
          <button class="vp-btn" type="button" data-rate="1">1 未習得</button>
          <button class="vp-btn" type="button" data-rate="2">2 不確か</button>
          <button class="vp-btn" type="button" data-rate="3">3 習得</button>
          <button class="vp-btn" type="button" data-rate="4">4 定着</button>
          <button class="vp-btn" type="button" id="vpShow">答え</button>
          <button class="vp-btn" type="button" id="vpNext">次へ</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(testEl);

    testEl.querySelector("#vpExit").addEventListener("click", closeTest);
    testEl.querySelector("#vpShow").addEventListener("click", showAnswer);
    testEl.querySelector("#vpNext").addEventListener("click", nextItem);

    testEl.querySelectorAll("[data-rate]").forEach(btn => {
      btn.addEventListener("click", () => {
        const r = Number(btn.getAttribute("data-rate"));
        rate(r);
      });
    });

    window.addEventListener("keydown", (e) => {
      if (testEl.style.display !== "block") return;
      if (e.key === " ") { e.preventDefault(); showAnswer(); }
      if (e.key === "ArrowRight") { e.preventDefault(); nextItem(); }
      if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") rate(Number(e.key));
    });
  }

  function buildSession(){
    const entries = loadEntries();
    // “独立テスト”なので、既存フラッシュ条件に縛らず全部から出す（和訳空は答えに—で表示）
    const pool = entries.slice();
    // shuffle
    for (let i=pool.length-1; i>0; i--){
      const j = Math.floor(Math.random()*(i+1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const items = pool.slice(0, Math.min(50, pool.length)); // 50問上限：スクロール回避 + 速度
    session = { items, i:0, done:0, rated:[] };
  }

  async function renderItem(){
    if (!session) buildSession();
    const total = session.items.length;
    const cur = session.items[session.i] || null;

    testEl.querySelector("#vpProg").textContent = `${Math.min(session.i+1,total)}/${total}`;
    testEl.querySelector("#vpDone").textContent = `${session.done}`;

    const wordEl = testEl.querySelector("#vpWord");
    const ansEl = testEl.querySelector("#vpAns");
    const lvlEl = testEl.querySelector("#vpLvl");

    if (!cur){
      wordEl.textContent = "完了";
      ansEl.style.display = "block";
      ansEl.textContent = "Exitで戻る";
      lvlEl.textContent = "—";
      return;
    }

    wordEl.textContent = cur.word;
    ansEl.textContent = cur.ja || "—";
    ansEl.style.display = "none";

    const cefr = await getCEFR(cur.word);
    lvlEl.textContent = cefr || "—";
  }

  function showAnswer(){
    const ansEl = testEl.querySelector("#vpAns");
    ansEl.style.display = "block";
  }

  function rate(r){
    if (!session) return;
    session.rated.push({ idx: session.i, rate: r, t: Date.now() });
    session.done++;
    nextItem();
  }

  function nextItem(){
    if (!session) return;
    session.i++;
    renderItem();
  }

  function openTest(){
    ensureTestUI();
    document.documentElement.classList.add("vp-noscreen-scroll");
    document.body.classList.add("vp-noscreen-scroll");
    backdrop.style.display = "block";
    testEl.style.display = "block";
    if (!session) buildSession();
    renderItem();
  }

  function closeTest(){
    if (!testEl) return;
    backdrop.style.display = "none";
    testEl.style.display = "none";
    document.documentElement.classList.remove("vp-noscreen-scroll");
    document.body.classList.remove("vp-noscreen-scroll");
  }

  // ========= Boot =========
  async function boot(){
    initTheme();
    mountFixedBar();
    mountCefrBadges();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

})();
