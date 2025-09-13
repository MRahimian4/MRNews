# scripts/fetch_data.py
# جمع‌آوری روزانه نرخ‌ها (USD→IRR, EUR→IRR, XAU→USD) + چند خبر RSS
# خروجی‌ها: docs/data/fx_latest.json , docs/data/gold_latest.json , docs/data/news_macro.json

import json, os, datetime as dt, requests

ROOT = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(ROOT, "docs", "data")
os.makedirs(DATA_DIR, exist_ok=True)

def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def timeseries(base, symbol, days=30):
    end = dt.date.today()
    start = end - dt.timedelta(days=days)
    url = (
        "https://api.exchangerate.host/timeseries"
        f"?start_date={start}&end_date={end}&base={base}&symbols={symbol}"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    data = r.json()
    points = []
    rates = data.get("rates", {})
    for day, vals in sorted(rates.items()):
        val = vals.get(symbol)
        if val is None:
            continue
        # زمان وسط‌روز را می‌گذاریم تا در نمودار مرتب باشد
        points.append({"t": f"{day}T12:00:00Z", "v": round(float(val), 6)})
    return points

def latest(base, symbol):
    url = f"https://api.exchangerate.host/latest?base={base}&symbols={symbol}"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    val = r.json().get("rates", {}).get(symbol)
    if val is None:
        return None
    return round(float(val), 6)

def build_fx():
    # USD→IRR و EUR→IRR (روزانه ۳۰ روز اخیر)
    usd_irr = timeseries("USD", "IRR", days=30)
    eur_irr = timeseries("EUR", "IRR", days=30)
    out = {
        "series": [
            {"label": "دلار (USD→IRR)", "unit": "IRR", "points": usd_irr},
            {"label": "یورو (EUR→IRR)", "unit": "IRR", "points": eur_irr},
        ]
    }
    save_json(os.path.join(DATA_DIR, "fx_latest.json"), out)

def build_gold():
    # طلا: XAU→USD (۳۰ روز اخیر). اگر تایم‌سریز در دسترس نبود، آخرین مقدار را می‌گیریم.
    try:
        xau_usd = timeseries("XAU", "USD", days=30)
        if not xau_usd:
            raise RuntimeError("empty timeseries")
    except Exception:
        val = latest("XAU", "USD")
        xau_usd = [{"t": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "v": val}] if val else []
    out = {"series": [{"label": "طلا (XAU→USD)", "unit": "USD", "points": xau_usd}]}
    save_json(os.path.join(DATA_DIR, "gold_latest.json"), out)

def build_news():
    # چند خبر ساده از RSS (بدون کلید). لازم نیست دقیق باشد؛ صرفاً برای MVP.
    feeds = [
        "https://feeds.bbci.co.uk/persian/rss.xml",
        "https://www.reuters.com/world/rss",
    ]
    import xml.etree.ElementTree as ET
    import urllib.parse

    items = []
    for url in feeds:
        try:
            res = requests.get(url, timeout=20)
            res.raise_for_status()
            root = ET.fromstring(res.content)
            # تلاش برای خواندن فرمت‌های رایج RSS/Atom
            for item in root.findall(".//item"):
                title = item.findtext("title") or ""
                link = item.findtext("link") or ""
                pub = item.findtext("pubDate") or ""
                desc = item.findtext("description") or ""
                if title and link:
                    items.append({
                        "title": title.strip(),
                        "source": urllib.parse.urlparse(link).netloc or "RSS",
                        "published": pub or "",
                        "summary": (desc or "")[:280],
                        "url": link,
                    })
            # Atom
            for entry in root.findall(".//{http://www.w3.org/2005/Atom}entry"):
                title = (entry.findtext("{http://www.w3.org/2005/Atom}title") or "").strip()
                link_el = entry.find("{http://www.w3.org/2005/Atom}link")
                link = (link_el.get("href") if link_el is not None else "") or ""
                pub = entry.findtext("{http://www.w3.org/2005/Atom}updated") or ""
                summ = entry.findtext("{http://www.w3.org/2005/Atom}summary") or ""
                if title and link:
                    items.append({
                        "title": title,
                        "source": urllib.parse.urlparse(link).netloc or "Atom",
                        "published": pub,
                        "summary": summ[:280],
                        "url": link,
                    })
        except Exception:
            continue

    items = items[:20]  # مختصر
    save_json(os.path.join(DATA_DIR, "news_macro.json"), {"items": items})

if __name__ == "__main__":
    build_fx()
    build_gold()
    build_news()
    print("DONE")
