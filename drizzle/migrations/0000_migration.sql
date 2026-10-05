CREATE TABLE public.articles (
  id text PRIMARY KEY,
  source text NOT NULL,
  category text NOT NULL,
  url text NOT NULL,
  image text,
  original_title text NOT NULL,
  titulo_inedito text NOT NULL,
  relevance bigint NOT NULL DEFAULT 0,
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.articles TO anon, authenticated;
GRANT ALL ON public.articles TO service_role;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Notícias públicas" ON public.articles FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX articles_published_idx ON public.articles (published_at DESC);
CREATE INDEX articles_relevance_idx ON public.articles (relevance DESC);

CREATE TABLE public.ingest_state (
  id int PRIMARY KEY DEFAULT 1,
  locked_until timestamptz,
  paused_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ingest_state TO service_role;
ALTER TABLE public.ingest_state ENABLE ROW LEVEL SECURITY;
INSERT INTO public.ingest_state (id) VALUES (1);