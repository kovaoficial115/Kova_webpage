-- =============================================================================
-- KOVA · Migración 06 — KOVA CUSTOM: el cliente sube sus diseños originales desde la página
--
-- Los archivos quedan guardados con el pedido en un bucket PRIVADO (custom-designs).
--   · Subir: solo con el enlace privado del pedido (token), a una ruta que reserva el servidor,
--     una vez y durante 15 minutos (mismo esquema que los comprobantes de pago).
--   · Tipos: PNG, JPG, WEBP o PDF · máximo 25 MB por archivo (lo exige el propio bucket).
--   · Ver/descargar: solo el personal del panel (owner/admin/producción) con URL firmada temporal.
--   · El público nunca lista ni lee archivos, ni la tabla order_design_files.
-- No modifica ni borra datos existentes.
-- =============================================================================

-- 1. Tablas ---------------------------------------------------------------------------------
create table if not exists public.order_design_files (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  line_no     integer not null,
  face        text not null check (face in ('front', 'back')),
  path        text not null unique,
  file_name   text not null,
  mime        text,
  size_bytes  bigint,
  sha256      text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status      text not null default 'active' check (status in ('active', 'replaced')),
  created_at  timestamptz not null default now()
);
create index if not exists order_design_files_order on public.order_design_files (order_id, line_no);
-- Un solo diseño vigente por línea y cara; los anteriores quedan como "replaced".
create unique index if not exists order_design_files_active on public.order_design_files (order_id, line_no, face)
  where status = 'active';

create table if not exists public.design_upload_slots (
  path       text primary key,
  order_id   uuid not null references public.orders (id) on delete cascade,
  line_no    integer not null,
  face       text not null,
  expires_at timestamptz not null,
  used       boolean not null default false
);

alter table public.order_design_files enable row level security;
alter table public.design_upload_slots enable row level security;
revoke all on public.order_design_files from anon, authenticated;
revoke all on public.design_upload_slots from anon, authenticated;
-- Lectura: personal del panel (producción incluida: no hay datos personales en esta tabla).
drop policy if exists "staff lee" on public.order_design_files;
create policy "staff lee" on public.order_design_files for select to authenticated using (public.is_staff());
grant select on public.order_design_files to authenticated;

-- 2. Bucket PRIVADO ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custom-designs', 'custom-designs', false, 26214400,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.design_slot_open(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.design_upload_slots s where s.path = p_path and not s.used and s.expires_at > now());
$$;
revoke all on function public.design_slot_open(text) from public;
grant execute on function public.design_slot_open(text) to anon, authenticated;

drop policy if exists "custom-designs: subida con cupo" on storage.objects;
create policy "custom-designs: subida con cupo" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'custom-designs' and public.design_slot_open(name));
drop policy if exists "custom-designs: personal lee" on storage.objects;
create policy "custom-designs: personal lee" on storage.objects
  for select to authenticated using (bucket_id = 'custom-designs' and public.is_staff());

-- 3. Auxiliares -------------------------------------------------------------------------------
-- Caras que lleva una personalización (según las zonas de su modalidad).
create or replace function public._custom_faces(p_mode text)
returns text[] language sql stable security definer set search_path = public as $$
  with cfg as (select public._custom_config() c),
  m as (select x from cfg, jsonb_array_elements(cfg.c -> 'modes') x where x ->> 'id' = p_mode limit 1),
  f as (select distinct z ->> 'face' face from cfg, m, jsonb_array_elements(cfg.c -> 'zones') z
         where jsonb_typeof(m.x -> 'zones') = 'array' and (m.x -> 'zones') ? (z ->> 'id') and z ->> 'face' in ('front', 'back'))
  select coalesce(
    (select array_agg(face order by face desc) from f),
    case p_mode when 'mini' then array['front'] when 'front' then array['front'] when 'back' then array['back']
                else array['front', 'back'] end);
$$;

-- ¿Se pueden cambiar los diseños? Hasta que empiece la producción.
create or replace function public._designs_open(o public.orders) returns boolean language sql stable set search_path = public as $$
  select o.fulfillment_status in ('pending_confirmation', 'confirmed');
$$;

-- 4. Funciones públicas (con el token privado del pedido) -------------------------------------
-- Líneas de KOVA CUSTOM del pedido, caras a estampar y diseños recibidos.
create or replace function public.get_order_designs(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare o public.orders;
begin
  o := public._order_by_token(p_token);
  return jsonb_build_object(
    'can_upload', public._designs_open(o),
    'max_bytes', 26214400,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'line_no', i.line_no, 'name', i.name, 'ref', i.custom ->> 'ref', 'mode_label', i.custom ->> 'mode_label',
        'faces', to_jsonb(public._custom_faces(i.custom ->> 'mode')),
        'designs', (select coalesce(jsonb_agg(jsonb_build_object('face', d.face, 'file_name', d.file_name, 'size_bytes', d.size_bytes,
            'created_at', d.created_at) order by d.face desc), '[]'::jsonb)
          from public.order_design_files d where d.order_id = o.id and d.line_no = i.line_no and d.status = 'active')
      ) order by i.line_no), '[]'::jsonb)
      from public.order_items i where i.order_id = o.id and i.custom is not null));
