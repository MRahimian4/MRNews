// —— ابزارهای عمومی
const $ = s => document.querySelector(s);
const NF = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
const NFcompact = new Intl.NumberFormat("fa-IR", { notation: "compact", maximumFractionDigits: 1 });
const fmtTime = iso => { try { return new Date(iso).toLocaleString("fa-IR"); } catch { return iso; } };
const hsl = (i, a=0.8) => `hsl(${(i*67)%360} 80% ${a*50}%)`;

// حالت اخبار (برای صفحه‌بندی)
const NEWS_STATE = { all: [], filtered: [], page: 1, pageSize: 10 };

// --- کمک‌تابع‌های شبکه/داده
async function fetchJSON(path){
  try{ const r = await fetch(path, {cache: "no-store"}); if(!r.ok) return null; return await r.json(); }
  catch{ return null; }
}

// دمو سری برای مواقع بدون فایل
function demoSeries(labels=["USD","EUR"], start=new Date(Date.now()-24*3600e3), n=48, base=50){
  return labels.map((lab, i) => {
    const pts = []; let v = base + i*2;
    for(let k=0;k<n;k++){ v += (Math.random()-.5)*0.6; pts.push({ t:new Date(+start + k*30*60*1000).toISOString(), v:+v.toFixed(2) }); }
    return { label:lab, unit:"UNIT", points:pts };
  });
}

// تبدیل به ریال بر اساس واحد سری
function toRialByUnit(value, seriesUnit, rates){
  if (seriesUnit === "IRR") return value;
  if (seriesUnit === "USD") return value * (rates?.USD || 0);
  if (seriesUnit === "EUR") return value * (rates?.EUR || 0);
  return value;
}

// اندازه‌دهی بوم
function fitCanvas(cnv){
  const rect = cnv.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  cnv.width = Math.floor(rect.width * ratio);
  cnv.height = Math.floor(rect.height * ratio);
  const ctx = cnv.getContext("2d");
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return ctx;
}

// رسم چارت خطی
function drawLineChart(canvasId, series, legendId, unit){
  const cnv = document.getElementById(canvasId);
  const ctx = fitCanvas(cnv);
  const W = cnv.clientWidth, H = cnv.clientHeight;
  const P = { l: 64, r: 16, t: 16, b: 32 };

  const points = series.flatMap(s => s.points.map(p => ({ t:+new Date(p.t), v:+p.v })));
  if(!points.length){ ctx.fillStyle="#94a3b8"; ctx.fillText("داده‌ای موجود نیست", 12, 20); return; }

  const tMin = Math.min(...points.map(p=>p.t));
  const tMax = Math.max(...points.map(p=>p.t));
  const vMin = Math.min(...points.map(p=>p.v));
  const vMax = Math.max(...points.map(p=>p.v));
  const pad  = (vMax - vMin) * 0.1 || 1;
  const yMin = vMin - pad, yMax = vMax + pad;

  const x = t => P.l + ((t - tMin) / (tMax - tMin || 1)) * (W - P.l - P.r);
  const y = v => H - P.b - ((v - yMin) / (yMax - yMin || 1)) * (H - P.t - P.b);

  // شبکه
  ctx.strokeStyle = "#273244"; ctx.lineWidth = 1;
  ctx.beginPath();
  const ticks = 4;
  for(let i=0;i<=ticks;i++){ const gy = P.t + i*(H-P.t-P.b)/ticks; ctx.moveTo(P.l, gy); ctx.lineTo(W-P.r, gy); }
  ctx.stroke();

  // محور X
  ctx.fillStyle = "#cbd5e1"; ctx.font = "12px system-ui"; ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";  ctx.fillText(new Date(tMin).toLocaleTimeString("fa-IR"), P.l, H-8);
  ctx.textAlign = "right"; ctx.fillText(new Date(tMax).toLocaleTimeString("fa-IR"), W - P.r, H-8);

  // محور Y
  ctx.textAlign = "right";
  for(let i=0;i<=ticks;i++){
    const val = yMax - (i*(yMax-yMin)/ticks);
    const yy  = P.t + i*(H-P.t-P.b)/ticks;
    const txt = unit==="rial" ? NFcompact.format(val) : NF.format(val);
    ctx.fillText(txt, P.l - 8, yy + 4);
  }

  // سری‌ها
  const leg = document.getElementById(legendId);
  if(leg){ leg.innerHTML = ""; }
  series.forEach((s, i) => {
    const col = hsl(i,.9);
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath();
    s.points.sort((a,b)=>+new Date(a.t)-+new Date(b.t)).forEach((p, idx) => {
      const X = x(+new Date(p.t)), Y = y(+p.v);
      if(idx===0) ctx.moveTo(X,Y); else ctx.lineTo(X,Y);
    });
    ctx.stroke();
    if(leg){ const pill = document.createElement("span"); pill.className = "pill"; pill.innerHTML = `<span class="dot" style="background:${col}"></span>${s.label}`; leg.appendChild(pill); }
  });

  if(leg){ const unitPill = document.createElement("span"); unitPill.className = "pill"; unitPill.innerHTML = unit==="rial" ? "واحد: ریال" : "واحد: اصلی"; leg.appendChild(unitPill); }
}

