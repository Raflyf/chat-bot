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

# Emoji "keras" (umpatan/provokasi) — TETAP disertakan di manifest, tapi diberi penanda
# agar runtime hanya memakainya saat konteksnya bercanda (user bercanda/roasting dulu).
# Keputusan user: "tidak apa apa dipakai juga dalam konteks bercanda, dan saat user juga
# memberikan stiker seperti itu saat bercanda".
EDGY_EMOJIS = {
    "\U0001F595",  # 🖕 jari tengah
    "\U0001F92C",  # 🤬 wajah umpatan
    "\U0001F44A",  # 👊 kepalan tangan
    "\U0001F4A9",  # 💩 kotoran
    "\U0001F346",  # 🍆 terong
    "\U0001F608",  # 😈 wajah jahat
    "\U0001F620",  # 😠 marah
    "\U0001F621",  # 😡 marah merah
}

by_emoji = {}
for x in labels:
    e = (x.get("emoji") or "").strip()
    if not e:
        continue
    by_emoji.setdefault(e, x["file"])  # file pertama menang (stabil)

edgy_included = sorted(e for e in by_emoji if e in EDGY_EMOJIS)

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
lines.append("/**")
lines.append(" * Emoji \"keras\" (umpatan/provokasi). Boleh dipakai bot HANYA saat konteks bercanda")
lines.append(" * (user bercanda/roasting/mengirim stiker serupa lebih dulu) — lihat guard di runtime.")
lines.append(" */")
lines.append("export const EDGY_STICKER_EMOJIS: string[] = [")
for e in edgy_included:
    lines.append(f"  {json.dumps(e, ensure_ascii=False)},")
lines.append("];")
lines.append("")
open(OUT, "w", encoding="utf-8").write("\n".join(lines))

print(f"wrote {OUT}: {len(by_emoji)} unique emojis from {len(labels)} stickers")
print(f"edgy emojis included ({len(edgy_included)}):", " ".join(edgy_included))
counts = collections.Counter((x.get("emoji") or "").strip() for x in labels if x.get("emoji"))
dupes = [(e, c) for e, c in counts.most_common(10) if c > 1]
print("top duplicate emojis:", dupes)
