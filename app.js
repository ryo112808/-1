/* 単語plus v2 - 安定動作優先（スマホ向け） */

const STORE_KEY = "tango_plus_v2_items";
const TRASH_KEY = "tango_plus_v2_trash";
const META_KEY  = "tango_plus_v2_meta";
const THEME_KEY = "tango_plus_v2_theme";

const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));

/* ---------- state ---------- */
let items = loadJSON(STORE_KEY, []);
let trash = loadJSON(TRASH_KEY, []);
let meta  = loadJSON(META_KEY, { tutorialDone: false, backup: null, lastUndo: null });

let flashDeck = [];
let flashIdx = 0;
let flashRevealed = false;

const LIMIT_CONCURRENCY = 3;
let queueAbort = false;

/* ---------- init ---------- */
boot();
function boot(){
  bindNav();
  bindTheme();
  bindPaste();
  bindDetail();
  bindManage();
  bindFlash();
  bindTutorial();

  renderChips();
  renderList();
  renderTrash();
  ensureFirstOpenTutorial();

  // SW
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

/* ---------- utils ---------- */
function loadJSON(key, fallback){
  try{
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  }catch{
    return fallback;
  }
}
function saveAll(){
  localStorage.setItem(STORE_KEY, JSON.stringify(items));
  localStorage.setItem(TRASH_KEY, JSON.stringify(trash));
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}
function normWord(s){
  return (s||"")
    .toString()
    .trim()
    .replace(/[“”"]/g,"")
    .replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g,"")
    .toLowerCase();
}
function uniqByWord(arr){
  const map = new Map();
  for (const it of arr){
    if (!it.word) continue;
    map.set(normWord(it.word), it);
  }
  return Array.from(map.values());
}
function now(){ return Date.now(); }
function fmtDate(t){
  const d = new Date(t);
  return d.toLocaleString();
}
function escapeHtml(str){
  return (str||"").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}
function hasText(s){ return (s||"").toString().trim().length > 0; }

/* ---------- navigation (views) ---------- */
function bindNav(){
  $("#toList").addEventListener("click", ()=>showView("list"));
  $("#toFlash").addEventListener("click", ()=>showView("flash"));
  $("#toManage").addEventListener("click", ()=>showView("manage"));

  $("#helpBtn").addEventListener("click", ()=>openTutorial(true));

  $("#clearSearch").addEventListener("click", ()=>{
    $("#search").value = "";
    renderList();
  });
  $("#search").addEventListener("input", ()=>renderList());
}
function showView(name){
  const map = {
    list:   ["#viewList", "#viewFlash", "#viewManage"],
    flash:  ["#viewFlash", "#viewList", "#viewManage"],
    manage: ["#viewManage", "#viewList", "#viewFlash"]
  };
  const [on, ...off] = map[name];
  $(on).hidden = false;
  off.forEach(sel => $(sel).hidden = true);

  if (name === "flash") renderFlashReady();
}

/* ---------- theme ---------- */
function bindTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") setTheme(saved);
  else {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  }

  $("#themeBtn").addEventListener("click", ()=>{
    const cur = document.documentElement.dataset.theme || "light";
    setTheme(cur === "light" ? "dark" : "light");
  });
}
function setTheme(mode){
  document.documentElement.dataset.theme = mode;
  localStorage.setItem(THEME_KEY, mode);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", mode === "dark" ? "#0d0f14" : "#ffffff");
}

/* ---------- paste modal + batch add ---------- */
function bindPaste(){
  $("#openPaste").addEventListener("click", ()=>openPaste(true));
  $("#closePaste").addEventListener("click", ()=>openPaste(false));
  $("#pasteModal").addEventListener("click", (e)=>{
    if (e.target.id === "pasteModal") openPaste(false);
  });

  $("#bulkClear").addEventListener("click", ()=> $("#bulk").value = "");
  $("#bulkAdd").addEventListener("click", async ()=>{
    const raw = $("#bulk").value || "";
    const words = parseWords(raw);
    if (words.length === 0) return;

    // create skeletons first (fast UI), then fetch in background
    const created = [];
    const existing = new Map(items.map(it => [normWord(it.word), it]));
    for (const w of words){
      const key = normWord(w);
      if (!key) continue;

      if (existing.has(key)){
        // already exists -> skip
        continue;
      }
      const it = {
        id: String(now()) + "_" + Math.random().toString(16).slice(2),
        word: key,
        ja: "",             // 必須：後で取得
        def: "",
        syn: [],
        tags: autoTags(key),
        note: "",
        level: 0,
        createdAt: now(),
        updatedAt: now(),
        fetchedAt: 0
      };
      created.push(it);
      existing.set(key, it);
    }

    if (created.length === 0) return;

    items = uniqByWord([...created, ...items]);
    saveAll();
    renderChips();
    renderList();

    // fetch details queue (with progress)
    $("#queueBox").hidden = false;
    queueAbort = false;
    await runFetchQueue(created);
    $("#queueBox").hidden = true;

    $("#bulk").value = "";
    openPaste(false);
  });
}
function openPaste(open){
  $("#pasteModal").hidden = !open;
}
function parseWords(text){
  // split by spaces/newlines/comma/slash etc; keep a-z letters
  const parts = (text||"")
    .replace(/\r/g,"\n")
    .split(/[\n,\/\t]+/g)
    .flatMap(line => line.split(/\s+/g))
    .map(x => normWord(x))
    .filter(Boolean);

  // unique keep order
  const seen = new Set();
  const out = [];
  for (const p of parts){
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/* ---------- dictionary + translation ---------- */
async function fetchDictionary(word){
  // dictionaryapi.dev
  const url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word);
  const res = await fetch(url);
  if (!res.ok) return { def:"", syn:[] };

  const data = await res.json();
  const entry = data?.[0];
  const meanings = entry?.meanings || [];

  // def: first few definitions
  const defs = [];
  const syns = new Set();

  for (const m of meanings){
    const ds = (m?.definitions || []).slice(0, 2);
    for (const d of ds){
      if (d?.definition) defs.push(d.definition);
      (d?.synonyms || []).forEach(s => syns.add(normWord(s)));
    }
    (m?.synonyms || []).forEach(s => syns.add(normWord(s)));
    if (defs.length >= 3) break;
  }

  return { def: defs.join(" / "), syn: Array.from(syns).filter(Boolean).slice(0, 12) };
}

async function translateToJa(text){
  // MyMemory (free, public). ネット状況で揺れるので fallback 前提。
  // NOTE: 取得できた結果は編集で直せる。
  const q = (text||"").trim();
  if (!q) return "";
  const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(q) + "&langpair=en|ja";
  const res = await fetch(url);
  if (!res.ok) return "";
  const data = await res.json();
  const out = data?.responseData?.translatedText || "";
  // 変な混入を軽く掃除
  return out.replace(/\s+/g," ").trim();
}

function autoTags(word){
  // 固有名詞みたいな雑タグを避けて “内容タグ”寄りに軽く
  // ここは「自動は薄く、本人が育てる」が最強
  const tags = [];
  if (word.endsWith("ly")) tags.push("adverb");
  if (word.endsWith("tion") || word.endsWith("sion")) tags.push("noun");
  if (word.endsWith("ive") || word.endsWith("al")) tags.push("adj");
  if (word.endsWith("ize") || word.endsWith("ify")) tags.push("verb");
  return tags;
}

/* ---------- fetch queue with concurrency ---------- */
async function runFetchQueue(targets){
  let done = 0;
  const total = targets.length;

  $("#queueText").textContent = `取得中… 0 / ${total}`;
  $("#queueBar").style.width = "0%";

  const work = targets.slice(); // queue
  const workers = Array.from({length: LIMIT_CONCURRENCY}, async () => {
    while(work.length && !queueAbort){
      const it = work.shift();
      await enrichItem(it);
      done++;
      $("#queueText").textContent = `取得中… ${done} / ${total}`;
      $("#queueBar").style.width = `${Math.round(done/total*100)}%`;

      // refresh list occasionally
      if (done % 2 === 0 || done === total){
        saveAll();
        renderChips();
        renderList();
      }
    }
  });

  await Promise.all(workers);
  saveAll();
  renderChips();
  renderList();
}

async function enrichItem(it){
  // already fetched recently?
  const found = items.find(x => x.id === it.id);
  if (!found) return;

  // dictionary
  const dic = await fetchDictionary(found.word);
  found.def = dic.def || found.def || "";
  found.syn = (dic.syn && dic.syn.length) ? dic.syn : (found.syn||[]);

  // Japanese translation is mandatory target
  if (!hasText(found.ja)){
    const ja = await translateToJa(found.word);
    found.ja = ja || found.ja || "";
  }

  found.fetchedAt = now();
  found.updatedAt = now();
}

/* ---------- list rendering ---------- */
function renderChips(){
  const total = items.length;
  const needJa = items.filter(it => !hasText(it.ja)).length;
  const chips = [
    { label:`単語 ${total}`, },
    { label:`和訳未取得 ${needJa}`, }
  ];

  $("#statusChips").innerHTML = chips.map(c => `<span class="chip">${escapeHtml(c.label)}</span>`).join("");
}

function renderList(){
  const q = ($("#search").value || "").trim().toLowerCase();

  let filtered = items.slice();
  if (q){
    filtered = filtered.filter(it => {
      const hay = [
        it.word, it.ja, it.def,
        (it.syn||[]).join(" "),
        it.note,
        (it.tags||[]).join(" ")
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  $("#listEmpty").hidden = filtered.length !== 0;

  const html = filtered.slice(0, 200).map(it => {
    const tags = (it.tags||[]).slice(0, 6).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    const badge = `暗記度 ${it.level ?? 0}`;
    const jaLine = hasText(it.ja) ? escapeHtml(it.ja) : `<span class="muted">（和訳 取得中 / 未取得）</span>`;
    return `
      <div class="item" data-open="${escapeHtml(it.id)}">
        <div class="item-top">
          <div>
            <div class="word">${escapeHtml(it.word)}</div>
            <div class="meta2">${jaLine}</div>
            <div class="tags">${tags}</div>
          </div>
          <div class="badge">${escapeHtml(badge)}</div>
        </div>
        <div class="meta2">更新 ${escapeHtml(fmtDate(it.updatedAt || it.createdAt))}</div>
      </div>
    `;
  }).join("");

  $("#list").innerHTML = html;

  // bind open detail
  $$("[data-open]").forEach(el=>{
    el.addEventListener("click", ()=>{
      const id = el.getAttribute("data-open");
      openDetail(id);
    });
  });
}

/* ---------- detail modal ---------- */
let detailId = null;
function bindDetail(){
  $("#closeDetail").addEventListener("click", ()=>closeDetail());
  $("#detailModal").addEventListener("click", (e)=>{
    if (e.target.id === "detailModal") closeDetail();
  });

  $("#saveDetail").addEventListener("click", ()=>{
    const it = items.find(x => x.id === detailId);
    if (!it) return;

    it.ja = ($("#detailJa").value||"").trim();
    it.note = ($("#detailNote").value||"").trim();

    const tagStr = ($("#detailTags").value||"").trim();
    it.tags = tagStr ? tagStr.split(/\s+/g).map(t=>t.trim()).filter(Boolean).slice(0,20) : [];
    it.updatedAt = now();

    saveAll();
    renderChips();
    renderList();
    closeDetail();
  });

  $("#trashOne").addEventListener("click", ()=>{
    const it = items.find(x => x.id === detailId);
    if (!it) return;
    moveToTrash([it.id], "one");
    closeDetail();
  });
}

function openDetail(id){
  const it = items.find(x => x.id === id);
  if (!it) return;
  detailId = id;

  $("#detailTitle").textContent = it.word;
  $("#detailJa").value = it.ja || "";
  $("#detailNote").value = it.note || "";
  $("#detailTags").value = (it.tags||[]).join(" ");

  $("#detailDef").textContent = it.def || "—";
  $("#detailSyn").textContent = (it.syn && it.syn.length) ? it.syn.join(", ") : "—";

  $("#detailModal").hidden = false;
}
function closeDetail(){
  $("#detailModal").hidden = true;
  detailId = null;
}

/* ---------- manage (trash / export / import / undo) ---------- */
function bindManage(){
  $("#exportBtn").addEventListener("click", ()=>{
    const payload = JSON.stringify({ items, trash, meta:{...meta, backup:null, lastUndo:null} }, null, 2);
    try{
      navigator.clipboard.writeText(payload);
      toast("コピーした。メモ帳に貼って保存OK。");
    }catch{
      window.prompt("これをコピーして保存:", payload);
    }
  });

  $("#importBtn").addEventListener("click", ()=>{
    const txt = window.prompt("エクスポートしたJSONを貼り付けてOK:");
    if (!txt) return;
    try{
      const obj = JSON.parse(txt);
      if (!obj || !Array.isArray(obj.items)) throw new Error();
      items = uniqByWord(obj.items);
      trash = Array.isArray(obj.trash) ? obj.trash : [];
      meta = { ...meta, tutorialDone: meta.tutorialDone };
      saveAll();
      renderChips(); renderList(); renderTrash();
      toast("インポート完了。");
    }catch{
      toast("形式が合ってなさそう。");
    }
  });

  $("#backupBtn").addEventListener("click", ()=>{
    // 直前バックアップを保存しておく（自動）
    if (meta.backup){
      const ok = confirm("バックアップに戻す？（今の状態は取り消しに入る）");
      if (!ok) return;
      meta.lastUndo = { items: structuredClone(items), trash: structuredClone(trash) };
      items = structuredClone(meta.backup.items);
      trash = structuredClone(meta.backup.trash);
      saveAll();
      renderChips(); renderList(); renderTrash();
      updateUndoBtn();
      toast("復元した。");
      return;
    }
    // 今の状態をバックアップ化
    meta.backup = { items: structuredClone(items), trash: structuredClone(trash), at: now() };
    saveAll();
    toast("バックアップを保存した。");
  });

  $("#undoBtn").addEventListener("click", ()=>{
    if (!meta.lastUndo) return;
    const tmp = { items: structuredClone(items), trash: structuredClone(trash) };
    items = structuredClone(meta.lastUndo.items);
    trash = structuredClone(meta.lastUndo.trash);
    meta.lastUndo = tmp; // swap
    saveAll();
    renderChips(); renderList(); renderTrash();
    updateUndoBtn();
    toast("取り消した。");
  });

  // move all to trash (safe)
  $("#moveAllToTrash").addEventListener("click", ()=>{
    if (items.length === 0) return;
    const ok = confirm("全消去（ゴミ箱へ）に進む？（復元できる）");
    if (!ok) return;
    moveToTrash(items.map(it=>it.id), "all");
  });

  // empty trash (long press)
  longPress($("#emptyTrash"), 900, ()=>{
    if (trash.length === 0) return;
    const ok = confirm("ゴミ箱を空にする？（完全削除）");
    if (!ok) return;
    meta.lastUndo = { items: structuredClone(items), trash: structuredClone(trash) };
    trash = [];
    saveAll();
    renderTrash();
    updateUndoBtn();
    toast("ゴミ箱を空にした。");
  });

  updateUndoBtn();
}

function updateUndoBtn(){
  $("#undoBtn").disabled = !meta.lastUndo;
}

function moveToTrash(ids, reason){
  meta.lastUndo = { items: structuredClone(items), trash: structuredClone(trash) };
  meta.backup = { items: structuredClone(items), trash: structuredClone(trash), at: now() };

  const move = new Set(ids);
  const keep = [];
  const moved = [];
  for (const it of items){
    if (move.has(it.id)){
      moved.push({ ...it, trashedAt: now() });
    }else{
      keep.push(it);
    }
  }
  items = keep;
  trash = [...moved, ...trash];

  saveAll();
  renderChips(); renderList(); renderTrash();
  updateUndoBtn();
  toast(reason === "all" ? "ゴミ箱へ移動した。" : "移動した。");
}

function renderTrash(){
  $("#trashEmpty").textContent = trash.length ? "" : "ゴミ箱は空。";

  $("#trashList").innerHTML = trash.slice(0, 120).map(it => {
    return `
      <div class="item">
        <div class="item-top">
          <div>
            <div class="word">${escapeHtml(it.word)}</div>
            <div class="meta2">${hasText(it.ja) ? escapeHtml(it.ja) : `<span class="muted">（和訳なし）</span>`}</div>
            <div class="meta2">削除 ${escapeHtml(fmtDate(it.trashedAt || it.updatedAt || it.createdAt))}</div>
          </div>
          <button class="btn" data-restore="${escapeHtml(it.id)}" type="button">復元</button>
        </div>
      </div>
    `;
  }).join("");

  $$("[data-restore]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-restore");
      restoreOne(id);
    });
  });
}

function restoreOne(id){
  meta.lastUndo = { items: structuredClone(items), trash: structuredClone(trash) };
  const keepTrash = [];
  let restored = null;
  for (const it of trash){
    if (it.id === id) restored = it;
    else keepTrash.push(it);
  }
  if (!restored) return;
  trash = keepTrash;
  items = uniqByWord([restored, ...items]);
  saveAll();
  renderChips(); renderList(); renderTrash();
  updateUndoBtn();
  toast("復元した。");
}

function longPress(el, ms, fn){
  let timer = null;
  const start = () => {
    timer = setTimeout(()=>{
      timer = null;
      fn();
    }, ms);
  };
  const cancel = () => {
    if (timer){ clearTimeout(timer); timer = null; }
  };
  el.addEventListener("touchstart", start, {passive:true});
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", cancel);
  el.addEventListener("mouseleave", cancel);
}

function toast(msg){
  // 軽量：alertより邪魔しない
  const d = document.createElement("div");
  d.textContent = msg;
  d.style.position="fixed";
  d.style.left="50%";
  d.style.bottom="18px";
  d.style.transform="translateX(-50%)";
  d.style.background="rgba(0,0,0,.82)";
  d.style.color="#fff";
  d.style.padding="10px 12px";
  d.style.borderRadius="12px";
  d.style.fontWeight="800";
  d.style.fontSize="13px";
  d.style.zIndex="999";
  document.body.appendChild(d);
  setTimeout(()=>d.remove(), 1300);
}

/* ---------- flash ---------- */
function bindFlash(){
  $("#exitFlash").addEventListener("click", ()=>{
    $("#flashStage").hidden = true;
    showView("list");
  });

  $("#shuffleFlash").addEventListener("click", ()=>{
    // toggle shuffle by rebuilding deck later
    toast("次の開始からシャッフル。");
    meta.flashShuffle = !meta.flashShuffle;
    saveAll();
  });

  $("#startFlash").addEventListener("click", ()=>{
    buildFlashDeck();
    if (flashDeck.length === 0){
      $("#flashEmpty").hidden = false;
      $("#flashStage").hidden = true;
      return;
    }
    $("#flashEmpty").hidden = true;
    $("#flashStage").hidden = false;
    flashIdx = 0;
    flashRevealed = false;
    showFlashCard();
  });

  $("#reveal").addEventListener("click", ()=>{
    revealAnswer();
  });

  $("#next").addEventListener("click", ()=>{
    // reveal then rate
    if (!flashRevealed){
      revealAnswer();
      return;
    }
    // if rated already -> move next
    if ($("#rateBox").hidden === false){
      toast("評価を押す。");
      return;
    }
    goNextFlash();
  });

  $("#rateBox").addEventListener("click", (e)=>{
    const btn = e.target.closest("[data-rate]");
    if (!btn) return;
    const rate = Number(btn.getAttribute("data-rate"));
    rateFlash(rate);
  });
}

function renderFlashReady(){
  // show empty if no items
  $("#flashEmpty").hidden = items.length !== 0;
  $("#flashStage").hidden = true;
}

function buildFlashDeck(){
  const count = Number($("#flashCount").value || 20);
  const filter = $("#flashFilter").value;

  let base = items.slice();
  if (filter !== "all"){
    const lvl = Number(filter);
    base = base.filter(it => (it.level ?? 0) === lvl);
  }

  // optional shuffle
  if (meta.flashShuffle){
    base = shuffle(base);
  }else{
    // stable: low level first
    base.sort((a,b)=> (a.level??0) - (b.level??0) || (b.updatedAt??0) - (a.updatedAt??0));
  }

  flashDeck = base.slice(0, count).map(it => it.id);
}

function showFlashCard(){
  const total = flashDeck.length;
  $("#flashProgress").textContent = `${flashIdx+1} / ${total}`;

  const it = items.find(x => x.id === flashDeck[flashIdx]);
  if (!it){
    goNextFlash();
    return;
  }

  $("#flashWord").textContent = it.word;
  $("#flashJa").textContent = it.ja || "（和訳 取得中 / 未取得）";
  $("#flashDef").textContent = it.def || "—";

  $("#flashAnswer").hidden = true;
  $("#rateBox").hidden = true;
  $("#flashHint").textContent = "答えを出すと評価ボタンが出る。";
  flashRevealed = false;
}

function revealAnswer(){
  $("#flashAnswer").hidden = false;
  $("#rateBox").hidden = false;
  flashRevealed = true;
  $("#flashHint").textContent = "評価を押すと次へ進む。";
}

function rateFlash(level){
  const it = items.find(x => x.id === flashDeck[flashIdx]);
  if (it){
    it.level = level;
    it.updatedAt = now();
    saveAll();
    renderChips();
    renderList();
  }
  goNextFlash();
}

function goNextFlash(){
  flashIdx++;
  if (flashIdx >= flashDeck.length){
    $("#flashStage").hidden = true;
    toast("終了。");
    showView("list");
    return;
  }
  showFlashCard();
}

function shuffle(arr){
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

/* ---------- tutorial (swipe) ---------- */
function bindTutorial(){
  // overlay close by outside tap
  $("#tutOverlay").addEventListener("click", (e)=>{
    if (e.target.id === "tutOverlay") closeTutorial();
  });

  $("#tutSkip").addEventListener("click", ()=>{
    meta.tutorialDone = true;
    saveAll();
    closeTutorial();
  });

  $("#tutPrev").addEventListener("click", ()=>tutMove(-1));
  $("#tutNext").addEventListener("click", ()=>tutMove(+1));

  // dots
  renderTutDots();
  $("#tutRail").addEventListener("scroll", ()=>syncTutDots(), {passive:true});
}

function ensureFirstOpenTutorial(){
  if (!meta.tutorialDone){
    openTutorial(false);
  }
}

function openTutorial(fromButton){
  $("#tutOverlay").hidden = false;
  // reset to first page when opened from button
  if (fromButton){
    $("#tutRail").scrollTo({left:0, behavior:"instant"});
    syncTutDots();
  }
}
function closeTutorial(){
  $("#tutOverlay").hidden = true;
}

function renderTutDots(){
  const pages = $$("#tutRail .tut-page").length;
  const dots = [];
  for (let i=0;i<pages;i++){
    dots.push(`<span class="dot ${i===0?"on":""}" data-dot="${i}"></span>`);
  }
  $("#tutDots").innerHTML = dots.join("");
}

function currentTutIndex(){
  const rail = $("#tutRail");
  const w = rail.clientWidth;
  const idx = Math.round(rail.scrollLeft / w);
  return Math.max(0, idx);
}

function tutMove(dir){
  const rail = $("#tutRail");
  const pages = $$("#tutRail .tut-page").length;
  const w = rail.clientWidth;
  let idx = currentTutIndex() + dir;
  idx = Math.max(0, Math.min(pages-1, idx));
  rail.scrollTo({left: idx*w, behavior:"smooth"});

  // final page next -> complete
  if (idx === pages-1){
    $("#tutNext").textContent = "完了";
    $("#tutNext").onclick = ()=>{
      meta.tutorialDone = true;
      saveAll();
      closeTutorial();
      $("#tutNext").onclick = ()=>tutMove(+1); // restore
      $("#tutNext").textContent = "次へ";
    };
  }else{
    $("#tutNext").textContent = "次へ";
    $("#tutNext").onclick = ()=>tutMove(+1);
  }
  syncTutDots();
}

function syncTutDots(){
  const idx = currentTutIndex();
  $$("#tutDots .dot").forEach((d,i)=>{
    d.classList.toggle("on", i===idx);
  });
  $("#tutPrev").disabled = (idx === 0);
}

/* ---------- quick fixes for “dead buttons” ---------- */
/* ここは重要：overlayやscrollでタップが拾えない事故を潰す */
document.addEventListener("touchstart", ()=>{}, {passive:true});
