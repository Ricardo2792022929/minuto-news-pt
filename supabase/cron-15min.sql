-- Relógio de 15 minutos, no lugar do Lovable Cloud.
-- Corre isto uma vez no SQL Editor do Supabase.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  existing bigint;
begin
  select jobid into existing from cron.job where jobname = 'flash-noticias-15min';
  if existing is not null then
    perform cron.unschedule(existing);
  end if;
end $$;

select cron.schedule(
  'flash-noticias-15min',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://minuto-news-pt.lovable.app/api/public/hooks/refresh',
    timeout_milliseconds := 10000
  );
  $$
);
