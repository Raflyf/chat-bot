---
version: "alpha"
name: "Futuristic UI Glassmorphism"
description: "Glassmorphism landing page, futuristic glass ui, transparent panels, blur effects, glowing edges, dark background, 3d interface. Ideal for landing pages, modern websites. AI-ready template."
colors:
  primary: "#020814"
  secondary: "#FFFFFF"
  tertiary: "#00F0FF"
  neutral: "#000000"
typography:
  h1:
    fontFamily: Exo 2
    fontSize: 2.5rem
    fontWeight: 700
  body-md:
    fontFamily: Exo 2
    fontSize: 1rem
    fontWeight: 400
rounded:
  sm: 16px
  md: 32px
  lg: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.sm}"
    padding: 12px
---

## Overview

Glassmorphism landing page, futuristic glass ui, transparent panels, blur effects, glowing edges, dark background, 3d interface. Ideal for landing pages, modern websites. AI-ready template. Glassmorphism didn't emerge from nowhere. It's the logical endpoint of a decades-long oscillation between flat and dimensional UI. Apple's iOS 7 introduced translucent panels in 2013 — a quiet rebellion against skeuomorphism that planted the seed. But the futuristic variant? That owes more to science fiction than to Cupertino. Think Minority Report interfaces, holographic HUDs in Iron Man, the layered transparency of Blade Runner 2049's data screens. Designers watched those films and thought: what if software actually felt like that?

The technical unlock came around 2020 when backdrop-filter finally shipped across browsers without catastrophic performance hits. Suddenly you could layer frosted panels over dynamic backgrounds without faking it with static blurs. The aesthetic exploded on Dribbble, got a name, got overused, got dismissed — and then matured.

What survived the hype cycle is the futuristic strain. Not the soft pastel cards of 2021, but something harder-edged. Panels with subtle luminous borders, dark substrates, chromatic refractions at the edges. It stopped trying to look like frosted glass and started looking like engineered light. That's where it lives now — at the intersection of material honesty and speculative fiction.

- Density: 5/10 — Balanced
- Variance: 4/10 — Moderate
- Motion: 8/10 — Cinematic

- **Style:** Futuristic, Analytical, Cinematic
- **Keywords:** glassmorphism, futuristic, ui, glass, transparent, blur, glowing, 3d
- **Era:** Future Glass
- **Light/Dark:** ✗ No / ✓ Full

## Colors

