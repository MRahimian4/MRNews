// —— ابزارهای عمومی
const $ = s => document.querySelector(s);
const NF = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
const NFcompact = new Intl.NumberFormat("fa-IR", { notation: "compact", maximumFractionDigits: 1 });
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString("fa-IR"); } catch { return iso; } };
const fmtDateTime = iso => { try { return new Date(iso).toLocaleString("fa-IR"); } catch { return iso; } };
const hsl = (i, a=0.9) => `hsl(${(i*67)%360} 80% ${a*50}%)`;

// حالت اخبار (برای صفحه‌بندی)
const NEWS_STATE = { all: [], filtered: [], page: 1, pageSize: 10 };

// --- کمک‌تابع‌های شبکه/داده
async function fetchJSON(path){
  try{ const r = await fetch(path, {cache: "no-store"}); if(!r.ok) return null; return await r.json(); }
  catch{ return null; }
}

// سری دمو (اگر فایل نبود)
function demoSeries(labels=["USD","EUR"], start=new Date(Date.now()-29*24*3600e3), n=30, base=600000){
  return labels.map((lab, i) => {
    const pts = []; let v = base + i*50000;
    for(let k=0;k<n;k++){ v += (Math.random()-.5)*10000; pts.push({ t:new Date(+start + k*24*3600e3).toISOString(), v:+v.toFixed(0) }); }
    return { label:lab, unit:"IRR", points:pts };
  });
}

// ————— نمودار —————
function fitCanvas(cnv){
  const rect = cnv.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  cnv.width = Math.floor(rect.width * ratio);
  cnv.height = Math.floor(rect.height * ratio);
  const ctx = cnv.getContext("2d");
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return ctx;
}

function drawLineChart(canvasId, series, unitLabel=""){
  const cnv = document.getElementById(canvasId);
  const ctx = fitCanvas(cnv);
  const W = cnv.clientWidth, H = cnv.clientHeight;
  const P = { l: 64, r: 16, t: 22, b: 36 };

  const pts = series.flatMap(s => s.points.map(p => ({ t:+new Date(p.t), v:+p.v })));
  if(!pts.length){ ctx.fillStyle="#94a3b8"; ctx.fillText("داده‌ای موجود نیست", 12, 20); return; }

  const tMin = Math.min(...pts.map(p=>p.t));
  const tMax = Math.max(...pts.map(p=>p.t));
  const vMin = Math.min(...pts.map(p=>p.v));
  const vMax = Math.max(...pts.map(p=>p.v));
  const pad  = (vMax - vMin) * 0.1 || 1;
  const yMin = vMin - pad, yMax = vMax + pad;

  const x = t => P.l + ((t - tMin) / (tMax - tMin || 1)) * (W - P.l - P.r);
  const y = v => H - P.b - ((v - yMin) / (yMax - yMin || 1)) * (H - P.t - P.b);

  // grid
  ctx.strokeStyle = "#273244"; ctx.lineWidth = 1;
  ctx.beginPath();
  const ticksY = 4;
  for(let i=0;i<=ticksY;i++){ const gy = P.t + i*(H-P.t-P.b)/ticksY; ctx.moveTo(P.l, gy); ctx.lineTo(W-P.r, gy); }
  ctx.stroke();

  // X labels (تاریخ شروع و پایان)
  ctx.fillStyle = "#cbd5e1"; ctx.font = "12px system-ui"; ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";  ctx.fillText(fmtDate(new Date(tMin).toISOString()), P.l, H-8);
  ctx.textAlign = "right"; ctx.fillText(fmtDate(new Date(tMax).toISOString()), W - P.r, H-8);

  // Y labels + عنوان محور
  ctx.textAlign = "right";
  for(let i=0;i<=ticksY;i++){
    const val = yMax - (i*(yMax-yMin)/ticksY);
    const yy  = P.t + i*(H-P.t-P.b)/ticksY;
    ctx.fillText(NFcompact.format(val), P.l - 8, yy + 4);
  }
  if(unitLabel){
    ctx.save();
    ctx.fillStyle = "#9ca3af"; ctx.font = "12px system-ui";
    ctx.translate(16, H/2); ctx.rotate(-Math.PI/2);
    ctx.textAlign = "center"; ctx.fillText(`واحد: ${unitLabel}`, 0, 0);
    ctx.restore();
  }

  // series
  series.forEach((s, i) => {
    const col = hsl(i,.9);
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath();
    s.points.sort((a,b)=>+new Date(a.t)-+new Date(b.t)).forEach((p, idx) => {
      const X = x(+new Date(p.t)), Y = y(+p.v);
      if(idx===0) ctx.moveTo(X,Y); else ctx.lineTo(X,Y);
    });
    ctx.stroke();
  });
}

