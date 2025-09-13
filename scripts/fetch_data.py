# scripts/fetch_data.py
# خبرها با ترجمهٔ خودکار به فارسی + تصویر (RSS/OG) + ادغام آرشیو ۶۰روزه + نرخ‌ها (fault-tolerant)
# خروجی‌ها:
#   docs/data/news_macro.json  (items: title, source, published, published_ts, summary, url, translated?, image)
#   docs/data/fx_latest.json   (USD→IRR, EUR→IRR؛ سری ۳۰روزه)
#   docs/data/gold_latest.json (XAU→USD؛ سری ۳۰روزه)

from __future__ import annotations
import json, os, sys, re, hashlib
import datetime as dt
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

# ---------- Network ----------
try:
    import requests
except Exception:
    requests = None  # type: ignore

UA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MRNews-DataFetcher/1.5; +https://github.com/)",
    "Accept": "application/json, text/xml, application/xml;q=0.9, */*;q=0.8",
}

ROOT = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(ROOT, "docs", "data")
os.makedirs(DATA_DIR, exist_ok=True)

def http_get_json(url: str, timeout: int = 30):
    if not requests: return None
    try:
        r = requests.get(url, headers=UA_HEADERS, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None

def http_get_bytes(url: str, timeout: int = 25):
    if not requests: return None
    try:
        r = requests.get(url, headers=UA_HEADERS, timeout=timeout)
        r.raise_for_status()
        return r.content
    except Exception:
        return None

def http_get_text(url: str, timeout: int = 12) -> Optional[str]:
    if not requests: return None
    try:
        r = requests.get(url, headers=UA_HEADERS, timeout=timeout)
        r.raise_for_status()
        r.encoding = r.apparent_encoding or "utf-8"
        return r.text
    except Exception:
        return None

# ---------- Time ----------
def to_iso_utc(s: str) -> str:
    if not s:
        return dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        from email.utils import parsedate_to_datetime
        d = parsedate_to_datetime(s)
        if d.tzinfo is None: d = d.replace(tzinfo=dt.timezone.utc)
        return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        pass
    try:
        z = s.replace("Z", "+00:00")
        d2 = dt.datetime.fromisoformat(z)
        if d2.tzinfo is None: d2 = d2.replace(tzinfo=dt.timezone.utc)
        return d2.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def iso_to_epoch_ms(iso: str) -> int:
    try:
        z = iso.replace("Z", "+00:00")
        d = dt.datetime.fromisoformat(z)
        if d.tzinfo is None: d = d.replace(tzinfo=dt.timezone.utc)
        return int(d.timestamp()*1000)
    except Exception:
        return int(dt.datetime.utcnow().timestamp()*1000)

# ---------- Text / Lang / HTML ----------
PERSIAN_RE = re.compile(r"[\u0600-\u06FF]")
TAG_RE = re.compile(r"<[^>]+>", re.I)
IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.I)
OG_IMG_RE = re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']', re.I)
TW_IMG_RE = re.compile(r'<meta[^>]+name=["\']twitter:image["\'][^>]*content=["\']([^"\']+)["\']', re.I)

def is_persian(txt: Optional[str]) -> bool:
    return bool(PERSIAN_RE.search((txt or "").strip()))

def strip_html(s: str) -> str:
    return TAG_RE.sub("", s or "").strip()

def normalize_url(u: str, base: Optional[str]=None) -> str:
    u = (u or "").strip()
    if not u: return ""
    if u.startswith("//"):  # //cdn...
        return "https:" + u
    if base and not (u.startswith("http://") or u.startswith("https://")):
        return urljoin(base, u)
    return u

def looks_like_image(u: str) -> bool:
    u = u.lower()
    return any(u.endswith(ext) for ext in (".jpg",".jpeg",".png",".webp",".gif",".avif"))

# ---------- Translation (LibreTranslate) + cache ----------
LT_URL = os.environ.get("LT_URL", "https://translate.astian.org")
LT_API_KEY = os.environ.get("LT_API_KEY", "")
TRANSLATE_LIMIT = int(os.environ.get("TRANSLATE_LIMIT", "30"))  # per run
CACHE_PATH = os.path.join(DATA_DIR, "translate_cache.json")

