export const KEYS = {
  ITEMS: "tango_plus_items_v3",
  BACKUP: "tango_plus_backup_v3",
  TUT: "tango_plus_seen_tutorial_v1",
};

export const now = () => Date.now();
export const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));

export function esc(s){
  return (s||"").toString().replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

export function normWord(s){
  return (s||"")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g,"")
    .replace(/[^a-z'-]/g,"");
}

export function splitWords(text){
  const raw = (text||"").replace(/\r/g,"\n");
  const parts = raw.split(/[\n,\/\t ]+/).map(x=>x.trim()).filter(Boolean);
  const out = [];
  for (const p of parts){
    const w = normWord(p);
    if (!w) continue;
    out.push(w);
  }
  const seen = new Set();
  return out.filter(w => (seen.has(w) ? false : (seen.add(w), true)));
}

export function mkField(){ return { status:"idle", at:0, err:"" }; }

export function mkItem(word){
  return {
    id: String(Date.now()) + "_" + Math.random().toString(16).slice(2),
    word,
    createdAt: now(),
    note: "",
    tags: [],      // user tags
    autoTags: [],  // auto (part of speech)
    level: 0,
    dueAt: now(),
    deletedAt: 0,

    phonetic: "",
    defText: "",
    jaText: "",
    synText: "",
    exText: "",

    fetch: { def: mkField(), ja: mkField(), syn: mkField(), ex: mkField() },
    lastError: ""
  };
}

export function loadItems(){
  try { return JSON.parse(localStorage.getItem(KEYS.ITEMS) || "[]"); }
  catch { return []; }
}

export function saveItems(items){
  localStorage.setItem(KEYS.ITEMS, JSON.stringify(items));
  localStorage.setItem(KEYS.BACKUP, JSON.stringify({ at: now(), items }));
}

export function loadBackup(){
  try { return JSON.parse(localStorage.getItem(KEYS.BACKUP) || "null"); }
  catch { return null; }
}

export function isDue(it){
  return (it.dueAt || 0) <= now();
}

export function parseTagQuery(q){
  const tags = (q.match(/#[\p{L}\p{N}_-]+/gu) || []).map(t=>t.slice(1).toLowerCase());
  const plain = q.replace(/#[\p{L}\p{N}_-]+/gu," ").trim();
  return { tags, plain };
}