function renderLegend(legendId, { title, series, updatedIso, source, note }){
  const leg = document.getElementById(legendId);
  if(!leg) return;
  const parts = [];
  parts.push(`<span class="pill"><strong>${title}</strong></span>`);
  (series || []).forEach((s, i) => {
    const col = hsl(i,.9);
    parts.push(`<span class="pill"><span class="dot" style="background:${col}"></span>${s.label}</span>`);
  });
  if(updatedIso) parts.push(`<span class="pill">به‌روزرسانی: ${fmtDateTime(updatedIso)}</span>`);
  if(source) parts.push(`<span class="pill">منبع: ${source}</span>`);
  if(note) parts.push(`<span class="pill">${note}</span>`);
  leg.innerHTML = parts.join(" ");
}

// ————— کمکی‌های سری زمانی —————
function multiplyGoldByUsdIrr(goldUSD, usdIRR){
  // goldUSD: [{t, v(USD)}], usdIRR: [{t, v(IRR per USD)}] → خروجی: XAU→IRR
  const a = goldUSD.slice().sort((x,y)=>+new Date(x.t)-+new Date(y.t));
  const b = usdIRR.slice().sort((x,y)=>+new Date(x.t)-+new Date(y.t));
  if(!a.length || !b.length) return [];

  let j = 0;
  let lastRate = b[0].v;
  const out = [];
  for(let i=0; i<a.length; i++){
    const tA = +new Date(a[i].t);
    while(j+1 < b.length && +new Date(b[j+1].t) <= tA){ j++; lastRate = b[j].v; }
    out.push({ t: a[i].t, v: a[i].v * (lastRate || 0) });
  }
  return out;
}

function lastISO(series){
  const pts = (series||[]).flatMap(s => s.points.map(p => +new Date(p.t)));
  if(!pts.length) return "";
  return new Date(Math.max(...pts)).toISOString();
}

// ————— اخبار —————
function newsTimestamp(it){
  if (typeof it.published_ts === "number") return it.published_ts;
  const s = (it.published || "").trim();
  let t = Date.parse(s);
  if (!isNaN(t)) return t;
  t = Date.parse(s.replace("GMT","UTC"));
  if (!isNaN(t)) return t;
  return new Date(s).getTime();
}
function filterAndSortNewsLast30(items){
  const now = Date.now();
  const from = now - 30*24*3600*1000;
  return (items || [])
    .map(it => ({ ...it, _ts: newsTimestamp(it) }))
    .filter(it => !isNaN(it._ts) && it._ts >= from)
    .sort((a,b) => b._ts - a._ts);
}
function renderNews(items){
  const box = $("#news-list");
  if(!items.length){
    box.innerHTML = `<div class="item"><h4>خبری در ۳۰ روز گذشته ثبت نشده</h4></div>`;
    return;
  }
  box.innerHTML = items.map(it => `
    <div class="item">
      ${it.image ? `<div class="item__img"><img class="thumb" loading="lazy" src="${it.image}" alt=""></div>` : ``}
      <div class="item__body">
        <h4>${it.title}</h4>
        <div class="meta">
          ${it.source || "نامشخص"} • ${fmtDateTime(it.published)}
          ${it.translated ? ` • <span class="badge">ترجمه‌شده</span>` : ``}
        </div>
        ${it.summary ? `<p>${it.summary}</p>` : ""}
        ${it.url ? `<div style="margin-top:6px"><a class="badge" href="${it.url}" target="_blank" rel="noopener">مشاهده خبر →</a></div>` : ""}
      </div>
    </div>
  `).join("");
}
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
  $("#nextPage")?.addEventListener("click", () => { if(NEWS_STATE.page<pages){ NEWS_STATE.page++; renderNewsPage(); } });
}
function renderNewsPage(){
  const start = (NEWS_STATE.page - 1) * NEWS_STATE.pageSize;
  const pageItems = NEWS_STATE.filtered.slice(start, start + NEWS_STATE.pageSize);
  renderNews(pageItems);
  renderPager();
}

