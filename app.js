import {
  KEYS, now, clamp, esc, normWord, splitWords,
  mkItem, loadItems, saveItems, loadBackup, isDue, parseTagQuery
} from "./storage.js";
import { createFetcher } from "./fetch.js";
import { createFlash } from "./flash.js";

// PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

// ===== State =====
let items = loadItems();

// ===== UI refs =====
const tabBtns = [...document.querySelectorAll(".tabBtn")];
const secs = {
  list: document.getElementById("sec_list"),
  paste: document.getElementById("sec_paste"),
  flash: document.getElementById("sec_flash"),
  manage: document.getElementById("sec_manage"),
};

const search = document.getElementById("search");
const clearSearch = document.getElementById("clearSearch");

const sort = document.getElementById("sort");
const levelFilter = document.getElementById("levelFilter");
const scope = document.getElementById("scope");
const pageSize = document.getElementById("pageSize");

const listEl = document.getElementById("list");
const moreBtn = document.getElementById("moreBtn");
const countNow = document.getElementById("countNow");

const pasteArea = document.getElementById("pasteArea");
const bulkAdd = document.getElementById("bulkAdd");
const pasteDemo = document.getElementById("pasteDemo");
const oneWord = document.getElementById("oneWord");
const oneAdd = document.getElementById("oneAdd");

const retryMissing = document.getElementById("retryMissing");
const retryFailed = document.getElementById("retryFailed");

const qWait = document.getElementById("qWait");
const qRun = document.getElementById("qRun");
const qOk = document.getElementById("qOk");
const qFail = document.getElementById("qFail");

const mJa = document.getElementById("mJa");
const mDef = document.getElementById("mDef");
const mSyn = document.getElementById("mSyn");
const mEx = document.getElementById("mEx");

const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const backupBtn = document.getElementById("backupBtn");

const restoreAll = document.getElementById("restoreAll");
const emptyTrashHold = document.getElementById("emptyTrashHold");
const holdHint = document.getElementById("holdHint");
const softClear = document.getElementById("softClear");
const trashList = document.getElementById("trashList");

const kAll = document.getElementById("kAll");
const kTrash = document.getElementById("kTrash");
const kDue = document.getElementById("kDue");

const toastEl = document.getElementById("toast");
const toastMsg = document.getElementById("toastMsg");
const toastSub = document.getElementById("toastSub");
const toastUndo = document.getElementById("toastUndo");
const toastClose = document.getElementById("toastClose");

const ruleSheet = document.getElementById("ruleSheet");
const openRules = document.getElementById("openRules");
const closeRules = document.getElementById("closeRules");

const tutorial = document.getElementById("tutorial");
const tutSkip = document.getElementById("tutSkip");
const tutPrev = document.getElementById("tutPrev");
const tutNext = document.getElementById("tutNext");
const tutPageTitle = document.getElementById("tutPageTitle");
const tutPageBody = document.getElementById("tutPageBody");
const openTutorial = document.getElementById("openTutorial");

// ===== Toast / Undo =====
let undoTimer = 0;
let undoSnapshot = null;

function toast(msg, sub = "", snapshot = null){
  toastMsg.textContent = msg;
  toastSub.textContent = sub;
  undoSnapshot = snapshot;
  toastUndo.style.display = snapshot ? "inline-flex" : "none";
  toastEl.classList.add("show");

  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    toastEl.classList.remove("show");
    undoSnapshot = null;
  }, 10000);
}

toastUndo.addEventListener("click", () => {
  if (!undoSnapshot) return;
  items = undoSnapshot;
  saveItems(items);
  renderAll();
  toastEl.classList.remove("show");
  undoSnapshot = null;
});
toastClose.addEventListener("click", () => {
  toastEl.classList.remove("show");
  undoSnapshot = null;
});

// ===== Helpers =====
const activeItems = () => items.filter(it => !it.deletedAt);
const trashItems = () => items.filter(it => !!it.deletedAt);

function setItems(next){
  items = next;
  saveItems(items);
}

function fieldChip(it, key, label){
  const st = it.fetch?.[key]?.status || "idle";
  const cls = st === "ok" ? "ok" : st === "fail" ? "bad" : st === "pending" ? "wait" : "";
  const text = st === "ok" ? "✓" : st === "fail" ? "×" : st === "pending" ? "…" : "–";
  return `<span class="chip ${cls}"><span class="dot"></span>${label} ${text}</span>`;
}