def _load_cache() -> Dict[str, str]:
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def _save_cache(cache: Dict[str, str]) -> None:
    try:
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def _cache_key(text: str) -> str:
    return hashlib.sha1(("fa|" + (text or "")).encode("utf-8")).hexdigest()

def translate_text(text: str, cache: Dict[str, str]) -> Optional[str]:
    text = (text or "").strip()
    if not text: return ""
    key = _cache_key(text)
    if key in cache: return cache[key]
    if not requests: return None
    try:
        url = LT_URL.rstrip("/") + "/translate"
        payload = {"q": text[:1800], "source": "auto", "target": "fa", "format": "text"}
        if LT_API_KEY: payload["api_key"] = LT_API_KEY
        r = requests.post(url, json=payload, headers={"Accept":"application/json"}, timeout=30)
        r.raise_for_status()
        data = r.json()
        fa = (data.get("translatedText") or "").strip()
        if fa:
            cache[key] = fa
            return fa
        return None
    except Exception:
        return None

# ---------- Common I/O ----------
def save_json(path: str, obj: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

# ---------- FX & Gold ----------
def timeseries(base: str, symbol: str, days: int = 30):
    end = dt.date.today(); start = end - dt.timedelta(days=days)
    url = ("https://api.exchangerate.host/timeseries"
           f"?start_date={start}&end_date={end}&base={base}&symbols={symbol}")
    data = http_get_json(url); out=[]
    rates = (data or {}).get("rates", {})
    for day, vals in sorted(rates.items()):
        val = (vals or {}).get(symbol)
        if val is None:
            continue
        out.append({"t": f"{day}T12:00:00Z", "v": round(float(val), 6)})
    return out

def latest(base: str, symbol: str):
    data = http_get_json(f"https://api.exchangerate.host/latest?base={base}&symbols={symbol}")
    if not data: return None
    val = (data.get("rates") or {}).get(symbol)
    return round(float(val), 6) if val is not None else None

def fallback_flat_series(days: int, value: float):
    end = dt.date.today(); start = end - dt.timedelta(days=days); cur = start; out=[]
    while cur <= end:
        out.append({"t": f"{cur}T12:00:00Z", "v": value})
        cur += dt.timedelta(days=1)
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

# ---------- News (Persian feeds + translate + image) ----------
NEWS_PATH = os.path.join(DATA_DIR, "news_macro.json")

FEEDS: List[Tuple[str, str]] = [
    ("BBC Persian",       "https://feeds.bbci.co.uk/persian/rss.xml"),
    ("Euronews Persian",  "https://parsi.euronews.com/rss"),
    ("ISNA",              "https://www.isna.ir/rss"),
    ("IRNA",              "https://www.irna.ir/rss"),
    ("Hamshahri Online",  "https://www.hamshahrionline.ir/rss"),
    ("Khabaronline",      "https://www.khabaronline.ir/RSS/"),
    ("Tasnim",            "https://www.tasnimnews.com/fa/rss"),
    ("Asriran",           "https://www.asriran.com/fa/rss"),
    ("Mehr",              "https://www.mehrnews.com/rss"),
    ("ILNA",              "https://www.ilna.ir/rss"),
]

# محدودیت گرفتن og:image برای آیتم‌های بدون عکس
IMAGE_FETCH_LIMIT = int(os.environ.get("IMAGE_FETCH_LIMIT", "12"))

def load_existing_news() -> List[Dict[str, Any]]:
    try:
        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            items: List[Dict[str, Any]] = data.get("items", [])
            cleaned: List[Dict[str, Any]] = []
            for it in items:
                iso = to_iso_utc(it.get("published",""))
                it["published"] = iso
                it["published_ts"] = it.get("published_ts") or iso_to_epoch_ms(iso)
                it["summary"] = strip_html(it.get("summary",""))[:280]
                # نگه‌داشتن فارسی یا ترجمه‌شده
                if is_persian(it.get("title")) or is_persian(it.get("summary","")) or it.get("translated"):
                    cleaned.append(it)
            return cleaned
    except Exception:
        return []

def extract_image_from_rss_item(item, base_url: Optional[str]=None) -> str:
    """media:content/@url | media:thumbnail/@url | enclosure/@url | content:encoded <img> | description <img>"""
    try:
        # namespaces
        MEDIA_NS = "{http://search.yahoo.com/mrss/}"
        CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}"

        # media:content
        m = item.find(f".//{MEDIA_NS}content")
        if m is not None:
            u = normalize_url(m.get("url",""), base_url)
            if looks_like_image(u): return u

        # media:thumbnail
        m = item.find(f".//{MEDIA_NS}thumbnail")
        if m is not None:
            u = normalize_url(m.get("url",""), base_url)
            if looks_like_image(u): return u

        # enclosure
        encl = item.find("enclosure")
        if encl is not None:
            u = normalize_url(encl.get("url",""), base_url)
            typ = (encl.get("type") or "").lower()
            if looks_like_image(u) or typ.startswith("image/"): return u

        # content:encoded
        enc = item.findtext(f"{CONTENT_NS}encoded") or ""
        m = IMG_RE.search(enc)
        if m:
            u = normalize_url(m.group(1), base_url)
            if looks_like_image(u): return u

        # description
        desc = item.findtext("description") or ""
        m = IMG_RE.search(desc)
        if m:
            u = normalize_url(m.group(1), base_url)
            if looks_like_image(u): return u
    except Exception:
        pass
    return ""

