-- Hash (SHA-256, hex) do token do agendador. O token fica só no secret REFRESH_TOKEN do GitHub.
ALTER TABLE public.ingest_state ADD COLUMN IF NOT EXISTS refresh_token_hash text;
