#!/usr/bin/env python3
"""
UJI SEMUA MODEL CLOUDFLARE WORKERS AI — mana yang merespon + waktu responnya.

KENAPA DIBUAT (permintaan pemilik produk, 09 Okt 2026):
  "coba cek semua model dari endpoint cloudflare itu ada model apa saja yg
   merespon, urutkan dari model terbaik dan terbaru dan respon time nya"

CARA PAKAI:
  python scripts/uji_model_cloudflare.py              # uji semua model teks
  python scripts/uji_model_cloudflare.py --semua      # termasuk vision/embedding
  python scripts/uji_model_cloudflare.py --gratis     # hanya model gratis

CATATAN PENTING:
  - Kuota gratis Cloudflare = 10.000 NEURON/hari per akun. Bila habis,
    SEMUA model mengembalikan HTTP 429 code 4006 ("used up daily free
    allocation"). Tunggu reset harian (00:00 UTC) lalu jalankan lagi.
  - Script membaca kredensial dari .env (CLOUDFLARE_KEYS = "akun:token,akun:token").
  - Hasil ditulis ke scratch/_cf_hasil.json + dicetak tabel terurut.
"""
import os, sys, json, time, urllib.request, urllib.error, pathlib, re

AKAR = pathlib.Path(__file__).resolve().parent.parent
SCRATCH = AKAR / "scratch"
SCRATCH.mkdir(exist_ok=True)


def baca_env():
    """Baca .env sederhana (KEY=VALUE)."""
    env = {}
    p = AKAR / ".env"
    if not p.exists():
        return env
    for baris in p.read_text(encoding="utf-8", errors="replace").splitlines():
        baris = baris.strip()
        if baris and not baris.startswith("#") and "=" in baris:
            k, v = baris.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def daftar_kredensial(env):
    """Kembalikan [(accountId, token), ...] dari CLOUDFLARE_KEYS."""
    hasil = []
    for k in (env.get("CLOUDFLARE_KEYS", "") or "").split(","):
        k = k.strip()
        if not k:
            continue
        if ":" in k:
            a, t = k.split(":", 1)
            hasil.append((a.strip(), t.strip()))
        elif env.get("CLOUDFLARE_ACCOUNT_ID"):
            hasil.append((env["CLOUDFLARE_ACCOUNT_ID"].strip(), k))
    return hasil


def ambil_katalog(acc, tok):
    """Ambil daftar model dari API Cloudflare."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{acc}/ai/models/search?per_page=200"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read()).get("result", [])


def prop(m, nama):
    for p in (m.get("properties") or []):
        if p.get("property_id") == nama:
            return p.get("value")
    return None


def uji_model(acc, tok, model, prompt="Balas satu kata: OK", max_tokens=16):
    """Uji satu model. Kembalikan (status, detik, jawaban)."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{acc}/ai/run/{model}"
    body = json.dumps({
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            dt = time.time() - t0
            hasil = json.loads(r.read())
            res = hasil.get("result", {}) or {}
            teks = res.get("response") or ""
            if not teks:
                ch = res.get("choices") or []
                if ch:
                    teks = (ch[0].get("message") or {}).get("content", "")
            return ("OK", round(dt, 2), str(teks)[:60].replace("\n", " "))
    except urllib.error.HTTPError as e:
        dt = time.time() - t0
        try:
            pesan = json.loads(e.read()).get("errors", [{}])[0].get("message", "")[:70]
        except Exception:
            pesan = ""
        return (f"HTTP{e.code}", round(dt, 2), pesan)
    except Exception as e:
        return ("ERR", round(time.time() - t0, 2), str(e)[:70])


def main():
    env = baca_env()
    kred = daftar_kredensial(env)
    if not kred:
        print("❌ CLOUDFLARE_KEYS tidak ditemukan di .env")
        return
    print(f"═══ {len(kred)} kredensial Cloudflare ═══\n")

    acc, tok = kred[0]
    katalog = ambil_katalog(acc, tok)
    teks = [m for m in katalog if m.get("task", {}).get("name") == "Text Generation"]
    if "--semua" in sys.argv:
        teks = katalog
    if "--gratis" in sys.argv:
        teks = [m for m in teks if prop(m, "price") is None]

    # Urutkan terbaru dulu
    teks.sort(key=lambda m: m.get("created_at", ""), reverse=True)
    print(f"═══ UJI {len(teks)} MODEL ═══\n")

    hasil = {}
    for i, m in enumerate(teks, 1):
        nama = m["name"]
        # Coba tiap akun sampai ada yang merespon (kuota bisa beda per akun).
        status, dt, ket = "TIDAK DIUJI", 0, ""
        for a, t in kred:
            status, dt, ket = uji_model(a, t, nama)
            if status == "OK":
                break
        hasil[nama] = {
            "status": status, "detik": dt, "ket": ket,
            "rilis": (m.get("created_at") or "")[:10],
            "ctx": prop(m, "context_window"),
            "gratis": prop(m, "price") is None,
            "reasoning": prop(m, "reasoning") == "true",
            "tools": prop(m, "function_calling") == "true",
        }
        tanda = "✅" if status == "OK" else "❌"
        print(f"  [{i:2}/{len(teks)}] {tanda} {nama:52} {status:8} {dt:6.2f}s {ket[:40]}")

    (SCRATCH / "_cf_hasil.json").write_text(
        json.dumps(hasil, ensure_ascii=False, indent=1), encoding="utf-8")

    # Ringkasan
    ok = {k: v for k, v in hasil.items() if v["status"] == "OK"}
    print(f"\n═══ RINGKASAN: {len(ok)}/{len(hasil)} MERESPON ═══")
    if ok:
        print("\n-- TERCEPAT --")
        for k, v in sorted(ok.items(), key=lambda x: x[1]["detik"])[:10]:
            print(f"   {v['detik']:6.2f}s  {k}")
        print("\n-- TERBARU & MERESPON --")
        for k, v in sorted(ok.items(), key=lambda x: x[1]["rilis"], reverse=True)[:10]:
            print(f"   {v['rilis']}  {k}")
    else:
        print("\n⚠️  TIDAK ADA YANG MERESPON — kuota neuron harian habis (HTTP 429 code 4006).")
        print("    Tunggu reset harian (00:00 UTC) lalu jalankan lagi.")


if __name__ == "__main__":
    main()
