// —— ابزارهای عمومی
const $ = s => document.querySelector(s);
const NF = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
const NFcompact = new Intl.NumberFormat("fa-IR", { notation: "compact", maximumFractionDigits: 1 });
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString("fa-IR"); } catch { return iso; } };
const fmtDateTime = iso => { try { return new Date(iso).toLocaleString("fa-IR"); } catch { return iso; } };
const hsl = (i, a=0.9) => `hsl(${(i*67)%360} 80% ${a*50}%)`;

// حالت اخبار (برای صفحه‌بندی)
const NEWS_STATE = { all: [], filtered: [], page: 1, pageSize: 10 };

// Tooltip state per-chart
const ChartStates = {}; // id -> { series, geom, x, y, P, W, H, tMin, tMax, yMin, yMax }

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

// ————— Chart Core —————
function fitCanvas(cnv){
  const rect = cnv.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  cnv.width = Math.floor(rect.width * ratio);
  cnv.height = Math.floor(rect.height * ratio);
  const ctx = cnv.getContext("2d");
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return ctx;
}

function get5DayTicks(tMin, tMax){
  const MS_DAY = 24*3600*1000;
  const start = new Date(tMin);
  start.setHours(0,0,0,0);
  // به اولین مضرب 5 روز برسیم
  const offset = ((start.getTime() - tMin) % (5*MS_DAY) + 5*MS_DAY) % (5*MS_DAY);
  let t = start.getTime() + (offset || 0);
  const ticks = [];
  for(; t <= tMax + MS_DAY; t += 5*MS_DAY){
    ticks.push(t);
  }
  return ticks;
}

function drawLabel(ctx, text, x, y, align="left"){
  ctx.save();
  ctx.font = "12px system-ui";
  const padX = 6, padY = 3;
  const w = ctx.measureText(text).width + padX*2;
  const h = 20;
  let bx = x, by = y - h/2;
  if(align==="right") bx = x - w;
  if(align==="center") bx = x - w/2;
  // پس‌زمینه
  ctx.fillStyle = "rgba(15,22,34,.95)";
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 6);
  ctx.fill(); ctx.stroke();
  // متن
  ctx.fillStyle = "#e5e7eb";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, bx + padX, y);
  ctx.restore();
}

// Base render (شبکه، خطوط، برچسب‌های ۵روزه، آخرین مقدار)
function renderBaseChart(canvasId, series, unitLabel=""){
  const cnv = document.getElementById(canvasId);
  const ctx = fitCanvas(cnv);
  const W = cnv.clientWidth, H = cnv.clientHeight;
  const P = { l: 64, r: 16, t: 16, b: 40 }; // کمی پایین بیشتر برای برچسب تاریخ

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

  // grid Y
  ctx.strokeStyle = "#273244"; ctx.lineWidth = 1;
  ctx.beginPath();
  const ticksY = 4;
  for(let i=0;i<=ticksY;i++){ const gy = P.t + i*(H-P.t-P.b)/ticksY; ctx.moveTo(P.l, gy); ctx.lineTo(W-P.r, gy); }
  ctx.stroke();

  // Y labels (فقط اعداد؛ عنوان محور حذف شد تا تداخلی نداشته باشد)
  ctx.fillStyle = "#cbd5e1"; ctx.font = "12px system-ui"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
  for(let i=0;i<=ticksY;i++){
    const val = yMax - (i*(yMax-yMin)/ticksY);
    const yy  = P.t + i*(H-P.t-P.b)/ticksY;
    ctx.fillText(NFcompact.format(val), P.l - 8, yy);
  }

  // grid X: هر ۵ روز
  const ticks5 = get5DayTicks(tMin, tMax);
  ctx.save();
  ctx.setLineDash([4,4]);
  ctx.strokeStyle = "#1e2a3a";
  ctx.beginPath();
  ticks5.forEach(tk => {
    const gx = x(tk);
    if (gx >= P.l && gx <= W-P.r){
      ctx.moveTo(gx, P.t); ctx.lineTo(gx, H-P.b);
    }
  });
  ctx.stroke();
  ctx.restore();

  // X labels: تاریخ‌های ۵ روزه
  ctx.fillStyle = "#9fb0c5"; ctx.font = "11px system-ui"; ctx.textBaseline = "alphabetic"; ctx.textAlign = "center";
  ticks5.forEach(tk => {
    const gx = x(tk);
    if (gx >= P.l && gx <= W-P.r){
      ctx.fillText(fmtDate(new Date(tk).toISOString()), gx, H-8);
    }
  });

  // series lines
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

  // مقادیر هر ۵ روز: نزدیک‌ترین نقطه هر سری
  ctx.font = "12px system-ui";
  series.forEach((s, i) => {
    const col = hsl(i,.9);
    const arr = s.points.slice().sort((a,b)=>+new Date(a.t)-+new Date(b.t));
    ticks5.forEach(tk => {
      // نزدیک‌ترین نقطه (در محدودهٔ ~ 48 ساعت)
      let nearest = null, dmin = Infinity;
      arr.forEach(p => {
        const d = Math.abs(+new Date(p.t) - tk);
        if(d < dmin){ dmin = d; nearest = p; }
      });
      if(nearest && dmin <= 48*3600*1000){
        const X = x(+new Date(nearest.t)), Y = y(+nearest.v);
        // نقطهٔ کوچک
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(X, Y, 2.5, 0, Math.PI*2); ctx.fill();
        // برچسب مقدار (compact)
        drawLabel(ctx, NFcompact.format(nearest.v), X + 6, Y - 14, "left");
      }
    });
  });

  // آخرین مقدار هر سری
  series.forEach((s, i) => {
    const col = hsl(i,.9);
    const last = s.points.slice().sort((a,b)=>+new Date(a.t)-+new Date(b.t)).at(-1);
    if(!last) return;
    const X = x(+new Date(last.t)), Y = y(+last.v);
    // دایرهٔ آخرین نقطه
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X, Y, 3, 0, Math.PI*2); ctx.fill();
    // برچسب عدد آخر (راست‌چین کنار نقطه تا بیرون نزنه)
    drawLabel(ctx, NFcompact.format(last.v), Math.min(X+8, W-P.r-4), Y, "left");
  });

  // ذخیرهٔ وضعیت برای رویدادهای Hover
  ChartStates[canvasId] = { series, P, W, H, tMin, tMax, yMin, yMax, x, y };
}

