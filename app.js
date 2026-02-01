/* 単語plus - stable build (no deadline concept, no page navigation) */

const STORE_KEY = "tango_plus_items_v3";
const TRASH_KEY = "tango_plus_trash_v1";
const THEME_KEY = "tango_plus_theme_v1";
const TUTO_KEY  = "tango_plus_tuto_done_v1";
const FLASH_PREF_KEY = "tango_plus_flash_pref_v1";

const $ = (id) => document.getElementById(id);

const ui = {
  themeBtn: $("themeBtn"),
  helpBtn: $("helpBtn"),

  bulkInput: $("bulkInput"),
  addBtn: $("addBtn"),
  exportBtn: $("exportBtn"),
  importBtn: $("importBtn"),
  openTrashBtn: $("openTrashBtn"),

  searchInput: $("searchInput"),
  refreshMissingBtn: $("refreshMissingBtn"),
  flashStartBtn: $("flashStartBtn"),
  pickCountBtn: $("pickCountBtn"),
  countLabel: $("countLabel"),
  shuffleBtn: $("shuffleBtn"),
  shuffleLabel: $("shuffleLabel"),
  statusLine: $("statusLine"),
  list: $("list"),

  // focus
  focus: $("focus"),
  exitFocusBtn: $("exitFocusBtn"),
  focusProgress: $("focusProgress"),
  focusWord: $("focusWord"),
  focusPhonetic: $("focusPhonetic"),
  showAnswerBtn: $("showAnswerBtn"),
  focusAnswer: $("focusAnswer"),
  focusJa: $("focusJa"),
  focusEn: $("focusEn"),
  rateGrid: $("rateGrid"),
  focusDone: $("focusDone"),
  doneLine: $("doneLine"),
  doneAgainBtn: $("doneAgainBtn"),
  doneCloseBtn: $("doneCloseBtn"),

  // tutorial
  tutorial: $("tutorial"),
  skipTutoBtn: $("skipTutoBtn"),
  prevTutoBtn: $("prevTutoBtn"),
  nextTutoBtn: $("nextTutoBtn"),
  tutoTrack: $("tutoTrack"),
  tutoDots: $("tutoDots"),
  tutoViewport: $("tutoViewport"),

  // toast
  toast: $("toast"),
};

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function loadItems() {
  return safeJsonParse(localStorage.getItem(STORE_KEY) || "[]", []);
}
function saveItems(items) {
  localStorage.setItem(STORE_KEY, JSON.stringify(items));
}
function loadTrash() {
  return safeJsonParse(localStorage.getItem(TRASH_KEY) || "[]", []);
}
function saveTrash(trash) {
  localStorage.setItem(TRASH_KEY, JSON.stringify(trash));
}

let items = loadItems();   // {id, word, phonetic, en, ja, rate, createdAt, updatedAt}
let trash = loadTrash();   // same shape
let flashPref = safeJsonParse(localStorage.getItem(FLASH_PREF_KEY) || "{}", { count: 20, shuffle: true });

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast.hidden = true), 1400);
}

/* ---------------- Theme ---------------- */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
  ui.themeBtn.textContent = (t === "dark") ? "ダーク" : "ライト";
}
(function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  const t = (saved === "dark" || saved === "light") ? saved : "light";
  setTheme(t);
})();

ui.themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || "light";
  setTheme(cur === "light" ? "dark" : "light");
});

