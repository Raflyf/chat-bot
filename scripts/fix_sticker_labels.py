#!/usr/bin/env python3
"""
Perbaiki label stiker WhatsApp + normalisasi ukuran.

MASALAH: WhatsApp menampilkan "Sticker with no label" bila WebP stiker tidak
punya metadata EXIF tag 0x5741 ("AW") berisi JSON dengan kunci
`accessibility-text` (label aksesibilitas) — dipakai WhatsApp Web/Desktop
sebagai label stiker. Mayoritas stiker kita hasil unduhan tidak punya field itu.

Selain itu, stiker statis WhatsApp wajib < 100 KB. Beberapa file kita > 100 KB
sehingga berisiko gagal render.

YANG DILAKUKAN skrip ini (in-place di public/stickers/):
  1. Rekompres stiker STATIS > 100 KB agar < 100 KB (512x512, alpha dijaga).
  2. Sisipkan/merge chunk EXIF dengan JSON berisi:
       - accessibility-text : label teks stiker (dari hasil pelabelan)
       - emojis             : [emoji] pasangan stiker
     Metadata lama (sticker-pack-*) dipertahankan.

Cara pakai:
    python scripts/fix_sticker_labels.py          # perbaiki semua
    python scripts/fix_sticker_labels.py --check  # hanya lapor, tanpa ubah
"""
import json
import os
import struct
import sys
import io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STICKER_DIR = os.path.join(ROOT, "public", "stickers")
LABELS = os.path.join(ROOT, "scratch", "_sticker_labels.json")
MANIFEST = os.path.join(ROOT, "src", "sticker-manifest.ts")

STATIC_MAX_BYTES = 100 * 1024  # WhatsApp: stiker statis < 100 KB
ANIM_MAX_BYTES = 500 * 1024    # WhatsApp: stiker animasi < 500 KB

EXIF_HEADER = b"II*\x00\x08\x00\x00\x00\x01\x00AW\x07\x00"  # TIFF LE + 1 entry tag 0x5741


def read_chunks(data: bytes):
    """Kembalikan list (fourcc, payload) dari WebP RIFF."""
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError("bukan WebP valid")
    chunks = []
    pos = 12
    while pos + 8 <= len(data):
        fourcc = data[pos:pos + 4]
        size = int.from_bytes(data[pos + 4:pos + 8], "little")
        payload = data[pos + 8:pos + 8 + size]
        chunks.append((fourcc, payload))
        pos += 8 + size + (size & 1)  # padding ganjil
    return chunks


def build_webp(chunks) -> bytes:
    body = b"".join(
        fourcc + struct.pack("<I", len(payload)) + payload + (b"\x00" if len(payload) & 1 else b"")
        for fourcc, payload in chunks
    )
    return b"RIFF" + struct.pack("<I", len(body) + 4) + b"WEBP" + body


def parse_exif_json(payload: bytes):
    """Ambil JSON dari payload EXIF (tag 0x5741 "AW").

    Struktur TIFF: 'II*\\x00' + ifd_offset(4) + count(2) + entry(12:
    tag(2) type(2) count(4) offset(4)) + ... + JSON pada `offset` sepanjang `count`.
    Parsing lewat header ini WAJIB (bukan mencari '{' pertama): byte panjang JSON
    bisa bernilai 0x7B ('{') sehingga pencarian naif salah ambil offset.
    """
    tag = payload.find(b"AW\x07\x00")
    if tag < 0 or tag + 12 > len(payload):
        return None
    count = int.from_bytes(payload[tag + 4:tag + 8], "little")
    offset = int.from_bytes(payload[tag + 8:tag + 12], "little")
    raw = payload[offset:offset + count] if 0 < offset <= len(payload) else b""
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        return None


def build_exif_chunk(meta: dict) -> bytes:
    js = json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    payload = EXIF_HEADER + struct.pack("<I", len(js)) + b"\x16\x00\x00\x00" + js
    return payload


def is_animated(chunks) -> bool:
    return any(fourcc == b"ANIM" for fourcc, _ in chunks)


def load_labels():
    """file -> (teks, emoji) dari hasil pelabelan."""
    out = {}
    if os.path.exists(LABELS):
        for x in json.load(open(LABELS, encoding="utf-8")):
            f = x.get("file")
            if f:
                out[f] = ((x.get("teks") or "").strip(), (x.get("emoji") or "").strip())
    return out


