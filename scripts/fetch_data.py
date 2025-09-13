# scripts/fetch_data.py
# (همان نسخه‌ی پایدار قبلی با افزودن published_ts برای اخبار)

from __future__ import annotations
import json, os, sys, datetime as dt
from typing import Any, Dict, List, Optional

try:
    import requests
except Exception:
    requests = None  # type: ignore

ROOT = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(ROOT, "docs", "data")
os.makedirs(DATA_DIR, exist_ok=True)

UA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MRNews-DataFetcher/1.0; +https://github.com/)",
    "Accept": "application/json, text/xml, application/xml;q=0.9, */*;q=0.8",
}

def save_json(path: str, obj: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def http_get_json(url: str, timeout: int = 30):
    if requests is None: return None
    try:
        r = requests.get(url, headers=UA_HEADERS, timeout=timeout); r.raise_for_status(); return r.json()
    except Exception:
        return None

def http_get_bytes(url: str, timeout: int = 20):
    if requests is None: return None
    try:
        r = requests.get(url, headers=UA_HEADERS, timeout=timeout); r.raise_for_status(); return r.content
    except Exception:
        return None

def to_iso_utc(s: str) -> str:
    if not s: return dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        from email.utils import parsedate_to_datetime
        d = parsedate_to_datetime(s); 
        if d.tzinfo is None: d = d.replace(tzinfo=dt.timezone.utc)
        return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        pass
    try:
        z = s.replace("Z","+00:00"); d2 = dt.datetime.fromisoformat(z)
        if d2.tzinfo is None: d2 = d2.replace(tzinfo=dt.timezone.utc)
        return d2.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def iso_to_epoch_ms(iso: str) -> int:
    try:
        z = iso.replace("Z","+00:00"); d = dt.datetime.fromisoformat(z)
        if d.tzinfo is None: d = d.replace(tzinfo=dt.timezone.utc)
        return int(d.timestamp()*1000)
    except Exception:
        return int(dt.datetime.utcnow().timestamp()*1000)

def timeseries(base: str, symbol: str, days: int = 30):
    end = dt.date.today(); start = end - dt.timedelta(days=days)
    url = ("https://api.exchangerate.host/timeseries"
           f"?start_date={start}&end_date={end}&base={base}&symbols={symbol}")
    data = http_get_json(url); out=[]
    rates = (data or {}).get("rates",{})
    for day, vals in sorted(rates.items()):
        val = (vals or {}).get(symbol); if val is None: continue
        out.append({"t": f"{day}T12:00:00Z", "v": round(float(val),6)})
    return out

def latest(base: str, symbol: str):
    data = http_get_json(f"https://api.exchangerate.host/latest?base={base}&symbols={symbol}")
    if not data: return None
    val = (data.get("rates") or {}).get(symbol)
    return round(float(val),6) if val is not None else None

def fallback_flat_series(days:int, value:float):
    end = dt.date.today(); start = end - dt.timedelta(days=days); cur = start; out=[]
    while cur <= end: out.append({"t": f"{cur}T12:00:00Z", "v": value}); cur += dt.timedelta(days=1)
    return out

def build_fx():
    usd_irr = timeseries("USD","IRR",30) or fallback_flat_series(30, latest("USD","IRR") or 600000.0)
    eur_irr = timeseries("EUR","IRR",30) or fallback_flat_series(30, latest("EUR","IRR") or 650000.0)
    save_json(os.path.join(DATA_DIR,"fx_latest.json"),{"series":[
        {"label":"دلار (USD→IRR)","unit":"IRR","points":usd_irr},
        {"label":"یورو (EUR→IRR)","unit":"IRR","points":eur_irr},
    ]})

def build_gold():
    xau_usd = timeseries("XAU","USD",30) or fallback_flat_series(30, latest("XAU","USD") or 2300.0)
    save_json(os.path.join(DATA_DIR,"gold_latest.json"),{"series":[{"label":"طلا (XAU→USD)","unit":"USD","points":xau_usd}]})

def build_news():
    feeds=["https://feeds.bbci.co.uk/persian/rss.xml","https://www.reuters.com/world/rss"]
    items=[]
    try:
        import xml.etree.ElementTree as ET
        from urllib.parse import urlparse
        ATOM_NS="{http://www.w3.org/2005/Atom}"
        for url in feeds:
            try:
                raw = http_get_bytes(url,20); 
                if not raw: continue
                root = ET.fromstring(raw)
                for it in root.findall(".//item"):
                    title=(it.findtext("title") or "").strip()
                    link =(it.findtext("link")  or "").strip()
                    pub_iso = to_iso_utc((it.findtext("pubDate") or "").strip())
                    desc=(it.findtext("description") or "").strip()
                    if title and link:
                        items.append({"title":title,"source":urlparse(link).netloc or "RSS",
                                      "published":pub_iso,"published_ts":iso_to_epoch_ms(pub_iso),
                                      "summary":desc[:280],"url":link})
                for en in root.findall(f".//{ATOM_NS}entry"):
                    title=(en.findtext(f"{ATOM_NS}title") or "").strip()
                    linkEl=en.find(f"{ATOM_NS}link")
                    link =(linkEl.get("href") if linkEl is not None else "").strip()
                    pub_iso = to_iso_utc((en.findtext(f"{ATOM_NS}updated") or en.findtext(f"{ATOM_NS}published") or "").strip())
                    summ=(en.findtext(f"{ATOM_NS}summary") or "").strip()
                    if title and link:
                        items.append({"title":title,"source":urlparse(link).netloc or "Atom",
                                      "published":pub_iso,"published_ts":iso_to_epoch_ms(pub_iso),
                                      "summary":summ[:280],"url":link})
    except Exception:
        pass
    if not items:
        now = dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        items=[{"title":"نمونه خبر: دادهٔ RSS در دسترس نبود","source":"Demo",
                "published":now,"published_ts":iso_to_epoch_ms(now),
                "summary":"برای تست ظاهر سایت.","url":"https://example.com/"}]
    items.sort(key=lambda x:x.get("published_ts",0), reverse=True)
    save_json(os.path.join(DATA_DIR,"news_macro.json"),{"items":items[:100]})

def main():
    try:
        build_fx(); build_gold(); build_news(); print("DONE"); return 0
    except Exception as e:
        print("WARNING:",e); return 0

if __name__=="__main__": sys.exit(main())
