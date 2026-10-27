-- Relógio de 15 minutos. Corre isto no SQL Editor do Supabase.
-- A ronda demora cerca de 1 minuto. 10 segundos cancelava o pedido a meio.
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
    url := 'https://flash-news-pt.lovable.app/api/public/hooks/refresh',
    timeout_milliseconds := 120000
  );
  $$
);
