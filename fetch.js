import { now, normWord } from "./storage.js";

const CONCURRENCY = 2;
const TIMEOUT_MS = 8000;
const RETRIES = 2;

export function createFetcher({ getItems, setItems, onUpdateKPI, toast }){
  const q = {
    waiting: [],
    running: new Set(),
    ok: 0,
    fail: 0,
  };

  function withTimeout(promise, ms){
    let t;
    const timeout = new Promise((_, rej) => {
      t = setTimeout(()=>rej(new Error("timeout")), ms);
    });
    return Promise.race([promise, timeout]).finally(()=>clearTimeout(t));
  }

  function markField(it, key, status, err=""){
    it.fetch[key].status = status;
    it.fetch[key].at = now();
    it.fetch[key].err = err || "";
    if (err) it.lastError = err;
  }

  function needFetch(it, key){
    if (it.deletedAt) return false;
    if (it.fetch?.[key]?.status === "ok") return false;
    return true;
  }

  async function fetchDictionary(word){
    const url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word);
    const res = await fetch(url);
    if (!res.ok) throw new Error("dict_http_" + res.status);
    const data = await res.json();
    const entry = data?.[0];

    const phonetic = entry?.phonetic || entry?.phonetics?.find(p => p?.text)?.text || "";
    const meanings = entry?.meanings || [];

    let defs = [];
    let syns = [];
    let ex = "";
    let posTags = [];

    for (const m of meanings){
      const pos = (m?.partOfSpeech || "").toLowerCase();
      if (pos) posTags.push(pos);

      for (const d of (m?.definitions || [])){
        if (d?.definition) defs.push(d.definition);
        if (!ex && d?.example) ex = d.example;
        if (Array.isArray(d?.synonyms)) syns.push(...d.synonyms);
      }
      if (Array.isArray(m?.synonyms)) syns.push(...m.synonyms);
    }

    defs = defs.filter(Boolean).slice(0, 3);
    syns = syns.map(s => normWord(s)).filter(Boolean);
    syns = syns.filter((v,i,a)=>a.indexOf(v)===i).slice(0, 10);
    posTags = posTags.filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0, 3);

    return { phonetic, defs, syns, ex, posTags };
  }

  async function fetchJa(text){
    const q = encodeURIComponent(text);
    const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|ja`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("ja_http_" + res.status);
    const data = await res.json();
    const t = data?.responseData?.translatedText || "";
    return (t || "").replace(/\s+/g," ").trim();
  }

  function enqueueFor(itId, keys){
    const items = getItems();
    const it = items.find(x => x.id === itId);
    if (!it || it.deletedAt) return;

    for (const k of keys){
      if (!needFetch(it, k)) continue;
      q.waiting.push({ id: itId, key: k, tries: 0 });
    }
    pump();
    onUpdateKPI();
  }

  function enqueueMissingAll(){
    const items = getItems();
    for (const it of items){
      if (it.deletedAt) continue;
      for (const k of ["ja","def","syn","ex"]){
        if (needFetch(it, k)) q.waiting.push({ id: it.id, key: k, tries: 0 });
      }
    }
    pump();
    onUpdateKPI();
    toast?.("未取得を再取得", "上のカウンタで進行が見える");
  }

  function enqueueFailedOnly(){
    const items = getItems();
    for (const it of items){
      if (it.deletedAt) continue;
      for (const k of ["ja","def","syn","ex"]){
        if (it.fetch?.[k]?.status === "fail") q.waiting.push({ id: it.id, key: k, tries: 0 });
      }
    }
    pump();
    onUpdateKPI();
    toast?.("失敗のみ再取得", "混雑や電波で揺れる前提");
  }

  async function runJob(job){
    const items = getItems();
    const it = items.find(x => x.id === job.id);
    if (!it || it.deletedAt) return;

    q.running.add(job.id + ":" + job.key);
    markField(it, job.key, "pending", "");
    setItems(items);

    try{
      if (job.key === "def" || job.key === "syn" || job.key === "ex"){
        const r = await withTimeout(fetchDictionary(it.word), TIMEOUT_MS);

        it.phonetic = r.phonetic || it.phonetic;

        // auto tags (part of speech)
        if (Array.isArray(r.posTags) && r.posTags.length){
          it.autoTags = Array.from(new Set([...(it.autoTags||[]), ...r.posTags])).slice(0, 6);
        }

        if (job.key === "def"){
          it.defText = (r.defs || []).join(" / ");
          markField(it, "def", it.defText ? "ok" : "fail", it.defText ? "" : "def_empty");
        }
        if (job.key === "syn"){
          it.synText = (r.syns || []).join(", ");
          markField(it, "syn", it.synText ? "ok" : "fail", it.synText ? "" : "syn_empty");
        }
        if (job.key === "ex"){
          it.exText = r.ex || "";
          markField(it, "ex", it.exText ? "ok" : "fail", it.exText ? "" : "ex_empty");
        }
      }

      if (job.key === "ja"){
        const base = (it.defText || it.word).slice(0, 140);
        const t = await withTimeout(fetchJa(base), TIMEOUT_MS);
        it.jaText = t || "";
        markField(it, "ja", it.jaText ? "ok" : "fail", it.jaText ? "" : "ja_empty");
      }

      q.ok++;
    } catch(e){
      q.fail++;
      const msg = String(e?.message || e || "error");
      markField(it, job.key, "fail", msg);

      if (job.tries < RETRIES){
        q.waiting.push({ ...job, tries: job.tries + 1 });
      }
    } finally {
      q.running.delete(job.id + ":" + job.key);
      setItems(getItems());
      onUpdateKPI();
      pump();
    }
  }

  function pump(){
    while (q.running.size < CONCURRENCY && q.waiting.length){
      const job = q.waiting.shift();
      const items = getItems();
      const it = items.find(x => x.id === job.id);
      if (!it || it.deletedAt) continue;
      if (!needFetch(it, job.key)) continue;
      runJob(job);
    }
    onUpdateKPI();
  }

  function getQueueStats(){
    return {
      waiting: q.waiting.length,
      running: q.running.size,
      ok: q.ok,
      fail: q.fail,
    };
  }

  return {
    enqueueFor,
    enqueueMissingAll,
    enqueueFailedOnly,
    getQueueStats,
  };
}
