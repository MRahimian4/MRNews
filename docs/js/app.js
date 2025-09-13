// —— کمکی‌ها
const $ = s => document.querySelector(s);
const NF = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
const NFcompact = new Intl.NumberFormat("fa-IR", { notation: "compact", maximumFractionDigits: 1 });

const fmtTime = iso => {
  try { return new Date(iso).toLocaleString("fa-IR"); } catch { return iso; }
};
const hsl = (i, a=0.8) => `hsl(${(i*67)%360} 80% ${a*50}%)`;

// خواندن JSON (اگر نبود null)
async function fetchJSON(path){
  try{ const r = await fetch(path, {cache: "no-store"}); if(!r.ok) return null; return await r.json(); }
  catch{ return null; }
}

// دمو دیتا برای مواقع بدون فایل
function demoSeries(labels=["USD","EUR"], start=new Date(Date.now()-24*3600e3), n=48, base=50){
  return labels.map((lab, i) => {
    const pts = []; let v = base + i*2;
    for(let k=0;k<n;k++){
      v += (Math.random()-.5)*0.6;
      pts.push({ t:new Date(+start + k*30*60*1000).toISOString(), v:+v.toFixed(2) });
    }
    return { label:lab, unit:"UNIT", points:pts };
  });
}

// تبدیل به ریال بر اساس واحد سری
function toRialByUnit(value, seriesUnit, rates){
  if (seriesUnit === "IRR") return value;                      // خودش ریال است
  if (seriesUnit === "USD") return value * (rates?.USD || 0);  // USD→IRR
  if (seriesUnit === "EUR") return value * (rates?.EUR || 0);  // EUR→IRR
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

// رسم چارت خطی با محورهای خوانا (RTL-safe)
function drawLineChart(canvasId, series, legendId, unit){
  const cnv = document.getElementById(canvasId);
  const ctx = fitCanvas(cnv);

  const W = cnv.clientWidth, H = cnv.clientHeight;
  const P = { l: 64, r: 16, t: 16, b: 32 };

  // داده‌ها
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
  for(let i=0;i<=ticks;i++){
    const gy = P.t + i*(H-P.t-P.b)/ticks;
    ctx.moveTo(P.l, gy); ctx.lineTo(W-P.r, gy);
  }
  ctx.stroke();

  // محور X
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "12px system-ui";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(new Date(tMin).toLocaleTimeString("fa-IR"), P.l, H-8);
  ctx.textAlign = "right";
  ctx.fillText(new Date(tMax).toLocaleTimeString("fa-IR"), W - P.r, H-8);

  // محور Y (برچسب برای هر خط شبکه)
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
    const col = hsl(i, .9);
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath();
    s.points.sort((a,b)=>+new Date(a.t)-+new Date(b.t)).forEach((p, idx) => {
      const X = x(+new Date(p.t)), Y = y(+p.v);
      if(idx===0) ctx.moveTo(X,Y); else ctx.lineTo(X,Y);
    });
    ctx.stroke();

    if(leg){
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.innerHTML = `<span class="dot" style="background:${col}"></span>${s.label}`;
      leg.appendChild(pill);
    }
  });

  // نشانگر واحد
  if(leg){
    const unitPill = document.createElement("span");
    unitPill.className = "pill";
    unitPill.innerHTML = unit==="rial" ? "واحد: ریال" : "واحد: اصلی";
    leg.appendChild(unitPill);
  }
}

// برش بازهٔ زمانی
function sliceByRange(series, range){
  const now = Date.now();
  const win = range==="1D" ? 1 : range==="1W" ? 7 : 30; // روز
  const from = now - win * 24*3600*1000;
  return series.map(s => ({
    label: s.label,
    unit: s.unit,
    points: s.points.filter(p => +new Date(p.t) >= from)
  }));
}

// —— راه‌اندازی
(async function init(){
  // انتخاب‌گرها
  ($("#mode")).appendChild(new Option("واقع‌بینانه","واقع‌بینانه"));
  ($("#mode")).appendChild(new Option("پیش‌بینی","پیش‌بینی"));
  ["اقتصاد کلان","سیاست","انرژی","فناوری","اروپا","آمریکا"].forEach(c => ($("#category")).appendChild(new Option(c,c)));

  // رویدادها
  $("#refresh").addEventListener("click", loadAndRender);
  $("#range").addEventListener("change", loadAndRender);
  $("#unit").addEventListener("change", loadAndRender);

  await loadAndRender();
  window.addEventListener("resize", () => loadAndRender(false));

  async function loadAndRender(clearLegend=true){
    if(clearLegend){ ["legend-fx","legend-gold"].forEach(id => { const e=$("#"+id); if(e){e.innerHTML="";} }); }

    const [fx, gold, news, rates] = await Promise.all([
      fetchJSON("./data/fx_latest.json"),
      fetchJSON("./data/gold_latest.json"),
      fetchJSON("./data/news_macro.json"),
      fetchJSON("./data/rates.json") // ممکن است وجود نداشته باشد
    ]);

    const unit = $("#unit").value;   // original | rial
    const range = $("#range").value; // 1D | 1W | 1M

    // اگر فایل‌های واقعی نبودند، دمو بساز
    let fxSeries   = (fx && fx.series)   ? fx.series   : demoSeries(["USD","EUR"]);
    let goldSeries = (gold && gold.series) ? gold.series : demoSeries(["XAU"], new Date(Date.now()-24*3600e3), 48, 2300);

    // برش بازه
    fxSeries = sliceByRange(fxSeries, range);
    goldSeries = sliceByRange(goldSeries, range);

    // تبدیل واحد به «ریال» در صورت انتخاب
    if(unit === "rial"){
      fxSeries = fxSeries.map(s => ({
        label: s.label,
        unit: "IRR",
        points: s.points.map(p => ({ t:p.t, v: toRialByUnit(p.v, s.unit || "IRR", rates) }))
      }));
      goldSeries = goldSeries.map(s => ({
        label: s.label,
        unit: "IRR",
        points: s.points.map(p => ({ t:p.t, v: toRialByUnit(p.v, s.unit || "USD", rates) }))
      }));
    }

    drawLineChart("chart-fx", fxSeries, "legend-fx", unit);
    drawLineChart("chart-gold", goldSeries, "legend-gold", unit);

    // اخبار
    const items = news?.items || [];
    renderNews(items);
  }

  // نمایش اخبار
  function renderNews(items){
    const box = $("#news-list");
    if(!items.length){
      box.innerHTML = `<div class="item"><h4>خبری وجود ندارد</h4><p>دادهٔ آزمایشی</p></div>`;
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
})();
