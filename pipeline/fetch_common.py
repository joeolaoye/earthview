"""Shared HTTP helpers for the human-spread data pipeline (stdlib only)."""
import json
import os
import time
import urllib.request

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "HumanSpreadDashboard/0.1 (personal research project)"
}


def http_get(url, headers=None, timeout=60, retries=3, as_bytes=False):
    h = dict(UA)
    if headers:
        h.update(headers)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
            return data if as_bytes else data.decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def save_json(name, obj):
    os.makedirs(RAW, exist_ok=True)
    p = os.path.join(RAW, name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    print(f"wrote {p} ({os.path.getsize(p)} bytes)")


def load_json(name, default=None):
    p = os.path.join(RAW, name)
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)
