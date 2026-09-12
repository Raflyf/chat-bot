-- Migration v15: Explicit Token Columns for Messages Table
-- Menyediakan kolom terpisah untuk pencatatan token asli upstream

ALTER TABLE messages ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS completion_tokens integer;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS total_tokens integer;

-- Indeks untuk agregasi performa kuota dan pemantauan dataset
CREATE INDEX IF NOT EXISTS idx_messages_tokens_created ON messages (created_at DESC, total_tokens);