def load_file_emoji():
    """file -> emoji dari manifest (sumber kebenaran pemetaan runtime)."""
    out = {}
    if os.path.exists(MANIFEST):
        import re
        txt = open(MANIFEST, encoding="utf-8").read()
        for emoji, fname in re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', txt):
            out.setdefault(fname, emoji)
    return out


def recompress_static(path: str, chunks, target=STATIC_MAX_BYTES):
    """Rekompres stiker statis > target dengan quality bertingkat."""
    from PIL import Image

    data = open(path, "rb").read()
    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode not in ("RGBA", "RGB"):
        im = im.convert("RGBA")
    # Pertahankan ukuran (WhatsApp: salah satu sisi tepat 512px)
    if im.size != (512, 512):
        canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        scale = min(512 / im.width, 512 / im.height)
        nw, nh = max(1, round(im.width * scale)), max(1, round(im.height * scale))
        resized = im.convert("RGBA").resize((nw, nh), Image.LANCZOS)
        canvas.paste(resized, ((512 - nw) // 2, (512 - nh) // 2), resized)
        im = canvas
    best = None
    for q in (90, 80, 70, 60, 50, 40, 30, 20):
        buf = io.BytesIO()
        im.save(buf, format="WEBP", quality=q, method=6)
        if buf.tell() <= target:
            best = buf.getvalue()
            break
        best = buf.getvalue()
    return best


def main():
    check_only = "--check" in sys.argv
    labels = load_labels()
    file_emoji = load_file_emoji()

    files = sorted(f for f in os.listdir(STICKER_DIR) if f.endswith(".webp"))
    fixed_label = 0
    recompressed = 0
    problems = []

    for name in files:
        path = os.path.join(STICKER_DIR, name)
        raw = open(path, "rb").read()
        chunks = read_chunks(raw)
        anim = is_animated(chunks)
        size0 = len(raw)

        # 1. Rekompres bila melebihi batas
        if not anim and size0 > STATIC_MAX_BYTES:
            if not check_only:
                newdata = recompress_static(path, chunks)
                raw = newdata
                chunks = read_chunks(raw)
                open(path, "wb").write(raw)
            recompressed += 1

        # 2. Label aksesibilitas
        teks, emoji = labels.get(name, ("", ""))
        emoji = file_emoji.get(name, emoji)
        label = (teks if teks and teks not in ("-", "->") else emoji) or emoji or name
        label = label[:120]

        exif_payload = None
        for fourcc, payload in chunks:
            if fourcc == b"EXIF":
                exif_payload = payload
                break
        meta = parse_exif_json(exif_payload) if exif_payload else None
        if not isinstance(meta, dict):
            meta = {}
        already = meta.get("accessibility-text") == label and meta.get("emojis") == [emoji]

        if not already:
            fixed_label += 1
            if not check_only:
                meta["accessibility-text"] = label
                if emoji:
                    meta["emojis"] = [emoji]
                meta.setdefault("is-from-sticker-maker", 1)
                meta.setdefault("sticker-maker-source-type", 3)
                new_chunks = [(fc, pl) for fc, pl in chunks if fc != b"EXIF"]
                new_chunks.append((b"EXIF", build_exif_chunk(meta)))
                raw = build_webp(new_chunks)
                open(path, "wb").write(raw)

        # 3. Verifikasi akhir
        if not check_only:
            final = open(path, "rb").read()
            fchunks = read_chunks(final)
            has_label = any(
                fc == b"EXIF" and (parse_exif_json(pl) or {}).get("accessibility-text")
                for fc, pl in fchunks
            )
            limit = ANIM_MAX_BYTES if anim else STATIC_MAX_BYTES
            if not has_label or len(final) > limit:
                problems.append((name, len(final), has_label, anim))

    print(f"total={len(files)} | label diperbarui={fixed_label} | statis direkompres={recompressed}")
    if problems:
        print(f"PERINGATAN: {len(problems)} file masih bermasalah:")
        for p in problems[:20]:
            print("  ", p)
    else:
        print("semua stiker punya accessibility-text dan ukuran sesuai batas.")


if __name__ == "__main__":
    main()