def extract_image_from_atom_entry(entry, base_url: Optional[str]=None) -> str:
    try:
        ATOM_NS = "{http://www.w3.org/2005/Atom}"
        MEDIA_NS = "{http://search.yahoo.com/mrss/}"

        # media:content / media:thumbnail
        m = entry.find(f".//{MEDIA_NS}content")
        if m is not None:
            u = normalize_url(m.get("url",""), base_url)
            if looks_like_image(u): return u
        m = entry.find(f".//{MEDIA_NS}thumbnail")
        if m is not None:
            u = normalize_url(m.get("url",""), base_url)
            if looks_like_image(u): return u

        # link rel=enclosure
        for ln in entry.findall(f"{ATOM_NS}link"):
            rel = (ln.get("rel") or "").lower()
            typ = (ln.get("type") or "").lower()
            href = normalize_url(ln.get("href",""), base_url)
            if rel == "enclosure" and (typ.startswith("image/") or looks_like_image(href)):
                return href

        # content/summary <img>
        for tag in (f"{ATOM_NS}content", f"{ATOM_NS}summary"):
            txt = entry.findtext(tag) or ""
            m = IMG_RE.search(txt)
            if m:
                u = normalize_url(m.group(1), base_url)
                if looks_like_image(u): return u
    except Exception:
        pass
    return ""

def fetch_og_image(page_url: str) -> str:
    html = http_get_text(page_url, timeout=12)
    if not html: return ""
    m = OG_IMG_RE.search(html) or TW_IMG_RE.search(html)
    if not m: return ""
    u = normalize_url(m.group(1), page_url)
    return u

def fetch_feeds_translate_and_images() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    try:
        import xml.etree.ElementTree as ET
    except Exception:
        return items

    cache = _load_cache()
    budget_tr = TRANSLATE_LIMIT
    budget_img = IMAGE_FETCH_LIMIT

    def ensure_fa(title: str, summary: str) -> Optional[Dict[str, Any]]:
        nonlocal budget_tr
        title = strip_html(title)
        summary = strip_html(summary)
        if is_persian(title) or is_persian(summary):
            return {"title": title, "summary": summary, "translated": False}
        if budget_tr <= 0:
            return None
        fa_title = translate_text(title, cache)
        fa_summary = translate_text(summary, cache) if summary else ""
        if fa_title is None:
            return None
        budget_tr -= 1
        return {"title": fa_title or title, "summary": fa_summary or summary, "translated": True}

    ATOM_NS = "{http://www.w3.org/2005/Atom}"

    for name, url in FEEDS:
        try:
            raw = http_get_bytes(url, timeout=25)
            if not raw: continue
            root = ET.fromstring(raw)

            # Guess base for relative URLs
            base = url

            # RSS
            for it in root.findall(".//item"):
                t = it.findtext("title") or ""
                l = (it.findtext("link") or "").strip()
                p = to_iso_utc((it.findtext("pubDate") or "").strip())
                d = it.findtext("description") or ""
                conv = ensure_fa(t, d)
                if not l or not conv: 
                    continue

                img = extract_image_from_rss_item(it, l)
                if not img and budget_img > 0:
                    og = fetch_og_image(l)
                    if og:
                        img = og
                        budget_img -= 1

                items.append({
                    "title": conv["title"],
                    "source": name,
                    "published": p,
                    "published_ts": iso_to_epoch_ms(p),
                    "summary": conv["summary"][:280],
                    "url": l,
                    "translated": conv["translated"],
                    "image": img or "",
                })

            # Atom
            for en in root.findall(f".//{ATOM_NS}entry"):
                t = en.findtext(f"{ATOM_NS}title") or ""
                link_el = en.find(f"{ATOM_NS}link")
                l = (link_el.get("href") if link_el is not None else "").strip()
                p = to_iso_utc((en.findtext(f"{ATOM_NS}updated") or en.findtext(f"{ATOM_NS}published") or "").strip())
                s = en.findtext(f"{ATOM_NS}summary") or ""
                conv = ensure_fa(t, s)
                if not l or not conv:
                    continue

                img = extract_image_from_atom_entry(en, l)
                if not img and budget_img > 0:
                    og = fetch_og_image(l)
                    if og:
                        img = og
                        budget_img -= 1

                items.append({
                    "title": conv["title"],
                    "source": name,
                    "published": p,
                    "published_ts": iso_to_epoch_ms(p),
                    "summary": conv["summary"][:280],
                    "url": l,
                    "translated": conv["translated"],
                    "image": img or "",
                })

        except Exception:
            continue

    _save_cache(cache)
    return items

