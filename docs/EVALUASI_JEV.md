# Evaluasi JEV untuk Chatbot — Hasil Uji Nyata

Tanggal uji: 17 Okt 2026. Semua angka di bawah berasal dari pemanggilan API
sungguhan, bukan perkiraan.

## Ringkasan

Klaim di dokumen asal **sebagian benar, sebagian tidak**. JEV memang classifier
yang akurat untuk niat user, tetapi **belum layak dipasang di jalur utama
chatbot** karena tiga kendala keras: latensi, kuota, dan sifatnya yang bukan
model percakapan.

| Aspek | Klaim dokumen | Hasil uji |
|---|---|---|
| Endpoint `POST /api/v1/decide` | Ada | **Benar**, HTTP 200 |
| Model `jev-1.14.0` | Ada | **Benar**, terverifikasi |
| Provider `workers-ai` | Ada | **Benar** |
| Key aktif | Ada | **Benar**, valid |
| Sisa kuota 9.656 token | Ada | **Benar** saat mulai, kini **1.663** |
| Akurasi mengalahkan regex | "Lebih pintar" | **Benar**, tapi hanya pada kalimat tidak baku (8/8 vs 6/8). Pada kalimat rapi regex juga 8/8. |
| Siap produksi | Tersirat | **Tidak**. Latensi 3–12 detik, kuota habis dalam 25 permintaan. |

## Temuan penting yang tidak disebut dokumen asal

### 1. Situsnya bukan milik TypeSafe

Dari footer situs itu sendiri:

> jevtypesafe.org is an independent third-party tool. It is NOT affiliated with
> TypeSafe or Cloudflare. Jev model inference is powered by Cloudflare Workers AI.

Artinya ini **perantara pihak ketiga** yang meneruskan ke Cloudflare Workers AI.
Risiko: bergantung pada satu perantara yang bisa mengubah harga, menutup layanan,
atau berhenti kapan saja. Tidak ada SLA.

### 2. Latensi mematikan untuk chat

```
putaran 1 : 6,1 detik
putaran 2 : 11,7 detik
putaran 3 : 9,1 detik
```

Satu-satunya keputusan `noul` sederhana butuh 3,2 detik. Chatbot saat ini
menjawab dalam hitungan detik total; menambah 3–12 detik hanya untuk menebak
niat membuat pengalaman jauh lebih lambat daripada sekarang.

### 3. Kuota sangat kecil

- Mulai: 9.656 token
- Setelah 13 percobaan uji: **1.663 token** (sekitar 83% habis)
- Satu keputusan `choice` memakai 350–400 token input
- Sisa kuota hari ini: sekitar **4 keputusan lagi**

Untuk chatbot yang menerima ratusan pesan per hari, ini tidak cukup. Paket
berbayar mulai 5 dolar AS, dan token **tidak** termasuk output (output gratis,
input berbayar).

### 4. Bukan model percakapan

JEV hanya mengembalikan label + probabilitas. Ia tidak bisa menggantikan LLM
untuk menulis balasan. Jadi ia hanya bisa dipakai sebagai **penebak niat**,
bukan pengganti logika bot.

## Hasil akurasi

### Uji 1 — kalimat rapi

| | Benar |
|---|---|
| Regex | 8/8 |
| JEV | 7/8 |

JEV salah pada `"jangan lupa ya besok aku ulang tahun, catet"` — dijawab
`reminder` padahal seharusnya `catatan`. Keyakinannya rendah (0,4), artinya
model sendiri tidak yakin.

### Uji 2 — obrolan santai, singkatan, tanpa kata kunci

| | Benar |
|---|---|
| Regex | 6/8 |
| JEV | 8/8 |

JEV menang justru di kasus yang selama ini bikin bot ngawur:

| Kalimat | Regex | JEV |
|---|---|---|
| `ntar sore gw ke dokter, jgn sampe lupa` | obrolan (SALAH) | reminder (0,81) |
| `bantuin cek dong harga tiket konser coldplay` | obrolan (SALAH) | cari_web (1,0) |

**Kesimpulan akurasi:** JEV memang lebih pintar mengenali maksud tersirat.
Klaim itu benar. Masalahnya bukan akurasi, tapi biaya dan kecepatan.

## Rekomendasi

### Jangan pasang di jalur utama

Alasannya:
1. 3–12 detik per keputusan, sementara regex 0 milidetik.
2. Kuota habis dalam hitungan hari untuk trafik nyata.
3. Perantara pihak ketiga tanpa jaminan layanan.
4. Regex bot sudah lulus 589 test; menambah titik gagal luar tanpa jaminan
   ketersediaan justru menurunkan keandalan.

### Kalau tetap ingin dipakai: pola yang aman

Pakai sebagai **lapis kedua**, bukan pengganti:

```
pesan masuk
  ├─ regex yakin (pola jelas)        -> langsung jalan, 0 ms
  └─ regex TIDAK yakin (0 pola cocok) -> panggil JEV, tunggu maks 3 detik
        ├─ JEV yakin (>0,75)           -> pakai hasilnya
        ├─ JEV ragu / gagal / timeout  -> biarkan LLM yang memutuskan
        └─ kuota habis                 -> matikan otomatis, pakai regex
```

Dengan pola ini:
- 80–90% pesan tidak menyentuh JEV (pola jelas) sehingga tetap cepat
- Kuota hanya terpakai untuk pesan ambigu
- Kalau JEV mati, bot tetap jalan normal

Tetap butuh: `JEV_API_KEY` di environment, batas kuota harian, dan tombol mati
manual.

## Kesimpulan

Klaim "JEV lebih pintar, tidak ngawur salah klasifikasi niat" **terbukti benar**
pada kalimat tidak baku: 8/8 vs 6/8.

Tetapi klaim bahwa ini layak langsung diintegrasikan **tidak terbukti**. Latensi
3–12 detik dan kuota 1.663 token sisa membuatnya belum bisa menjadi penentu
utama di chatbot produksi.

Keputusan ada di pemilik produk. Kalau ingin dilanjutkan, pola "lapis kedua"
di atas adalah cara paling aman; kalau tidak, regex yang ada sudah cukup dan
tidak perlu dependensi baru.