end; $$;

-- Reserva una ruta privada para subir el diseño de una línea y una cara.
create or replace function public.request_design_upload(p_token text, p_line integer, p_face text, p_ext text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare o public.orders; it public.order_items; v_path text; v_ext text := lower(coalesce(p_ext, ''));
begin
  perform public._rate_check('design', 40, interval '1 hour');
  o := public._order_by_token(p_token);
  if not public._designs_open(o) then
    perform public._fail('Tu pedido ya está en producción o cerrado: escríbenos por WhatsApp si necesitas cambiar el diseño.');
  end if;
  select * into it from public.order_items where order_id = o.id and line_no = p_line and custom is not null;
  if it.order_id is null then perform public._fail('Esa línea del pedido no es de KOVA CUSTOM.'); end if;
  if coalesce(p_face, '') <> all (public._custom_faces(it.custom ->> 'mode')) then
    perform public._fail('Esa cara de la camiseta no lleva estampado en esta modalidad.');
  end if;
  if v_ext = 'jpeg' then v_ext := 'jpg'; end if;
  if v_ext not in ('png', 'jpg', 'webp', 'pdf') then perform public._fail('Sube tu diseño en PNG, JPG, WEBP o PDF.'); end if;
  if (select count(*) from public.order_design_files where order_id = o.id and line_no = p_line and face = p_face) >= 6 then
    perform public._fail('Ya cambiaste este diseño varias veces. Escríbenos por WhatsApp para enviarlo.');
  end if;
  if (select count(*) from public.design_upload_slots where order_id = o.id and not used and expires_at > now()) >= 10 then
    perform public._fail('Hay demasiadas subidas pendientes. Espera unos minutos e inténtalo de nuevo.');
  end if;
  v_path := format('%s/%s-%s-%s.%s', o.id, p_line, p_face, gen_random_uuid(), v_ext);
  insert into public.design_upload_slots (path, order_id, line_no, face, expires_at)
  values (v_path, o.id, p_line, p_face, now() + interval '15 minutes');
  return jsonb_build_object('bucket', 'custom-designs', 'path', v_path, 'max_bytes', 26214400);
end; $$;

-- Registra el diseño ya subido. Si la cara ya tenía uno, el anterior queda como reemplazado.
create or replace function public.submit_design_file(p_token text, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  o public.orders; s public.design_upload_slots; obj storage.objects;
  v_name text := public._clean(regexp_replace(coalesce(p ->> 'file_name', ''), '[\\/]', '_', 'g'), 120);
  v_sha text := lower(coalesce(p ->> 'sha256', '')); v_size bigint; v_mime text;
begin
  perform public._rate_check('design', 40, interval '1 hour');
  o := public._order_by_token(p_token);
  if not public._designs_open(o) then
    perform public._fail('Tu pedido ya está en producción o cerrado: escríbenos por WhatsApp si necesitas cambiar el diseño.');
  end if;
  select * into s from public.design_upload_slots where path = p ->> 'path' for update;
  if s.path is null or s.order_id <> o.id or s.used then perform public._fail('No encontramos el archivo del diseño. Súbelo de nuevo.'); end if;
  select * into obj from storage.objects where bucket_id = 'custom-designs' and name = s.path;
  if obj.name is null then perform public._fail('El diseño no terminó de subir. Inténtalo de nuevo.'); end if;
  if v_sha !~ '^[0-9a-f]{64}$' then v_sha := null; end if;
  v_size := case when (obj.metadata ->> 'size') ~ '^\d+$' then (obj.metadata ->> 'size')::bigint end;
  v_mime := obj.metadata ->> 'mimetype';
  if v_size = 0 then perform public._fail('El archivo llegó vacío. Súbelo de nuevo.'); end if;
  if v_name = '' then v_name := split_part(s.path, '/', 2); end if;

  update public.order_design_files set status = 'replaced'
   where order_id = o.id and line_no = s.line_no and face = s.face and status = 'active';
  insert into public.order_design_files (order_id, line_no, face, path, file_name, mime, size_bytes, sha256)
  values (o.id, s.line_no, s.face, s.path, v_name, v_mime, v_size, v_sha);
  update public.design_upload_slots set used = true where path = s.path;
  delete from public.design_upload_slots where expires_at < now() - interval '1 day';
  perform public._history(o.id, 'customer', 'Diseño recibido',
    format('KOVA CUSTOM · producto %s · %s: %s', s.line_no, case s.face when 'front' then 'frente' else 'espalda' end, v_name));
  return jsonb_build_object('ok', true);
end; $$;

-- 5. Permisos --------------------------------------------------------------------------------
revoke all on function public._custom_faces(text) from public, anon, authenticated;
revoke all on function public._designs_open(public.orders) from public, anon, authenticated;
revoke all on function public.get_order_designs(text), public.request_design_upload(text, integer, text, text),
  public.submit_design_file(text, jsonb) from public;
grant execute on function public.get_order_designs(text), public.request_design_upload(text, integer, text, text),
  public.submit_design_file(text, jsonb) to anon, authenticated;
