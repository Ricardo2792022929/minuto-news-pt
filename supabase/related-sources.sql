-- Fontes extra da mesma notícia. Corre isto uma vez no SQL Editor.
alter table public.articles add column if not exists related jsonb not null default '[]'::jsonb;