// ===== Fetcher =====
const fetcher = createFetcher({
  getItems: () => items,
  setItems: (x) => setItems(x),
  onUpdateKPI: () => renderKPIs(),
  toast,
});

// ===== Flash =====
const flash = createFlash({
  getItems: () => items,
  save: () => saveItems(items),
  renderKPIs: () => renderKPIs(),
});

// ===== Tabs =====
function setTab(name){
  tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  Object.entries(secs).forEach(([k,el]) => el.classList.toggle("active", k===name));
  if (name === "flash") flash.rebuild();
  renderAll();
}
tabBtns.forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

// ===== Search / filters =====
let shown = 0;

function applyFilters(list){
  const qraw = (search.value || "").trim().toLowerCase();
  const { tags, plain } = parseTagQuery(qraw);

  let out = list.slice();

  if (levelFilter.value !== "all") out = out.filter(it => String(it.level) === levelFilter.value);
  if (scope.value === "due") out = out.filter(isDue);

  if (tags.length){
    out = out.filter(it => {
      const all = new Set([...(it.tags||[]), ...(it.autoTags||[])]);
      return tags.every(t => all.has(t));
    });
  }

  if (plain){
    out = out.filter(it => {
      const hay = (
        it.word + " " +
        (it.jaText||"") + " " +
        (it.defText||"") + " " +
        (it.synText||"") + " " +
        (it.exText||"") + " " +
        (it.note||"") + " " +
        (it.tags||[]).join(" ") + " " +
        (it.autoTags||[]).join(" ")
      ).toLowerCase();
      return hay.includes(plain);
    });
  }

  if (sort.value === "new") out.sort((a,b)=>b.createdAt-a.createdAt);
  if (sort.value === "old") out.sort((a,b)=>a.createdAt-b.createdAt);
  if (sort.value === "due") out.sort((a,b)=>(a.dueAt||0)-(b.dueAt||0));
  if (sort.value === "az") out.sort((a,b)=>a.word.localeCompare(b.word));

  return out;
}

function renderKPIs(){
  const qs = fetcher.getQueueStats();
  qWait.textContent = qs.waiting;
  qRun.textContent = qs.running;
  qOk.textContent = qs.ok;
  qFail.textContent = qs.fail;

  const a = activeItems();
  let ja=0, def=0, syn=0, ex=0;
  for (const it of a){
    if ((it.jaText||"").trim() === "") ja++;
    if (it.fetch?.def?.status !== "ok") def++;
    if (it.fetch?.syn?.status !== "ok") syn++;
    if (it.fetch?.ex?.status !== "ok") ex++;
  }
  mJa.textContent = ja;
  mDef.textContent = def;
  mSyn.textContent = syn;
  mEx.textContent = ex;

  kAll.textContent = a.length;
  kTrash.textContent = trashItems().length;
  kDue.textContent = a.filter(isDue).length;
}

