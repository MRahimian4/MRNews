# scripts/fetch_data.py
# جمع‌آوری نرخ‌ها (USD→IRR, EUR→IRR, XAU→USD) + خبرهای RSS
# خروجی‌ها: docs/data/fx_latest.json , docs/data/gold_latest.json , docs/data/news_macro.json
# پایدار در برابر خطا؛ زمان خبرها به ISO-UTC تبدیل می‌شود تا فیلتر زمانی درست کار کند.

from __future__ import annotations
import json, os, sys, datetime as dt
from typing import Any, Dict, List, Optional

# --- وابستگی شبکه
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

# ---------------------------- utils

def save_json(path: str, obj: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def http_get_json(url: str, timeout: int = 30) -> Optional[Dict[str, Any]]:
    if requests is None:
        return None
    try:
        r = requests.get(url, headers=UA_HEADERS, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None

def http_get_bytes(url: str, timeout: int = 20) -> Optional[bytes]:
    if requests is None:
        return None
    try:
        r = requests.get(url, headers=UA_HEADERS, timeout=timeout)
        r.raise_for_status()
        return r.content
    except Exception:
        return None

def to_iso_utc(s: str) -> str:
    """تبدیل رشته‌های زمان RSS/Atom به ISO-UTC (YYYY-MM-DDTHH:MM:SSZ)"""
    if not s:
        return dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    # 1) تلاش با RFC822 (pubDate)
    try:
        from email.utils import parsedate_to_datetime
        d = parsedate_to_datetime(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        pass
    # 2) تلاش با ISOهای مختلف
    try:
        z = s.replace("Z", "+00:00")
        d2 = dt.datetime.fromisoformat(z)
        if d2.tzinfo is None:
            d2 = d2.replace(tzinfo=dt.timezone.utc)
        return d2.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

# ---------------------------- FX

def timeseries(base: str, symbol: str, days: int = 30) -> List[Dict[str, Any]]:
    end = dt.date.today()
    start = end - dt.timedelta(days=days)
    url = ("https://api.exchangerate.host/timeseries"
           f"?start_date={start}&end_date={end}&base={base}&symbols={symbol}")
    data = http_get_json(url)
    out: List[Dict[str, Any]] = []
    rates = (data or {}).get("rates", {})
    for day, vals in sorted(rates.items()):
        val = (vals or {}).get(symbol)
        if val is None: 
            continue
        out.append({"t": f"{day}T12:00:00Z", "v": round(float(val), 6)})
    return out

def latest(base: str, symbol: str) -> Optional[float]:
    url = f"https://api.exchangerate.host/latest?base={base}&symbols={symbol}"
    data = http_get_json(url)
    if not data:
        return None
    val = (data.get("rates") or {}).get(symbol)
    return round(float(val), 6) if val is not None else None

def fallback_flat_series(days: int, value: float) -> List[Dict[str, Any]]:
    end = dt.date.today()
    start = end - dt.timedelta(days=days)
    cur = start
    out: List[Dict[str, Any]] = []
    while cur <= end:
        out.append({"t": f"{cur}T12:00:00Z", "v": value})
        cur += dt.timedelta(days=1)
    return out

def build_fx() -> None:
    usd_irr = timeseries("USD", "IRR", days=30)
    eur_irr = timeseries("EUR", "IRR", days=30)
    if not usd_irr:
        last = latest("USD", "IRR") or 600000.0
        usd_irr = fallback_flat_series(30, last)
    if not eur_irr:
        last = latest("EUR", "IRR") or 650000.0
        eur_irr = fallback_flat_series(30, last)
    save_json(os.path.join(DATA_DIR, "fx_latest.json"), {
        "series": [
            {"label": "دلار (USD→IRR)", "unit": "IRR", "points": usd_irr},
            {"label": "یورو (EUR→IRR)", "unit": "IRR", "points": eur_irr},
        ]
    })

# ---------------------------- Gold

def build_gold() -> None:
    xau_usd = timeseries("XAU", "USD", days=30)
    if not xau_usd:
        last = latest("XAU", "USD") or 2300.0
        xau_usd = fallback_flat_series(30, last)
    save_json(os.path.join(DATA_DIR, "gold_latest.json"), {
        "series": [{"label": "طلا (XAU→USD)", "unit": "USD", "points": xau_usd}]
    })

# ---------------------------- News (RSS/Atom)

def build_news() -> None:
    feeds = [
        "https://feeds.bbci.co.uk/persian/rss.xml",
        "https://www.reuters.com/world/rss",
    ]
    items: List[Dict[str, Any]] = []
    try:
        import xml.etree.ElementTree as ET
        from urllib.parse import urlparse
    except Exception:
        ET = None  # type: ignore

    if ET is not None:
        for url in feeds:
            try:
                raw = http_get_bytes(url, timeout=20)
                if not raw:
                    continue
                root = ET.fromstring(raw)

                # RSS items
                for it in root.findall(".//item"):
                    title = (it.findtext("title") or "").strip()
                    link  = (it.findtext("link") or "").strip()
                    pub   = to_iso_utc((it.findtext("pubDate") or "").strip())
                    desc  = (it.findtext("description") or "").strip()
                    if title and link:
                        items.append({
                            "title": title,
                            "source": (urlparse(link).netloc or "RSS"),
                            "published": pub,      # ← همیشه ISO-UTC
                            "summary": desc[:280],
                            "url": link,
                        })

                # Atom entries
                ATOM_NS = "{http://www.w3.org/2005/Atom}"
                for entry in root.findall(f".//{ATOM_NS}entry"):
                    title  = (entry.findtext(f"{ATOM_NS}title") or "").strip()
                    linkEl = entry.find(f"{ATOM_NS}link")
                    link   = (linkEl.get("href") if linkEl is not None else "").strip()
                    pub    = to_iso_utc((entry.findtext(f"{ATOM_NS}updated") or
                                         entry.findtext(f"{ATOM_NS}published") or "").strip())
                    summ   = (entry.findtext(f"{ATOM_NS}summary") or "").strip()
                    if title and link:
                        items.append({
                            "title": title,
                            "source": (urlparse(link).netloc or "Atom"),
                            "published": pub,      # ← ISO-UTC
                            "summary": summ[:280],
                            "url": link,
                        })
            except Exception:
                continue

    if not items:
        now = dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        items = [{
            "title": "نمونه خبر: دادهٔ RSS در دسترس نبود",
            "source": "Demo",
            "published": now,
            "summary": "برای تست ظاهر سایت. ممکن است دسترسی شبکه‌ی Runner محدود باشد.",
            "url": "https://example.com/"
        }]

    # مرتب‌سازی نزولی زمان
    items.sort(key=lambda x: x.get("published",""), reverse=True)
    save_json(os.path.join(DATA_DIR, "news_macro.json"), {"items": items[:30]})

# ---------------------------- main

def main() -> int:
    try:
        build_fx()
        build_gold()
        build_news()
        print("DONE (ISO timestamps ready)")
        return 0
    except Exception as e:
        # خروجی حداقلی حتی در خطای غیرمنتظره
        try:
            save_json(os.path.join(DATA_DIR, "fx_latest.json"), {
                "series": [{"label": "دلار (USD→IRR)", "unit": "IRR",
                            "points": fallback_flat_series(7, 600000.0)}]
            })
            save_json(os.path.join(DATA_DIR, "gold_latest.json"), {
                "series": [{"label": "طلا (XAU→USD)", "unit": "USD",
                            "points": fallback_flat_series(7, 2300.0)}]
            })
            now = dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
            save_json(os.path.join(DATA_DIR, "news_macro.json"), {
                "items": [{
                    "title": "نمونه خبر (fallback)",
                    "source": "Local",
                    "published": now,
                    "summary": "اجرای اسکریپت با خطا مواجه شد اما فایل‌های جایگزین نوشته شد.",
                    "url": "https://example.com/"
                }]
            })
        except Exception:
            pass
        print(f"WARNING: {e}")
        return 0

if __name__ == "__main__":
    sys.exit(main())
