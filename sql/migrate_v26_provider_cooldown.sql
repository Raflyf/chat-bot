-- ============================================================================
-- MIGRASI V26: COOLDOWN PROVIDER PERSISTEN
--
-- MASALAH (audit 05 Okt 2026):
-- Cooldown key provider disimpan di MEMORI (`keyCooldownMap` di src/providers.ts).
-- Pada Vercel serverless, memori hilang setiap cold start / instance baru,
-- sehingga provider yang sudah kena rate-limit bisa dicoba lagi -> boros kuota
-- dan memperlambat respons (menunggu timeout).
--
-- SOLUSI: simpan cooldown di tabel agar bertahan lintas instance. Kolom baru di
-- tabel `provider_keys` (dibuat di sini) menyimpan sampai kapan sebuah key
-- di-cooling dan alasannya.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.provider_cooldown (
    id          bigserial PRIMARY KEY,
    -- Jenis provider (groq, cloudflare, openrouter, ...) — samakan dengan ProviderKind
    kind        text        NOT NULL,
    -- Hash 12 karakter dari API key (JANGAN simpan key mentah!)
    key_hash    text        NOT NULL,
    -- Model (opsional) bila cooldown hanya untuk model tertentu
    model       text        NOT NULL DEFAULT '',
    -- Sampai kapan di-cooling (timestamp absolut)
    until_at    timestamptz NOT NULL,
    -- Alasan singkat untuk diagnosa: 'tpm' | 'rpd' | 'neuron' | 'quota' | 'error'
    alasan      text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kind, key_hash, model)
);

CREATE INDEX IF NOT EXISTS idx_cooldown_until ON public.provider_cooldown (until_at);
CREATE INDEX IF NOT EXISTS idx_cooldown_kind  ON public.provider_cooldown (kind);

-- RLS: hanya service role (backend) yang boleh mengakses.
ALTER TABLE public.provider_cooldown ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_cooldown FROM anon, authenticated;

-- ============================================================================
-- RPC: set cooldown (upsert)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_provider_cooldown(
    p_kind     text,
    p_key_hash text,
    p_model    text,
    p_until    timestamptz,
    p_alasan   text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.provider_cooldown (kind, key_hash, model, until_at, alasan)
    VALUES (p_kind, p_key_hash, p_model, p_until, p_alasan)
    ON CONFLICT (kind, key_hash, model)
    DO UPDATE SET until_at = EXCLUDED.until_at,
                  alasan   = EXCLUDED.alasan;
END;
$$;

-- ============================================================================
-- RPC: ambil semua cooldown aktif
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_provider_cooldowns()
RETURNS TABLE (kind text, key_hash text, model text, until_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT c.kind, c.key_hash, c.model, c.until_at
    FROM public.provider_cooldown c
    WHERE c.until_at > now();
$$;

-- ============================================================================
-- RPC: bersihkan cooldown kadaluarsa
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bersihkan_cooldown_kadaluarsa()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n integer;
BEGIN
    DELETE FROM public.provider_cooldown WHERE until_at <= now();
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;
