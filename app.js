const KEY="tango_plus_v1";
const THEME="tango_theme";
let data=JSON.parse(localStorage.getItem(KEY)||"[]");
let deck=[],idx=0;

const q=s=>document.querySelector(s);
const save=()=>localStorage.setItem(KEY,JSON.stringify(data));

function render(){
  const ul=q("#words");ul.innerHTML="";
  const f=q("#search").value.toLowerCase();
  data.filter(d=>d.w.includes(f)).forEach(d=>{
    const li=document.createElement("li");
    li.textContent=`${d.w} – ${d.j||"（意味取得中）"}`;
    ul.appendChild(li);
  });
}

async function lookup(w){
  const r=await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${w}`);
  if(!r.ok) return "";
  const j=await r.json();
  return j[0]?.meanings?.[0]?.definitions?.[0]?.definition||"";
}

q("#addBtn").onclick=async()=>{
  const ws=q("#bulk").value.split(/\s+/).map(w=>w.toLowerCase());
  q("#bulk").value="";
  for(const w of ws){
    if(!w||data.find(d=>d.w===w)) continue;
    const item={w,j:""};
    data.unshift(item); save(); render();
    item.j=await lookup(w); save(); render();
  }
};

q("#flashBtn").onclick=()=>{
  deck=data.filter(d=>d.j);
  if(!deck.length) return;
  idx=0;
  q("#focus").hidden=false;
  show();
};

function show(){
  q("#progress").textContent=`${idx+1}/${deck.length}`;
  q("#fWord").textContent=deck[idx].w;
  q("#fJa").hidden=true;
  q("#showAns").hidden=false;
}

q("#showAns").onclick=()=>{
  q("#fJa").textContent=deck[idx].j;
  q("#fJa").hidden=false;
};

document.querySelectorAll(".rates button").forEach(b=>{
  b.onclick=()=>{
    idx++;
    if(idx>=deck.length){
      q("#focus").hidden=true;
    }else show();
  };
});

q("#exitFocus").onclick=()=>q("#focus").hidden=true;

q("#search").oninput=render;

// theme
function setTheme(t){
  document.documentElement.dataset.theme=t;
  localStorage.setItem(THEME,t);
  q("#themeBtn").textContent=t==="light"?"ライト":"ダーク";
}
q("#themeBtn").onclick=()=>{
  setTheme(document.documentElement.dataset.theme==="light"?"dark":"light");
};
setTheme(localStorage.getItem(THEME)||"light");

// tutorial
if(!localStorage.getItem("seen")){
  q("#tuto").hidden=false;
}
q("#skip").onclick=()=>{
  localStorage.setItem("seen","1");
  q("#tuto").hidden=true;
};

render();
