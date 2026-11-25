-- 05 · Defensa en profundidad sobre permisos (ya aplicada en producción el 25-11-2026).
-- RLS ya impedía que un anónimo borrara o escribiera en products/store_settings, pero el rol anon
-- seguía teniendo el GRANT de escritura. Se quita para que el bloqueo no dependa solo de las políticas.
revoke insert, update, delete, truncate, references, trigger on public.products from anon;
revoke insert, update, delete, truncate, references, trigger on public.store_settings from anon;
revoke all on public.admins from anon;
-- TRUNCATE ignora RLS: ningún rol del API debe tenerlo.
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;
-- Tablas nuevas: sin escritura para anon por defecto.
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;
