// --- توابع کمکی ---
const $ = sel => document.querySelector(sel);
const fmtTime = iso => {
  try {
    return new Date(iso).toLocaleString("fa-IR");
  } catch {
    return iso;
  }
};
const hsl = (i, a=0.8) => `hsl(${(i*67)%360} 80% ${a*50}%)`;

// تبدیل به ریال (عدد تستی فعلاً)
function toRial(value, currency){
  // نرخ‌های تقریبی تستی (بعداً از API می‌گیریم)
  const rates = { USD: 600000, EUR: 650000, XAU: 35000000 }; // هر واحد
  if(!rates[currency]) return null;
  return value * rates[currency];
}

// چارت ساده (دلار/یورو/ریال یا طلا/ریال)
function fitCanvas(cnv){
  const rect = cnv.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  cnv.width = Math.floor(rect.width * ratio);
  cnv.height = Math.floor(rect.height * ratio);
  const ctx = cnv.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return ctx;
}

function drawLineChart(canvasId, series, legendId){
  const cnv = document.getElementById(canvasId);
  const ctx = fitCanvas(cnv);
  const W = cnv.clientWidth, H = cnv.clientHeight;
  const P = {l:40, r:12, t:10, b:24};

  const points = series.flatMap(s => s.points.map(p => ({t: +new Date(p.t), v: +p.v})));
  if(!points.length){ ctx.fillStyle="#94a3b8"; ctx.fillText("داده‌ای نیست", 12, 20); return; }
  const tMin = Math.min(...points.map(p => p.t));
  const tMax = Math.max(...points.map(p => p.t));
  const vMin = Math.min(...points.map(p => p.v));
  const vMax = Math.max(...points.map(p => p.v));
  const pad = (vMax - vMin) * 0.1 || 1;
  const yMin = vMin - pad, yMax = vMax + pad;

  const x = t => P.l + ( (t - tMin) / (tMax - tMin || 1) ) * (W - P.l - P.r);
  const y = v => H - P.b - ( (v - yMin) / (yMax - yMin) ) * (H - P.t - P.b);

  ctx.strokeStyle = "#273244"; ctx.lineWidth = 1;
  ctx.beginPath();
  for(let i=0;i<=4;i++){
    const gy = P.t + i*(H-P.t-P.b)/4;
    ctx.moveTo(P.l, gy); ctx.lineTo(W-P.r, gy);
  }
  ctx.stroke();

  ctx.fillStyle="#9ca3af"; ctx.font="12px system-ui";
  ctx.fillText(new Date(tMin).toLocaleTimeString("fa-IR"), P.l, H-6);
  ctx.fillText(new Date(tMax).toLocaleTimeString("fa-IR"), W-120, H-6);
  ctx.fillText(yMax.toFixed(2), 4, P.t+10);
  ctx.fillText(yMin.toFixed(2), 4, H-P.b);

  series.forEach((s, i) => {
    const col = hsl(i, .9);
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath();
    s.points.sort((a,b)=>+new Date(a.t)-+new Date(b.t));
    s.points.forEach((p, idx) => {
      const X = x(+new Date(p.t)), Y = y(+p.v);
      if(idx===0) ctx.moveTo(X,Y); else ctx.lineTo(X,Y);
    });
    ctx.stroke();

    const leg = document.getElementById(legendId);
    if(leg && !leg.dataset.filled){ leg.innerHTML = ""; leg.dataset.filled = "1"; }
    if(leg){
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.innerHTML = `<span class="dot" style="background:${col}"></span>${s.label}`;
      leg.appendChild(pill);
    }
  });
}

// نمایش اخبار
function renderNews(items){
  const box = $("#news-list");
  if(!items || !items.length){
    box.innerHTML = `<div class="item"><h4>خبری وجود ندارد</h4><p>دادهٔ آزمایشی</p></div>`;
    return;
  }
  box.innerHTML = items.map(it => `
    <div class="item">
      <h4>${it.title}</h4>
      <div class="meta">${it.source || "نامشخص"} • ${fmtTime(it.published)}</div>
      ${it.summary ? `<p>${it.summary}</p>` : ""}
      ${it.url ? `<div style="margin-top:6px"><a class="badge" href="${it.url}" target="_blank">مشاهده خبر →</a></div>` : ""}
    </div>
  `).join("");
}

async function fetchJSON(path){
  try{ const res = await fetch(path,{cache:"no-store"}); if(!res.ok) return null; return await res.json(); }
  catch{ return null; }
}

// داده نمایشی
function demoSeries(labels=["USD","EUR"], start=new Date(Date.now()-6*3600e3), n=36, base=50){
  const series = labels.map((lab, i) => {
    const pts = []; let v = base + i*2;
    for(let k=0;k<n;k++){ v += (Math.random()-.5)*0.6; pts.push({t:new Date(+start + k*10*60*1000).toISOString(), v:+v.toFixed(2)}); }
    return { label: lab, points: pts };
  });
  return series;
}

// شروع
(async function init(){
  const config = await fetchJSON("./config.json");
  const modes = (config && config.modes) || ["واقع‌بینانه","پیش‌بینی"];
  const cats  = (config && config.categories) || ["اقتصاد کلان","سیاست","انرژی","فناوری"];

  modes.forEach(m => $("#mode").appendChild(new Option(m,m)));
  cats.forEach(c => $("#category").appendChild(new Option(c,c)));

  $("#refresh").addEventListener("click", loadAndRender);
  await loadAndRender();
  window.addEventListener("resize", () => loadAndRender(false));

  async function loadAndRender(showLegendClear=true){
    if(showLegendClear){ ["legend-fx","legend-gold"].forEach(id => { const e=$("#"+id); if(e){e.innerHTML=""; e.dataset.filled=""; } }); }

    const fx = await fetchJSON("./data/fx_latest.json");
    const gold = await fetchJSON("./data/gold_latest.json");
    const news = await fetchJSON("./data/news_macro.json");

    const fxSeries = fx?.series || demoSeries(["USD","EUR"], new Date(Date.now()-24*3600e3), 48, 50);
    const goldSeries = gold?.series || demoSeries(["XAU"], new Date(Date.now()-24*3600e3), 48, 2300);

    // اضافه کردن نسخه ریالی
    fxSeries.forEach(s=>{
      const rialPts = s.points.map(p=>({t:p.t,v:toRial(p.v,s.label)}));
      fxSeries.push({label:`${s.label} (ریال)`, points: rialPts});
    });
    goldSeries.forEach(s=>{
      const rialPts = s.points.map(p=>({t:p.t,v:toRial(p.v,"XAU")}));
      goldSeries.push({label:`${s.label} (ریال)`, points: rialPts});
    });

    drawLineChart("chart-fx", fxSeries, "legend-fx");
    drawLineChart("chart-gold", goldSeries, "legend-gold");
    renderNews(news?.items || []);
  }
})();
 
