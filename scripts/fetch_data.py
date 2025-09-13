# scripts/fetch_data.py
# گردآوری خبرها + آرشیو زمان‌دار (۶۰ روز) با ادغام اجرای قبلی
# منابع: BBC Persian, Reuters World, Reuters Middle East, Al Jazeera
# خروجی: docs/data/news_macro.json  (با فیلدهای published ISO و published_ts)
# به‌همراه FX و Gold مثل قبل (fault-tolerant)

from __future__ import annotations
import json, os, sys, datetime as dt
from typing import Any, Dict, List, Optional

# ---------- نت‌ورک ----------
try:
    import requests
except Exception:
    requests = None  # type: ignore

UA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MRNews-DataFetcher/1.1; +https://github.com/)",
    "Accept": "application/json, text/xml, application/xml;q=0.9, */*;q=0.8",
}

ROOT = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(ROOT, "docs", "data")
os.makedirs(DATA_DIR, exist_ok=True)

def http_get_json(url: str, timeout: int = 30):
    if not requests: return None
    try:
        r = requests.get(url, headers=UA_HEADERS, timeout=timeout); r.raise_for_status(); return r.json()
    except Exception:
        return None

def http_get_bytes(url: str, timeout: int = 20):
    if not requests: return None
    try:
        r = requests.get(url, headers=UA_HEADERS, timeout=timeout); r.raise_for_status(); return r.content
    except Exception:
        return None

# ---------- زمان ----------
def to_iso_utc(s: str) -> str:
    """normalize to ISO-UTC (YYYY-MM-DDTHH:MM:SSZ)"""
    import datetime as _dt
    if not s:
        return _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    # RFC822 (pubDate)
    try:
        from email.utils import parsedate_to_datetime
        d = parsedate_to_datetime(s)
        if d.tzinfo is None: d = d.replace(tzinfo=_dt.timezone.utc)
        return d.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        pass
    # ISO
    try:
        z = s.replace("Z", "+00:00")
        d2 = _dt.datetime.fromisoformat(z)
        if d2.tzinfo is None: d2 = d2.replace(tzinfo=_dt.timezone.utc)
        return d2.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def iso_to_epoch_ms(iso: str) -> int:
    import datetime as _dt
    try:
        z = iso.replace("Z", "+00:00")
        d = _dt.datetime.fromisoformat(z)
        if d.tzinfo is None: d = d.replace(tzinfo=_dt.timezone.utc)
        return int(d.timestamp()*1000)
    except Exception:
        return int(_dt.datetime.utcnow().timestamp()*1000)

