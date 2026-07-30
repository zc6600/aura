#!/usr/bin/env python
"""
Real web search backend for the `search` tool group.

No API key required: queries DuckDuckGo's HTML endpoint (html.duckduckgo.com),
which is meant for browsers without JS, and scrapes the result list. This is a
deliberately minimal, dependency-free (stdlib only) implementation so it works
in any project without extra installs or credentials. If DuckDuckGo's markup
changes and the regex stops matching, this needs to be updated to match --
the caller gets result_count: 0 rather than a silent failure, so that's
visible instead of hidden.
"""
import sys
import json
import re
import html
from urllib.request import Request, urlopen
from urllib.parse import quote, urlparse, parse_qs, unquote

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

RESULT_PATTERN = re.compile(
    r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>'
    r'.*?class="result__snippet"[^>]*>(.*?)</a>',
    re.DOTALL,
)


def resolve_ddg_redirect(href):
    href = html.unescape(href)
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if "duckduckgo.com" in parsed.netloc and parsed.path == "/l/":
        qs = parse_qs(parsed.query)
        target = qs.get("uddg", [None])[0]
        if target:
            return unquote(target)
    return href


def strip_tags(fragment):
    return html.unescape(re.sub(r"<[^<]+?>", "", fragment)).strip()


def search_duckduckgo(query, max_results=8, timeout=15):
    url = "https://html.duckduckgo.com/html/?q=" + quote(query)
    req = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="replace")

    results = []
    for match in RESULT_PATTERN.finditer(body):
        raw_href, raw_title, raw_snippet = match.groups()
        url_out = resolve_ddg_redirect(raw_href)
        title = strip_tags(raw_title)
        snippet = strip_tags(raw_snippet)
        if url_out and title:
            results.append({"title": title, "url": url_out, "snippet": snippet})
        if len(results) >= max_results:
            break
    return results


def main():
    raw = sys.stdin.read()
    try:
        args = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        print(json.dumps({"success": False, "status": "failed", "error": f"invalid input: {e}"}))
        return

    query = (args.get("query") or "").strip()
    if not query:
        print(json.dumps({"success": False, "status": "failed", "error": "query is required"}))
        return

    try:
        max_results = int(args.get("max_results") or 8)
    except Exception:
        max_results = 8
    max_results = max(1, min(max_results, 20))

    try:
        results = search_duckduckgo(query, max_results=max_results)
    except Exception as e:
        print(json.dumps({"success": False, "status": "failed", "error": f"search request failed: {e}"}))
        return

    print(json.dumps({
        "success": True,
        "status": "ok",
        "query": query,
        "result_count": len(results),
        "results": results,
    }))


if __name__ == "__main__":
    main()