/* ---------------- Utils ---------------- */
function normalizeWord(w) {
  return (w || "").toString().trim().toLowerCase().replace(/[^a-z'-]/g, "");
}
function uniq(arr) {
  return [...new Set(arr)];
}
function now() { return Date.now(); }
function makeId() { return String(Date.now()) + "_" + Math.random().toString(16).slice(2); }

function summarizeStatus() {
  const total = items.length;
  const ready = items.filter(x => x.ja && x.ja.trim().length > 0).length;
  const missing = total - ready;
  ui.statusLine.textContent = `単語：${total}　準備：${ready}　未準備：${missing}`;
}

/* ---------------- Lookup (EN) ----------------
   dictionaryapi.dev (no key)
*/
async function lookupEn(word) {
  const url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word);
  const res = await fetch(url);
  if (!res.ok) throw new Error("en_not_found");
  const data = await res.json();
  const entry = data?.[0];

  const phonetic = entry?.phonetic || entry?.phonetics?.find(p => p?.text)?.text || "";
  // take up to 2 definitions across first meaning
  const meanings = entry?.meanings || [];
  const defs = [];
  for (const m of meanings) {
    const ds = (m?.definitions || []).slice(0, 2).map(d => d?.definition).filter(Boolean);
    defs.push(...ds);
    if (defs.length >= 2) break;
  }
  const en = defs.slice(0,2).join(" / ");
  return { phonetic, en };
}

/* ---------------- Translate (EN->JA) ----------------
   MyMemory (free, no key). Rate limits exist; we queue.
*/
async function translateJa(textEn) {
  const q = encodeURIComponent(textEn);
  const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|ja`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("ja_fail");
  const data = await res.json();
  const ja = data?.responseData?.translatedText || "";
  return (ja || "").toString().trim();
}

/* ---------------- Fetch Queue (speed + stability) ---------------- */
let queue = [];
let running = 0;
const CONCURRENCY = 3;

function enqueueFetch(id) {
  if (queue.includes(id)) return;
  queue.push(id);
  pumpQueue();
  render();
}

function pumpQueue() {
  while (running < CONCURRENCY && queue.length > 0) {
    const id = queue.shift();
    const it = items.find(x => x.id === id);
    if (!it) continue;
    if (it.ja && it.ja.trim()) continue;

    running++;
    fetchAllForItem(it).finally(() => {
      running--;
      pumpQueue();
      render();
    });
  }
}

async function fetchAllForItem(it) {
  try {
    it.updatedAt = now();
    saveItems(items);
    const { phonetic, en } = await lookupEn(it.word);
    it.phonetic = phonetic || "";
    it.en = en || "";
    saveItems(items);

    // Always attach JA as the "answer" (requested)
    if (it.en && it.en.trim()) {
      const ja = await translateJa(it.en);
      it.ja = ja || "";
    } else {
      it.ja = "";
    }

    it.updatedAt = now();
    saveItems(items);
  } catch (e) {
    // Keep as "未準備" and allow retry
    it.updatedAt = now();
    saveItems(items);
  }
}

/* ---------------- Rendering ---------------- */
function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

function render() {
  summarizeStatus();

  const q = (ui.searchInput.value || "").toLowerCase().trim();
  const filtered = !q ? items : items.filter(it => {
    const hay = `${it.word} ${it.ja||""} ${it.en||""}`.toLowerCase();
    return hay.includes(q);
  });

  ui.list.innerHTML = "";

  if (filtered.length === 0) {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `<div class="muted">まだ何もない（または検索に一致しない）</div>`;
    ui.list.appendChild(li);
    return;
  }

  for (const it of filtered) {
    const ready = !!(it.ja && it.ja.trim());
    const badge = ready
      ? `<span class="badge ok">✓ 準備</span>`
      : `<span class="badge ng">× 未準備</span>`;

    const rateText = ["未習得","不確か","習得","定着"][Number(it.rate ?? 0)] || "未習得";
    const rateBadge = `<span class="badge">${escapeHtml(rateText)}</span>`;

    const phon = it.phonetic ? `<span class="badge">${escapeHtml(it.phonetic)}</span>` : "";

    const jaBlock = ready ? `<div class="ja">${escapeHtml(it.ja)}</div>` : `<div class="ja muted">和訳を準備中（再取得もOK）</div>`;
    const enBlock = it.en ? `<div class="en">${escapeHtml(it.en)}</div>` : "";

    const row = document.createElement("li");
    row.className = "item";
    row.innerHTML = `
      <div class="item-top">
        <div>
          <div class="word">${escapeHtml(it.word)}</div>
          <div class="subline">${badge}${rateBadge}${phon}</div>
        </div>
        <div class="subline" style="justify-content:flex-end">
          <button class="chip" data-retry="${it.id}" type="button">再取得</button>
          <button class="chip" data-del="${it.id}" type="button">削除</button>
        </div>
      </div>
      ${jaBlock}
      ${enBlock}
      <div class="item-actions">
        <button class="btn" data-rate="${it.id}" data-val="0" type="button">未習得</button>
        <button class="btn" data-rate="${it.id}" data-val="1" type="button">不確か</button>
        <button class="btn" data-rate="${it.id}" data-val="2" type="button">習得</button>
        <button class="btn" data-rate="${it.id}" data-val="3" type="button">定着</button>
      </div>
    `;
    ui.list.appendChild(row);
  }

  // bind actions
  ui.list.querySelectorAll("[data-retry]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-retry");
      const it = items.find(x => x.id === id);
      if (!it) return;
      it.ja = "";
      it.en = it.en || "";
      saveItems(items);
      enqueueFetch(id);
      toast("再取得を開始");
    });
  });

  ui.list.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      const it = items.find(x => x.id === id);
      if (!it) return;

      // move to trash
      items = items.filter(x => x.id !== id);
      it.deletedAt = now();
      trash.unshift(it);
      saveItems(items);
      saveTrash(trash);
      render();
      toast("ゴミ箱へ移動");
    });
  });

  ui.list.querySelectorAll("[data-rate]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-rate");
      const val = Number(btn.getAttribute("data-val"));
      const it = items.find(x => x.id === id);
      if (!it) return;
      it.rate = val;
      it.updatedAt = now();
      saveItems(items);
      render();
      toast("暗記度を更新");
    });
  });

  // update flash labels
  ui.countLabel.textContent = String(flashPref.count || 20);
  ui.shuffleLabel.textContent = (flashPref.shuffle ? "ON" : "OFF");
}

/* ---------------- Bulk Add ---------------- */
function parseBulk(text) {
  const raw = (text || "").split(/\s+/).map(normalizeWord).filter(Boolean);
  return uniq(raw).filter(w => w.length >= 2);
}

ui.addBtn.addEventListener("click", () => {
  const words = parseBulk(ui.bulkInput.value);
  ui.bulkInput.value = "";

  let added = 0;
  for (const w of words) {
    if (items.some(x => x.word === w)) continue;
    const it = {
      id: makeId(),
      word: w,
      phonetic: "",
      en: "",
      ja: "",
      rate: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    items.unshift(it);
    added++;
    enqueueFetch(it.id);
  }

  saveItems(items);
  render();
  if (added > 0) toast(`${added}語追加`);
  else toast("追加なし（重複はまとめた）");
});

ui.bulkInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) ui.addBtn.click();
});

ui.searchInput.addEventListener("input", render);

/* ---------------- Retry Missing ---------------- */
ui.refreshMissingBtn.addEventListener("click", () => {
  const missing = items.filter(x => !(x.ja && x.ja.trim())).slice(0, 80); // cap
  missing.forEach(it => enqueueFetch(it.id));
  toast("未準備を再取得");
});

/* ---------------- Backup / Restore ---------------- */
ui.exportBtn.addEventListener("click", async () => {
  const payload = JSON.stringify({ items, trash, flashPref }, null, 0);
  try {
    await navigator.clipboard.writeText(payload);
    toast("バックアップをコピー");
  } catch {
    window.prompt("これをコピーして保存:", payload);
  }
});

ui.importBtn.addEventListener("click", () => {
  const txt = window.prompt("バックアップ文字列を貼り付け:");
  if (!txt) return;
  const obj = safeJsonParse(txt, null);
  if (!obj || !Array.isArray(obj.items)) {
    toast("形式が合わない");
    return;
  }
  items = obj.items;
  trash = Array.isArray(obj.trash) ? obj.trash : [];
  flashPref = obj.flashPref || flashPref;

  saveItems(items);
  saveTrash(trash);
  localStorage.setItem(FLASH_PREF_KEY, JSON.stringify(flashPref));
  render();
  toast("復元完了");
});

/* ---------------- Trash ---------------- */
ui.openTrashBtn.addEventListener("click", () => {
  if (trash.length === 0) { toast("ゴミ箱は空"); return; }

  const lines = trash.slice(0, 50).map((t, i) => `${i+1}. ${t.word}`).join("\n");
  const pick = window.prompt(
    "ゴミ箱（復元する番号 / 'all'で全復元 / 空で閉じる）\n\n" + lines
  );
  if (!pick) return;

  if (pick.trim().toLowerCase() === "all") {
    // restore all
    for (const t of trash) {
      delete t.deletedAt;
      items.unshift(t);
    }
    trash = [];
    saveItems(items);
    saveTrash(trash);
    render();
    toast("全復元");
    return;
  }

  const n = Number(pick);
  if (!Number.isFinite(n) || n < 1 || n > trash.length) { toast("番号が合わない"); return; }
  const t = trash.splice(n-1, 1)[0];
  delete t.deletedAt;
  items.unshift(t);
  saveItems(items);
  saveTrash(trash);
  render();
  toast("復元");
});

/* ---------------- Flash (Focus Mode) ---------------- */
let flashDeck = [];
let flashIdx = 0;
let sessionCount = 20;

function buildDeck() {
  const ready = items.filter(x => x.ja && x.ja.trim());
  const pool = flashPref.shuffle ? shuffleArray([...ready]) : [...ready];
  return pool.slice(0, sessionCount);
}

function shuffleArray(a) {
  for (let i=a.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function openFocus() {
  ui.focus.hidden = false;
  ui.focusDone.hidden = true;
  ui.focusAnswer.hidden = true;
  ui.showAnswerBtn.hidden = false;
}

function closeFocus() {
  ui.focus.hidden = true;
}

function showCard() {
  const it = flashDeck[flashIdx];
  ui.focusProgress.textContent = `${flashIdx+1} / ${flashDeck.length}`;
  ui.focusWord.textContent = it.word;
  ui.focusPhonetic.textContent = it.phonetic || "";
  ui.focusJa.textContent = "";
  ui.focusEn.textContent = "";
  ui.focusAnswer.hidden = true;
  ui.showAnswerBtn.hidden = false;
}

function showDone() {
  ui.focusDone.hidden = false;
  ui.doneLine.textContent = `${flashDeck.length}語チェック`;
}

ui.pickCountBtn.addEventListener("click", () => {
  const v = window.prompt("出題数（1〜200）", String(flashPref.count || 20));
  if (!v) return;
  const n = Math.max(1, Math.min(200, Number(v)));
  if (!Number.isFinite(n)) return;
  flashPref.count = n;
  localStorage.setItem(FLASH_PREF_KEY, JSON.stringify(flashPref));
  render();
  toast("出題数を更新");
});

ui.shuffleBtn.addEventListener("click", () => {
  flashPref.shuffle = !flashPref.shuffle;
  localStorage.setItem(FLASH_PREF_KEY, JSON.stringify(flashPref));
  render();
  toast("シャッフルを更新");
});

ui.flashStartBtn.addEventListener("click", () => {
  sessionCount = Number(flashPref.count || 20);
  flashDeck = buildDeck();

  if (flashDeck.length === 0) {
    toast("和訳つき単語がまだない");
    return;
  }
  flashIdx = 0;
  openFocus();
  showCard();
});

ui.exitFocusBtn.addEventListener("click", closeFocus);
ui.doneCloseBtn.addEventListener("click", closeFocus);

ui.doneAgainBtn.addEventListener("click", () => {
  sessionCount = Number(flashPref.count || 20);
  flashDeck = buildDeck();
  flashIdx = 0;
  ui.focusDone.hidden = true;
  openFocus();
  showCard();
});

ui.showAnswerBtn.addEventListener("click", () => {
  const it = flashDeck[flashIdx];
  ui.focusJa.textContent = it.ja || "";
  ui.focusEn.textContent = it.en ? `英: ${it.en}` : "";
  ui.focusAnswer.hidden = false;
  ui.showAnswerBtn.hidden = true;
});

ui.rateGrid.querySelectorAll("button[data-rate]").forEach(btn => {
  btn.addEventListener("click", () => {
    const rate = Number(btn.getAttribute("data-rate"));
    const it = flashDeck[flashIdx];
    if (it) {
      it.rate = rate;
      it.updatedAt = now();
      saveItems(items);
    }
    flashIdx++;
    if (flashIdx >= flashDeck.length) {
      showDone();
    } else {
      showCard();
    }
  });
});

/* ---------------- Tutorial (always escapable) ---------------- */
let slide = 0;

function setSlide(n) {
  slide = Math.max(0, Math.min(3, n));
  ui.tutoTrack.style.transform = `translateX(${-100*slide}%)`;
  const dots = ui.tutoDots.querySelectorAll(".dot");
  dots.forEach((d, i) => d.classList.toggle("on", i === slide));
  ui.prevTutoBtn.disabled = (slide === 0);
  ui.nextTutoBtn.textContent = (slide === 3) ? "閉じる" : "次へ";
}

function openTutorial() {
  ui.tutorial.hidden = false;
  setSlide(0);
}

function closeTutorial(done=true) {
  ui.tutorial.hidden = true;
  if (done) localStorage.setItem(TUTO_KEY, "1");
}

ui.helpBtn.addEventListener("click", openTutorial);
ui.skipTutoBtn.addEventListener("click", () => closeTutorial(true));
ui.prevTutoBtn.addEventListener("click", () => setSlide(slide - 1));
ui.nextTutoBtn.addEventListener("click", () => {
  if (slide === 3) closeTutorial(true);
  else setSlide(slide + 1);
});

// swipe
(function bindSwipe(){
  let startX = null;
  ui.tutoViewport.addEventListener("touchstart", (e) => {
    startX = e.touches?.[0]?.clientX ?? null;
  }, { passive: true });

  ui.tutoViewport.addEventListener("touchend", (e) => {
    const endX = e.changedTouches?.[0]?.clientX ?? null;
    if (startX === null || endX === null) return;
    const dx = endX - startX;
    if (Math.abs(dx) < 35) return;
    if (dx < 0) ui.nextTutoBtn.click();
    else ui.prevTutoBtn.click();
    startX = null;
  }, { passive: true });
})();

/* ---------------- Boot ---------------- */
(function boot(){
  // show tutorial on first open, always escapable
  const done = localStorage.getItem(TUTO_KEY) === "1";
  if (!done) openTutorial();

  // queue fetch for existing missing items (small batch)
  items.slice(0, 50).filter(x => !(x.ja && x.ja.trim())).forEach(x => enqueueFetch(x.id));

  // render
  render();

  // tick queue
  pumpQueue();
})();
