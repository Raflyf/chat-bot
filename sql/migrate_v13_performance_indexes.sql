-- Migration v13: Performance Optimization & Query Accelerators
-- Menambahkan indeks B-tree komposit pada tabel messages dan provider_quota
-- untuk mempercepat filter rentang waktu (today, 7d, 14d, 30d, all) dari hitungan detik menjadi sub-detik.

-- 1. Indeks filter waktu tunggal
CREATE INDEX IF NOT EXISTS idx_messages_created_at_desc ON messages (created_at DESC);

-- 2. Indeks komposit role + created_at (mempercepat query hitung model assistant dan media user)
CREATE INDEX IF NOT EXISTS idx_messages_role_created_at ON messages (role, created_at DESC);

-- 3. Indeks komposit platform + created_at (mempercepat filter platform WhatsApp dan Telegram)
CREATE INDEX IF NOT EXISTS idx_messages_platform_created_at ON messages (platform, created_at DESC);

-- 4. Indeks tanggal pada kuota provider (mempercepat agregasi riwayat konsumsi API)
CREATE INDEX IF NOT EXISTS idx_provider_quota_day_desc ON provider_quota (day DESC);
