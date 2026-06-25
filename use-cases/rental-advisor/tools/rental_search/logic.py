#!/usr/bin/env python3
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


PARAMS = Path("params/rental_advisor.yml")
FIXTURE = Path("data/rental_listings/sample_99co_singapore.json")
REPORT = Path("reports/rental_search_snapshot.json")
DEFAULT_URL = "https://www.99.co/singapore/rent"


def read_args():
    raw = sys.stdin.read().strip()
    return json.loads(raw) if raw else {}


def read_params_text():
    if not PARAMS.exists():
        return ""
    return PARAMS.read_text(encoding="utf-8")


def nested_value(text, section, key, default=""):
    current = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.strip().startswith("#"):
            continue
        if not raw.startswith(" ") and line.endswith(":"):
            current = line[:-1].strip()
            continue
        if current == section and line.strip().startswith(key + ":"):
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return default


def int_param(text, section, key, default=None):
    value = nested_value(text, section, key, "")
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def defaults():
    text = read_params_text()
    return {
        "mode": nested_value(text, "source", "mode", "offline"),
        "search_url": nested_value(text, "source", "search_url", DEFAULT_URL),
        "area": nested_value(text, "preferences", "area", ""),
        "max_budget": int_param(text, "preferences", "max_budget_sgd"),
        "bedrooms": int_param(text, "preferences", "bedrooms"),
        "max_mrt_minutes": int_param(text, "preferences", "max_mrt_minutes"),
        "furnishing": nested_value(text, "preferences", "furnishing", ""),
    }


