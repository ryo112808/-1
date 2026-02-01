/* 単語plus / v7 (tutorial tap fix) */
const STORE_KEY = "tango_plus_v6";
const TRASH_KEY = "tango_plus_trash_v6";
const THEME_KEY = "tango_plus_theme_v6";
const SEEN_KEY  = "tango_plus_seen_v6";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const now = () => Date.now();
const uid = () => String(Date.now()) + "_" + Math.random().toString(16).slice(2);

function load(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{
    return fallback;
  }
}
function save(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

let items = load(STORE_KEY, []);
let trash = load(TRASH_KEY, []);

function normalizeWord(w){
  return (w || "")
    .replace(/[“”"']/g,"")
    .trim()
    .toLowerCase();
}

function splitWords(text){
  const t = (text || "").replace(/\r/g,"\n");
  const parts = t.split(/[\n,\/]+/g).flatMap(x => x.split(/\s+/g));
  const cleaned = parts.map(x => normalizeWord(x)).filter(Boolean);
  return cleaned.filter(w => /^[a-z\-]+$/i.test(w));
}

function levelLabel(lv){
  if (lv === 0) return "未習得";
  if (lv === 1) return "あやふや";
  if (lv === 2) return "習得";
  return "定着";
}

function escapeHtml(s){
  return (s ?? "").toString().replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function updateThemeBtn(){
  const btn = $("#themeBtn");
  if (!btn) return;
  const t = document.documentElement.dataset.theme || "auto";
  btn.textContent = (t === "dark") ? "🌙" : (t === "light") ? "☀️" : "🌗";
}
function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  save(THEME_KEY, theme);
  updateThemeBtn();
}
function initTheme(){
  const stored = load(THEME_KEY, "auto");
  applyTheme(stored);
}
function cycleTheme(){
  const cur = document.documentElement.dataset.theme || "auto";
  const next = (cur === "auto") ? "light" : (cur === "light") ? "dark" : "auto";
  applyTheme(next);
}

/* --- 取得 --- */
async function fetchDictionary(word){
  const url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("dict_fetch");
  const data = await res.json();
  const entry = data?.[0] || {};
  const phonetic = entry.phonetic || entry.phonetics?.find(p=>p?.text)?.text || "";

  let defs = [];
  let examples = [];
  let synonyms = [];

  const meanings = entry.meanings || [];
  for (const m of meanings){
    const part = m.partOfSpeech || "";
    for (const d of (m.definitions || [])){
      if (d?.definition) defs.push((part ? part + "： " : "") + d.definition);
      if (d?.example) examples.push(d.example);
      if (Array.isArray(d?.synonyms)) synonyms.push(...d.synonyms);
    }
    if (Array.isArray(m?.synonyms)) synonyms.push(...m.synonyms);
  }

  defs = Array.from(new Set(defs)).slice(0, 4);
  examples = Array.from(new Set(examples)).slice(0, 2);
  synonyms = Array.from(new Set(synonyms.map(s => normalizeWord(s)).filter(Boolean))).slice(0, 8);

  return { phonetic, defs, examples, synonyms };
}

async function fetchJa(word){
  const q = encodeURIComponent(word);
  const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|ja`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("ja_fetch");
  const data = await res.json();
  const t = data?.responseData?.translatedText || "";
  const ja = (t || "").trim();
  return ja || "要確認（手入力）";
}

function autoTagsFromDefs(defs){
  const text = (defs || []).join(" ").toLowerCase();
  const tags = [];
  const add = (t) => { if (!tags.includes(t)) tags.push(t); };

  if (/\bcompare|contrast|whereas|however|nevertheless|nonetheless\b/.test(text)) add("#対比");
  if (/\bcause|result|therefore|thus|consequently\b/.test(text)) add("#因果");
  if (/\bevaluate|assess|judge|criteria\b/.test(text)) add("#評価");
  if (/\babstract|concept|idea|theory\b/.test(text)) add("#抽象");
  if (/\bverb\b/.test(text)) add("#動詞");
  if (/\bnoun\b/.test(text)) add("#名詞");
  if (/\badjective\b/.test(text)) add("#形容詞");
  if (/\badverb\b/.test(text)) add("#副詞");

  return tags.slice(0, 3);
}

function ensureItem(word){
  const w = normalizeWord(word);
  if (!w) return null;
  const hit = items.find(x => x.word === w);
  if (hit) return hit;

  const it = {
    id: uid(),
    word: w,
    createdAt: now(),
    level: 0,
    phonetic: "",
    defs: [],
    synonyms: [],
    examples: [],
    ja: "要確認（手入力）",
    note: "",
    tags: [],
    fetchedAt: 0,
    pending: true,
    hold: false
  };
  items.unshift(it);
  return it;
}

/* --- キュー --- */
let queue = [];
let running = 0;
let okCount = 0;
let holdCount = 0;

function updateQueueUI(){
  const q = $("#qLabel"), p = $("#pLabel"), s = $("#sLabel"), f = $("#fLabel"), h = $("#queueHint");
  if (q) q.textContent = `待機 ${queue.length}`;
  if (p) p.textContent = `進行 ${running}`;
  if (s) s.textContent = `成功 ${okCount}`;
  if (f) f.textContent = `保留 ${holdCount}`;
  if (h) h.textContent = (queue.length || running) ? "取得中：画面を閉じても保存は続く" : "取得：完了";
}

async function processOne(it){
  try{
    if (it.fetchedAt && (now() - it.fetchedAt) < 1000 * 60 * 60 * 24 * 3) {
      it.pending = false;
      it.hold = false;
      return;
    }

    const [dict, ja] = await Promise.allSettled([
      fetchDictionary(it.word),
      fetchJa(it.word),
    ]);

    if (dict.status === "fulfilled"){
      it.phonetic = dict.value.phonetic || it.phonetic;
      it.defs = dict.value.defs || [];
      it.examples = dict.value.examples || [];
      it.synonyms = dict.value.synonyms || [];
      const autoTags = autoTagsFromDefs(it.defs);
      it.tags = Array.from(new Set([...(it.tags||[]), ...autoTags]));
    } else {
      it.hold = true;
    }

    if (ja.status === "fulfilled"){
      it.ja = (ja.value || "").trim() || "要確認（手入力）";
    } else {
      it.ja = it.ja && it.ja.trim() ? it.ja : "要確認（手入力）";
      it.hold = true;
    }

    it.pending = false;
    it.fetchedAt = now();
  }catch{
    it.pending = false;
    it.hold = true;
    it.ja = it.ja && it.ja.trim() ? it.ja : "要確認（手入力）";
  }
}

async function pump(){
  updateQueueUI();
  while (running < 3 && queue.length){
    const it = queue.shift();
    running++;
    updateQueueUI();

    processOne(it).then(()=>{
      if (it.hold) holdCount++;
      else okCount++;
      running--;
      save(STORE_KEY, items);
      renderList();
      pump();
    });
  }

  save(STORE_KEY, items);
  updateQueueUI();
}

function enqueueItems(arr){
  const targets = arr.filter(it => it && (it.pending || it.hold || !it.fetchedAt));
  for (const it of targets){
    if (!queue.find(x => x.id === it.id)) queue.push(it);
  }
  pump();
}

/* --- LIST --- */
function passesFilter(it, q, level){
  if (level !== "all" && String(it.level) !== String(level)) return false;
  if (!q) return true;

  const hay = [
    it.word,
    it.ja,
    (it.defs || []).join(" "),
    (it.synonyms || []).join(" "),
    (it.examples || []).join(" "),
    it.note,
    (it.tags || []).join(" "),
    it.phonetic
  ].join(" ").toLowerCase();

  return hay.includes(q);
}

function sortItems(arr, mode){
  const a = [...arr];
  if (mode === "old") a.sort((x,y)=>x.createdAt - y.createdAt);
  else if (mode === "az") a.sort((x,y)=>x.word.localeCompare(y.word));
  else a.sort((x,y)=>y.createdAt - x.createdAt);
  return a;
}

function renderList(){
  const list = $("#listArea");
  if (!list) return;

  const qRaw = ($("#search")?.value || "").trim().toLowerCase();
  const level = $("#filterLevel")?.value || "all";
  const sortBy = $("#sortBy")?.value || "new";

  const filtered = sortItems(items.filter(it => passesFilter(it, qRaw, level)), sortBy);

  if (filtered.length === 0){
    list.innerHTML = `<div class="hint">単語がまだ入っていない。貼るタブでまとめ貼りすると一気に作れる。</div>`;
    return;
  }

  list.innerHTML = filtered.map(it => {
    const tags = (it.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    const defs = (it.defs || []).length ? escapeHtml(it.defs.join("\n")) : "取得中…";
    const syn = (it.synonyms || []).length ? escapeHtml(it.synonyms.join(", ")) : "取得中…";
    const ex  = (it.examples || []).length ? escapeHtml(it.examples.join("\n")) : "取得中…";
    const ja  = escapeHtml(it.ja || "要確認（手入力）");

    return `
      <article class="item" data-id="${it.id}">
        <div class="itemTop">
          <div>
            <div class="itemWord">${escapeHtml(it.word)}</div>
            <div class="itemSub">${escapeHtml(it.phonetic || "")}</div>
          </div>
          <div class="levelTag">${levelLabel(it.level)}</div>
        </div>

        <div class="itemBody">
          <div class="kv"><div class="k">和訳</div><div class="v">${ja}</div></div>
          <div class="kv"><div class="k">意味（英語）</div><div class="v">${defs}</div></div>
          <div class="kv"><div class="k">類語</div><div class="v">${syn}</div></div>
          <div class="kv"><div class="k">例文</div><div class="v">${ex}</div></div>

          <div class="kv">
            <div class="k">メモ（任意）</div>
            <textarea class="textarea note" data-note="${it.id}" placeholder="自分用メモ">${escapeHtml(it.note || "")}</textarea>
          </div>

          <div class="kv">
            <div class="k">タグ（自動付与＋手動OK）</div>
            <input class="input tagsIn" data-tags="${it.id}" placeholder="#対比 #因果 など" value="${escapeHtml((it.tags||[]).join(" "))}">
            <div class="tags">${tags}</div>
          </div>

          <div class="row">
            <select class="select lvSel" data-lv="${it.id}">
              <option value="0" ${it.level===0?"selected":""}>未習得</option>
              <option value="1" ${it.level===1?"selected":""}>あやふや</option>
              <option value="2" ${it.level===2?"selected":""}>習得</option>
              <option value="3" ${it.level===3?"selected":""}>定着</option>
            </select>
            <button class="btn danger toTrash" data-trash="${it.id}" type="button">ゴミ箱へ</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  $$(".note").forEach(t => t.addEventListener("change", () => {
    const it = items.find(x=>x.id===t.dataset.note);
    if (!it) return;
    it.note = t.value || "";
    save(STORE_KEY, items);
  }));

  $$(".tagsIn").forEach(inp => inp.addEventListener("change", () => {
    const it = items.find(x=>x.id===inp.dataset.tags);
    if (!it) return;
    const ts = (inp.value || "").split(/\s+/).map(s=>s.trim()).filter(Boolean);
    it.tags = Array.from(new Set(ts));
    save(STORE_KEY, items);
    renderList();
  }));

  $$(".lvSel").forEach(sel => sel.addEventListener("change", () => {
    const it = items.find(x=>x.id===sel.dataset.lv);
    if (!it) return;
    it.level = Number(sel.value);
    save(STORE_KEY, items);
    renderList();
  }));

  $$(".toTrash").forEach(btn => btn.addEventListener("click", () => {
    const it = items.find(x=>x.id===btn.dataset.trash);
    if (!it) return;
    trash.unshift({ ...it, trashedAt: now() });
    items = items.filter(x=>x.id!==it.id);
    save(STORE_KEY, items);
    save(TRASH_KEY, trash);
    renderList();
    alert("ゴミ箱へ移動した（管理→ゴミ箱で復元）");
  }));
}

/* --- Tabs --- */
function setTab(name){
  const map = { list: "#tab_list", paste:"#tab_paste", flash:"#tab_flash", manage:"#tab_manage" };
  for (const k of Object.keys(map)){
    const el = $(map[k]);
    if (el) el.hidden = (k !== name);
  }
  $$(".tab").forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}

/* --- Flash overlay --- */
let deck = [];
let idx = 0;
let revealed = false;
let flashTargetCount = 0;
let result = { "0":0, "1":0, "2":0, "3":0 };

function openFlashOverlay(){ $("#flashOverlay") && ($("#flashOverlay").hidden = false); }
function closeFlashOverlay(){ $("#flashOverlay") && ($("#flashOverlay").hidden = true); }

function buildDeck(level, count, shuffle){
  const pool = (level === "all") ? [...items] : items.filter(x => String(x.level) === String(level));
  const withJa = pool.filter(x => (x.ja || "").trim().length);
  const base = withJa.length ? withJa : pool;

  let arr = base.slice();
  if (shuffle){
    for (let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
  }

  const n = Math.max(1, Math.min(count, arr.length));
  return arr.slice(0, n);
}

function updateFlashUI(){
  const it = deck[idx];
  if (!it) return;

  $("#flashProgress") && ($("#flashProgress").textContent = `${idx+1} / ${flashTargetCount}`);
  $("#flashWord") && ($("#flashWord").textContent = it.word);
  $("#flashPhonetic") && ($("#flashPhonetic").textContent = it.phonetic || "");

  $("#answerBox") && ($("#answerBox").hidden = !revealed);
  $("#rateRow") && ($("#rateRow").hidden = !revealed);

  $("#flashJa") && ($("#flashJa").textContent = revealed ? (it.ja || "要確認（手入力）") : "");
  $("#flashHint") && ($("#flashHint").textContent = revealed ? "評価で暗記度を更新 → 次へ" : "「答え」で和訳を表示");
  $("#flashMeta") && ($("#flashMeta").textContent = `暗記度：${levelLabel(it.level)}　#タグ：${(it.tags||[]).join(" ")}`);
}

function showDone(){
  $("#flashDone") && ($("#flashDone").hidden = false);
  const card = document.querySelector(".overlay__card");
  if (card) card.hidden = true;

  $("#doneText") && ($("#doneText").textContent =
    `未習得 ${result["0"]} / あやふや ${result["1"]} / 習得 ${result["2"]} / 定着 ${result["3"]}　（合計 ${flashTargetCount}）`
  );
}

function startFlash(){
  const level = $("#flashLevel")?.value || "all";
  const shuffle = !!$("#flashShuffle")?.checked;
  const rawCount = ($("#flashCount")?.value || "").trim();
  const count = Math.max(1, Number(rawCount || 20));

  const base = buildDeck(level, count, shuffle);
  if (!base.length){
    alert("出題できる単語がまだ少ない。先に貼るタブで追加するとすぐ回せる。");
    return;
  }

  deck = base;
  idx = 0;
  revealed = false;
  flashTargetCount = deck.length;
  result = { "0":0, "1":0, "2":0, "3":0 };

  $("#flashDone") && ($("#flashDone").hidden = true);
  const card = document.querySelector(".overlay__card");
  if (card) card.hidden = false;

  openFlashOverlay();
  updateFlashUI();
}

function reveal(){ revealed = true; updateFlashUI(); }
function rate(lv){
  if (!revealed) revealed = true;
  const it = deck[idx];
  if (it){
    it.level = Number(lv);
    result[String(lv)]++;
    save(STORE_KEY, items);
  }
  updateFlashUI();
}
function next(){
  idx++;
  revealed = false;
  if (idx >= flashTargetCount){ showDone(); return; }
  updateFlashUI();
}

/* --- Export/Import + Trash --- */
function doExport(){
  const payload = { version: 6, exportedAt: new Date().toISOString(), items, trash };
  const text = JSON.stringify(payload, null, 2);
  navigator.clipboard.writeText(text).then(()=>{
    alert("エクスポートをコピーした（メモ帳に貼って保存でOK）");
  }).catch(()=>{
    window.prompt("このテキストをコピーして保存:", text);
  });
}
function doImport(){
  const txt = window.prompt("エクスポートしたJSONを貼ってOK:");
  if (!txt) return;
  try{
    const obj = JSON.parse(txt);
    const arr = obj?.items;
    if (!Array.isArray(arr)) throw new Error();
    items = arr.map(x => ({
      ...x,
      word: normalizeWord(x.word),
      level: Number(x.level || 0),
      ja: (x.ja || "要確認（手入力）"),
      tags: Array.isArray(x.tags) ? x.tags : [],
      defs: Array.isArray(x.defs) ? x.defs : [],
      synonyms: Array.isArray(x.synonyms) ? x.synonyms : [],
      examples: Array.isArray(x.examples) ? x.examples : [],
    })).filter(x => x.word);

    trash = Array.isArray(obj?.trash) ? obj.trash : trash;
    save(STORE_KEY, items);
    save(TRASH_KEY, trash);
    renderList();
    alert("インポート完了");
  }catch{
    alert("形式が合ってるJSONをそのまま貼ってOK");
  }
}
function trashAll(){
  if (!items.length){ alert("移動できる単語がまだない。"); return; }
  const ok = confirm("全単語をゴミ箱へ移動する？（復元OK）");
  if (!ok) return;
  trash.unshift(...items.map(it => ({...it, trashedAt: now()})));
  items = [];
  save(STORE_KEY, items);
  save(TRASH_KEY, trash);
  renderList();
  alert("ゴミ箱へ移動した");
}
function openTrash(){
  if (!trash.length){ alert("ゴミ箱は空。"); return; }
  const sample = trash.slice(0, 30).map((t,i)=>`${i+1}. ${t.word}`).join("\n");
  const ans = window.prompt(`復元したい番号（1-${Math.min(30,trash.length)}）を入力:\n\n${sample}`);
  if (!ans) return;
  const n = Number(ans);
  if (!Number.isFinite(n) || n < 1 || n > Math.min(30,trash.length)) return;

  const it = trash.splice(n-1, 1)[0];
  if (it){
    if (!items.find(x=>x.word===it.word)) items.unshift({...it, id: uid(), restoredAt: now()});
    save(STORE_KEY, items);
    save(TRASH_KEY, trash);
    renderList();
    alert("復元した");
  }
}

/* --- Tutorial (event delegation fix) --- */
let tutoIndex = 0;

function slides(){ return $$("#tutoSlides .tuto__slide"); }

function renderDots(){
  const dots = $("#tutoDots");
  if (!dots) return;
  dots.innerHTML = slides().map((_,i)=>`<span class="dot ${i===tutoIndex?"is-active":""}"></span>`).join("");
}

function showSlide(i){
  const ss = slides();
  if (!ss.length) return;

  tutoIndex = Math.max(0, Math.min(i, ss.length-1));
  ss.forEach((s,idx)=>s.classList.toggle("is-active", idx===tutoIndex));
  renderDots();

  const next = $("#tutoNext");
  if (next) next.textContent = (tutoIndex===ss.length-1) ? "完了" : "次へ";
}

function openTuto(){
  const t = $("#tuto");
  if (!t) return;
  t.hidden = false;
  showSlide(0);
}

function closeTuto(){
  const t = $("#tuto");
  if (!t) return;
  t.hidden = true;
  localStorage.setItem(SEEN_KEY, "1");
}

function maybeOpenTuto(){
  const seen = localStorage.getItem(SEEN_KEY);
  if (seen) return;
  openTuto();
}

/* ✅ ここが本命：ボタンが死んでも拾える“委譲” */
function tutorialDelegation(){
  document.addEventListener("click", (e) => {
    const t = $("#tuto");
    if (!t || t.hidden) return;

    const el = e.target.closest("#tutoSkip, #tutoPrev, #tutoNext");
    if (!el) return;

    e.preventDefault();
    e.stopPropagation();

    if (el.id === "tutoSkip") { closeTuto(); return; }
    if (el.id === "tutoPrev") { showSlide(tutoIndex - 1); return; }
    if (el.id === "tutoNext") {
      const ss = slides();
      if (tutoIndex >= ss.length - 1) closeTuto();
      else showSlide(tutoIndex + 1);
      return;
    }
  }, { passive:false, capture:true });
}

/* --- Events --- */
function bind(){
  $$(".tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("#themeBtn")?.addEventListener("click", cycleTheme);

  $("#search")?.addEventListener("input", renderList);
  $("#clearSearch")?.addEventListener("click", () => { $("#search").value=""; renderList(); });
  $("#filterLevel")?.addEventListener("change", renderList);
  $("#sortBy")?.addEventListener("change", renderList);

  $("#addBulk")?.addEventListener("click", () => {
    const txt = $("#bulk")?.value || "";
    const ws = splitWords(txt);
    if (!ws.length){ alert("英単語を貼ってから「追加する」。"); return; }

    let added = 0;
    for (const w of ws){
      const before = items.length;
      const it = ensureItem(w);
      if (it && items.length !== before) added++;
      if (it) it.pending = true;
    }
    save(STORE_KEY, items);
    renderList();

    const targets = ws.map(w => items.find(x => x.word === normalizeWord(w))).filter(Boolean);
    okCount = 0; holdCount = 0;
    enqueueItems(targets);

    alert(`追加：${added}語（取得開始）`);
  });

  $("#retryMissing")?.addEventListener("click", () => {
    const missing = items.filter(x => x.pending || x.hold || !x.fetchedAt);
    if (!missing.length){ alert("再取得対象が今は少ない。"); return; }
    okCount = 0; holdCount = 0;
    missing.forEach(x => { x.pending = true; x.hold = false; });
    save(STORE_KEY, items);
    renderList();
    enqueueItems(missing);
  });

  $("#startFlash")?.addEventListener("click", startFlash);
  $("#endFlash")?.addEventListener("click", () => { closeFlashOverlay(); setTab("list"); });

  $("#revealBtn")?.addEventListener("click", reveal);
  $("#nextBtn")?.addEventListener("click", next);

  $$("#rateRow .rate").forEach(btn => btn.addEventListener("click", () => {
    rate(btn.dataset.rate);
    next();
  }));

  $("#doneClose")?.addEventListener("click", () => { closeFlashOverlay(); setTab("list"); });

  $("#exportBtn")?.addEventListener("click", doExport);
  $("#importBtn")?.addEventListener("click", doImport);
  $("#trashAll")?.addEventListener("click", trashAll);
  $("#openTrash")?.addEventListener("click", openTrash);

  document.addEventListener("keydown", (e) => {
    const ov = $("#flashOverlay");
    if (!ov || ov.hidden) return;

    if (e.key === " "){
      e.preventDefault();
      if (!revealed) reveal();
      else next();
    }
    if (e.key === "1") { e.preventDefault(); rate(0); next(); }
    if (e.key === "2") { e.preventDefault(); rate(1); next(); }
    if (e.key === "3") { e.preventDefault(); rate(2); next(); }
    if (e.key === "4") { e.preventDefault(); rate(3); next(); }
    if (e.key === "Escape"){ e.preventDefault(); closeFlashOverlay(); setTab("list"); }
  });
}

function init(){
  initTheme();
  updateQueueUI();
  tutorialDelegation();   // ←先に仕込む（これでボタン死なない）
  bind();
  renderList();
  setTab("list");
  maybeOpenTuto();

  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

init();
