# CODEBASE MAP — FreeAIBot

Peta navigasi read-only. Agen yang mengaudit atau mengubah satu berkas bisa langsung menuju sasaran tanpa memindai seluruh repo.

Dihasilkan oleh `npm run map:codebase` dari AST repo lokal. Tidak ada kode aplikasi yang diubah.

## Cara pakai

1. Cari topik di **Peta cepat: topik ke file**.
2. Sebelum mengubah berkas bersama, baca **Dampak perubahan**.
3. Detail simbol per berkas: `docs/codebase-index.json` (exports, imports, kasus tes).
4. Jangan membaca `CLAUDE.md`/`DOCUMENTATION.md` utuh; pakai `grep` lalu baca rentang kecil.
5. `graphify-out/` (jika ada) adalah graf lama dan tidak memuat semua berkas terbaru; verifikasi dengan peta ini.

## Ringkasan

| Area | File | Baris |
| --- | --- | --- |
| api | 11 | 3496 |
| public | 19 | 10645 |
| scripts | 17 | 3163 |
| sql | 28 | 2958 |
| src | 51 | 36651 |
| tests | 99 | 9733 |
| **total** | **225** | **66646** |

## Titik masuk

- `api/webhook.ts` — Webhook Telegram (serverless).
- `api/whatsapp.ts` — Webhook WhatsApp Cloud + verifikasi signature.
- `api/health.ts` — Health check produksi: versi, database, provider.
- `api/stats.ts` — Metrik dashboard: kuota, kunci, model, pool.
- `api/dataset.ts` — Ekspor riwayat percakapan (CSV/JSON).
- `api/admin-otp.ts` — Auth admin: PIN, OTP, sesi, purge data.
- `src/index.ts` — Runner lokal: Telegram polling + Baileys.
- `src/telegram.ts` — Handler seluruh pesan Telegram.
- `src/whatsapp_cloud.ts` — Handler pesan WhatsApp Cloud.
- `src/whatsapp_baileys.ts` — Handler pesan WhatsApp Baileys.
- `src/skills.ts` — Persona, prompt, sanitasi, autoReply.
- `src/providers.ts` — Urutan tier, race, failover provider.

## Peta cepat: topik ke file

- **Persona, prompt, sanitasi balasan**: `src/skills.ts`
- **Routing provider, failover, race**: `src/providers.ts`, `src/limits.ts`, `src/quota.ts`, `src/neuron.ts`, `src/cooldown.ts`
- **Kontrak env dan daftar model**: `src/env.ts`
- **Riwayat dan cache konteks**: `src/memory.ts`, `src/db.ts`, `src/chat_id.ts`
- **Telegram**: `src/telegram.ts`, `api/webhook.ts`
- **WhatsApp Cloud**: `src/whatsapp_cloud.ts`, `api/whatsapp.ts`
- **WhatsApp Baileys**: `src/whatsapp_baileys.ts`, `src/baileys_brain.ts`, `src/whatsapp_session.ts`
- **Media: gambar, stiker, audio, dokumen, video**: `src/media.ts`, `src/media_guard.ts`
- **Stiker: aset, label, cooldown**: `src/stickers.ts`, `src/sticker-manifest.ts`
- **Pencarian web dan scraping**: `src/web.ts`, `src/knowledge.ts`, `src/bot_growth.ts`
- **Tebak-tebakan, gombalan, game**: `src/riddles.ts`, `src/bot_memory.ts`, `src/games/engine.ts`, `src/games/index.ts`, `src/games/cards.ts`
- **Catatan, tugas, keuangan, kebiasaan**: `src/notes.ts`
- **Pengingat**: `src/remind.ts`, `src/reminder-repeat.ts`, `src/reminder-dedup.ts`, `src/reminder-ubah.ts`, `src/reminder-multihari.ts`
- **Zona waktu dan profil user**: `src/timezone.ts`, `src/user-profile.ts`, `src/user_facts.ts`
- **Keamanan admin**: `src/admin_auth.ts`, `src/rate_limit.ts`, `api/admin-otp.ts`
- **Dashboard metrik**: `api/stats.ts`, `public/js/dashboard.js`, `public/dashboard.html`, `public/css/console.css`, `public/js/i18n.js`
- **Landing dan UI publik**: `public/index.html`, `public/privacy.html`
- **Mode grup**: `src/group_mode.ts`, `src/group_db.ts`
- **Monitor pengiriman dan VPS**: `src/wa_monitor.ts`, `src/vps_monitor.ts`
- **Perintah bot (satu sumber)**: `src/commands.ts`
- **Logger dan observabilitas**: `src/logger.ts`

## Modul inti (src/ dan api/)