def normalize_space(text):
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def fetch(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "AuraRentalAdvisor/0.1 (+https://www.99.co/singapore/rent)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read().decode("utf-8", errors="ignore")


def text_from_html(page):
    page = re.sub(r"<script\b[^>]*>.*?</script>", " ", page, flags=re.I | re.S)
    page = re.sub(r"<style\b[^>]*>.*?</style>", " ", page, flags=re.I | re.S)
    page = re.sub(r"<[^>]+>", "\n", page)
    lines = [normalize_space(line) for line in page.splitlines()]
    return [line for line in lines if line]


def parse_price(line):
    match = re.search(r"S\$\s*([0-9,]+)\s*/mo", line)
    if not match:
        return None
    return int(match.group(1).replace(",", ""))


def parse_listing_blocks(lines, source_url):
    listings = []
    for i, line in enumerate(lines):
        price = parse_price(line)
        if price is None:
            continue
        window = lines[i : i + 18]
        title = ""
        address = ""
        details = []
        mrt = ""
        mrt_minutes = None
        for item in window[1:]:
            if not title and not item.startswith("S$") and len(item) > 8:
                title = item
                if "," in item:
                    address = item
                continue
            details.append(item)
            mrt_match = re.search(r"(.+ MRT)\s*[·-]\s*([0-9]+)\s*mins?", item)
            if mrt_match:
                mrt = mrt_match.group(1)
                mrt_minutes = int(mrt_match.group(2))
        bedrooms = None
        bathrooms = None
        size_sqft = None
        property_type = ""
        furnishing = ""
        for item in details:
            bed = re.search(r"([0-9]+)\s*Beds?", item)
            bath = re.search(r"([0-9]+)\s*Baths?", item)
            size = re.search(r"([0-9,]+)\s*sqft", item)
            if bed:
                bedrooms = int(bed.group(1))
            elif "Common Room" in item or "Master Room" in item:
                bedrooms = 0
                property_type = item
            if bath:
                bathrooms = int(bath.group(1))
            if size:
                size_sqft = int(size.group(1).replace(",", ""))
            if "furnished" in item.lower():
                furnishing = item
            if item in {"Condo", "Apartment", "HDB", "HDB 5 Rooms", "Common Room"}:
                property_type = item
        if title:
            listings.append(
                {
                    "title": title,
                    "address": address,
                    "price_sgd": price,
                    "bedrooms": bedrooms,
                    "bathrooms": bathrooms,
                    "size_sqft": size_sqft,
                    "property_type": property_type,
                    "furnishing": furnishing,
                    "mrt": mrt,
                    "mrt_minutes": mrt_minutes,
                    "tags": [x for x in details if x and len(x) < 40][:8],
                    "source_url": source_url,
                    "source": "99.co live page visible text",
                }
            )
    return listings


def load_offline():
    if not FIXTURE.exists():
        return []
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for row in rows:
        row.setdefault("source_url", DEFAULT_URL)
    return rows


def score_listing(row, prefs):
    score = 0
    reasons = []
    price = row.get("price_sgd")
    if prefs.get("max_budget") and price:
        if price <= prefs["max_budget"]:
            score += 30
            reasons.append("within budget")
        else:
            score -= min(30, int((price - prefs["max_budget"]) / 100))
            reasons.append("over budget")
    if prefs.get("bedrooms") is not None and row.get("bedrooms") is not None:
        if row["bedrooms"] >= prefs["bedrooms"]:
            score += 20
            reasons.append("bedroom count fits")
        elif row["bedrooms"] == 0 and prefs["bedrooms"] <= 1:
            score += 5
            reasons.append("room option, not whole unit")
    if prefs.get("max_mrt_minutes") and row.get("mrt_minutes") is not None:
        if row["mrt_minutes"] <= prefs["max_mrt_minutes"]:
            score += 20
            reasons.append("MRT distance fits")
        else:
            score -= 5
            reasons.append("farther from MRT")
    area = (prefs.get("area") or "").lower()
    searchable = " ".join(
        str(row.get(k) or "") for k in ["title", "address", "mrt", "property_type"]
    ).lower()
    searchable += " " + " ".join(row.get("tags") or []).lower()
    if area and area in searchable:
        score += 20
        reasons.append("area match")
    furnishing = (prefs.get("furnishing") or "").lower()
    if furnishing and furnishing in str(row.get("furnishing") or "").lower():
        score += 10
        reasons.append("furnishing fit")
    return score, reasons


def filter_and_rank(listings, prefs, limit):
    ranked = []
    for row in listings:
        price = row.get("price_sgd")
        if prefs.get("max_budget") and price and price > prefs["max_budget"] * 1.15:
            continue
        score, reasons = score_listing(row, prefs)
        item = dict(row)
        item["fit_score"] = score
        item["fit_reasons"] = reasons
        ranked.append(item)
    ranked.sort(key=lambda x: x.get("fit_score", 0), reverse=True)
    return ranked[:limit]


def search(args):
    d = defaults()
    prefs = {
        "area": args.get("area", d["area"]),
        "max_budget": args.get("max_budget", d["max_budget"]),
        "bedrooms": args.get("bedrooms", d["bedrooms"]),
        "max_mrt_minutes": args.get("max_mrt_minutes", d["max_mrt_minutes"]),
        "furnishing": args.get("furnishing", d["furnishing"]),
    }
    mode = args.get("mode", d["mode"])
    limit = int(args.get("limit", 10))
    source_url = d["search_url"] or DEFAULT_URL
    warnings = []
    if mode == "live":
        try:
            listings = parse_listing_blocks(text_from_html(fetch(source_url)), source_url)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            warnings.append(f"live fetch failed: {e}; falling back to offline fixture")
            listings = load_offline()
            mode = "offline-fallback"
    else:
        listings = load_offline()
    results = filter_and_rank(listings, prefs, limit)
    payload = {
        "status": "ok",
        "provider": "99.co",
        "mode": mode,
        "searched_at": time.time(),
        "source_url": source_url,
        "preferences": prefs,
        "warnings": warnings,
        "count": len(results),
        "listings": results,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def inspect():
    d = defaults()
    return {
        "status": "ok",
        "provider": "99.co",
        "params_path": str(PARAMS),
        "fixture_path": str(FIXTURE),
        "report_path": str(REPORT),
        "defaults": d,
    }


def main():
    try:
        args = read_args()
        action = args.get("action")
        if action == "search":
            print(json.dumps(search(args)))
        elif action == "inspect":
            print(json.dumps(inspect()))
        else:
            print(json.dumps({"status": "failed", "error": f"unknown action: {action}"}))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))


if __name__ == "__main__":
    main()