function renderList(){
  const base = applyFilters(activeItems());
  const size = Number(pageSize.value || 30);
  if (shown === 0) shown = size;

  const slice = base.slice(0, shown);
  countNow.textContent = base.length;

  listEl.innerHTML = "";
  if (!slice.length){
    listEl.innerHTML = `<div class="card"><div class="small">対象が空。</div></div>`;
    moreBtn.style.display = "none";
    return;
  }

  for (const it of slice){
    const dueTxt = isDue(it) ? "期限：いま" : "期限：" + new Date(it.dueAt).toLocaleDateString();
    const err = it.lastError ? `<div class="small" style="margin-top:6px;color:rgba(255,59,48,.9)">失敗理由：${esc(it.lastError)}</div>` : "";

    const tagChips = [...new Set([...(it.autoTags||[]).map(t=>"auto:"+t), ...(it.tags||[]).map(t=>"tag:"+t)])]
      .slice(0, 12)
      .map(t => {
        const label = t.startsWith("auto:") ? t.slice(5) : t.slice(4);
        return `<span class="chip">#${esc(label)}</span>`;
      }).join(" ");

    const html = `
      <div class="card">
        <div class="wordLine">
          <div>
            <div class="word">${esc(it.word)}</div>
            <div class="small">${esc(it.phonetic||"")}　${dueTxt}　/　作成 ${new Date(it.createdAt).toLocaleString()}</div>
          </div>
          <span class="chip"><span class="dot"></span>暗記度 ${it.level}</span>
        </div>

        <div class="meta" style="margin-top:10px">
          ${fieldChip(it,"ja","和訳")}
          ${fieldChip(it,"def","定義")}
          ${fieldChip(it,"syn","類語")}
          ${fieldChip(it,"ex","例文")}
          ${isDue(it) ? `<span class="chip wait"><span class="dot"></span>期限</span>` : ``}
        </div>

        ${err}

        <div style="height:10px"></div>
        <details>
          <summary>詳細 / 編集</summary>
          <div style="margin-top:10px" class="two">
            <div>
              <div class="small">和訳</div>
              <div style="font-weight:900;margin-top:4px">${esc(it.jaText || "—")}</div>

              <div style="height:10px"></div>
              <div class="small">英語定義</div>
              <div style="font-weight:850;margin-top:4px">${esc(it.defText || "—")}</div>

              <div style="height:10px"></div>
              <div class="small">類語</div>
              <div style="font-weight:850;margin-top:4px">${esc(it.synText || "—")}</div>

              <div style="height:10px"></div>
              <div class="small">例文</div>
              <div style="font-weight:850;margin-top:4px">${esc(it.exText || "—")}</div>
            </div>

            <div>
              <div class="small">メモ</div>
              <input data-note="${it.id}" placeholder="メモ（任意）" value="${esc(it.note||"")}" />
              <div style="height:10px"></div>

              <div class="small">タグ（スペース区切り / #なし）</div>
              <input data-tags="${it.id}" placeholder="例：logic contrast" value="${esc((it.tags||[]).join(" "))}" />
              <div style="height:10px"></div>

              <div class="small">暗記度 / 期限</div>
              <div class="row" style="margin-top:6px">
                <select data-lvl="${it.id}">
                  ${[0,1,2,3,4].map(n => `<option value="${n}" ${it.level===n?"selected":""}>暗記度 ${n}</option>`).join("")}
                </select>
                <button class="secondary" data-due="${it.id}">期限を今にする</button>
              </div>

              <div style="height:10px"></div>
              <div class="row">
                <button class="secondary" data-refetch="${it.id}">再取得</button>
                <button class="danger" data-trash="${it.id}">ゴミ箱へ</button>
              </div>

              ${tagChips ? `<div style="height:10px"></div><div class="meta">${tagChips}</div>` : ``}
            </div>
          </div>
        </details>
      </div>
    `;
    const div = document.createElement("div");
    div.innerHTML = html;
    listEl.appendChild(div.firstElementChild);
  }

  moreBtn.style.display = base.length > slice.length ? "block" : "none";

  document.querySelectorAll("[data-note]").forEach(el => {
    el.addEventListener("change", () => {
      const it = items.find(x => x.id === el.getAttribute("data-note"));
      if (!it) return;
      it.note = el.value;
      saveItems(items);
    });
  });

  document.querySelectorAll("[data-tags]").forEach(el => {
    el.addEventListener("change", () => {
      const it = items.find(x => x.id === el.getAttribute("data-tags"));
      if (!it) return;
      const tags = (el.value||"")
        .split(/\s+/).map(t=>t.trim().toLowerCase()).filter(Boolean)
        .map(t=>t.replace(/^#/,""))
        .filter((v,i,a)=>a.indexOf(v)===i)
        .slice(0, 12);
      it.tags = tags;
      saveItems(items);
      renderAll();
    });
  });

  document.querySelectorAll("[data-lvl]").forEach(el => {
    el.addEventListener("change", () => {
      const it = items.find(x => x.id === el.getAttribute("data-lvl"));
      if (!it) return;
      it.level = clamp(Number(el.value||0),0,4);
      saveItems(items);
      renderAll();
    });
  });

  document.querySelectorAll("[data-due]").forEach(btn => {
    btn.addEventListener("click", () => {
      const it = items.find(x => x.id === btn.getAttribute("data-due"));
      if (!it) return;
      it.dueAt = now();
      saveItems(items);
      renderAll();
    });
  });

  document.querySelectorAll("[data-refetch]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-refetch");
      fetcher.enqueueFor(id, ["ja","def","syn","ex"]);
      toast("再取得を開始", "進行は上のカウンタに出る");
    });
  });

  document.querySelectorAll("[data-trash]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-trash");
      const snapshot = JSON.parse(JSON.stringify(items));
      const it = items.find(x=>x.id===id);
      if (!it) return;
      it.deletedAt = now();
      saveItems(items);
      renderAll();
      toast("ゴミ箱へ移動", "10秒以内なら取り消しできる", snapshot);
    });
  });
}

