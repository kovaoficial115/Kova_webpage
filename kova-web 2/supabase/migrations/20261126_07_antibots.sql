-- =============================================================================
-- KOVA · Migración 07 — Protección contra bots en los pedidos
--
-- 1. Verificador anti-bots (Cloudflare Turnstile) validado AQUÍ, en el servidor: el navegador manda
--    el token en p.captcha y la base lo confirma con Cloudflare antes de crear el pedido.
--    Mientras no exista el secreto 'turnstile_secret' en kova_private.secrets, la verificación
--    queda apagada (así se puede desplegar la web primero y activar después sin cortar ventas).
--    Si Cloudflare no responde, el pedido sigue (se registra en audit_logs) y lo frenan los límites.
-- 2. Límite de pedidos por persona: misma conexión (IP con sal), mismo correo o mismo WhatsApp.
--    Por defecto 3 por hora y 10 por día; se cambian en admin_settings.general
--    (max_orders_per_hour_per_person, max_orders_per_day_per_person).
--    Un reintento del mismo pedido (misma clave de idempotencia) no cuenta ni se vuelve a verificar.
--
-- Activar Turnstile (una vez, en el SQL Editor de Supabase, con la clave SECRETA del widget):
--   insert into kova_private.secrets (name, value) values ('turnstile_secret', convert_to('0x…', 'UTF8'))
--   on conflict (name) do update set value = excluded.value;
-- Apagarlo:  delete from kova_private.secrets where name = 'turnstile_secret';
-- =============================================================================

-- En Supabase la extensión existe; en el Postgres local de pruebas la simula tests/db/00_supabase_stub.sql.
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'http') then
    create extension if not exists http with schema extensions;
  end if;
end $$;

-- Las funciones de red de la extensión no deben quedar al alcance de la clave pública.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'extensions' and (p.proname like 'http%' or p.proname = 'urlencode') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- Valores por defecto de los límites (editables después sin tocar código).
update public.admin_settings
   set value = jsonb_build_object('max_orders_per_hour_per_person', 3, 'max_orders_per_day_per_person', 10) || value
 where key = 'general';

-- ---------- 1. Turnstile ---------------------------------------------------------------
create or replace function public._turnstile_check(p_token text)
returns void language plpgsql volatile security definer set search_path = public, extensions, kova_private as $$
declare
  v_secret text; v_ip text := public._client_ip(); r extensions.http_response; v_ok boolean := false; v_res jsonb;
begin
  select convert_from(value, 'UTF8') into v_secret from kova_private.secrets where name = 'turnstile_secret';
  if coalesce(v_secret, '') = '' then return; end if;   -- aún no activado
  if coalesce(p_token, '') = '' or char_length(p_token) > 2048 then
    perform public._fail('No pudimos confirmar que eres una persona. Recarga la página e inténtalo de nuevo.');
  end if;
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '6000');
    r := extensions.http_post('https://challenges.cloudflare.com/turnstile/v0/siteverify',
      'secret=' || extensions.urlencode(v_secret) || '&response=' || extensions.urlencode(p_token)
        || case when v_ip <> 'local' then '&remoteip=' || extensions.urlencode(v_ip) else '' end,
      'application/x-www-form-urlencoded');
    if r.status = 200 then v_res := r.content::jsonb; end if;
  exception when others then
    v_res := null;
  end;
  if v_res is null then
    -- Cloudflare caído o lento: no se frena la venta; quedan los límites por persona.
    perform public._audit('turnstile_unavailable', 'order', '', jsonb_build_object('status', r.status));
    return;
  end if;
  v_ok := coalesce((v_res ->> 'success')::boolean, false);
  if not v_ok then
    perform public._fail('No pudimos confirmar que eres una persona. Recarga la página e inténtalo de nuevo.');
  end if;
end; $$;

-- ---------- 2. Límite por persona ----------------------------------------------------------
create or replace function public._order_person_check(p jsonb)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  b jsonb := coalesce(p -> 'buyer', '{}'::jsonb);
  v_email text := public._norm_email(b ->> 'email');
  v_phone text := public._norm_phone(b ->> 'whatsapp');
  v_fp text := case when public._client_ip() <> 'local' then public._client_hash() end;
  g jsonb := public._setting('general');
  v_max_h integer := coalesce((g ->> 'max_orders_per_hour_per_person')::int, 3);
  v_max_d integer := coalesce((g ->> 'max_orders_per_day_per_person')::int, 10);
  n_h integer; n_d integer;
begin
  select count(*) filter (where o.created_at > now() - interval '1 hour'), count(*)
    into n_h, n_d
    from public.orders o
   where o.created_at > now() - interval '24 hours'
     and ((v_fp is not null and o.client_fingerprint = v_fp)
       or (v_email <> '' and o.email = v_email)
       or (v_phone <> '' and o.whatsapp = v_phone));
  if n_h >= v_max_h or n_d >= v_max_d then
    perform public._fail('Ya registraste varios pedidos en poco tiempo. Si necesitas hacer otro, escríbenos por WhatsApp y te ayudamos.');
  end if;
end; $$;

-- ---------- 3. create_order pasa primero por los dos controles ------------------------------
-- La función original queda como _create_order_core (sin acceso público). Si la migración 02 se
-- vuelve a ejecutar, basta con correr esta otra vez: detecta la versión nueva y la reemplaza.
do $$
begin
  if position('_create_order_core' in pg_get_functiondef('public.create_order(jsonb)'::regprocedure)) = 0 then
    drop function if exists public._create_order_core(jsonb);
    alter function public.create_order(jsonb) rename to _create_order_core;
  end if;
end $$;
revoke execute on function public._create_order_core(jsonb) from public, anon, authenticated;

create or replace function public.create_order(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  -- Reintento del mismo pedido (se cayó la conexión): no se vuelve a verificar ni cuenta para el límite.
  if not exists (select 1 from public.orders where idempotency_key = public._clean(p ->> 'idempotency_key', 80)) then
    perform public._turnstile_check(p ->> 'captcha');
    perform public._order_person_check(p);
  end if;
  return public._create_order_core(p);
end; $$;

revoke execute on function public._turnstile_check(text), public._order_person_check(jsonb) from public, anon, authenticated;
revoke execute on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to anon, authenticated;

-- Índices para contar rápido los pedidos recientes de una persona.
create index if not exists orders_email_created_idx on public.orders (email, created_at desc);
create index if not exists orders_whatsapp_created_idx on public.orders (whatsapp, created_at desc);
create index if not exists orders_fingerprint_created_idx on public.orders (client_fingerprint, created_at desc);
