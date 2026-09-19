#!/usr/bin/env python3
"""
Labeling otomatis stiker -> emoji via vision AI.

Provider (urut prioritas):
  1. Cloudflare Workers AI (qwen3.8-27b) — rotasi semua CLOUDFLARE_KEYS, tanpa rate-limit ketat
  2. Groq (qwen3.8-27b) — fallback, rotasi GROQ_KEYS

Output: scratch/_sticker_labels.json  (daftar {file, emoji})
Resume-safe: file yang sudah ada di output tidak dilabeli ulang.

Setelah selesai jalankan: python scripts/gen_sticker_manifest.py
"""
import os
import sys
import io
import re
import json
import time
import base64
import urllib.request

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Butuh Pillow: pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "public", "stickers")
OUT = os.path.join(ROOT, "scratch", "_sticker_labels.json")
ENV_PATH = os.path.join(ROOT, ".env")

MAX_SIDE = 256  # stiker dikecilkan sebelum dikirim (hindari WAF payload besar)

PROMPT = "Emoji apa yang mewakili stiker ini? Jawab HANYA 1 emoji."

EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"
    "\u2600-\u27BF"
    "\u2B00-\u2BFF"
    "\u2190-\u21FF"
    "\u2764\u2665\u2666\u203C\u2049\u2122\u2139\u3030\u303D\u3297\u3299"
    "\uFE0F\u200D"
    "]+"
)


def get_keys(name):
    if not os.path.exists(ENV_PATH):
        return []
    for ln in open(ENV_PATH, encoding="utf-8", errors="ignore"):
        if ln.startswith(name + "="):
            raw = ln.split("=", 1)[1].strip()
            return [k.strip().strip('"').strip("'") for k in raw.split(",") if k.strip()]
    return []


def small_png(path):
    im = Image.open(path).convert("RGBA")
    im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.split()[3])
    buf = io.BytesIO()
    bg.save(buf, "PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def extract_emoji(text):
    m = EMOJI_RE.search((text or "").strip())
    if not m:
        return None
    e = m.group(0).strip("\uFE0F\u200D")
    return e or None


def call_cf(fn, key):
    acc = key.split(":")[0]
    tok = key.split(":", 1)[1] if ":" in key else key
    b64 = small_png(os.path.join(DST, fn))
    body = json.dumps({
        "model": "@cf/qwen/qwen3.8-27b",
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ]}],
        "max_tokens": 200,
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode()
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{acc}/ai/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    return extract_emoji(d["choices"][0]["message"].get("content") or "")


def call_groq(fn, key):
    b64 = small_png(os.path.join(DST, fn))
    body = json.dumps({
        "model": "qwen/qwen3.8-27b",
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ]}],
        "temperature": 0.1,
        "max_tokens": 30,
        "reasoning_effort": "none",
    }).encode()
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    return extract_emoji(d["choices"][0]["message"]["content"])


def main():
    if not os.path.isdir(DST):
        raise SystemExit(f"Folder stiker tidak ada: {DST}")

    cf_keys = get_keys("CLOUDFLARE_KEYS")
    groq_keys = get_keys("GROQ_KEYS")
    if not cf_keys and not groq_keys:
        raise SystemExit("Tidak ada CLOUDFLARE_KEYS / GROQ_KEYS di .env")
    print(f"cf_keys={len(cf_keys)} groq_keys={len(groq_keys)}", flush=True)

    files = sorted(f for f in os.listdir(DST) if f.endswith(".webp"))
    labels = {}
    if os.path.exists(OUT):
        try:
            labels = {x["file"]: x["emoji"] for x in json.load(open(OUT, encoding="utf-8")) if x.get("emoji")}
        except Exception:
            labels = {}

    todo = [f for f in files if f not in labels]
    print(f"total={len(files)} done={len(labels)} todo={len(todo)}", flush=True)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    cf_idx = 0
    for i, fn in enumerate(todo):
        got = None
        for _ in range(max(1, len(cf_keys))):
            if not cf_keys:
                break
            key = cf_keys[cf_idx % len(cf_keys)]
            try:
                got = call_cf(fn, key)
                if got:
                    break
            except Exception as e:
                msg = str(e)[:60]
                if "429" in msg or "403" in msg or "1010" in msg:
                    cf_idx += 1
                    time.sleep(1)
                    continue
                break
            cf_idx += 1
        if not got:
            for gk in groq_keys:
                try:
                    got = call_groq(fn, gk)
                    if got:
                        break
                except Exception:
                    time.sleep(2)
        if got:
            labels[fn] = got
        else:
            print(f"  {fn}: FAILED", flush=True)

        if (i + 1) % 10 == 0:
            json.dump([{"file": k, "emoji": v} for k, v in sorted(labels.items())],
                      open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            print(f"progress: {len(labels)}/{len(files)}", flush=True)

    json.dump([{"file": k, "emoji": v} for k, v in sorted(labels.items())],
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"DONE: {len(labels)}/{len(files)}", flush=True)


if __name__ == "__main__":
    main()