| File | Baris | Tujuan | Ekspor utama |
| --- | --- | --- | --- |
| `src/skills.ts` | 5880 | - | fn cleanMathAndNoise, fn userAskedAboutMedia, fn stripMediaNarration, fn adalahReaksiVisualStiker, fn extractStickerReadTag |
| `src/notes.ts` | 4393 | PENCATATAN PRIBADI, catatan, tugas, keuangan, kebiasaan. KENAPA MODUL INI ADA (permintaan pemilik produk, 04 Okt 2026): "apakah bot nya bisa digunakan untuk mencatat dan mengingat  | type NoteKind, type ExpenseKind, iface NiatTerdeteksi, iface CatatanRingkas, iface TugasRingkas |
| `src/whatsapp_baileys.ts` | 2273 | - | iface BaileysGroupTargetInfo, fn unwrapBaileysMessage, fn deteksiTargetBotBaileys, fn startBaileysReminderWorker, fn stopBaileysReminderWorker |
| `src/web.ts` | 2220 | Mesin Pencari & Penjelajah Web Bebas Real-Time 2026 (Zero-API-Key) Menggabungkan Google News Global & ID, Bing News, Hacker News, Wikipedia (ID/EN), arXiv, serta Deep Webpage Scrap | fn isSafePublicUrl, fn fetchAmanSsrf, fn cleanStr, fn decodeBingUrl, fn isJunkArticle |
| `src/providers.ts` | 2046 | - | fn getOrderedKeys, iface TextPart, iface ImagePart, type ContentPart, iface ChatMsg |
| `src/baileys_backup_web.ts` | 1655 | BAILEYS BACKUP WEB & CLOUD SYNC SERVICE Menyediakan kontrol web penuh untuk Baileys Backup (status VPS InstaBox, telemetri failover laptop Windows, Resume/Start VPS, dan sinkronisa | const BAILEYS_BACKUP_CLOUD_FILENAME, const BAILEYS_BACKUP_DESKTOP_FILENAME, const DESKTOP_HEARTBEAT_TTL_SECS, const BAILEYS_BACKUP_RELEASE_URL, type VpsAvailability |
| `src/media.ts` | 1446 | - | fn transcribeAudio, fn extractPdfTextSimple, fn sniffMimeType, fn extractDocumentText, fn processIncomingDocument |
| `src/telegram.ts` | 1389 | - | fn getTelegramBot, fn sendTelegramMessageSafe, fn sendTelegramStickerSafe, fn deteksiPanggilSlash, fn handleIncomingMessage |
| `src/admin_auth.ts` | 1334 | - | iface AdminAuthConfig, fn hashValue, fn isScryptHash, fn verifyPinHash, fn resolveMatchingHash |
| `api/stats.ts` | 1295 | - | fn getModelCatalog, fn handler |
| `src/whatsapp_cloud.ts` | 1285 | - | fn verifyWhatsAppWebhook, fn verifyMetaSignature, const verifyWhatsAppSignature, fn sendWhatsAppCloudMessageSafe, fn sendWhatsAppCloudStickerSafe |
| `src/games/engine.ts` | 1275 | MESIN GAME — logika utama semua permainan. Alur: `mulaiGame()` -> state awal -> tiap pesan user lewat `prosesGame()` -> state baru + teks balasan. State disimpan di DB (tabel game_ | iface HasilGame, fn unoMulai, fn unoLangkah, fn capsaMulai, fn capsaKombinasiTerbaik |
| `src/remind.ts` | 834 | - | iface ReminderItem, iface HasilSimpanReminder, fn saveReminderToDb, fn simpanReminderCerdas, const BAILEYS_REMINDER_MARKER |
| `src/group_mode.ts` | 728 | ENGINE MODE GRUP BERSAMA — WhatsApp Baileys & Telegram. Mengelola 3 mode per-grup: - 'mention' (default): balas saat @mention, reply pesan bot, kata panggil natural, atau follow-up | type GroupMode, iface GroupModeRecord, type GroupCommandKind, iface GroupEvaluationInput, iface GroupEvaluationResult |
| `src/vps_monitor.ts` | 590 | MONITOR LIFECYCLE VPS BAILEYS (PASSIVE & COMPLIANT) Memantau batas runtime maksimum (mis. 120 menit pada InstaBox Free Plan) dan perubahan status VPS (paused/stopped/pulih). Modul  | const STATE_FILENAME, iface InstaboxMachineSnapshot, iface VpsMonitorState, iface VpsMonitorEvent, iface CekLifecycleDeps |
| `src/timezone.ts` | 587 | Mesin Zona Waktu Global & Universal Real-Time Clock Menangani waktu dinamis untuk pengguna di seluruh belahan bumi: - Waktu Universal (UTC/GMT) | iface FormattedTime, fn formatInZone, iface CountryTz, fn detectUserCountry, iface LocationEntry |
| `api/dataset.ts` | 582 | - | iface DatasetPair, fn formatLocalComponents, fn handler |
| `src/memory.ts` | 565 | - | iface ChatContext, fn withChatLock, fn adalahTestChatId, fn invalidateContextCache, fn updateContextCache |
| `src/bot_memory.ts` | 517 | Memori bot yang tumbuh sendiri. KENAPA MODUL INI ADA: Sebelumnya tebak-tebakan (dan gombalan) disimpan sebagai konstanta di kode. | type MemoryKind, iface MemoryItem, fn slugify, fn memoryKey, fn saveMemoryItem |
| `src/limits.ts` | 484 | Batas kuota LIVE dari endpoint resmi tiap provider. Kenapa modul ini ada: sebelumnya limit di-hardcode di .env dan TERBUKTI SALAH untuk beberapa provider (temuan audit v0.49): | iface LiveLimit, fn geminiDocumentedLimits, fn dreampromptingDocumentedLimits, fn getCachedLimits, fn fetchOpenRouterLimits |
| `src/vps_keepalive.ts` | 482 | AUTO-PING / ACTIVITY LEASE VPS BAILEYS (ANTI AUTO-PAUSE) InstaBox mem-pause sandbox yang idle selama `autoSuspendAfterSeconds` (free plan: 1800 detik = 30 menit). Endpoint resmi un | const KEEPALIVE_STATE_FILENAME, const KEEPALIVE_LEASE_ID, const MIN_KEEPALIVE_INTERVAL_SECS, const MAX_KEEPALIVE_LEASE_TTL_SECS, type KeepaliveSource |
| `src/wa_monitor.ts` | 474 | MONITOR PENGIRIMAN WHATSAPP KENAPA ADA: Saat akun WhatsApp Cloud API terblokir Meta (mis. payment method belum | iface MetaErrorInfo, type KategoriErrorMeta, fn klasifikasiErrorMeta, fn resetMonitorWaUntukTest, fn statistikKirimWa |
| `api/laporan.ts` | 408 | - | const maxDuration, fn handler |
| `src/stickers.ts` | 395 | Sistem stiker balasan bot (aset stiker WhatsApp milik user). Model memilih emoji secara DINAMIS (lewat tag [[sticker:<emoji>]] di balasannya — bukan daftar template hardcode). Modu | fn isEdgyStickerEmoji, fn isPlayfulContext, type StickerMood, fn stickerMood, fn stickerFitsMood |
| `src/user-profile.ts` | 390 | PROFIL WAKTU PENGGUNA, zona waktu per-user, permanen. MASALAH (temuan pemilik produk 05 Okt 2026): "jangan salah membaca waktu user sedang berada... misal sistem defaultnya WIB, | iface ProfilWaktu, fn ambilProfilWaktu, fn simpanProfilWaktu, fn profilDariLokasi, iface KeputusanWaktu |
| `src/games/index.ts` | 374 | MESIN GAME — lapisan integrasi (DB + deteksi + alur percakapan). Modul ini yang dipanggil `tanganiPencatatan()`: mendeteksi apakah user minta bermain, memulai permainan, memproses  | iface HasilTanganiGame, fn ambilGame, fn simpanGame, fn akhiriGame, fn daftarGameTeks |
| `src/quota.ts` | 374 | Pelacak kuota harian per key (hybrid in-memory + Supabase provider_quota). Reset otomatis tiap tanggal UTC baru. 429 ikut dihitung agar pool berhenti. Sejak v0.27.13: juga melacak  | type ProviderKind, type QuotaKind, fn keyHash, fn keyTokensUsedToday, fn keyRequestsUsedToday |
| `api/admin-otp.ts` | 362 | - | fn handler |
| `src/db.ts` | 356 | - | fn db, fn saveMessage, fn isMessageProcessed, fn markMessageProcessed, fn claimIncomingMessage |
| `src/bot_growth.ts` | 328 | Pertumbuhan memori bot: cari dari internet, simpan ke memori. KENAPA MODUL INI ADA: Pemilik produk meminta bot tumbuh sendiri: | fn extractUrlsFromSearch, fn growMemory, fn getOrGrowMemory, fn needsGrowth |
| `src/env.ts` | 316 | - | const config, fn assertRuntime |
| `src/games/cards.ts` | 304 | MESIN GAME — kartu, papan, dadu, dan aturan permainan. KENAPA MODUL INI ADA: Sebelumnya bot MENGARANG saat diajak main (UNO/kartu/catur) karena tidak ada | type Jenis, type Nilai, iface Kartu, const SIMBOL, const NILAI_ANGKA |
| `src/reminder-ubah.ts` | 292 | UBAH / UNDUR / BATALKAN PENGINGAT. MASALAH (temuan pemilik produk 05 Okt 2026): "jika user bilang 'waktu rapat di undur 1 jam jadi jam 10 sampai jam 11', | iface PengingatRingkas, type AksiUbah, iface PermintaanUbah, fn daftarPengingatPending, fn ubahPengingat |
| `src/user_facts.ts` | 277 | PENANGKAP FAKTA PERSONAL USER (permintaan pemilik produk 06 Okt 2026): "buat agar bot bisa menangkap personality, kesukaan, dan lainnya dari user, simpan di database" | const PENANDA_FAKTA, iface FaktaPersonal, fn deteksiFaktaPersonal, fn simpanFaktaPersonal, fn tangkapFaktaPersonal |
| `src/knowledge.ts` | 263 | - | type KnowledgeCategory, iface CachedKnowledge, fn sanitizeKnowledgeText, fn normalizeEntityKey, fn determineCategoryAndTTL |
| `src/sticker-manifest.ts` | 262 | Manifest stiker: emoji -> nama file di public/stickers/, PLUS teks & konsep. DILABELI MANUAL (bukan model API) dengan membaca TEKS di setiap stiker lebih dulu, baru konsep gambarny | const STICKER_MANIFEST, const STICKER_INFO, const EDGY_STICKER_EMOJIS |
| `src/commands.ts` | 257 | DAFTAR PERINTAH BOT — SATU SUMBER KEBENARAN. KENAPA MODUL INI ADA (permintaan pemilik produk 16 Okt 2026): "saya ingin ketika / gini itu muncul semua list fitur yg ada secara lengk | iface PerintahBot, const PERINTAH_BOT, const PERINTAH_BERARGUMEN, const PERINTAH_BANTUAN, const PERINTAH_DIGABUNG |
| `src/reminder-repeat.ts` | 243 | PENGINGAT BERULANG — aturan pengulangan & perhitungan kemunculan berikutnya. FITUR BARU (permintaan pemilik produk 05 Okt 2026): "ingatkan tiap hari jam 7 minum obat" | type RepeatKind, iface AturanUlang, fn deteksiPengulangan, fn berikutnya, fn labelUlang |
| `api/baileys-backup.ts` | 227 | - | iface BaileysBackupHandlerDeps, fn createBaileysBackupHandler |
| `src/reminder-multihari.ts` | 216 | PENGINGAT MULTI-HARI (H-N) — "ingatkan 3, 2, 1 hari sebelum" PERMINTAAN PEMILIK PRODUK (09 Okt 2026): "reminder setiap 3, 2, 1 hari senelummnya" | iface PermintaanMultiHari, fn deteksiMultiHari, fn susunDaftarPengingat |
| `src/whatsapp_session.ts` | 195 | - | iface RestoreSessionOptions, fn isRemoteFileNewer, fn restoreSessionFromSupabase, fn syncSessionDirToSupabase, fn clearSessionInSupabase |
| `src/ringkasan.ts` | 184 | RINGKASAN PERIODIK, laporan bulanan/mingguan di chat. KENAPA (audit 05 Okt 2026): user harus membuka dashboard atau bertanya satu per satu untuk tahu kondisi datanya. Dengan `/ring | iface OpsiRingkasan, fn susunRingkasan, fn mintaRingkasan |
| `src/documents.ts` | 164 | SIMPAN DOKUMEN — teks hasil ekstraksi PDF/Word agar bisa DIAUDIT. KENAPA (permintaan pemilik produk, 09 Okt 2026): "apalah bot benar menjelaskan isi pdf nya? coba kamu cek isi pdf  | iface DokumenTersimpan, fn simpanDokumen, fn dokumenTerakhir, fn ekstrakTeksDokumen, fn ekstrakTeksPdf |
| `api/cron/reminders.ts` | 161 | - | fn handler |
| `src/chat_id.ts` | 138 | NORMALISASI chat_id — SATU SUMBER untuk SELURUH APLIKASI. MASALAH YANG DIPERBAIKI (temuan pemilik produk 09 Okt 2026): chat_id TIDAK KONSISTEN antar tabel: | fn normChatId, fn nomorWhatsApp, const BAILEYS_CHAT_PREFIX, const BAILEYS_GROUP_PREFIX, fn baileysGroupChatKey |
| `src/logger.ts` | 129 | Logger terstruktur tanpa dependensi eksternal (single-line JSON). CATATAN MIGRASI: Saat ini logger hanya dipasang di entrypoint (src/index.ts) dan endpoint webhook (api/webhook.ts, | type LogLevel, iface LogContext, iface Logger, fn log, fn logInfo |
| `src/cooldown.ts` | 119 | COOLDOWN PROVIDER PERSISTEN. KENAPA MODUL INI ADA (audit 05 Okt 2026): Cooldown key provider sebelumnya hanya di MEMORI (`keyCooldownMap`). Pada | fn cooldownMemori, fn setCooldown, fn hapusCooldown, fn hidrasiCooldown, fn mulaiHidrasiLatar |
| `api/health.ts` | 116 | ENDPOINT HEALTH CHECK — /api/health KENAPA: sebelumnya tidak ada cara cepat memeriksa apakah sistem hidup dan komponennya sehat. Dengan endpoint ini, uptime monitor gratis (UptimeR | fn handler |
| `src/group_db.ts` | 105 | ROUTER TABEL GRUP vs PRIVAT — pemisahan database fisik & logis. Saat `sql/migrate_v35_group_database.sql` sudah dijalankan di Supabase, seluruh chat grup otomatis memakai tabel `gr | type GroupTableBase, fn isTableMissingError, fn hasDedicatedGroupTables, fn resolveTableName, fn markGroupTablesUnavailable |
| `api/cron/backup.ts` | 103 | - | fn handler |
| `api/whatsapp.ts` | 103 | - | const maxDuration, const config, fn handler |
| `src/media_guard.ts` | 87 | PENJAGA BERKAS — pertahanan berlapis untuk unggahan pengguna. LATAR BELAKANG (audit keamanan 06 Okt 2026, parameter #18): Proyek ini TIDAK memakai antivirus/ClamAV. Itu dapat diter | fn adaMagicBytesBerbahaya, fn periksaBerkasAman, const DAFTAR_EKSTENSI_TERLARANG |
| `src/neuron.ts` | 82 | KONVERSI NEURON CLOUDFLARE. MASALAH (laporan pemilik produk 06 Okt 2026): "masa baru 2 request sudah habis? kan cloudflare itu hitungannya neuron, | iface TarifNeuron, const TARIF_NEURON, const TARIF_DEFAULT, fn tarifModel, const NEURON_HARIAN_GRATIS |
| `src/reminder-dedup.ts` | 75 | DETEKSI DUPLIKAT PENGINGAT. MASALAH (temuan pemilik produk 05 Okt 2026): "misal ingatkan besok jam 9 ada rapat, lalu beberapa jam kemudian user | fn normalisasiUntukBanding, fn kemiripanPesan, const TOLERANSI_WAKTU_MENIT, const AMBANG_GABUNG, const AMBANG_MIRIP |
| `api/webhook.ts` | 72 | - | const maxDuration, fn handler |
| `api/cron/arsip.ts` | 67 | - | fn handler |
| `src/riddles.ts` | 64 | Benih awal memori tebak-tebakan. PENTING — INI BUKAN SUMBER UTAMA: Sebelumnya berkas ini adalah bank tebak-tebakan yang dibaca langsung oleh | iface SeedRiddle, const RIDDLE_SEED, const GOMBAL_SEED |
| `src/markers.ts` | 62 | Sinyal durable antar-giliran percakapan yang disimpan di kolom `feedback` tabel messages (tanpa menambah kolom baru / mengotori data). Mengapa perlu: balasan bot diproduksi oleh mo | iface DurableMarkers, fn encodeMarkers, fn stripRiddleMarker, fn lastRiddleAnswer |
| `src/rate_limit.ts` | 61 | RATE LIMIT sederhana berbasis memori. KENAPA: endpoint publik (login admin) bisa dibombardir percobaan. Lockout PIN sudah ada, tapi GET status tidak dibatasi — penyerang bisa | iface HasilRateLimit, fn cekRateLimit |
| `src/baileys_brain.ts` | 43 | Otak percakapan khusus jalur WhatsApp Baileys. Memisahkan sesi obrolan biasa (`wa_baileys_<nomor>`) dari Cloud API (`wa_<nomor>`), sementara data terstruktur bersama (pengingat, ca | fn baileysAutoReply, fn baileysDescribeImage, fn baileysDynamicNotice |

## Dampak perubahan (siapa meng-import berkas ini)

| File | Peng-import | Contoh |
| --- | --- | --- |
| `src/db.ts` | 30 | `api/admin-otp.ts`, `api/cron/arsip.ts`, `api/cron/backup.ts`, `api/dataset.ts`, ... |
| `src/env.ts` | 28 | `api/admin-otp.ts`, `api/cron/arsip.ts`, `api/cron/backup.ts`, `api/cron/reminders.ts`, ... |
| `src/notes.ts` | 26 | `src/reminder-ubah.ts`, `src/ringkasan.ts`, `src/telegram.ts`, `src/whatsapp_baileys.ts`, ... |
| `src/skills.ts` | 21 | `src/baileys_brain.ts`, `src/media.ts`, `src/remind.ts`, `src/telegram.ts`, ... |
| `src/chat_id.ts` | 19 | `api/admin-otp.ts`, `api/dataset.ts`, `src/baileys_brain.ts`, `src/db.ts`, ... |
| `src/group_db.ts` | 14 | `api/cron/backup.ts`, `api/dataset.ts`, `api/stats.ts`, `src/db.ts`, ... |
| `src/memory.ts` | 11 | `src/baileys_brain.ts`, `src/media.ts`, `src/skills.ts`, `src/telegram.ts`, ... |
| `src/timezone.ts` | 9 | `src/group_mode.ts`, `src/notes.ts`, `src/reminder-repeat.ts`, `src/skills.ts`, ... |
| `src/user_facts.ts` | 9 | `src/telegram.ts`, `src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts`, `tests/adaptasi-universal.test.mjs`, ... |
| `src/remind.ts` | 7 | `api/cron/reminders.ts`, `src/telegram.ts`, `src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts`, ... |
| `src/logger.ts` | 6 | `api/webhook.ts`, `api/whatsapp.ts`, `src/documents.ts`, `src/index.ts`, ... |
| `src/web.ts` | 6 | `src/bot_growth.ts`, `src/telegram.ts`, `src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts`, ... |
| `src/user-profile.ts` | 6 | `src/notes.ts`, `src/remind.ts`, `src/ringkasan.ts`, `tests/evaluasi-07okt.test.mjs`, ... |
| `src/stickers.ts` | 6 | `src/skills.ts`, `src/telegram.ts`, `src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts`, ... |
| `src/providers.ts` | 5 | `api/stats.ts`, `src/media.ts`, `src/memory.ts`, `src/skills.ts`, ... |
| `src/admin_auth.ts` | 4 | `api/admin-otp.ts`, `api/baileys-backup.ts`, `api/dataset.ts`, `api/stats.ts` |
| `src/telegram.ts` | 4 | `api/cron/reminders.ts`, `api/webhook.ts`, `src/index.ts`, `tests/telegram-grup-panggil.test.mjs` |
| `src/wa_monitor.ts` | 4 | `api/health.ts`, `src/remind.ts`, `src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts` |
| `src/neuron.ts` | 4 | `api/stats.ts`, `src/providers.ts`, `tests/cloudflare-neuron.test.mjs`, `tests/neuron.test.mjs` |
| `src/commands.ts` | 4 | `scripts/set_perintah_telegram.ts`, `src/notes.ts`, `src/telegram.ts`, `tests/telegram-menu-perintah.test.mjs` |
| `src/reminder-repeat.ts` | 4 | `src/notes.ts`, `src/remind.ts`, `src/ringkasan.ts`, `tests/berulang.test.mjs` |
| `src/reminder-dedup.ts` | 4 | `src/remind.ts`, `src/reminder-ubah.ts`, `tests/pengingat-kanal-baileys.test.mjs`, `tests/pengingat.test.mjs` |
| `src/sticker-manifest.ts` | 4 | `src/skills.ts`, `src/stickers.ts`, `tests/stiker-klasifikasi.test.mjs`, `tests/stiker-teks-konsep.test.mjs` |
| `src/markers.ts` | 4 | `src/skills.ts`, `src/telegram.ts`, `src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts` |
| `src/media.ts` | 4 | `src/telegram.ts`, `src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts`, `tests/otak-terpisah-dan-konteks.test.mjs` |
| `src/rate_limit.ts` | 3 | `api/admin-otp.ts`, `api/baileys-backup.ts`, `tests/rate-limit.test.mjs` |
| `src/baileys_backup_web.ts` | 3 | `api/baileys-backup.ts`, `api/cron/reminders.ts`, `tests/vps-keepalive.test.mjs` |
| `src/vps_monitor.ts` | 3 | `api/cron/reminders.ts`, `src/baileys_backup_web.ts`, `src/whatsapp_baileys.ts` |
| `src/vps_keepalive.ts` | 3 | `api/cron/reminders.ts`, `src/baileys_backup_web.ts`, `tests/vps-keepalive.test.mjs` |
| `src/knowledge.ts` | 3 | `src/bot_memory.ts`, `src/skills.ts`, `src/web.ts` |

## Impor internal per modul besar

| File | Import internal |
| --- | --- |
| `src/skills.ts` | `src/bot_growth.ts`, `src/bot_memory.ts`, `src/chat_id.ts`, `src/env.ts`, `src/games/index.ts`, `src/knowledge.ts`, `src/markers.ts`, `src/memory.ts`, ... |
| `src/notes.ts` | `src/chat_id.ts`, `src/commands.ts`, `src/db.ts`, `src/games/index.ts`, `src/group_db.ts`, `src/reminder-repeat.ts`, `src/reminder-ubah.ts`, `src/ringkasan.ts`, ... |
| `src/whatsapp_baileys.ts` | `src/baileys_brain.ts`, `src/chat_id.ts`, `src/db.ts`, `src/documents.ts`, `src/env.ts`, `src/group_mode.ts`, `src/markers.ts`, `src/media.ts`, ... |
| `src/web.ts` | `src/knowledge.ts` |
| `src/providers.ts` | `src/cooldown.ts`, `src/env.ts`, `src/logger.ts`, `src/neuron.ts`, `src/quota.ts` |
| `src/baileys_backup_web.ts` | `src/db.ts`, `src/env.ts`, `src/vps_keepalive.ts`, `src/vps_monitor.ts` |
| `src/media.ts` | `src/env.ts`, `src/media_guard.ts`, `src/memory.ts`, `src/providers.ts`, `src/quota.ts`, `src/skills.ts` |
| `src/telegram.ts` | `src/commands.ts`, `src/db.ts`, `src/documents.ts`, `src/env.ts`, `src/group_mode.ts`, `src/markers.ts`, `src/media.ts`, `src/memory.ts`, ... |
| `src/admin_auth.ts` | `src/db.ts`, `src/env.ts` |
| `api/stats.ts` | `src/admin_auth.ts`, `src/db.ts`, `src/env.ts`, `src/group_db.ts`, `src/limits.ts`, `src/neuron.ts`, `src/providers.ts` |
| `src/whatsapp_cloud.ts` | `src/db.ts`, `src/documents.ts`, `src/env.ts`, `src/markers.ts`, `src/media.ts`, `src/memory.ts`, `src/notes.ts`, `src/remind.ts`, ... |
| `src/games/engine.ts` | `src/games/cards.ts` |
| `src/remind.ts` | `src/chat_id.ts`, `src/db.ts`, `src/env.ts`, `src/group_db.ts`, `src/reminder-dedup.ts`, `src/reminder-repeat.ts`, `src/skills.ts`, `src/user-profile.ts`, ... |
| `src/group_mode.ts` | `src/db.ts`, `src/group_db.ts`, `src/timezone.ts` |
| `src/vps_monitor.ts` | `src/db.ts`, `src/env.ts` |
| `src/timezone.ts` | `src/chat_id.ts` |
| `api/dataset.ts` | `src/admin_auth.ts`, `src/chat_id.ts`, `src/db.ts`, `src/env.ts`, `src/group_db.ts` |
| `src/memory.ts` | `src/chat_id.ts`, `src/db.ts`, `src/group_db.ts`, `src/providers.ts` |
| `src/bot_memory.ts` | `src/db.ts`, `src/knowledge.ts` |
| `src/vps_keepalive.ts` | `src/db.ts`, `src/env.ts` |
| `src/wa_monitor.ts` | `src/cooldown.ts`, `src/db.ts`, `src/env.ts` |
| `api/laporan.ts` | `src/db.ts`, `src/env.ts` |
| `src/stickers.ts` | `src/sticker-manifest.ts` |

## API HTTP

| Route | File | Baris |
| --- | --- | --- |
| `/api/admin-otp` | `api/admin-otp.ts` | 362 |
| `/api/baileys-backup` | `api/baileys-backup.ts` | 227 |
| `/api/arsip` | `api/cron/arsip.ts` | 67 |
| `/api/backup` | `api/cron/backup.ts` | 103 |
| `/api/reminders` | `api/cron/reminders.ts` | 161 |
| `/api/dataset` | `api/dataset.ts` | 582 |
| `/api/health` | `api/health.ts` | 116 |
| `/api/laporan` | `api/laporan.ts` | 408 |
| `/api/stats` | `api/stats.ts` | 1295 |
| `/api/webhook` | `api/webhook.ts` | 72 |
| `/api/whatsapp` | `api/whatsapp.ts` | 103 |

## Skema database (sql/)

| File | Objek |
| --- | --- |
| `sql/migrate_v08.sql` | summaries, corrections, corrections_chat_idx |
| `sql/migrate_v09_hardened.sql` | reminders, reminders_due_idx, messages, messages_chat_idx, summaries, corrections, corrections_chat_idx, provider_quota |
| `sql/migrate_v10_whatsapp_sessions.sql` | whatsapp_sessions |
| `sql/migrate_v12_admin_auth.sql` | public.admin_auth_config, public.rpc_admin_verify_pin, public.rpc_admin_save_otp, public.rpc_admin_verify_otp_and_reset_pin, public.rpc_admin_change_pin |
| `sql/migrate_v13_performance_indexes.sql` | idx_messages_created_at_desc, idx_messages_role_created_at, idx_messages_platform_created_at, idx_provider_quota_day_desc |
| `sql/migrate_v14_web_knowledge.sql` | web_knowledge, idx_web_knowledge_lookup |
| `sql/migrate_v15_message_tokens.sql` | idx_messages_tokens_created |
| `sql/migrate_v16_security_hardening_and_rpc.sql` | public.increment_knowledge_hit, public.atomic_increment_provider_quota, idx_reminders_status_due_platform, idx_reminders_lease_until, idx_web_knowledge_entity_key_trgm |
| `sql/migrate_v17_ops.sql` | public.schema_migrations, idx_messages_created_at, public.rpc_purge_user_data, public.rpc_purge_expired_web_knowledge |
| `sql/migrate_v18_daily_token_tracking.sql` | public.atomic_increment_provider_tokens, public.atomic_increment_provider_quota |
| `sql/migrate_v19_audit_fixes.sql` | idx_web_knowledge_expires_at, idx_reminders_chat_id |
| `sql/migrate_v20_audit_fixes_batch2.sql` | public.rpc_admin_change_pin, public.rpc_admin_verify_otp_and_reset_pin, public.schema_migrations |
| `sql/migrate_v21_riddle_memory.sql` | riddle_memory, idx_riddle_memory_pick, increment_riddle_use |
| `sql/migrate_v22_personal_notes.sql` | public.notes, idx_notes_chat_created, idx_notes_tags, public.todos, idx_todos_chat_status, idx_todos_due, public.expenses, idx_expenses_chat_occurred, ... |
| `sql/migrate_v23_pending_confirmations.sql` | public.pending_confirmations, idx_pending_conf_expires, public.set_pending_confirmation, public.take_pending_confirmation, public.clear_pending_confirmation |
| `sql/migrate_v24_game_engine.sql` | public.game_sessions, idx_game_kind, public.set_game_state, public.get_game_state, public.end_game |
| `sql/migrate_v25_user_profiles.sql` | public.user_profiles, idx_user_profiles_tz, public.set_user_timezone, public.get_user_timezone |
| `sql/migrate_v26_provider_cooldown.sql` | public.provider_cooldown, idx_cooldown_until, idx_cooldown_kind, public.set_provider_cooldown, public.get_provider_cooldowns, public.bersihkan_cooldown_kadaluarsa |
| `sql/migrate_v27_reminder_recurring.sql` | idx_reminders_repeat |
| `sql/migrate_v28_message_archive.sql` | public.messages_archive, idx_archive_chat, idx_archive_created, public.arsipkan_pesan_lama |
| `sql/migrate_v29_cleanup.sql` | - |
| `sql/migrate_v30_rls_hardening.sql` | - |
| `sql/migrate_v31_laporan.sql` | public.laporan, idx_laporan_created, idx_laporan_status |
| `sql/migrate_v32_documents.sql` | public.documents, idx_documents_chat |
| `sql/migrate_v33_security_hardening_audit.sql` | public.increment_knowledge_hit, public.increment_riddle_use, public.arsipkan_pesan_lama, public.rpc_purge_user_data |
| `sql/migrate_v34_integritas_data.sql` | idx_expenses_chat_kind_amount_created, idx_messages_archive_created_at, idx_messages_dedup_hotpath, public.rpc_catat_gagal_pin, public.rpc_reset_gagal_pin |
| `sql/migrate_v35_group_database.sql` | IF, public.group_messages, idx_group_messages_chat_created, idx_group_messages_tokens_created, public.group_reminders, idx_group_reminders_status_due_platform, idx_group_reminders_lease_until, idx_group_reminders_chat_id, ... |
| `sql/schema.sql` | messages, messages_chat_idx, reminders, idx_reminders_status_due_platform, idx_reminders_lease_until, provider_quota |

## Tes (tests/)

Semua tes offline: `npm test`, atau satu berkas `node --import tsx --test tests/<nama>.test.mjs`.

| Berkas tes | Kasus utama |
| --- | --- |
| `tests/adaptasi-universal.test.mjs` | universal: TANGGAL berbagai gaya (bukan hanya contoh user) / universal: JADWAL kegiatan apa pun tersimpan (bukan hanya badminton) / universa |
| `tests/angka-bukan-tugas.test.mjs` | angka: guard "bukan tentang tugas" ada / angka: "udah" tidak lagi langsung diikuti angka / angka: pola "tandai N selesai" ditambahkan |
| `tests/anti-echo-pesan-user.test.mjs` | echo: balasan PERSIS sama dengan pesan user terdeteksi / echo: balasan sangat mirip (kata berbeda) terdeteksi / echo: sapaan pendek TIDAK di |
| `tests/anti-factchecker.test.mjs` | fact-checker: teks hardcoded dihapus dari KODE / fact-checker: guard konteksPersonal ada / fact-checker: return kosong untuk regenerasi (buk |
| `tests/anti-konfabulasi.test.mjs` | konfabulasi: pesan pendek + topik baru -> DIBUANG / bocor instruksi: balasan soal gaya sendiri -> DIBUANG / salah info: bot mengaku tidak bi |
| `tests/anti-kontaminasi.test.mjs` | kontaminasi: balasan konfirmasi LAMA dibuang dari riwayat / kontaminasi: "Belum ada jadwal rutin" dibuang dari riwayat / kontaminasi: gaya n |
| `tests/audit-07okt-2.test.mjs` | fakta: pertanyaan "suka buah apa" TIDAK jadi fakta / fakta: kesukaan SUNGGUHAN tetap tersimpan / fakta: "Nama kamu X" dikenali |
| `tests/audit-08okt-2.test.mjs` | auto-reply DISIMPAN ke riwayat di 3 platform (AI tahu) / dedup: berbasis KONTEN (bukan hanya msg_id) / pertanyaan keuangan: ter-trigger untu |
| `tests/audit-08okt.test.mjs` | Rp1: jumlah barang TIDAK jadi nominal / nominal: ambil angka TERBESAR, bukan tanggal / multi-item: pesan campuran -> pemasukan & pengeluaran |
| `tests/audit-final-fixes.test.mjs` | audit #2: 401/403 & Cloudflare neuron 400 lanjut ke key berikutnya tanpa model cooldown / audit #3: OpenCode 429 FreeUsageLimitError (fullBo |
| `tests/audit-lengkap-v36.test.mjs` | detectUserCountry mengabaikan grup & ID Telegram namun mengenali nomor WA asli +1 / +62 / ekstrakPesanInti melepas wrapper grup pasif, memba |
| `tests/auto-maintenance-meta.test.mjs` | 1. klasifikasiErrorMeta membedakan blokir akun, gangguan sementara, dan error per-penerima / 2. Blokir silent-HTTP-200 (141006): langsung ak |
| `tests/baileys-backup-web.test.mjs` | 1. Klasifikasi state, pilihan endpoint, fallback /start, & parser error InstaBox / 2. triggerInstaboxResume: sukses 202, fallback /resume -> |
| `tests/baileys-lid-dan-stiker.test.mjs` | extractPnDigits hanya menerima JID nomor telepon dan menolak LID/grup / resolveBaileysSenderNumber meresolusi @lid lewat remoteJidAlt / reso |
| `tests/batas-kemampuan.test.mjs` | batas: prompt punya blok BATAS KEMAMPUAN / batas: melarang mengaku bisa memutar musik / batas: melarang klaim kemampuan lain yang tidak ada |
| `tests/berulang.test.mjs` | deteksiPengulangan: tiap hari / deteksiPengulangan: nama hari / deteksiPengulangan: hari kerja |
| `tests/chat-id-konsisten.test.mjs` | chat_id: WhatsApp SELALU berprefix wa_ / chat_id: Telegram JUGA berprefix wa_ (selaras data produksi) / chat_id: TULIS == BACA untuk SEMUA p |
| `tests/cloudflare-neuron.test.mjs` | cloudflare: ada helper cekKeyBolehDipakai (satuan benar) / cloudflare: token dikonversi ke neuron sebelum dibandingkan / cloudflare: DIPAKAI |
| `tests/dedup-laporan-jujur.test.mjs` | header jenis + daftar -> tercatat / info pendapatan tanpa header -> TIDAK tercatat / tanpa header & tanpa kata kerja -> TIDAK tercatat |
| `tests/dokumen-tersimpan.test.mjs` | dokumen: modul documents.ts punya fungsi yang diperlukan / dokumen: penyimpanan DISAMBUNGKAN ke alur WhatsApp / dokumen: impor pdf-parse lew |
| `tests/empati-sakit.test.mjs` | sakit: keluhan fisik dikenali sebagai suasana rapuh / sakit: "sakit kaki/kepala/perut" dikenali / sakit: prompt melarang menyuruh pergi |
| `tests/evaluasi-07okt.test.mjs` | pengingat: "oh iya ingetin ... setiap hari" TERSIMPAN / pengingat: pesan bersih dari jam kedua & kata sambung / pengingat: pengantar 2 kata  |
| `tests/fakta-personal-bersih.test.mjs` | fakta: PERTANYAAN tidak disimpan sebagai fakta / fakta: keterangan kabur bukan pekerjaan / fakta: kebiasaan kabur tidak disimpan |
| `tests/fakta-personal.test.mjs` | fakta: NAMA ditangkap / fakta: KESUKAAN ditangkap / fakta: PEKERJAAN ditangkap |
| `tests/format-angka.test.mjs` | format: 3.803 TIDAK dibulatkan jadi 4K / format: angka kecil tampil utuh / format: 100.000+ baru disingkat (1 desimal) |
| `tests/format-respon-rapi.test.mjs` | format: reproduksi resep nasgor tergencet -> terurai rapi dengan judul, poin, dan langkah terpisah / format: balasan sudah rapi multi-bagian |
| `tests/game.test.mjs` | semua game bisa dimulai & punya pembuka / dek remi = 52 kartu, semua unik / dek UNO = 108 kartu |
| `tests/gaya-cs.test.mjs` | gaya CS: harapan generik dibuang / gaya CS: tawaran layanan dibuang / gaya CS: basa-basi kosong dibuang |
| `tests/grup-database-terpisah.test.mjs` | sql/migrate_v35_group_database.sql mendeklarasikan 9 tabel grup aman dengan RLS & tanpa DELETE/DROP / isTableMissingError dan resolveTableNa |
| `tests/grup-mode.test.mjs` | default mode grup adalah mention / deteksiPanggilanNatural menangkap kata panggil natural tanpa salah tangkap robot/botol / deteksiPerintahM |
| `tests/i18n-kunci-lengkap.test.mjs` | i18n: kamus EN tidak kosong / i18n: SETIAP kunci yang dipakai ADA di kamus EN / i18n: kunci dinamis dash.* & dyn.* tersedia |
| `tests/i18n-lengkap.test.mjs` | i18n.js: sintaks valid (koma lengkap) / i18n.js: dashboard.js juga sintaks valid / landing: SEMUA data-i18n ada di kamus EN |
| `tests/integrasi.test.mjs` | integrasi: alur pencatatan & klasifikasi / integrasi: pengingat berulang tersimpan dengan kolom benar / integrasi: zona waktu per-user tersi |
| `tests/interjeksi-halah.test.mjs` | halah: ada di daftar interjeksi / halah: ada set INTERJEKSI_BERLEBIHAN / halah: ada fungsi cooldown batasiInterjeksiBerlebihan |
| `tests/isolasi-laporan.test.mjs` | ISOLASI: tidak ada kode di src/ yang membaca tabel laporan / ISOLASI: getContext hanya membaca messages, summaries, corrections / ISOLASI: a |
| `tests/jadwal-kegiatan.test.mjs` | waktu: tanggal lengkap diparse BENAR (bukan 1 Jan 2027) / waktu: tahun 4 digit TIDAK dibaca sebagai jeda jam / waktu: rentang tanpa kata "ja |
| `tests/katalog-model-sinkron.test.mjs` | katalog API mencakup semua model runtime tepat sekali per provider / model qualified dan prefiks media cocok tepat satu kartu, tanpa silang  |
| `tests/keamanan.test.mjs` | berkas: .exe ditolak / berkas: .sh/.bat/.ps1/.js ditolak / berkas: .docx/.pdf/.txt DIIZINKAN |
| `tests/kebiasaan-otomatis.test.mjs` | kebiasaan: tersimpan OTOMATIS tanpa perintah / kebiasaan: TIDAK ada perintah /kebiasaan (desain baru) / kebiasaan: TIDAK bentrok dengan fitu |
| `tests/keluar-topik-game.test.mjs` | game: memakai WHITELIST, bukan blacklist / game: "Jadiin stiker" BUKAN langkah game / game: TIDAK menawarkan main lagi saat berhenti |
| `tests/keuangan-masuk.test.mjs` | keuangan: kata pemasukan mencakup gajian/bonus/thr/komisi / keuangan: daftar pemasukan di jalur implisit disamakan / keuangan: klasifikasi i |
| `tests/klasifikasi-presisi.test.mjs` | presisi: CURHAT tidak boleh dicatat sebagai fitur / presisi: PERMINTAAN fitur HARUS terdeteksi / presisi: "aku habis 50rb buat makan" (tanpa |
| `tests/larangan-arahkan-lapor.test.mjs` | bot: ajakan melapor dibuang / bot: balasan normal TIDAK terpengaruh / prompt: ada larangan eksplisit mengarahkan user |
| `tests/lokasi-tertunda.test.mjs` | butuhLokasi: cuaca terdeteksi / butuhLokasi: waktu & pengingat tetap terdeteksi / butuhLokasi: kiblat, matahari, puasa terdeteksi |
| `tests/memori-bot.test.mjs` | memori: riwayat dari DB diperbesar (40 pesan) / memori: fakta/koreksi diperbesar (15) / memori: riwayat di prompt diperbesar (30) |
| `tests/memori-pikun.test.mjs` | pikun: ringkasan AKUMULATIF (gabung lama + baru) / pikun: ringkasan lama dibaca sebelum diperbarui / pikun: counter berbasis DB (bukan hanya |
| `tests/monitoring-valid.test.mjs` | monitoring: ada PROBE AKTIF untuk kunci Cloudflare / monitoring: dashboard MEMBACA provider_cooldown / monitoring: cooldown MEMAKSA status c |
| `tests/neuron.test.mjs` | tarifModel: model dikenal mengembalikan tarif resmi / tarifModel: model tak dikenal pakai tarif konservatif / hitungNeuron: 14.000 token BUK |
| `tests/noise-catatan.test.mjs` | noise: frasa tujuan "ke watchlist movie ku" dibuang / noise: "ke daftar belanja:" dibuang / noise: "ke notes:" dibuang |
| `tests/nominal-bukan-nomor.test.mjs` | parseNominal: nomor HP TIDAK dianggap nominal / parseNominal: nomor rekening TIDAK dianggap nominal / parseNominal: nominal besar yang SAH t |
| `tests/nomor-tugas.test.mjs` | nomor: tugas pertama selalu #1 (walau id global #13) / nomor: urutan 1,2,3 meski id melompat / nomor: stabil setelah tugas selesai (tidak re |
| `tests/obrolan-santai.test.mjs` | lokasi: "gaul dimana" TIDAK memicu tanya lokasi / lokasi: pertanyaan lokasi NYATA tetap memicu / kesal: prompt melarang menyuruh user pergi |
| `tests/opsi-b-tanya-dulu.test.mjs` | Opsi B: jalur "tanya-catat-keuangan" ada / Opsi B: pertanyaan dihasilkan AI, BUKAN template statis / Opsi B: cek perintah eksplisit sebelum  |
| `tests/otak-terpisah-dan-konteks.test.mjs` | kunci chat Baileys vs Cloud: riwayat chat terpisah, data bersama tetap konsisten / systemPrompt: Baileys membuang aturan Cloud-only & tidak  |
| `tests/panduan-hapus.test.mjs` | hapus: /uang tanpa isi menampilkan daftar (agar bisa hapus) / hapus: /hapus-uang <nomor> tersedia / hapus: /hapus memakai nomor urut untuk c |
| `tests/panduan-menu.test.mjs` | panduan: permintaan menu dengan kata kerja DITERIMA / panduan: permintaan fitur/perintah/tutorial DITERIMA / panduan: TUGAS NYATA tidak dian |
| `tests/panduan-vs-tugas.test.mjs` | panduan: permintaan TUGAS nyata TIDAK jadi panduan / panduan: permintaan panduan SUNGGUHAN tetap dikenali / panduan: sinyal tugas nyata (hit |
| `tests/pemasukan-eksplisit.test.mjs` | pemasukan: INFORMASI pendapatan TIDAK dicatat / pemasukan: PERMINTAAN catat HARUS tercatat / pengeluaran: tetap dicatat otomatis |
| `tests/pengingat-bersih.test.mjs` | pengingat: kalimat bersih dari pengantar & frasa gaul / pengingat: menang atas keuangan saat ada kata bayar/beli / keuangan: TIDAK terpengar |
| `tests/pengingat-kanal-baileys.test.mjs` | marker Baileys: idempoten, terdeteksi, dan bisa dibersihkan bersih / dedup: kata pendek bertanda Baileys ("ON") tetap cocok 100% dengan polo |
| `tests/pengingat-kirim.test.mjs` | kirim WA: mengembalikan status (bukan void) / kirim WA: gagal HTTP/network menandai gagal / cron: callback mengembalikan status kirim |
| `tests/pengingat-konfirmasi-dobel.test.mjs` | kasus nyata: "jadi pengingat rutin ... itu WIB ya" terdeteksi konfirmasi / konfirmasi dengan tanda tanya juga terdeteksi / PERINTAH penginga |
| `tests/pengingat-rutin.test.mjs` | hapus: "hapus jadwal rutin" terdeteksi sebagai BATAL / hapus: "hapus tugas" TIDAK dianggap batal pengingat / hapus: pola mencakup jadwal/rut |
| `tests/pengingat.test.mjs` | kemiripanPesan: pengingat SAMA dengan kalimat berbeda -> tinggi / kemiripanPesan: pengingat BERBEDA -> rendah / normalisasiUntukBanding: bua |
| `tests/penomoran-per-user.test.mjs` | penomoran: keenam fungsi nomor-urut ada (catatan/tugas/uang) / penomoran: TIDAK ada yang menampilkan ID global di pesan simpan / penomoran:  |
| `tests/persona-adaptif.test.mjs` | persona: register formal dideteksi / persona: register gaul dideteksi / persona: PRIORITAS menjawab ISI pesan (anti-ngawur) |
| `tests/persona-media-context.test.mjs` | stiker: mood dari caption asli, bukan teks instruksi buatan sistem / gaya: saling ledek tanpa kata tawa tidak otomatis kesal / gaya: keluhan |
| `tests/pesan-sendiri-terbaca.test.mjs` | chat_id: WhatsApp SELALU berprefix wa_ (konsisten dengan messages) / chat_id: normalisasi DIPAKAI saat menyimpan & mengirim pengingat / quot |
| `tests/presisi-waktu.test.mjs` | presisi: "2 menit lagi" pada :57 -> janji == kirim (tidak ngaret) / presisi: berbagai detik permintaan tetap tepat / presisi: melewati tenga |
| `tests/provider-routing.test.mjs` | runtime tier mengikuti kontrak tanpa Dahl/NIM / race memilih hasil pertama dan membatalkan request yang kalah / OpenCode menjaga input multi |
| `tests/quoted-ke-ai.test.mjs` | whatsapp-cloud: teks ke AI MEMUAT penanda [Membalas ...] / whatsapp-cloud: autoReply TIDAK lagi pakai teks mentah / whatsapp-cloud: penanda  |
| `tests/quoted-message.test.mjs` | whatsapp-cloud: membaca m.context (quoted message) / whatsapp-cloud: deteksi pesan yang dibalas milik BOT / telegram: membaca reply_to_messa |
| `tests/rate-limit.test.mjs` | rate limit: mengizinkan sampai batas, lalu menolak / rate limit: jendela berbeda tidak saling ganggu |
| `tests/redaksi-log.test.mjs` | redactUrl: key di query string dibuang / redactUrl: berbagai nama parameter kredensial / redactUrl: Authorization Bearer dibuang |
| `tests/reminder-multihari.test.mjs` | multi-hari: "3, 2, 1 hari sebelum" dideteksi / multi-hari: notasi H-N didukung / multi-hari: "seminggu sebelum" = H-7 |
| `tests/reply-quote.test.mjs` | whatsapp-cloud: kirim pesan dukung quote (context.message_id) / whatsapp-cloud: quote hanya chunk pertama / telegram: kirim pesan dukung rep |
| `tests/selesai-nama.test.mjs` | selesai: "tugas upload jurnal selesai" cocok tugas "upload jurnal" / selesai: "upload jurnal selesai" cocok tugas "upload jurnal" / selesai: |
| `tests/sesi-upgrade.test.mjs` | sesi: token dengan hash LAMA tetap valid setelah PIN di-upgrade / sesi: token dengan hash BARU juga valid / sesi: token dengan hash yang tid |
| `tests/stiker-balas-bukan-reaksi.test.mjs` | adalahReaksiVisualStiker menangkap komentar hewan/tokoh/gesture/ekspresi stiker / adalahReaksiVisualStiker tidak menangkap balasan chat natu |
| `tests/stiker-balas-seimbang.test.mjs` | stiker: stiker normal BOLEH dibalas stiker (tidak diblokir suasana) / stiker: tetap TOLAK mood kesal & sedih (jangan terlalu longgar) / stik |
| `tests/stiker-caption.test.mjs` | media.ts: processIncomingSticker menerima parameter caption / media.ts: caption pengirim dipakai, bukan hanya emoji / telegram.ts: caption s |
| `tests/stiker-klasifikasi.test.mjs` | stiker: teks EJEKAN tidak boleh bermood lucu / stiker: mood cocok dengan teks (audit 221 stiker) / stiker: user sedih tidak dapat stiker luc |
| `tests/stiker-nyambung.test.mjs` | stiker: WebP transparan DIKONVERSI ke PNG putih sebelum vision / stiker: paksaStiker diteruskan (PNG hasil konversi tetap dianggap stiker) / |
| `tests/stiker-obrolan.test.mjs` | obrolan: "Lu harus paksa gue..." TIDAK jadi tugas / obrolan: tugas SUNGGUHAN tetap terdeteksi / stiker: ada penegak anti-"mengaku tak bisa b |
| `tests/stiker-teks-konsep.test.mjs` | manifest: STICKER_INFO tersedia dengan teks + konsep / manifest: setiap emoji STICKER_INFO ada file-nya / prompt: aturan stiker didorong (bu |
| `tests/tag-reply-nyambung.test.mjs` | bocor: balasan soal "pesan sistem"/riwayat/amnesia DIBUANG / bocor: prompt punya larangan bahas proses internal / tag-reply: prompt instruks |
| `tests/tanpa-konfirmasi.test.mjs` | konfirmasi keuangan: hanya untuk KEUANGAN tanpa perintah (Opsi B) / konfirmasi: pemanggilan simpanKonfirmasi HANYA di jalur keuangan / konfi |
| `tests/telegram-grup-panggil.test.mjs` | panggil /namabot di AKHIR pesan — pertanyaan dibersihkan / panggil /namabot di AWAL pesan — pertanyaan dibersihkan / panggil /namabot di TEN |
| `tests/telegram-menu-perintah.test.mjs` | semua perintah sah menurut aturan Telegram (a-z, 0-9, garis bawah) / deskripsi memenuhi batas Telegram (3-256 karakter) / tidak lebih dari 1 |
| `tests/usage-groq.test.mjs` | usage: format standar OpenAI terbaca / usage: format KHUSUS Groq (x_groq.usage) terbaca / usage: format Groq LENGKAP (keduanya ada) -> pakai |
| `tests/vision-stiker-akurat.test.mjs` | stiker: balasan ROBOTIK dibuang / stiker: enforcer tak-bisa-baca WAJIB context-aware (jangan buang balasan sah) / stiker: bocoran prefix "Ja |
| `tests/vps-keepalive.test.mjs` | 1. normalizeKeepaliveState mengisi default & membersihkan error / 2. renewVpsActivityLease memanggil endpoint lease yang benar + parse expir |
| `tests/vps-monitor.test.mjs` | 1. parseInstaboxMachine mendukung flat camelCase, wrapper { machine }, snake_case, dan menolak invalid / 2. evaluasiStatusVps TIDAK mengirim |
| `tests/waktu.test.mjs` | parseNominal: digit & satuan / parseNominal: ANGKA KATA (penting untuk Voice Note) / parseNominal: tidak salah baca |
| `tests/web-search.test.mjs` | search: pertanyaan faktual & terkini memicu penelusuran / search: "apa itu X" & "cara X" memicu penelusuran / search: obrolan biasa TIDAK me |
| `tests/web-sync-and-perf.test.mjs` | api/stats.ts: allTimeAssistantMsgs mengambil created_at & inisialisasi dreamprompting / api/dataset.ts & dashboard.js: mendukung prefix wa_b |
| `tests/whatsapp-maintenance.test.mjs` | 1. WHATSAPP_MAINTENANCE_MODE: terdokumentasi & default NONAKTIF / 2. Hasil kirim pemberitahuan pemeliharaan DIPERIKSA (tidak diabaikan) / 3. |
| `tests/whatsapp-session-sync.test.mjs` | sendWhatsAppMessageSafe meneruskan quoted sebagai argumen ke-3 (options), bukan di dalam payload konten / restoreSessionFromSupabase menjaga |
| `tests/zona-parse.test.mjs` | zona: "jam 6 pagi" -> 06:00 WIB (bukan 13:00) / zona: "buatkan jadwal rutin tiap jam 6 pagi" -> 06:00 WIB / zona: "besok jam 9" -> 09:00 WIB |

## Berkas besar (baca bertahap: grep, lalu read offset/limit)

| File | Baris |
| --- | --- |
| `src/skills.ts` | 5880 |
| `src/notes.ts` | 4393 |
| `public/css/console.css` | 3650 |
| `public/js/dashboard.js` | 2524 |
| `src/whatsapp_baileys.ts` | 2273 |
| `src/web.ts` | 2220 |
| `src/providers.ts` | 2046 |
| `src/baileys_backup_web.ts` | 1655 |
| `src/media.ts` | 1446 |
| `src/telegram.ts` | 1389 |
| `src/admin_auth.ts` | 1334 |
| `api/stats.ts` | 1295 |

## Berkas yang tidak boleh diubah tanpa alasan kuat

- `src/env.ts` — kontrak env dan daftar model.
- `src/providers.ts` — urutan tier, race, propagasi abort.
- `src/quota.ts`, `src/limits.ts`, `src/neuron.ts` — pencatatan kuota; kesalahan di sini merusak metrik.
- `api/stats.ts` + `public/js/dashboard.js` — kontrak berpasangan, ubah bersamaan.
- `.env`, `.env.local` — rahasia; jangan pernah dicetak.
