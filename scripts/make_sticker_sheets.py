#!/usr/bin/env python3
"""
Buat montase stiker: gabungkan banyak stiker ke dalam satu gambar grid
supaya bisa dilabeli manual oleh model yang lebih pintar (bukan API key user).

Setiap sel diberi nomor urut + nama file, sehingga hasil pelabelan bisa
dipetakan kembali ke file dengan pasti.

Cara pakai:
    python scripts/make_sticker_sheets.py            # 25 per lembar
    python scripts/make_sticker_sheets.py --per 16   # 16 per lembar
"""
import os
import sys
import glob
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STICKER_DIR = os.path.join(ROOT, "public", "stickers")
OUT_DIR = os.path.join(ROOT, "scratch", "_sheets")

CELL = 240          # ukuran sisi sel (px)
PAD = 8             # jarak antar sel
LABEL_H = 26        # tinggi area teks nama file


def load_font(size: int):
    """Cari font sistem yang bisa dipakai; fallback ke font bawaan PIL."""
    for name in ("arial.ttf", "segoeui.ttf", "DejaVuSans.ttf", "calibri.ttf"):
        for base in (r"C:\Windows\Fonts", "/usr/share/fonts/truetype/dejavu", ""):
            p = os.path.join(base, name) if base else name
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def flatten_to_rgb(im: Image.Image) -> Image.Image:
    """Stiker WebP punya alpha; tempel di latar putih agar terlihat jelas."""
    im = im.convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    return bg.convert("RGB")


def main() -> None:
    per = 25
    if "--per" in sys.argv:
        per = int(sys.argv[sys.argv.index("--per") + 1])

    files = sorted(glob.glob(os.path.join(STICKER_DIR, "stk_*.webp")))
    if not files:
        print("tidak ada stiker ditemukan")
        return

    cols = 5
    rows = (per + cols - 1) // cols
    font = load_font(15)

    os.makedirs(OUT_DIR, exist_ok=True)
    sheet_count = 0

    for start in range(0, len(files), per):
        batch = files[start:start + per]
        w = cols * (CELL + PAD) + PAD
        h = rows * (CELL + LABEL_H + PAD) + PAD
        sheet = Image.new("RGB", (w, h), (24, 24, 28))
        draw = ImageDraw.Draw(sheet)

        for idx, path in enumerate(batch):
            r, c = divmod(idx, cols)
            x = PAD + c * (CELL + PAD)
            y = PAD + r * (CELL + LABEL_H + PAD)

            try:
                im = Image.open(path)
                im = flatten_to_rgb(im)
                im.thumbnail((CELL, CELL), Image.LANCZOS)
            except Exception as e:
                print(f"  gagal buka {os.path.basename(path)}: {e}")
                continue

            # tempel di tengah sel
            ox = x + (CELL - im.width) // 2
            oy = y + (CELL - im.height) // 2
            sheet.paste(im, (ox, oy))

            # nomor global + nama file
            global_no = start + idx + 1
            name = os.path.basename(path).replace(".webp", "")
            draw.text((x + 2, y + CELL + 4), f"{global_no:3d} {name}", fill=(255, 230, 120), font=font)

        sheet_count += 1
        out = os.path.join(OUT_DIR, f"sheet_{sheet_count:02d}.jpg")
        sheet.save(out, quality=88)
        print(f"  {out}  ({len(batch)} stiker, {w}x{h})")

    print(f"\ntotal: {len(files)} stiker -> {sheet_count} lembar di scratch/_sheets/")


if __name__ == "__main__":
    main()