function renderTrash(){
  const tr = trashItems().sort((a,b)=>b.deletedAt-a.deletedAt);
  trashList.innerHTML = "";
  if (!tr.length){
    trashList.innerHTML = `<div class="small">ゴミ箱は空。</div>`;
    return;
  }
  for (const it of tr.slice(0, 80)){
    const el = document.createElement("div");
    el.className = "card";
    el.style.background = "var(--card2)";
    el.style.boxShadow = "none";
    el.innerHTML = `
      <div class="wordLine">
        <div>
          <div class="word">${esc(it.word)}</div>
          <div class="small">削除 ${new Date(it.deletedAt).toLocaleString()}</div>
        </div>
        <button class="secondary" data-restore="${it.id}" style="flex:0 0 auto">復元</button>
      </div>
    `;
    trashList.appendChild(el);
  }
  document.querySelectorAll("[data-restore]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-restore");
      const snapshot = JSON.parse(JSON.stringify(items));
      const it = items.find(x=>x.id===id);
      if (!it) return;
      it.deletedAt = 0;
      saveItems(items);
      renderAll();
      toast("復元", "10秒以内なら取り消しできる", snapshot);
    });
  });
}

function renderAll(){
  renderKPIs();
  renderList();
  renderTrash();
}

// ===== Add / Merge =====
function upsertWords(words){
  const snapshot = JSON.parse(JSON.stringify(items));
  const map = new Map(items.map(it => [it.word, it]));
  let added = 0;

  for (const w of words){
    if (map.has(w)){
      const it = map.get(w);
      if (it.deletedAt) it.deletedAt = 0;
      if (!it.dueAt) it.dueAt = now();
    } else {
      const it = mkItem(w);
      items.unshift(it);
      map.set(w, it);
      added++;
    }
  }
  saveItems(items);

  for (const w of words){
    const it = map.get(w);
    if (!it || it.deletedAt) continue;
    fetcher.enqueueFor(it.id, ["ja","def","syn","ex"]);
  }

  renderAll();
  toast("追加完了", `${words.length} 件処理（新規 ${added}）`, snapshot);
}

// ===== Events =====
clearSearch.addEventListener("click", () => { search.value=""; shown=0; renderAll(); });
search.addEventListener("input", () => { shown=0; renderAll(); });
sort.addEventListener("change", () => { shown=0; renderAll(); });
levelFilter.addEventListener("change", () => { shown=0; renderAll(); });
scope.addEventListener("change", () => { shown=0; renderAll(); });
pageSize.addEventListener("change", () => { shown=0; renderAll(); });

moreBtn.addEventListener("click", () => { shown += Number(pageSize.value||30); renderAll(); });

pasteDemo.addEventListener("click", () => {
  pasteArea.value = "claim\nnevertheless, abundant / constitute\nconspicuous\nelaborate\n";
});

bulkAdd.addEventListener("click", () => {
  const words = splitWords(pasteArea.value);
  if (!words.length) return;
  pasteArea.value = "";
  upsertWords(words);
  setTab("list");
});

function addOne(){
  const w = normWord(oneWord.value);
  if (!w) return;
  oneWord.value = "";
  upsertWords([w]);
  setTab("list");
}
oneAdd.addEventListener("click", addOne);
oneWord.addEventListener("keydown", (e)=>{ if (e.key==="Enter") addOne(); });

retryMissing.addEventListener("click", ()=>fetcher.enqueueMissingAll());
retryFailed.addEventListener("click", ()=>fetcher.enqueueFailedOnly());

// Rules sheet
openRules.addEventListener("click", ()=>ruleSheet.classList.add("show"));
closeRules.addEventListener("click", ()=>ruleSheet.classList.remove("show"));

// Export / Import / Backup
exportBtn.addEventListener("click", async () => {
  const data = JSON.stringify(items, null, 2);
  try{
    await navigator.clipboard.writeText(data);
    toast("エクスポート完了", "クリップボードへコピー");
  } catch {
    window.prompt("このJSONをコピーして保存:", data);
  }
});

importBtn.addEventListener("click", () => {
  const txt = window.prompt("エクスポートしたJSONを貼り付け:");
  if (!txt) return;

  let incoming;
  try{
    incoming = JSON.parse(txt);
    if (!Array.isArray(incoming)) throw new Error();
  } catch {
    toast("インポート", "JSONの形式が合ってるか確認して");
    return;
  }

  const snapshot = JSON.parse(JSON.stringify(items));
  items = incoming;
  saveItems(items);
  renderAll();
  toast("インポート完了", "10秒以内なら取り消しできる", snapshot);

  fetcher.enqueueMissingAll();
});

