#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os, json, time, math, re
from datetime import datetime, timedelta, timezone
import requests

DATA_DIR = os.path.join("docs", "data")
os.makedirs(DATA_DIR, exist_ok=True)

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def get_json(url, headers=None, params=None, timeout=20):
    r = requests.get(url, headers=headers or {}, params=params or {}, timeout=timeout)
    r.raise_for_status()
    return r.json()

def parse_timeseries_generic(payload):
    """
    ورودی‌های مختلف را به لیست [{t, v}] نرمال می‌کند.
    از کلیدهای متداول مثل price/value/close و time/timestamp/date پشتیبانی می‌کند.
    """
    cand = None
    if isinstance(payload, dict):
        for key in ["data", "result", "values", "series", "prices", "items"]:
            if key in payload and isinstance(payload[key], list):
                cand = payload[key]; break
        if cand is None and "chart" in payload and isinstance(payload["chart"], list):
            cand = payload["chart"]
    elif isinstance(payload, list):
        cand = payload
    else:
        return []

    out = []
    for it in cand:
        if isinstance(it, dict):
            # زمان
            t = it.get("time") or it.get("timestamp") or it.get("t") or it.get("date") or it.get("d")
            if isinstance(t, (int, float)):  # unix seconds/millis
                t = int(t)
                if t > 10**12:  # ms
                    ts = datetime.fromtimestamp(t/1000, tz=timezone.utc)
                else:
                    ts = datetime.fromtimestamp(t, tz=timezone.utc)
                t_iso = ts.isoformat()
            elif isinstance(t, str):
                # اگر فقط تاریخ بود، به نیمه‌شب UTC ببریم
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}", t):
                    t_iso = datetime.fromisoformat(t+"T00:00:00+00:00").isoformat()
                else:
                    try:
                        t_iso = datetime.fromisoformat(t.replace("Z","+00:00")).isoformat()
                    except Exception:
                        try:
                            t_iso = datetime.fromtimestamp(int(t), tz=timezone.utc).isoformat()
                        except Exception:
                            continue
            else:
                continue
            # مقدار
            v = None
            for k in ["price","value","close","v","p","c","rate"]:
                if k in it:
                    v = it[k]; break
            if v is None and isinstance(it.get("y"), (int,float)):
                v = it["y"]
            try:
                v = float(v)
            except Exception:
                continue
            out.append({"t": t_iso, "v": v})
        elif isinstance(it, (list, tuple)) and len(it) >= 2:
            t, v = it[0], it[1]
            try:
                t = int(t)
                if t > 10**12:
                    t_iso = datetime.fromtimestamp(t/1000, tz=timezone.utc).isoformat()
                else:
                    t_iso = datetime.fromtimestamp(t, tz=timezone.utc).isoformat()
                v = float(v)
                out.append({"t": t_iso, "v": v})
            except Exception:
                continue
    # مرتب‌سازی و یکتا‌سازی روزانه
    out.sort(key=lambda x: x["t"])
    uniq = {}
    for item in out:
        d = item["t"][:10]
        uniq[d] = item  # آخرین مقدار روز
    return [uniq[k] for k in sorted(uniq.keys())]

# -------------------- Free-market providers --------------------

def fetch_priceto_day(symbol: str):
    """
    منبع آزاد: https://api.priceto.day
    - History: /v1/history/irr/{symbol}
    - Chart:   /v1/chart/irr/{symbol}  (fallback)
    - Latest:  /v1/latest/irr/{symbol} (fallback)
    """
    base = "https://api.priceto.day/v1"
    try:
        j = get_json(f"{base}/history/irr/{symbol}")
        series = parse_timeseries_generic(j)
        if not series:
            j = get_json(f"{base}/chart/irr/{symbol}")
            series = parse_timeseries_generic(j)
        if not series:
            j = get_json(f"{base}/latest/irr/{symbol}")
            series = parse_timeseries_generic(j)
        return series
    except Exception:
        return []

def fetch_bonbast_series(symbol: str, api_key: str):
    """
    Bonbast (نیازمند کلید). چون جزئیات endpoint مستندات عمومی ندارد،
    این تابع فقط اسکلت را فراهم می‌کند. اگر کلید و URL دقیق داری، اینجا بگذار.
    """
    if not api_key:
        return []
    # TODO: endpoint واقعی را جایگزین کن
    # مثال فرضی:
    # url = f"https://api.bonbast.com/v1/history?pair={symbol}_irr&days=60&token={api_key}"
    # j = get_json(url)
    # return parse_timeseries_generic(j)
    return []

def fetch_tgju_series(symbol: str, api_key: str):
    """
    TGJU وب‌سرویس رسمی (نیازمند کلید/قرارداد). اسکلت آماده است.
    """
    if not api_key:
        return []
    # TODO: endpoint واقعی TGJU را جایگزین کن
    # url = f"https://api.tgju.org/v1/forex/history?symbol={symbol}&apikey={api_key}"
    # j = get_json(url)
    # return parse_timeseries_generic(j)
    return []

