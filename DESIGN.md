# DESIGN.md — FreeAIBot

Arah desain untuk `public/index.html` (landing) dan `public/dashboard.html` (konsol monitoring).
Arah ini **disuplai pemilik produk** (Rafly Firmansyah) lewat permintaan: gaya Liquid Glass ala
iOS 26, mengacu pada Apple Human Interface Guidelines, dengan referensi implementasi web dari
repo publik (dpawlikowski/liquid-glass, waldbach/liquid-glass-css).

## Design Read

> Reading this as: **product console + landing** untuk **pemilik bot WhatsApp/Telegram yang
> memantau kuota API 24/7**, dengan bahasa visual **Apple Liquid Glass (iOS 26)**, dial
> **ENERGY 2 / RHYTHM 2 / MOTION 1**.

## Identitas

- **Produk:** FreeAIBot, asisten AI multimodal 24/7 untuk WhatsApp & Telegram.
- **Audiens:** pemilik bot (Rafly) + pengunjung yang mau coba.
- **Karakter:** tenang, presisi, seperti perangkat Apple: permukaan bersih, satu aksen,
  tipografi netral yang rapi, tanpa dekorasi yang tidak berfungsi.

## Palet (2 core + 1 accent, sesuai R-29)

Ditulis sebagai pasangan terang/gelap. Nilai diambil dari bahasa visual Apple, bukan gradien AI.

| Peran | Terang | Gelap | Alasan |
|---|---|---|---|
| Core 1 (permukaan) | `#F2F2F7` (systemGroupedBackground) | `#000000` | Dasar konten; netral, tidak bersaing dengan data |
| Core 2 (teks) | `#1C1C1E` (label) | `#F5F5F7` | Kontras tinggi di kedua mode |
| Accent | `#007AFF` (systemBlue) | `#0A84FF` (systemBlue dark) | Satu aksen untuk aksi utama & status aktif; Apple memakai biru ini untuk kontrol, dan biru ini tidak dipakai sebagai gradien |
| Sekunder teks | `#3C3C4399` | `#EBEBF599` | Label sekunder resmi Apple |

**Warna status** (bukan bagian palet dekoratif, hanya penanda keadaan nyata):
hijau `#34C759` (sehat), kuning `#FF9F0A` (perhatian), merah `#FF3B30` (habis/gagal).
Dipakai HANYA pada indikator status kuota yang datanya nyata dari endpoint provider.

**Dilarang:** gradien biru-ke-ungu, ungu-hitam, neon, pastel block, orb radial, glow dekoratif.

## Tipografi

- **Satu keluarga: system font stack Apple** (`-apple-system, BlinkMacSystemFont, "SF Pro Text",
  "Segoe UI", system-ui`). Alasan: ini font sistem Apple; memuat SF Pro dari CDN melanggar lisensi,
  dan stack ini otomatis memberi SF Pro di perangkat Apple serta Segoe UI di Windows.
- **Bukan Inter, bukan JetBrains Mono** (roster default AI, R-06). Angka memakai
  `font-variant-numeric: tabular-nums` dari font yang sama, bukan font mono terpisah.
- Skala mengikuti Dynamic Type Apple: Body 17px, Headline 17px semibold, Title 22px,
  Large Title 34px, Caption 12px. Line-height 1.4 untuk body, 1.15 untuk judul.
- Tidak ada uppercase ber-tracking lebar, tidak ada heading monospace besar.

## Material: Liquid Glass

**Aturan mutlak dari HIG (dikutip dari sumber):** *"Liquid Glass is exclusively for the
navigation/control layer floating above content. Never apply it to content itself."*

Terjemahan untuk proyek ini:
- **Layer kontrol (boleh glass):** header/toolbar, tab bar bawah, tombol aksi utama,
  panel ringkasan yang mengambang, modal/dialog, segmented control.
- **Layer konten (DILARANG glass):** tabel data, daftar model, kartu metrik, paragraf,
  blok kode, ringkasan berita. Ini memakai permukaan padat (`--surface`) dengan border 1px.

**Resep glass** (diadaptasi dari implementasi web yang dipelajari):
- `backdrop-filter: blur(20px) saturate(180%)` sebagai dasar frosted.
- Tint tipis: `rgb(255 255 255 / 0.14)` di gelap, `rgb(255 255 255 / 0.62)` di terang.
- Border atas 1px lebih terang (menangkap cahaya) + border luar 0.5px.
- Inset highlight: `inset 0 1px 0 rgb(255 255 255 / 0.42)`.
- Specular edge: gradien linear tipis di tepi atas, bukan glow.
- **Dose cap (R-10):** maksimal 3 elemen glass terlihat sekaligus di satu layar.
- **Fallback:** bila `backdrop-filter` tidak didukung, permukaan jadi padat 78% (teks tetap terbaca).
- **Reduce Transparency:** `@media (prefers-reduced-transparency: reduce)` mematikan blur,
  permukaan jadi padat.
- **Reduce Motion:** semua animasi glass dimatikan.

## Gerak (MOTION 1)

Hover dan transisi saja. Tidak ada loop tak berujung, tidak ada parallax, tidak ada float.
Satu orkestrasi masuk halaman: header + konten utama muncul dengan stagger 40ms sekali saja.

## Radius (R-11, radius sebagai alat hierarki)

- Kontrol kecil (input, tombol): `10px`
- Tombol besar / search: `14px`
- Panel / kartu: `18px`
- Modal / sheet: `24px`
- Pill HANYA untuk segmented control dan badge status (bentuknya memang pill).

Radius konsentris: elemen di dalam panel memakai radius lebih kecil dari panelnya.

## Ikon

Tidak memakai library ikon generik (Lucide dsb, R-04). Ikon yang dipakai hanyalah glyph
fungsional yang sudah ada di platform: tanda centang status, segitiga peringatan, tanda silang.
Semua dibuat sebagai SVG inline dengan makna tertulis di komentar.

## Yang dihapus dari versi lama (temuan audit)

1. Gradien `#2563eb → #7c3aed` (biru-ke-ungu) di header dan tombol.
2. Lima warna aksen sekaligus (sky, purple, emerald, amber, rose) tanpa sistem.
3. Font Inter + JetBrains Mono (roster default AI).
4. 30 `box-shadow` dan 13 gradien di dashboard sebagai default, bukan hierarki.
5. `backdrop-filter` di navbar + kartu + modal + sidebar sekaligus.
6. Emoji sebagai dekorasi di judul/bullet.

## Batasan yang harus tetap benar

- Semua angka yang ditampilkan berasal dari endpoint nyata (R-17). Tidak ada angka karangan.
- Setiap tombol/link punya tujuan nyata (R-26). Tidak ada kontrol mati.
- Tiga state wajib ada di setiap blok data: kosong, memuat, gagal (R-27).
- Kontras teks minimal 4.5:1 di kedua tema (R-25).
- Keyboard: fokus terlihat, Escape menutup dialog (R-32).
- Toggle tema gelap/terang harus bekerja penuh di kedua mode (R-34).