def merge_and_save_news() -> None:
    now_ms = int(dt.datetime.utcnow().timestamp()*1000)
    cutoff = now_ms - 60*24*3600*1000  # ۶۰ روز اخیر

    existing = load_existing_news()
    fresh = fetch_feeds_translate_and_images()

    # ادغام بر اساس URL
    by_url: Dict[str, Dict[str, Any]] = {}
    for it in existing:
        u = (it.get("url") or "").strip()
        if u:
            by_url[u] = it

    added = 0
    for it in fresh:
        u = (it.get("url") or "").strip()
        if not u:
            continue
        if u in by_url:
            old = by_url[u]
            # اگر جدیدتر بود جایگزین کن
            if it.get("published_ts", 0) > old.get("published_ts", 0):
                # اگر عکس جدید ندارد ولی قدیمی داشت، همان قدیمی را نگه داریم
                if not it.get("image") and old.get("image"):
                    it["image"] = old.get("image", "")
                by_url[u] = it
            else:
                # نسخه قدیمی را نگه می‌داریم؛ اگر قدیمی عکس ندارد ولی جدید دارد، عکس را اضافه کنیم
                if not old.get("image") and it.get("image"):
                    old["image"] = it["image"]
        else:
            by_url[u] = it
            added += 1

    merged = list(by_url.values())
    merged = [it for it in merged if it.get("published_ts", 0) >= cutoff]
    merged.sort(key=lambda x: x.get("published_ts", 0), reverse=True)
    merged = merged[:400]

    save_json(os.path.join(DATA_DIR, "news_macro.json"), {"items": merged})
    print(f"NEWS(FA+img+translate): existing={len(existing)} fetched={len(fresh)} merged={len(merged)} added_now={added}")

# ---------- main ----------
def main() -> int:
    try:
        build_fx()
        build_gold()
        merge_and_save_news()
        print("DONE")
        return 0
    except Exception as e:
        # حداقل خروجی‌ها
        try:
            save_json(os.path.join(DATA_DIR,"fx_latest.json"),{
                "series":[{"label":"دلار (USD→IRR)","unit":"IRR","points":fallback_flat_series(7,600000.0)}]
            })
            save_json(os.path.join(DATA_DIR,"gold_latest.json"),{
                "series":[{"label":"طلا (XAU→USD)","unit":"USD","points":fallback_flat_series(7,2300.0)}]
            })
            now_iso = dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
            save_json(os.path.join(DATA_DIR,"news_macro.json"),{"items":[{
                "title":"نمونه خبر (fallback)","source":"Local","published":now_iso,
                "published_ts":iso_to_epoch_ms(now_iso),"summary":"اتصال به فید/ترجمه/تصویر برقرار نشد.",
                "url":"https://example.com/","translated":False,"image":""
            }]})
        except Exception:
            pass
        print("WARNING:", e)
        return 0

if __name__ == "__main__":
    sys.exit(main())
