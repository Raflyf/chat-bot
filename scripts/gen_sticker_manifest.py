#!/usr/bin/env python3
"""
Generator manifest stiker: emoji -> nama file di public/stickers/.

Cara pakai:
  1. Taruh file stiker .webp di public/stickers/ (nama bebas, mis. stk_001.webp).
  2. Jalankan labeling:  python scripts/label_stickers.py
     (label otomatis via vision: Cloudflare qwen3.8-27b + Groq fallback)
  3. Jalankan generator ini: python scripts/gen_sticker_manifest.py
     -> menghasilkan src/sticker-manifest.ts (di-commit ke repo)

Hasil labeling disimpan di scratch/_sticker_labels.json (gitignored).
"""
import json
import os
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABELS = os.path.join(ROOT, "scratch", "_sticker_labels.json")
OUT = os.path.join(ROOT, "src", "sticker-manifest.ts")

if not os.path.exists(LABELS):
    raise SystemExit(
        f"File label tidak ditemukan: {LABELS}\nJalankan dulu: python scripts/label_stickers.py"
    )

labels = json.load(open(LABELS, encoding="utf-8"))
by_emoji = {}
for x in labels:
    e = (x.get("emoji") or "").strip()
    if not e:
        continue
    by_emoji.setdefault(e, x["file"])  # file pertama menang (stabil)

lines = [
    "/**",
    " * Manifest stiker: emoji -> nama file di public/stickers/.",
    " * Digenerate otomatis dari pelabelan vision (scripts/label_stickers.py).",
    " * JANGAN edit manual — jalankan ulang generator bila aset berubah:",
    " *   python scripts/label_stickers.py && python scripts/gen_sticker_manifest.py",
    " */",
    "export const STICKER_MANIFEST: Record<string, string> = {",
]
for e in sorted(by_emoji):
    lines.append(f"  {json.dumps(e, ensure_ascii=False)}: {json.dumps(by_emoji[e])},")
lines.append("};")
lines.append("")
open(OUT, "w", encoding="utf-8").write("\n".join(lines))

print(f"wrote {OUT}: {len(by_emoji)} unique emojis from {len(labels)} stickers")
counts = collections.Counter((x.get("emoji") or "").strip() for x in labels if x.get("emoji"))
dupes = [(e, c) for e, c in counts.most_common(10) if c > 1]
print("top duplicate emojis:", dupes)