- **Background** (#020814) — Primary background surface
- **Text** (#FFFFFF) — Primary text color
- **Accent** (#00F0FF) — Primary accent, CTAs and interactive elements
- **Glass White** (#FFFFFF10) — Secondary surface
- **Border Glow** (#00F0FF80) — Extended palette, decorative use
- **Shadow** (#000000) — Extended palette, decorative use

## Typography

- **Display / Hero:** Exo 2 — Weight 700, tight tracking, used for headline impact
- **Body:** Exo 2 — Weight 400, 16px/1.6 line-height, max 72ch per line
- **UI Labels / Captions:** Exo 2 — 0.875rem, weight 500, slight letter-spacing
- **Monospace:** JetBrains Mono — Used for code, metadata, and technical values

Scale:

- Hero: clamp(2.5rem, 5vw, 4rem)
- H1: 2.25rem
- H2: 1.5rem
- Body: 1rem / 1.6
- Small: 0.875rem

## Layout

- **Grid:** CSS Grid primary. Max-width containment: 1280px centered with 1.5rem side padding.
- **Spacing rhythm:** Balanced. Base unit: 0.5rem (8px).
- **Section vertical gaps:** clamp(4rem, 8vw, 8rem).
- **Hero layout:** Split-screen (text left, visual right).
- **Feature sections:** Zig-zag alternating text+image rows. No 3-equal-columns.
- **Mobile collapse:** All multi-column layouts collapse below 768px. No horizontal overflow.
- **z-index contract:** base (0) / sticky-nav (100) / overlay (200) / modal (300) / toast (500).

## Elevation & Depth

Isometric 3D rendered assets, glowing circuit board traces, glass-like panels, luminous neon, internal luminescence.

- **Physics:** Spring — stiffness 120, damping 20. Confident, weighted transitions.
- **Entry animations:** Fade + translate-Y (16px → 0) over 540ms ease-out. Staggered cascades for lists: 120ms between items.
- **Hover states:** Scale(1.03) + shadow lift over 200ms.
- **Page transitions:** Fade + slide (300ms).
- **Performance:** Only transform and opacity animated. No layout-triggering properties.

## Shapes

Base corner radius: 16px. See rounded tokens in front matter for the full scale.

## Components

- **Primary Button:** Rounded (16px) shape. Accent color fill. Hover: 8% darken + subtle lift shadow. Active: -1px translate tactile press. Font weight 600. No outer glows.
- **Secondary / Ghost Button:** Outline variant. 1.5px border in muted color. Text in primary color. Hover: subtle background fill.
- **Cards:** Rounded (16px) corners. Surface background. Subtle shadow (0 2px 12px rgba(0,0,0,0.06)). 1px border stroke.
- **Inputs:** Label above input. 1px border stroke. Focus ring: 2px accent color offset 2px. Error text below in semantic red. No floating labels.
- **Navigation:** Primary surface background. Active item: accent color indicator. Font weight 500 when active.
- **Skeletons:** Shimmer animation matching component dimensions. No circular spinners.
- **Empty States:** Icon-based composition with descriptive text and action button.

## Do's and Don'ts

- No emojis in UI — use icon system only (Lucide, Heroicons)
- No pure black (#000000) — use off-black or charcoal variants
- No oversaturated accent colors (saturation cap: 80%)
- No 3-column equal-width feature layouts — use zig-zag or asymmetric grid
- No `h-screen` — use `min-h-[100dvh]`
- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen"
- No broken external image links — use picsum.photos or inline SVG
- No generic lorem ipsum in demos

- Do Dark background
- Do Frosted glass containers (blur)
- Do Glowing borders/edges
- Do Floating elements with depth
- Do Clean sans-serif typography

## Use Case

Landing pages, Modern websites


---

## Keputusan Desain yang Disetujui Pemilik Produk (v0.80)

Dokumen ini adalah arah visual dari sumber eksternal. Beberapa bagiannya bertabrakan
dengan aturan anti-slop internal, jadi konfliknya dilaporkan lebih dulu dan pemilik
produk memutuskan. Keputusannya dicatat di sini supaya tidak ditanyakan lagi.

| Topik | Arahan awal | Keputusan pemilik | Konsekuensi |
|---|---|---|---|
| Cakupan kaca | Glass di navbar + kartu + modal + sidebar sekaligus | **Tetap glass di seluruh permukaan** | Menyimpang dari batas dosis anti-slop (maks 1-2 elemen). Hierarki tetap dijaga lewat luminansi border: makin dekat ke penonton, makin terang bordernya. |
| Testimoni | 3 kartu testimoni | **Tidak ada bagian testimoni** | Belum ada pengguna nyata yang memberi kutipan, dan testimoni karangan dilarang. Diganti panel status sistem berisi angka nyata. |
| Paket harga | 3 tier, tier tengah ditonjolkan | **Sesuaikan sistem** | Sistem ini gratis dan kuotanya berubah, jadi tidak ada bagian harga sama sekali. |
| Bahasa | Seluruhnya Inggris | **Indonesia sebagai utama, dengan tombol ganti ke Inggris** | Tombol bahasa ada di header. Kamus lengkap ada di `public/js/landing.js`. |

### Dial (dari DESIGN.md)

- **ENERGY 3** — halaman harus menyapa keras: hero besar, aksen cyan, panel bercahaya.
- **RHYTHM 3** — komposisi antar bagian berbeda: hero split-screen, kemampuan zig-zag,
  langkah tiga kolom, panel status, CTA terpusat. Tidak ada pola yang diulang mentah.
- **MOTION 2** — gerak terarah: satu animasi masuk untuk hero, reveal saat digulir,
  transisi hover 200ms. Tidak ada gerak berulang tanpa pemicu.

### Motif identitas

Rantai. Garis penghubung antar simpul penyedia menunjukkan urutan percobaan yang
sebenarnya, dan pola yang sama muncul di landing page (panel "Rantai penyedia")
maupun konsol (warna per penyedia). Ini yang membuat halaman tidak bisa dipindah ke
produk lain begitu saja.

### Alasan tiap keputusan visual

- **Latar #020814**: substrat gelap wajib agar lapisan frosted terbaca sebagai bidang,
  bukan kotak abu.
- **Aksen #00F0FF**: satu aksen, dipakai di titik interaksi (CTA utama, border hover,
  angka kunci). Bukan di semua permukaan.
- **Blur 12-20px**: di bawah 12px kehilangan metafora kaca; di atas 24px terlihat
  seperti status memuat.
- **Radius 8/16/20px**: tiga tingkat, jadi radius menandai hierarki (kontrol, kartu,
  panel) alih-alih menghias seragam.
- **Exo 2**: geometris dengan sudut tegas, cocok untuk tema "engineered light", dan
  tetap terbaca di ukuran kecil untuk tabel konsol.
- **Tidak ada grid/dot pattern**: tekstur latar dibuat dari tiga bidang cahaya lembut.
  Pola garis teknis akan jadi tekstur tanpa makna.
- **Tidak ada emoji sebagai ikon**: seluruh ikon SVG inline, digambar sendiri agar
  sesuai konteks (bukan satu set library yang seragam).