// --- اخبار: نرمال‌سازی، فیلتر، مرتب‌سازی، صفحه‌بندی

// تبدیل ایمن رشته‌های تاریخ خبر به timestamp عددی (ms)
function newsTimestamp(item){
  // اگر بک‌اند published_ts داده باشد
  if (typeof item?.published_ts === "number" && !isNaN(item.published_ts)) return item.published_ts;

  let s = (item?.published || "").trim();
  if (!s) return NaN;

  // تلاش ۱: Date.parse مستقیم
  let t = Date.parse(s);
  if (!isNaN(t)) return t;

  // تلاش ۲: جایگزینی GMT→UTC (برخی پارسرها)
  t = Date.parse(s.replace("GMT", "UTC"));
  if (!isNaN(t)) return t;

  // تلاش ۳: اگر ISO ناقص بود، Z اضافه کنیم
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    t = Date.parse(s + "Z");
    if (!isNaN(t)) return t;
  }

  // آخرین تلاش: new Date(s).getTime()
  t = new Date(s).getTime();
  return isNaN(t) ? NaN : t;
}

// برش بازهٔ زمانی سری‌ها
function sliceByRange(series, range){
  const now = Date.now();
  const win = range==="1D" ? 1 : range==="1W" ? 7 : 30; // روز
  const from = now - win * 24*3600*1000;
  return series.map(s => ({ label: s.label, unit: s.unit, points: s.points.filter(p => +new Date(p.t) >= from) }));
}

// فیلتر و مرتب‌سازی اخبار
function filterAndSortNews(items, range){
  const now = Date.now();
  const win = range==="1D" ? 1 : range==="1W" ? 7 : 30; // روز
  const from = now - win * 24*3600*1000;

  const normalized = (items || [])
    .map(it => ({ ...it, _ts: newsTimestamp(it) }))
    .filter(it => !isNaN(it._ts)); // فقط آیتم‌های دارای تاریخ معتبر

  return normalized
    .filter(it => it._ts >= from)
    .sort((a,b) => b._ts - a._ts);
}

// رندر اخبار یک صفحه
function renderNews(items){
  const box = $("#news-list");
  if(!items.length){
    box.innerHTML = `<div class="item"><h4>خبری در این بازه ثبت نشده</h4><p>بازه زمانی را تغییر دهید یا بعداً سر بزنید.</p></div>`;
    return;
  }
  box.innerHTML = items.map(it => `
    <div class="item">
      <h4>${it.title}</h4>
      <div class="meta">${it.source || "نامشخص"} • ${fmtTime(it.published)}</div>
      ${it.summary ? `<p>${it.summary}</p>` : ""}
      ${it.url ? `<div style="margin-top:6px"><a class="badge" href="${it.url}" target="_blank" rel="noopener">مشاهده خبر →</a></div>` : ""}
    </div>
  `).join("");
}

