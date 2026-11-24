-- FamilyQuest · 0004 — расписание (pg_cron)
-- Supabase free tier: pg_cron есть в списке расширений, включается этим файлом.
-- Время в UTC. Москва = UTC+3, поэтому «00:05 по Москве» = 21:05 UTC.

create extension if not exists pg_cron;

do $$
declare
  j bigint;
begin
  -- снимаем прошлые задания, чтобы файл можно было применять повторно
  for j in select jobid from cron.job where jobname like 'fq-%'
  loop
    perform cron.unschedule(j);
  end loop;

  -- создать экземпляры ежедневных/еженедельных задач на новый день
  perform cron.schedule(
    'fq-materialize',
    '5 21 * * *',
    $cron$ select public.materialize_daily(); $cron$
  );

  -- заняться просрочками и напомнить о дедлайнах
  perform cron.schedule(
    'fq-close-overdue',
    '*/5 * * * *',
    $cron$ select public.close_overdue(); $cron$
  );
exception
  when others then
    raise notice 'pg_cron не настроен (%): %', sqlstate, sqlerrm;
end;
$$;

-- Полезное для проверки:
--   select jobid, jobname, schedule, active from cron.job order by jobid;
--   select * from cron.job_run_details order by start_time desc limit 20;