// —— راه‌اندازی
(async function init(){
  // کنترل‌ها را قفل می‌کنیم: ۳۰ روز و ریال
  const unitSel = $("#unit"); if(unitSel){ unitSel.value = "rial"; unitSel.disabled = true; }
  const rangeSel = $("#range"); if(rangeSel){ rangeSel.value = "1M"; rangeSel.disabled = true; }

  $("#refresh")?.addEventListener("click", () => { NEWS_STATE.page = 1; loadAndRender(); });

  await loadAndRender();
  window.addEventListener("resize", () => loadAndRender(false));

  async function loadAndRender(clearLegend=true){
    if(clearLegend){ ["legend-fx","legend-gold"].forEach(id => { const e=$("#"+id); if(e){e.innerHTML="";} }); }

    const [fx, gold, news, rates] = await Promise.all([
      fetchJSON("./data/fx_latest.json"),      // شامل USD→IRR و EUR→IRR (۳۰ روزه)
      fetchJSON("./data/gold_latest.json"),    // شامل XAU→USD (۳۰ روزه)
      fetchJSON("./data/news_macro.json"),
      fetchJSON("./data/rates.json")           // شامل timestamp و منبع
    ]);

    // --- سری‌های FX
    let fxSeries = (fx && fx.series) ? fx.series : demoSeries(["دلار (USD→IRR)","یورو (EUR→IRR)"]);
    fxSeries = fxSeries.map(s => {
      const pts = s.points.sort((a,b)=>+new Date(a.t)-+new Date(b.t)).slice(-30);
      return { label: s.label, unit: "IRR", points: pts };
    });

    // --- سری طلا به ریال (XAU→IRR) با ضرب روزانه در USD→IRR
    const goldUSD = (gold && gold.series && gold.series[0]) ? gold.series[0] : demoSeries(["XAU→USD"], new Date(Date.now()-29*24*3600e3), 30, 2300)[0];
    const usdIRR  = fxSeries.find(s => /USD/i.test(s.label)) || fxSeries[0];
    const goldIRRpoints = multiplyGoldByUsdIrr(goldUSD.points, usdIRR.points);
    const goldIRRseries = [{ label: "طلا (XAU→IRR)", unit: "IRR", points: goldIRRpoints }];

    // ———— رسم نمودارها
    // 1) طلا به ریال
    drawLineChart("chart-gold", goldIRRseries, "ریال");
    renderLegend("legend-gold", {
      title: "قیمت هر اونس طلا به ریال — روند ۳۰ روزه",
      series: goldIRRseries,
      updatedIso: lastISO(goldIRRseries),
      source: "exchangerate.host × open.er-api (تبدیل USD→IRR)",
      note: "محاسبهٔ روزانه: (XAU→USD) × (USD→IRR)"
    });

    // 2) ارز به ریال (USD & EUR)
    drawLineChart("chart-fx", fxSeries, "ریال");
    renderLegend("legend-fx", {
      title: "نرخ ارز به ریال — دلار و یورو — روند ۳۰ روزه",
      series: fxSeries,
      updatedIso: (rates && rates.timestamp) ? rates.timestamp : lastISO(fxSeries),
      source: (rates && rates.source) ? rates.source : "exchangerate.host"
    });

    // --- اخبار (۳۰ روز گذشته)
    NEWS_STATE.all = (news && news.items) ? news.items : [];
    NEWS_STATE.filtered = filterAndSortNewsLast30(NEWS_STATE.all);
    renderNewsPage();
  }
})();