def get_free_market_series(days: int = 30):
    provider = (os.getenv("FREE_MARKET_PROVIDER") or "priceto").strip().lower()
    usd = eur = []

    if provider == "priceto":
        usd = fetch_priceto_day("usd")
        eur = fetch_priceto_day("eur")
        source = "priceto.day (Free-market IRR pairs)"
    elif provider == "bonbast":
        usd = fetch_bonbast_series("usd", os.getenv("BONBAST_API_KEY",""))
        eur = fetch_bonbast_series("eur", os.getenv("BONBAST_API_KEY",""))
        source = "Bonbast API (Free-market)"
    elif provider == "tgju":
        usd = fetch_tgju_series("usd", os.getenv("TGJU_API_KEY",""))
        eur = fetch_tgju_series("eur", os.getenv("TGJU_API_KEY",""))
        source = "TGJU WebService (Free-market)"
    else:
        # پیش‌فرض امن
        usd = fetch_priceto_day("usd")
        eur = fetch_priceto_day("eur")
        source = "priceto.day (Free-market IRR pairs)"

    # آخرین 30 روز
    def last_n(arr, n):
        arr = sorted(arr, key=lambda x: x["t"])
        return arr[-n:] if len(arr) > n else arr

    usd = last_n(usd, days)
    eur = last_n(eur, days)
    return usd, eur, source

# -------------------- Gold (XAU→USD) from metals/external  --------------------

def fetch_xau_usd_series(days: int = 30):
    """
    تلاش برای گرفتن XAU→USD روزانه؛ اگر سرویس کلیددار تنظیم شد از آن استفاده می‌کنیم،
    در غیر اینصورت از exchangerate.host (تقریبی) کمک می‌گیریم.
    """
    prov = (os.getenv("METALS_PROVIDER") or "").strip().lower()
    api_key = os.getenv("METALS_API_KEY","").strip()

    # providers سفارشی: metalsapi, metalpriceapi, goldapi ... (اگر داشتی اضافه کن)
    try:
        if prov == "metalsapi" and api_key:
            # نمونهٔ فرضی:
            # url = f"https://metals-api.com/api/timeseries?access_key={api_key}&start_date=...&end_date=...&base=XAU&symbols=USD"
            # j = get_json(url); return parse_timeseries_generic(j)
            pass
    except Exception:
        pass

    # fallback ساده با exchangerate.host: (استفاده از نرخ معکوس XAUUSD≈USD/XAU)
    try:
        end = datetime.utcnow().date()
        start = end - timedelta(days=40)
        url = f"https://api.exchangerate.host/timeseries"
        j = get_json(url, params={
            "start_date": start.isoformat(), "end_date": end.isoformat(),
            "base": "XAU", "symbols": "USD"
        })
        # به قالب [{t,v}] تبدیل
        points = []
        if isinstance(j, dict) and j.get("rates"):
            for d, obj in sorted(j["rates"].items()):
                usd = obj.get("USD")
                if usd:
                    points.append({"t": d+"T00:00:00+00:00", "v": float(usd)})
        # آخرین 30 روز
        points = points[-30:] if len(points) > 30 else points
        return points
    except Exception:
        return []

# -------------------- Compose & Save --------------------

def multiply_series(a, b):
    """ a: [{t,v}] with XAU→USD ; b: [{t,v}] with USD→IRR ; sync by nearest <= t """
    if not a or not b: return []
    b_sorted = sorted(b, key=lambda x: x["t"])
    out = []
    j = 0
    last = b_sorted[0]["v"]
    for p in sorted(a, key=lambda x: x["t"]):
        tA = p["t"]
        # حرکت جلو تا آخرین نرخِ قبل/هم‌زمان
        while j+1 < len(b_sorted) and b_sorted[j+1]["t"] <= tA:
            j += 1
            last = b_sorted[j]["v"]
        out.append({"t": tA, "v": float(p["v"]) * float(last)})
    return out

def main():
    days = 30

    # 1) نرخ آزاد دلار/یورو به ریال (۳۰ روزه)
    usd_irr, eur_irr, source = get_free_market_series(days=days)

    fx_series = [
        {"label": "دلار (USD→IRR، بازار آزاد)", "unit": "IRR", "points": usd_irr},
        {"label": "یورو  (EUR→IRR، بازار آزاد)", "unit": "IRR", "points": eur_irr},
    ]
    write_json(os.path.join(DATA_DIR, "fx_latest.json"), {"series": fx_series})

    # 2) XAU→USD و سپس XAU→IRR با نرخ آزاد USD
    xau_usd = fetch_xau_usd_series(days=days)
    xau_irr = multiply_series(xau_usd, usd_irr)
    gold_series = [
        {"label": "طلا (XAU→IRR، بر اساس USD آزاد)", "unit": "IRR", "points": xau_irr}
    ]
    write_json(os.path.join(DATA_DIR, "gold_latest.json"), {"series": gold_series})

    # 3) rates.json (برای نمایش منبع/زمان)
    write_json(os.path.join(DATA_DIR, "rates.json"), {
        "source": f"{source}",
        "timestamp": now_iso()
    })

    # 4) خبرها (اگر از قبل داری همون رو نگه می‌داریم؛ در غیر اینصورت فایل خالی نسازه)
    news_path = os.path.join(DATA_DIR, "news_macro.json")
    if not os.path.exists(news_path):
        write_json(news_path, {"items": []})

if __name__ == "__main__":
    main()