backupBtn.addEventListener("click", () => {
  const b = loadBackup();
  if (!b || !Array.isArray(b.items)){
    toast("バックアップ", "見つからない");
    return;
  }
  const ok = window.confirm("バックアップへ復元する？（Undoあり）");
  if (!ok) return;

  const snapshot = JSON.parse(JSON.stringify(items));
  items = b.items;
  saveItems(items);
  renderAll();
  toast("バックアップ復元", new Date(b.at).toLocaleString(), snapshot);
});

// Trash controls
restoreAll.addEventListener("click", () => {
  const snapshot = JSON.parse(JSON.stringify(items));
  for (const it of items) it.deletedAt = 0;
  saveItems(items);
  renderAll();
  toast("全部復元", "10秒以内なら取り消しできる", snapshot);
});

let holdT = 0;
function startHold(){
  holdHint.style.display = "block";
  holdT = setTimeout(() => {
    const txt = window.prompt("確認：ERASE と入力すると完全削除");
    if ((txt||"").trim().toUpperCase() !== "ERASE"){
      toast("完全削除", "確認入力が一致しない");
      holdHint.style.display = "none";
      return;
    }
    const snapshot = JSON.parse(JSON.stringify(items));
    items = items.filter(it => !it.deletedAt);
    saveItems(items);
    renderAll();
    toast("ゴミ箱を完全削除", "10秒以内なら取り消しできる", snapshot);
    holdHint.style.display = "none";
  }, 2000);
}
function endHold(){
  clearTimeout(holdT);
  setTimeout(()=>holdHint.style.display="none", 250);
}
emptyTrashHold.addEventListener("touchstart", startHold, {passive:true});
emptyTrashHold.addEventListener("touchend", endHold);
emptyTrashHold.addEventListener("mousedown", startHold);
emptyTrashHold.addEventListener("mouseup", endHold);

softClear.addEventListener("click", () => {
  const ok = window.confirm("全消去（ゴミ箱へ移動）する？（Undoあり）");
  if (!ok) return;
  const snapshot = JSON.parse(JSON.stringify(items));
  const t = now();
  for (const it of items) if (!it.deletedAt) it.deletedAt = t;
  saveItems(items);
  renderAll();
  toast("全消去（ゴミ箱へ）", "10秒以内なら取り消しできる", snapshot);
});

// Tutorial
const pages = [
  { t:"① 貼る→取得", b:"「貼る」に単語をまとめて貼る。端末に保存され、裏で和訳を取る。" },
  { t:"② フラッシュは和訳で", b:"単語だけ表示→『答え』or評価で和訳。英語定義は詳細に隔離。" },
  { t:"③ データ保護", b:"削除はゴミ箱へ（復元OK）。エクスポートでバックアップもできる。" }
];
let tIdx = 0;
function tRender(){
  tutPageTitle.textContent = pages[tIdx].t;
  tutPageBody.textContent = pages[tIdx].b;
  tutPrev.disabled = (tIdx === 0);
  tutNext.textContent = (tIdx === pages.length - 1) ? "完了" : "次へ";
}
function tOpen(){
  tIdx = 0; tRender();
  tutorial.classList.add("show");
}
function tClose(mark=true){
  tutorial.classList.remove("show");
  if (mark) localStorage.setItem(KEYS.TUT, "1");
}
tutSkip.addEventListener("click", ()=>tClose(true));
tutPrev.addEventListener("click", ()=>{ tIdx = Math.max(0, tIdx-1); tRender(); });
tutNext.addEventListener("click", ()=>{
  if (tIdx === pages.length - 1) return tClose(true);
  tIdx = Math.min(pages.length - 1, tIdx + 1);
  tRender();
});
openTutorial.addEventListener("click", ()=>tOpen());

// ===== Init =====
function boot(){
  renderAll();
  shown = Number(pageSize.value || 30);

  // 初回だけチュートリアル
  if (localStorage.getItem(KEYS.TUT) !== "1"){
    setTimeout(()=>tOpen(), 250);
  }

  // 起動時：idleのものだけ静かにキューへ
  for (const it of activeItems()){
    for (const k of ["ja","def","syn","ex"]){
      if ((it.fetch?.[k]?.status || "idle") === "idle"){
        fetcher.enqueueFor(it.id, [k]);
      }
    }
  }
}
boot();
