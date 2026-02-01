import { now, clamp, isDue, esc } from "./storage.js";

export function createFlash({ getItems, save, renderKPIs }){
  const flashScope = document.getElementById("flashScope");
  const flashLevel = document.getElementById("flashLevel");
  const flashOrder = document.getElementById("flashOrder");
  const flashCount = document.getElementById("flashCount");

  const flashCard = document.getElementById("flashCard");
  const flashEnd = document.getElementById("flashEnd");
  const endTotal = document.getElementById("endTotal");
  const endRated = document.getElementById("endRated");
  const endRestart = document.getElementById("endRestart");
  const endBack = document.getElementById("endBack");

  const fWord = document.getElementById("fWord");
  const fMeta = document.getElementById("fMeta");
  const fLvl = document.getElementById("fLvl");
  const fDetails = document.getElementById("fDetails");
  const fBody = document.getElementById("fBody");
  const fMore = document.getElementById("fMore");
  const fMoreBody = document.getElementById("fMoreBody");
  const fRemain = document.getElementById("fRemain");
  const fTotal = document.getElementById("fTotal");

  const btnReveal = document.getElementById("btnReveal");
  const btnNext = document.getElementById("btnNext");
  const btnAgain = document.getElementById("btnAgain");
  const btnHard = document.getElementById("btnHard");
  const btnGood = document.getElementById("btnGood");
  const btnEasy = document.getElementById("btnEasy");

  let deck = [];
  let idx = 0;
  let rated = 0;

  function jaReady(it){
    return !!((it.jaText || "").trim());
  }

  function inTarget(it){
    if (it.deletedAt) return false;
    if (!jaReady(it)) return false; // 和訳必須
    if (flashScope.value === "due" && !isDue(it)) return false;

    const lv = flashLevel.value;
    if (lv === "all") return true;
    if (lv === "0") return it.level === 0;
    if (lv === "0-1") return it.level <= 1;
    if (lv === "0-2") return it.level <= 2;
    return true;
  }

  function sortDeck(list){
    const order = flashOrder.value;
    const out = list.slice();
    if (order === "shuffle") out.sort(()=>Math.random()-0.5);
    if (order === "due") out.sort((a,b)=>(a.dueAt||0)-(b.dueAt||0));
    if (order === "new") out.sort((a,b)=>b.createdAt-a.createdAt);
    return out;
  }

  function rebuild(){
    const base = sortDeck(getItems().filter(inTarget));
    const n = Math.max(1, Number(flashCount.value || 20));
    deck = base.slice(0, n);
    idx = 0;
    rated = 0;

    flashEnd.style.display = "none";
    flashCard.style.display = "block";

    render();
  }

  function render(){
    fTotal.textContent = deck.length;
    fRemain.textContent = Math.max(0, deck.length - idx);

    if (!deck.length){
      fWord.textContent = "対象が空っぽ";
      fMeta.textContent = "和訳がある単語が対象";
      fBody.innerHTML = "";
      if (fMoreBody) fMoreBody.innerHTML = "";
      fDetails.open = false;
      if (fMore) fMore.open = false;
      return;
    }

    if (idx >= deck.length){
      flashCard.style.display = "none";
      flashEnd.style.display = "block";
      endTotal.textContent = deck.length;
      endRated.textContent = rated;
      fRemain.textContent = 0;
      return;
    }

    const it = deck[idx];
    fWord.textContent = it.word;
    fMeta.textContent = `${it.phonetic || ""}　期限：${isDue(it) ? "いま" : new Date(it.dueAt).toLocaleDateString()}　/　暗記度 ${it.level}`;
    fLvl.innerHTML = `<span class="dot"></span><span>暗記度 ${it.level}</span>`;

    // 初期は単語だけ。答えを開いた時に和訳が見える設計
    fBody.innerHTML = `<div style="font-weight:900;font-size:16px">${esc(it.jaText || "—")}</div>`;

    if (fMoreBody){
      const parts = [];
      parts.push(`<div class="small">英語定義</div><div style="font-weight:850;margin-top:4px">${esc(it.defText || "—")}</div>`);
      parts.push(`<div style="height:10px"></div><div class="small">類語</div><div style="font-weight:850;margin-top:4px">${esc(it.synText || "—")}</div>`);
      parts.push(`<div style="height:10px"></div><div class="small">例文</div><div style="font-weight:850;margin-top:4px">${esc(it.exText || "—")}</div>`);
      fMoreBody.innerHTML = parts.join("");
    }

    // ここが重要：最初は閉じる（英語意味が前面に出ない）
    fDetails.open = false;
    if (fMore) fMore.open = false;
  }

  function reveal(){
    if (!deck.length) return;
    if (idx >= deck.length) return;
    fDetails.open = true; // 和訳を表示
  }

  function next(){
    idx += 1;
    render();
  }

  function applyRating(type){
    if (!deck.length) return;
    if (idx >= deck.length) return;

    const it = deck[idx];
    if (!it) return;

    // 評価したら必ず和訳が見える（要件）
    reveal();

    const base = now();
    let addMin = 10;
    let addDays = 0;

    if (type === "again"){ addMin = 10; addDays = 0; }
    if (type === "hard"){ it.level = clamp(it.level + 1, 0, 4); addDays = 1; }
    if (type === "good"){ it.level = clamp(it.level + 1, 0, 4); addDays = 3; }
    if (type === "easy"){
      it.level = clamp(it.level + 1, 0, 4);
      addDays = (it.level >= 4) ? 14 : 7;
    }

    it.dueAt = base + addMin*60*1000 + addDays*24*60*60*1000;
    rated += 1;

    save();
    renderKPIs();

    setTimeout(() => next(), 350);
  }

  btnReveal.addEventListener("click", reveal);
  btnNext.addEventListener("click", next);
  btnAgain.addEventListener("click", ()=>applyRating("again"));
  btnHard.addEventListener("click", ()=>applyRating("hard"));
  btnGood.addEventListener("click", ()=>applyRating("good"));
  btnEasy.addEventListener("click", ()=>applyRating("easy"));

  endRestart.addEventListener("click", rebuild);
  endBack.addEventListener("click", rebuild);

  flashScope.addEventListener("change", rebuild);
  flashLevel.addEventListener("change", rebuild);
  flashOrder.addEventListener("change", rebuild);
  flashCount.addEventListener("change", rebuild);

  document.addEventListener("keydown", (e) => {
    const sec = document.getElementById("sec_flash");
    if (!sec.classList.contains("active")) return;
    if (e.key === " ") { e.preventDefault(); reveal(); }
    if (e.key === "1") applyRating("again");
    if (e.key === "2") applyRating("hard");
    if (e.key === "3") applyRating("good");
    if (e.key === "4") applyRating("easy");
  });

  return { rebuild };
}