# ---------- FX & Gold (مثل قبل، خلاصه‌شده/پایدار) ----------
def save_json(path: str, obj: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

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

# ---------- News: fetch + merge archive ----------
NEWS_PATH = os.path.join(DATA_DIR, "news_macro.json")

def load_existing_news() -> List[Dict[str, Any]]:
    try:
        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            items = data.get("items", [])
            # اطمینان از داشتن published_ts
            for it in items:
                if "published_ts" not in it:
                    iso = to_iso_utc(it.get("published",""))
                    it["published"] = iso
                    it["published_ts"] = iso_to_epoch_ms(iso)
            return items
    except Exception:
        return []

def fetch_feeds() -> List[Dict[str, Any]]:
    feeds = [
        "https://feeds.bbci.co.uk/persian/rss.xml",
        "https://www.reuters.com/world/rss",
        "https://www.reuters.com/world/middle-east/rss",
        "https://www.aljazeera.com/xml/rss/all.xml",
    ]
    items: List[Dict[str, Any]] = []
    try:
        import xml.etree.ElementTree as ET
        from urllib.parse import urlparse
    except Exception:
        return items

    ATOM_NS = "{http://www.w3.org/2005/Atom}"

    for url in feeds:
        try:
            raw = http_get_bytes(url, timeout=25)
            if not raw: continue
            root = ET.fromstring(raw)

            # RSS
            for it in root.findall(".//item"):
                title = (it.findtext("title") or "").strip()
                link  = (it.findtext("link") or "").strip()
                pub   = to_iso_utc((it.findtext("pubDate") or "").strip())
                desc  = (it.findtext("description") or "").strip()
                if title and link:
                    items.append({
                        "title": title,
                        "source": urlparse(link).netloc or "RSS",
                        "published": pub,
                        "published_ts": iso_to_epoch_ms(pub),
                        "summary": desc[:280],
                        "url": link,
                    })

            # Atom
            for en in root.findall(f".//{ATOM_NS}entry"):
                title = (en.findtext(f"{ATOM_NS}title") or "").strip()
                linkEl = en.find(f"{ATOM_NS}link")
                link = (linkEl.get("href") if linkEl is not None else "").strip()
                pub = to_iso_utc((en.findtext(f"{ATOM_NS}updated") or en.findtext(f"{ATOM_NS}published") or "").strip())
                summ = (en.findtext(f"{ATOM_NS}summary") or "").strip()
                if title and link:
                    items.append({
                        "title": title,
                        "source": urlparse(link).netloc or "Atom",
                        "published": pub,
                        "published_ts": iso_to_epoch_ms(pub),
                        "summary": summ[:280],
                        "url": link,
                    })
        except Exception:
            continue

    return items

def merge_and_save_news() -> None:
    now_ms = int(dt.datetime.utcnow().timestamp()*1000)
    cutoff = now_ms - 60*24*3600*1000  # ۶۰ روز اخیر

    existing = load_existing_news()
    fresh = fetch_feeds()

    # ایندکس بر اساس URL برای ادغام
    by_url: Dict[str, Dict[str, Any]] = {}
    for it in existing:
        u = (it.get("url") or "").strip()
        if u: by_url[u] = it

    added = 0
    for it in fresh:
        u = (it.get("url") or "").strip()
        if not u: continue
        if u in by_url:
            # به‌روزرسانی timestamp/title/summary اگر جدیدتر بود
            old = by_url[u]
            if it.get("published_ts", 0) > old.get("published_ts", 0):
                by_url[u] = it
        else:
            by_url[u] = it
            added += 1

    merged = list(by_url.values())
    # فقط ۶۰ روز اخیر
    merged = [it for it in merged if it.get("published_ts", 0) >= cutoff]
    # مرتب‌سازی نزولی
    merged.sort(key=lambda x: x.get("published_ts", 0), reverse=True)
    # محدودیت بالا
    merged = merged[:400]

    save_json(NEWS_PATH, {"items": merged})
    print(f"NEWS: existing={len(existing)} fetched={len(fresh)} merged={len(merged)} added_now={added}")

# ---------- main ----------
def main() -> int:
    try:
        build_fx()
        build_gold()
        merge_and_save_news()
        print("DONE")
        return 0
    except Exception as e:
        # در بدترین حالت خروجی حداقلی بنویس
        try:
            save_json(os.path.join(DATA_DIR,"fx_latest.json"),{
                "series":[{"label":"دلار (USD→IRR)","unit":"IRR","points":fallback_flat_series(7,600000.0)}]
            })
            save_json(os.path.join(DATA_DIR,"gold_latest.json"),{
                "series":[{"label":"طلا (XAU→USD)","unit":"USD","points":fallback_flat_series(7,2300.0)}]
            })
            now_iso = dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
            save_json(NEWS_PATH, {"items":[{
                "title":"نمونه خبر (fallback)","source":"Local",
                "published":now_iso,"published_ts":iso_to_epoch_ms(now_iso),
                "summary":"اتصال به فیدهای خبری برقرار نشد.","url":"https://example.com/"
            }]})
        except Exception:
            pass
        print("WARNING:", e)
        return 0

if __name__ == "__main__":
    sys.exit(main())
