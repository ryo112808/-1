(() => {
  "use strict";

  const KEY = "tango_plus_v2_data";
  const TRASH_KEY = "tango_plus_v2_trash";
  const THEME_KEY = "tango_plus_v2_theme";
  const TOUR_SEEN = "tango_plus_v2_tour_seen";

  const $ = (id) => document.getElementById(id);

  const safeOn = (el, ev, fn) => {
    if (!el) return;
    el.addEventListener(ev, (e) => {
      try { fn(e); } catch (err) { console.error(err); toast("内部エラー：再読み込みして"); }
    }, { passive: false });
  };

  const toast = (msg) => {
    // 超軽量トースト
    let t = document.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      t.style.position = "fixed";
      t.style.left = "12px";
      t.style.right = "12px";
      t.style.bottom = "16px";
      t.style.zIndex = "1000";
      t.style.padding = "12px 14px";
      t.style.borderRadius = "14px";
      t.style.fontWeight = "800";
      t.style.border = "1px solid var(--line)";
      t.style.background = "var(--card)";
      t.style.boxShadow = "var(--shadow)";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(t._tm);
    t.showing = true;
    t._tm = setTimeout(() => (t.style.display = "none"), 1800);
  };

  const load = (k, def) => {
    try {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : def;
    } catch {
      return def;
    }
  };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // ---- state
  let data = load(KEY, []);
  let trash = load(TRASH_KEY, []);
  let filter = "";
  let currentView = "list";

  // flash state
  let deck = [];
  let idx = 0;
  let revealed = false;

  // ---- theme
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0f1116" : "#ffffff");
  }
  function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") setTheme(stored);
    else setTheme("light");
  }

  // ---- normalize
  function normWord(w) {
    return (w || "").trim().toLowerCase().replace(/[^a-z'-]/g, "");
  }
  function splitWords(text) {
    return (text || "")
      .split(/[\s,]+/)
      .map(normWord)
      .filter(Boolean);
  }

  // ---- api: Japanese translation (free public: MyMemory)
  async function fetchJa(word) {
    // MyMemory is rate-limited; failure is acceptable.
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ja`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("net");
    const j = await res.json();
    const out = (j?.responseData?.translatedText || "").trim();
    if (!out) throw new Error("empty");
    return out;
  }

  // ---- UI helpers
  function showView(name) {
    currentView = name;
    const views = ["viewList", "viewFlash", "viewManage"];
    for (const v of views) {
      const el = $(v);
      if (el) el.hidden = (v !== `view${name[0].toUpperCase()}${name.slice(1)}`);
    }
  }

  function setChips() {
    const chips = $("statusChips");
    if (!chips) return;

    const total = data.length;
    const jaMissing = data.filter(x => !x.ja).length;

    chips.innerHTML = "";
    const mk = (txt) => {
      const d = document.createElement("div");
      d.className = "chip";
      d.textContent = txt;
      chips.appendChild(d);
    };
    mk(`単語：${total}`);
    mk(`和訳未取得：${jaMissing}`);
  }

  function match(item, q) {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      (item.w || "").includes(s) ||
      (item.ja || "").toLowerCase().includes(s) ||
      (item.memo || "").toLowerCase().includes(s) ||
      (item.tags || []).join(" ").toLowerCase().includes(s)
    );
  }

  function renderList() {
    const list = $("list");
    const empty = $("listEmpty");
    if (!list || !empty) return;

    const q = filter.trim().toLowerCase();
    const items = data.filter(x => match(x, q));

    list.innerHTML = "";
    empty.hidden = items.length !== 0;

    for (const it of items) {
      const card = document.createElement("div");
      card.className = "item";
      card.dataset.word = it.w;

      const top = document.createElement("div");
      top.className = "item-top";

      const w = document.createElement("div");
      w.className = "word";
      w.textContent = it.w;

      const b = document.createElement("div");
      b.className = "badge";
      b.textContent = `暗記度 ${it.rate ?? 0}`;

      top.appendChild(w);
      top.appendChild(b);

      const ja = document.createElement("div");
      ja.className = "item-ja";
      ja.textContent = it.ja ? it.ja : "（和訳 未取得）";

      card.appendChild(top);
      card.appendChild(ja);

      // tap -> simple detail edit (prompt)
      safeOn(card, "click", () => {
        const memo = prompt("メモ（空で削除）", it.memo || "");
        if (memo === null) return;
        it.memo = memo.trim();
        save(KEY, data);
        renderList();
      });

      list.appendChild(card);
    }
  }

  // ---- paste modal
  function openModal(id) { const m = $(id); if (m) m.hidden = false; }
  function closeModal(id) { const m = $(id); if (m) m.hidden = true; }

  async function addWords(words) {
    if (!words.length) return;

    // dedupe
    const existing = new Set(data.map(x => x.w));
    const added = [];
    for (const w of words) {
      if (existing.has(w)) continue;
      const item = { w, ja: "", memo: "", tags: [], rate: 0 };
      data.unshift(item);
      existing.add(w);
      added.push(item);
    }
    save(KEY, data);
    setChips();
    renderList();

    if (!added.length) { toast("追加済み"); return; }
    toast(`追加：${added.length}`);

    // fetch ja sequentially (lightweight)
    for (const it of added) {
      try {
        it.ja = await fetchJa(it.w);
      } catch {
        // leave empty, do not freeze
      }
      save(KEY, data);
      // minimal re-render every few items
    }
    setChips();
    renderList();
    toast("和訳の取得が終わった");
  }

  // ---- flash
  function buildDeck(count, shuffle) {
    const src = data.slice(); // copy
    if (!src.length) return [];

    const pool = shuffle ? shuffleArr(src) : src;
    const n = Math.min(Number(count) || 20, pool.length);
    return pool.slice(0, n);
  }
  function shuffleArr(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function flashResetUI() {
    const stage = $("flashStage");
    const empty = $("flashEmpty");
    const done = $("flashDone");
    if (stage) stage.hidden = true;
    if (empty) empty.hidden = true;
    if (done) done.hidden = true;
  }

  function flashShowCard() {
    const stage = $("flashStage");
    const empty = $("flashEmpty");
    const done = $("flashDone");
    const prog = $("flashProgress");
    const word = $("flashWord");
    const ans = $("flashAnswer");
    const ja = $("flashJa");

    if (!stage || !empty || !done || !prog || !word || !ans || !ja) return;

    if (!deck.length) {
      stage.hidden = true;
      done.hidden = true;
      empty.hidden = false;
      return;
    }
    if (idx >= deck.length) {
      stage.hidden = true;
      empty.hidden = true;
      done.hidden = false;
      return;
    }

    revealed = false;
    ans.hidden = true;

    const it = deck[idx];
    prog.textContent = `${idx + 1} / ${deck.length}`;
    word.textContent = it.w;
    ja.textContent = it.ja ? it.ja : "（和訳 未取得）";

    stage.hidden = false;
    empty.hidden = true;
    done.hidden = true;
  }

  function revealJa() {
    const ans = $("flashAnswer");
    if (!ans) return;
    ans.hidden = false;
    revealed = true;
  }

  function rateFlash(r) {
    if (!deck.length || idx >= deck.length) return;
    // 「答え」見てからだけ評価できる
    if (!revealed) { toast("先に「答え」"); return; }

    const it = deck[idx];
    it.rate = Number(r);

    save(KEY, data);
    idx++;
    flashShowCard();
  }

  function skipFlash() {
    if (!deck.length) return;
    idx++;
    flashShowCard();
  }

  // ---- tour (slide)
  const tourPages = [
    { t: "① 貼って追加", b: "英単語をまとめて貼って「追加」。" },
    { t: "② 和訳が自動で付く", b: "追加後、和訳を順に取得。失敗しても止まらない。" },
    { t: "③ フラッシュで確認", b: "英単語 → 答えで和訳 → 評価で次へ。出題数で終わる。" },
    { t: "④ データを守る", b: "エクスポートでバックアップ。全消去はゴミ箱へ移す方式。" },
  ];
  let tourIdx = 0;

  function tourRender() {
    const card = $("tourCard");
    const dots = $("tourDots");
    const next = $("tourNext");
    const prev = $("tourPrev");
    if (!card || !dots || !next || !prev) return;

    const p = tourPages[tourIdx];
    card.innerHTML = `<div style="font-weight:900;font-size:16px;margin-bottom:6px;">${p.t}</div><div>${p.b}</div>`;

    dots.innerHTML = "";
    for (let i = 0; i < tourPages.length; i++) {
      const d = document.createElement("div");
      d.className = "dot" + (i === tourIdx ? " on" : "");
      dots.appendChild(d);
    }

    prev.disabled = tourIdx === 0;
    next.textContent = (tourIdx === tourPages.length - 1) ? "完了" : "次へ";
  }

  function openTour(firstTime = false) {
    openModal("tourModal");
    tourIdx = 0;
    tourRender();
    if (firstTime) localStorage.setItem(TOUR_SEEN, "1");
  }

  function closeTour() {
    closeModal("tourModal");
  }

  // ---- manage
  function exportData() {
    const box = $("ioBox");
    if (!box) return;
    const payload = { data, trash, v: 2, at: new Date().toISOString() };
    box.value = JSON.stringify(payload, null, 2);
    box.focus();
    box.select();
    toast("エクスポートした");
  }

  function importData() {
    const box = $("ioBox");
    if (!box) return;
    let obj;
    try { obj = JSON.parse(box.value || ""); } catch { toast("JSONが壊れてる"); return; }

    const incoming = Array.isArray(obj?.data) ? obj.data : null;
    if (!incoming) { toast("形式が違う"); return; }

    // merge by word
    const map = new Map(data.map(x => [x.w, x]));
    for (const it of incoming) {
      if (!it?.w) continue;
      const w = normWord(it.w);
      if (!w) continue;
      if (!map.has(w)) {
        map.set(w, { w, ja: it.ja || "", memo: it.memo || "", tags: it.tags || [], rate: it.rate ?? 0 });
      } else {
        // prefer existing; fill blanks
        const cur = map.get(w);
        if (!cur.ja && it.ja) cur.ja = it.ja;
        if (!cur.memo && it.memo) cur.memo = it.memo;
        if (!cur.tags?.length && it.tags?.length) cur.tags = it.tags;
      }
    }
    data = Array.from(map.values());
    save(KEY, data);
    setChips();
    renderList();
    toast("インポートした（マージ）");
  }

  function trashAll() {
    if (!data.length) { toast("空"); return; }
    trash = data.concat(trash);
    data = [];
    save(KEY, data);
    save(TRASH_KEY, trash);
    setChips();
    renderList();
    toast("全消去→ゴミ箱へ");
  }
  function undoTrash() {
    if (!trash.length) { toast("ゴミ箱が空"); return; }
    data = trash.concat(data);
    trash = [];
    save(KEY, data);
    save(TRASH_KEY, trash);
    setChips();
    renderList();
    toast("復元した");
  }

  // ---- SW: update-safe (and recover)
  async function setupSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      // update check
      reg.update?.();
      // force reload when new SW takes over
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // one-time reload
        location.reload();
      });
    } catch (e) {
      console.warn("SW failed", e);
    }
  }

  // ---- boot
  function boot() {
    initTheme();
    setChips();
    renderList();
    showView("list");

    // bind: top actions
    safeOn($("themeBtn"), "click", () => {
      const cur = document.documentElement.dataset.theme || "light";
      setTheme(cur === "light" ? "dark" : "light");
    });
    safeOn($("helpBtn"), "click", () => openTour(false));

    // search
    safeOn($("search"), "input", (e) => {
      filter = e.target.value || "";
      renderList();
    });
    safeOn($("clearSearch"), "click", () => {
      const s = $("search");
      if (s) s.value = "";
      filter = "";
      renderList();
    });

    // navigation
    safeOn($("toList"), "click", () => showView("list"));
    safeOn($("toFlash"), "click", () => { showView("flash"); });
    safeOn($("toManage"), "click", () => showView("manage"));

    // paste modal
    safeOn($("openPaste"), "click", () => openModal("pasteModal"));
    safeOn($("pasteClose"), "click", () => closeModal("pasteModal"));
    safeOn($("pasteX"), "click", () => closeModal("pasteModal"));
    safeOn($("pasteClear"), "click", () => { const b = $("pasteBox"); if (b) b.value = ""; });
    safeOn($("pasteAdd"), "click", async () => {
      const b = $("pasteBox");
      const words = splitWords(b?.value || "");
      await addWords(words);
      closeModal("pasteModal");
      if (b) b.value = "";
    });

    // flash controls
    safeOn($("exitFlash"), "click", () => {
      flashResetUI();
      showView("list");
    });
    safeOn($("startFlash"), "click", () => {
      flashResetUI();
      const cnt = $("flashCount")?.value || "20";
      const sh = $("flashShuffle")?.checked ?? true;
      deck = buildDeck(cnt, sh);
      idx = 0;
      flashShowCard();
    });
    safeOn($("revealAnswer"), "click", () => revealJa());
    safeOn($("skipCard"), "click", () => skipFlash());
    safeOn($("backToTop"), "click", () => { flashResetUI(); showView("list"); });

    // rate buttons (event delegation)
    const flashView = $("viewFlash");
    safeOn(flashView, "click", (e) => {
      const btn = e.target?.closest?.(".rate");
      if (!btn) return;
      const r = btn.getAttribute("data-rate");
      rateFlash(r);
    });

    // manage
    safeOn($("exportBtn"), "click", exportData);
    safeOn($("importBtn"), "click", importData);
    safeOn($("trashAllBtn"), "click", trashAll);
    safeOn($("undoBtn"), "click", undoTrash);

    // tour modal bind (重要：ここがズレると全ボタン死ぬ)
    safeOn($("tourClose"), "click", closeTour);
    safeOn($("tourSkip"), "click", () => { localStorage.setItem(TOUR_SEEN, "1"); closeTour(); });
    safeOn($("tourPrev"), "click", () => { tourIdx = Math.max(0, tourIdx - 1); tourRender(); });
    safeOn($("tourNext"), "click", () => {
      if (tourIdx >= tourPages.length - 1) { localStorage.setItem(TOUR_SEEN, "1"); closeTour(); return; }
      tourIdx++; tourRender();
    });

    // first time tour
    if (!localStorage.getItem(TOUR_SEEN)) {
      openTour(true);
    }

    // SW last
    setupSW();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