function ensureTooltip(id){
  const elId = `tt-${id}`;
  let tip = document.getElementById(elId);
  if(!tip){
    tip = document.createElement("div");
    tip.className = "chart-tooltip";
    tip.id = elId;
    tip.style.display = "none";
    document.body.appendChild(tip);
  }
  return tip;
}

function attachHover(canvasId){
  const cnv = document.getElementById(canvasId);
  if(!cnv || cnv.__hoverAttached) return;
  cnv.__hoverAttached = true;

  const tip = ensureTooltip(canvasId);

  cnv.addEventListener("mouseleave", () => {
    tip.style.display = "none";
    // بازنقاشی بدون لایهٔ راهنما
    const st = ChartStates[canvasId];
    if(st) renderBaseChart(canvasId, st.series, "ریال");
  });

  cnv.addEventListener("mousemove", (e) => {
    const st = ChartStates[canvasId];
    if(!st) return;
    const rect = cnv.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { P, W, H, tMin, tMax, x, y } = st;

    // بیرون از ناحیه رسم؟
    if(px < P.l || px > W-P.r || py < P.t || py > H-P.b){
      tip.style.display = "none";
      renderBaseChart(canvasId, st.series, "ریال");
      return;
    }

    // زمان متناظر با x
    const ratio = (px - P.l) / (W - P.l - P.r);
    const tHover = tMin + ratio * (tMax - tMin);

    // نزدیک‌ترین نقاط هر سری
    const rows = [];
    const markers = [];
    st.series.forEach((s, i) => {
      let nearest = null, dmin = Infinity;
      s.points.forEach(p => {
        const d = Math.abs(+new Date(p.t) - tHover);
        if(d < dmin){ dmin = d; nearest = p; }
      });
      if(nearest){
        rows.push({ label: s.label, color: hsl(i,.9), value: nearest.v });
        markers.push({ x: x(+new Date(nearest.t)), y: y(nearest.v), color: hsl(i,.9) });
      }
    });

    // بازکِشی پایه + لایهٔ راهنما
    renderBaseChart(canvasId, st.series, "ریال");
    const ctx = cnv.getContext("2d");
    // خط عمودی
    ctx.save();
    ctx.strokeStyle = "rgba(100,150,255,.5)";
    ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(px, st.P.t); ctx.lineTo(px, st.H - st.P.b); ctx.stroke();
    ctx.restore();
    // مارکرها
    markers.forEach(m => {
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(m.x, m.y, 3.5, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = "#0b0f14"; ctx.lineWidth = 1; ctx.stroke();
    });

    // Tooltip HTML
    const html = [
      `<div class="row" style="margin-bottom:4px"><strong>${fmtDateTime(new Date(tHover).toISOString())}</strong></div>`,
      ...rows.map(r => `<div class="row"><span><span class="dot" style="background:${r.color}"></span> ${r.label}</span><span class="val">${NFcompact.format(r.value)}</span></div>`)
    ].join("");
    tip.innerHTML = html;
    tip.style.display = "block";

    // جایگذاری Tooltip
    const pad = 14;
    let left = e.clientX + pad, top = e.clientY + pad;
    const vw = window.innerWidth, vh = window.innerHeight;
    const tw = tip.offsetWidth || 220, th = tip.offsetHeight || 80;
    if(left + tw > vw - 8) left = e.clientX - tw - pad;
    if(top + th > vh - 8) top = e.clientY - th - pad;
    tip.style.left = `${left}px`;
    tip.style.top  = `${top}px`;
  });
}

// Legend
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
      fetchJSON("./data/fx_latest.json"),      // USD→IRR و EUR→IRR (۳۰ روزه)
      fetchJSON("./data/gold_latest.json"),    // XAU→USD (۳۰ روزه)
      fetchJSON("./data/news_macro.json"),
      fetchJSON("./data/rates.json")           // timestamp و منبع
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

    // ———— رسم نمودارها + Hover
    renderBaseChart("chart-gold", goldIRRseries, "ریال");
    attachHover("chart-gold");
    renderLegend("legend-gold", {
      title: "قیمت هر اونس طلا به ریال — روند ۳۰ روزه",
      series: goldIRRseries,
      updatedIso: lastISO(goldIRRseries),
      source: "exchangerate.host × open.er-api (تبدیل USD→IRR)",
      note: "محاسبهٔ روزانه: (XAU→USD) × (USD→IRR)"
    });

    renderBaseChart("chart-fx", fxSeries, "ریال");
    attachHover("chart-fx");
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
