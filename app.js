/* Движок дашборда «Сводный план ОТМ».
   Источник данных зависит от window.DASH_MODE:
   - "local"  — /api/data (локальный сервер collector.py)
   - "public" — data.json (статический сайт на GitHub Pages)
*/
"use strict";
const MODE = window.DASH_MODE || "local";
const $ = id => document.getElementById(id);
const S = {
  items: [], sections: [], meta: {}, status: {}, cfg: {},
  fSection: "", fMonth: "", fResp: "", fStatus: "",
  sortCol: -1, sortDir: 1,
  charts: {},
  nextPollAt: 0,
  refreshEvery: MODE === "public" ? 60 : 10,
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

window.addEventListener("error", ev => {
  const al = $("alert");
  if (al){ al.classList.add("show");
    al.textContent = "⚠ Ошибка страницы: " + ev.message +
      (ev.filename ? " (" + ev.filename.split("/").pop() + ":" + ev.lineno + ")" : ""); }
});

/* ---------- данные ---------- */
async function fetchData(){
  if (MODE === "public"){
    const r = await fetch("data.json?v=" + Date.now(), {cache: "no-store"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  }
  const r = await fetch("/api/data", {cache: "no-store"});
  return await r.json();
}
async function refreshNow(){
  if (MODE === "local"){
    try{ await fetch("/api/refresh", {cache: "no-store"}); }catch(e){}
  }
  loadData();
}

/* ---------- константы ---------- */
const STATUS_LABEL = {work:"В работе", decided:"Есть решение", none:"Без статуса"};
const STATUS_COLOR = {work:"#3ddc97", decided:"#ffb648", none:"#8b96b3"};
const monthLabel = m => m === "2027 и позже" ? "2027+" : m;
const MONTH_ORDER = ["Октябрь","Ноябрь","Декабрь","Январь","2027 и позже","Без даты"];

/* ---------- KPI ---------- */
function buildKPI(filtered){
  const f = filtered;
  const work = f.filter(i => i.status==="work").length;
  const decided = f.filter(i => i.status==="decided").length;
  const exact = f.filter(i => i.exactDate).length;
  const nodate = f.filter(i => !(i.months||[]).length).length;
  const people = new Set();
  f.forEach(i => (i.respList||[]).forEach(p => people.add(p)));
  const cards = [
    {label:"Всего мероприятий", value:f.length, sub:`разделов: ${new Set(f.map(i=>i.section)).size}`, click:()=>resetFilters()},
    {label:"В работе", value:work, sub:`${f.length?(work/f.length*100).toFixed(0):0}% пунктов`, click:()=>setStatus("work")},
    {label:"Есть решение", value:decided, sub:"в примечании «РЕШЕНО»", click:()=>setStatus("decided")},
    {label:"С точной датой", value:exact, sub:"день и месяц указаны", click:()=>setMonth("Точная дата")},
    {label:"Без даты", value:nodate, sub:"срок не определён", click:()=>setMonth("Без даты")},
    {label:"Ответственных", value:people.size, sub:"уникальных фамилий", click:()=>resetFilters()},
  ];
  const g = $("kpiGrid"); g.innerHTML = "";
  for (const c of cards){
    const d = document.createElement("div");
    d.className = "kpi click";
    d.innerHTML = `<div class="label">${esc(c.label)}</div><div class="value">${c.value}</div><div class="sub">${esc(c.sub)}</div>`;
    d.onclick = c.click;
    g.appendChild(d);
  }
}

/* ---------- фильтры ---------- */
function filterItems(){
  return S.items.filter(i =>
    (!S.fSection || i.section === S.fSection) &&
    (!S.fMonth || (S.fMonth==="Точная дата" ? i.exactDate :
                   S.fMonth==="Без даты" ? !(i.months||[]).length :
                   (i.months||[]).includes(S.fMonth))) &&
    (!S.fResp || (i.respList||[]).includes(S.fResp)) &&
    (!S.fStatus || i.status === S.fStatus));
}
const setSection = s => { S.fSection = s; syncFilters(); render(); };
const setMonth = m => { S.fMonth = m; syncFilters(); render(); };
const setResp = r => { S.fResp = r; syncFilters(); render(); };
const setStatus = st => { S.fStatus = st; syncFilters(); render(); };
function resetFilters(){ S.fSection=S.fMonth=S.fResp=S.fStatus=""; syncFilters(); render(); }

function buildFilters(){
  const f = $("filters"); f.innerHTML = "";
  const mk = (label, id, opts, cur, onchange) => {
    const lab = document.createElement("label");
    lab.textContent = label;
    const s = document.createElement("select"); s.id = id;
    const o0 = document.createElement("option"); o0.value=""; o0.textContent="— все —"; s.appendChild(o0);
    for (const [v,t] of opts){ const o = document.createElement("option"); o.value=v; o.textContent=t; if (v===cur) o.selected=true; s.appendChild(o); }
    s.onchange = onchange;
    lab.appendChild(s); f.appendChild(lab);
  };
  const uniq = arr => [...new Set(arr)];
  const months = uniq(S.items.flatMap(i=>i.months||[])).sort();
  const people = uniq(S.items.flatMap(i=>i.respList||[])).sort((a,b)=>a.localeCompare(b,"ru"));
  mk("раздел", "fSection", S.sections.map(s=>[s.evt, `${s.num}. ${s.evt.slice(0,44)}`]), S.fSection, e=>setSection(e.target.value));
  mk("месяц", "fMonth", [...months,["Точная дата","Точная дата"],["Без даты","Без даты"]].map(m=>[m,monthLabel(m)]), S.fMonth, e=>setMonth(e.target.value));
  mk("ответственный", "fResp", people.map(p=>[p,p]), S.fResp, e=>setResp(e.target.value));
  mk("статус", "fStatus", Object.entries(STATUS_LABEL), S.fStatus, e=>setStatus(e.target.value));
  const b = document.createElement("button"); b.id="resetFilters"; b.textContent="✕ сбросить"; b.onclick=resetFilters; f.appendChild(b);
}
function syncFilters(){
  const vals = {fSection:S.fSection, fMonth:S.fMonth, fResp:S.fResp, fStatus:S.fStatus};
  for (const [id,v] of Object.entries(vals)){
    const el = $(id);
    if (el) el.value = v;
  }
}

/* ---------- графики ---------- */
function hsl(i,n,a){ return `hsl(${(i*360/Math.max(n,1))%360} 68% 62% / ${a})`; }
function baseOpts(){
  return {responsive:true, maintainAspectRatio:false,
    plugins:{legend:{display:false}},
    scales:{x:{ticks:{color:"#8b96b3"},grid:{color:"#273253"}},
            y:{ticks:{color:"#8b96b3"},grid:{color:"#273253"}}}};
}
function renderCharts(){
  const C = S.charts;
  const cnt = (arr, key) => { const m = new Map(); arr.forEach(x=>m.set(key(x),(m.get(key(x))||0)+1)); return m; };

  const bySec = [...cnt(S.items, i=>i.section).entries()].sort((a,b)=>b[1]-a[1]);
  if (C.sec) C.sec.destroy();
  C.sec = new Chart($("secChart"), { type:"bar",
    data:{labels:bySec.map(([s])=>s.replace(/:.*$/,"").slice(0,40)),
      datasets:[{label:"мероприятий", data:bySec.map(([,n])=>n),
        backgroundColor:bySec.map((_,i)=>hsl(i,bySec.length,.8)), borderRadius:4}]},
    options:{...baseOpts(),
      onClick:(e,els)=>{ if(els.length) setSection(bySec[els[0].index][0]); }}});

  const byMonth = new Map(MONTH_ORDER.map(m=>[m,0]));
  S.items.forEach(i=>{
    const ms = i.months||[];
    if (ms.length) ms.forEach(m=>byMonth.set(m,byMonth.get(m)+1));
    else byMonth.set("Без даты",byMonth.get("Без даты")+1);
  });
  if (C.month) C.month.destroy();
  C.month = new Chart($("monthChart"), { type:"bar",
    data:{labels:MONTH_ORDER.map(monthLabel), datasets:[{label:"пунктов", data:MONTH_ORDER.map(m=>byMonth.get(m)),
      backgroundColor:MONTH_ORDER.map(m=>m==="Без даты" ? "#3a4565" : hsl(MONTH_ORDER.indexOf(m),6,.85)), borderRadius:4}]},
    options:{...baseOpts(),
      onClick:(e,els)=>{ if(els.length) setMonth(MONTH_ORDER[els[0].index]); }}});

  const stOrder = ["work","decided","none"];
  const stData = stOrder.map(s=>S.items.filter(i=>i.status===s).length);
  if (C.st) C.st.destroy();
  C.st = new Chart($("statusChart"), { type:"doughnut",
    data:{labels:stOrder.map(s=>STATUS_LABEL[s]),
      datasets:[{data:stData, backgroundColor:stOrder.map(s=>STATUS_COLOR[s]+"cc"), borderColor:"#141b2e", borderWidth:3}]},
    options:{responsive:true, maintainAspectRatio:false, cutout:"62%",
      plugins:{legend:{position:"right", labels:{color:"#8b96b3", boxWidth:12}}},
      onClick:(e,els)=>{ if(els.length) setStatus(stOrder[els[0].index]); }}});

  const respCnt = cnt(S.items.flatMap(i=>i.respList||[]), x=>x);
  const top = [...respCnt.entries()].filter(([n])=>n).sort((a,b)=>b[1]-a[1]).slice(0,12);
  if (C.resp) C.resp.destroy();
  C.resp = new Chart($("respChart"), { type:"bar",
    data:{labels:top.map(([n])=>n.split(" ").slice(0,2).join(" ")),
      datasets:[{label:"пунктов", data:top.map(([,n])=>n),
        backgroundColor:top.map((_,i)=>hsl(200+i*30,top.length,.8)), borderRadius:4}]},
    options:{...baseOpts(), indexAxis:"y",
      onClick:(e,els)=>{ if(els.length) setResp(top[els[0].index][0]); }}});
}

/* ---------- таблица ---------- */
function renderTable(){
  const q = $("search").value.trim().toLowerCase();
  const rows = filterItems().filter(r =>
    !q || [r.num,r.evt,r.date,r.place,r.resp,r.note].some(v=>String(v??"").toLowerCase().includes(q)));
  const thead = document.querySelector("#dataTable thead");
  const cols = ["num","evt","date","place","resp","note"];
  const labels = ["№","Мероприятие","Дата","Место","Ответственные","Примечание"];
  thead.innerHTML = "<tr>" + cols.map((c,i)=>
    `<th data-c="${c}">${labels[i]} <span class="arr">${S.sortCol===c?(S.sortDir>0?"▲":"▼"):""}</span></th>`).join("") + "</tr>";
  thead.querySelectorAll("th").forEach(th=>th.onclick=()=>{
    const c = th.dataset.c;
    if (S.sortCol===c) S.sortDir*=-1; else {S.sortCol=c; S.sortDir=1;}
    renderTable();
  });
  const sorted = S.sortCol<0 ? rows : rows.slice().sort((a,b)=>{
    let r = String(a[S.sortCol]??"").localeCompare(String(b[S.sortCol]??""), "ru");
    return r * S.sortDir;
  });
  const tbody = document.querySelector("#dataTable tbody");
  const MAX = 600;
  tbody.innerHTML = sorted.slice(0,MAX).map(r => {
    const st = r.status;
    const tag = `<span class="tag ${st}">${STATUS_LABEL[st]}</span>`;
    return `<tr><td class="num">${esc(r.num)}</td><td class="event">${esc(r.evt)}</td><td>${esc(r.date)||"—"}</td><td>${esc(r.place)||"—"}</td><td>${esc(r.resp)||"—"}</td><td>${esc(r.note)} ${st!=="none"?tag:""}</td></tr>`;
  }).join("");
  $("rowCount").textContent = `${rows.length} пунктов` + (sorted.length>MAX ? ` · показаны первые ${MAX}` : "");
}

/* ---------- общий рендер ---------- */
function render(){
  buildKPI(filterItems());
  renderCharts();
  renderTable();
}

/* ---------- статус ---------- */
function renderStatus(err){
  const dot = $("statusDot"), txt = $("statusText");
  const updated = S.meta.updated;
  if (!err && updated){ dot.className="dot ok"; txt.textContent = MODE==="public" ? "сайт · данные актуальны" : "онлайн · данные свежие"; }
  else if (err){ dot.className="dot err"; txt.textContent="ошибка"; }
  else { dot.className=""; txt.textContent="нет данных"; }
  $("lastUpdate").textContent = updated || "—";
  const al = $("alert");
  if (err){ al.classList.add("show"); al.textContent = "⚠ " + err; }
  else al.classList.remove("show");
}

/* ---------- загрузка ---------- */
async function loadData(){
  try{
    const p = await fetchData();
    S.meta = p.meta || {};
    S.cfg = p.config || {};
    S.status = p.status || {};
    S.nextPollAt = Date.now()/1000 + S.refreshEvery;
    renderStatus(S.meta.error || null);
    if (!p.items || !p.items.length){
      $("kpiGrid").innerHTML = `<div class="empty">Данные ещё не получены. ${esc(S.meta.error||"")}</div>`;
      return;
    }
    S.items = p.items;
    S.sections = p.sections || [];
    const sub = [S.meta.doc_title ? `источник: ${S.meta.doc_title}` : "", S.meta.updated ? `обновлено: ${S.meta.updated}` : ""].filter(Boolean).join(" · ");
    $("docTitle").innerHTML = esc(S.meta.title || "Сводный план ОТМ") +
      (sub ? `<span class="sub" id="docSub">${esc(sub)}</span>` : "");
    buildFilters();
    render();
  }catch(e){
    renderStatus(MODE === "public"
      ? "не удалось загрузить данные с сайта: " + e.message
      : "нет связи с сервером: " + e.message);
  }
}

/* ---------- CSV ---------- */
function exportCsv(){
  const rows = filterItems();
  const head = ["№","Мероприятие","Дата","Место","Ответственные","Примечание","Статус"];
  const lines = [head.join("\t")];
  rows.forEach(r=>lines.push([r.num,r.evt,r.date,r.place,r.resp,r.note,STATUS_LABEL[r.status]].join("\t")));
  const blob = new Blob(["\ufeff"+lines.join("\r\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "план_отм_выборка.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- таймер ---------- */
function tick(){
  const left = Math.max(0, Math.round(S.nextPollAt - Date.now()/1000));
  $("nextPoll").textContent = left ? `через ${left} с` : "сейчас";
  if (!left){ loadData(); }
}

$("btnRefresh").onclick = refreshNow;
$("search").oninput = renderTable;
$("exportCsv").onclick = exportCsv;

loadData();
setInterval(tick, 1000);
setInterval(loadData, S.refreshEvery * 1000);