// صفحه‌بندی
function renderPager(){
  const pager = $("#news-pager");
  const total = NEWS_STATE.filtered.length;
  const pages = Math.max(1, Math.ceil(total / NEWS_STATE.pageSize));

  if(total === 0){ pager.innerHTML = ""; return; }

  pager.innerHTML = `
    <div class="pagerbar">
      <button class="btn" id="prevPage" ${NEWS_STATE.page<=1 ? "disabled" : ""}>قبلی</button>
      <span class="badge">صفحه ${NEWS_STATE.page} از ${pages} • ${total} خبر</span>
      <button class="btn" id="nextPage" ${NEWS_STATE.page>=pages ? "disabled" : ""}>بعدی</button>
    </div>
  `;

  $("#prevPage")?.addEventListener("click", () => { if(NEWS_STATE.page>1){ NEWS_STATE.page--; renderNewsPage(); } });
  $("#nextPage")?.addEventListener("click", () => { const pages = Math.max(1, Math.ceil(total / NEWS_STATE.pageSize)); if(NEWS_STATE.page<pages){ NEWS_STATE.page++; renderNewsPage(); } });
}

function renderNewsPage(){
  const start = (NEWS_STATE.page - 1) * NEWS_STATE.pageSize;
  const pageItems = NEWS_STATE.filtered.slice(start, start + NEWS_STATE.pageSize);
  renderNews(pageItems);
  renderPager();
}

// —— راه‌اندازی
(async function init(){
  // انتخاب‌گرها
  ($("#mode")).appendChild(new Option("واقع‌بینانه","واقع‌بینانه"));
  ($("#mode")).appendChild(new Option("پیش‌بینی","پیش‌بینی"));
  ["اقتصاد کلان","سیاست","انرژی","فناوری","اروپا","آمریکا"].forEach(c => ($("#category")).appendChild(new Option(c,c)));

  // رویدادها
  $("#refresh").addEventListener("click", () => { NEWS_STATE.page = 1; loadAndRender(); });
  $("#range").addEventListener("change", () => { NEWS_STATE.page = 1; loadAndRender(); });
  $("#unit").addEventListener("change", loadAndRender);

  await loadAndRender();
  window.addEventListener("resize", () => loadAndRender(false));

  async function loadAndRender(clearLegend=true){
    if(clearLegend){ ["legend-fx","legend-gold"].forEach(id => { const e=$("#"+id); if(e){e.innerHTML="";} }); }

    const [fx, gold, news, rates] = await Promise.all([
      fetchJSON("./data/fx_latest.json"),
      fetchJSON("./data/gold_latest.json"),
      fetchJSON("./data/news_macro.json"),
      fetchJSON("./data/rates.json")
    ]);

    const unit = $("#unit").value;   // original | rial
    const range = $("#range").value; // 1D | 1W | 1M

    // سری‌ها
    let fxSeries   = (fx && fx.series)     ? fx.series   : demoSeries(["USD","EUR"]);
    let goldSeries = (gold && gold.series) ? gold.series : demoSeries(["XAU"], new Date(Date.now()-24*3600e3), 48, 2300);

    fxSeries   = sliceByRange(fxSeries, range);
    goldSeries = sliceByRange(goldSeries, range);

    if(unit === "rial"){
      fxSeries = fxSeries.map(s => ({ label: s.label, unit: "IRR", points: s.points.map(p => ({ t:p.t, v: toRialByUnit(p.v, s.unit || "IRR", rates) })) }));
      goldSeries = goldSeries.map(s => ({ label: s.label, unit: "IRR", points: s.points.map(p => ({ t:p.t, v: toRialByUnit(p.v, s.unit || "USD", rates) })) }));
    }

    drawLineChart("chart-fx", fxSeries, "legend-fx", unit);
    drawLineChart("chart-gold", goldSeries, "legend-gold", unit);

    // اخبار: نرمال‌سازی + فیلتر + مرتب‌سازی + صفحه‌بندی
    NEWS_STATE.all = (news && news.items) ? news.items : [];
    NEWS_STATE.filtered = filterAndSortNews(NEWS_STATE.all, range);
    renderNewsPage();
  }
})();
