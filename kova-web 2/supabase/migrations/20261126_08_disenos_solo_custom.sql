-- =============================================================================
-- KOVA · Migración 08 — Diseños: solo líneas de KOVA CUSTOM
--
-- Las líneas normales y de preventa guardan order_items.custom como JSON null (no NULL de SQL),
-- así que "custom is not null" las contaba como KOVA CUSTOM y "Tus diseños" salía en pedidos sin
-- personalización. Ahora se exige que custom sea un objeto. No modifica datos.
-- =============================================================================

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
      from public.order_items i where i.order_id = o.id and jsonb_typeof(i.custom) = 'object'));
end; $$;

create or replace function public.request_design_upload(p_token text, p_line integer, p_face text, p_ext text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare o public.orders; it public.order_items; v_path text; v_ext text := lower(coalesce(p_ext, ''));
begin
  perform public._rate_check('design', 40, interval '1 hour');
  o := public._order_by_token(p_token);
  if not public._designs_open(o) then
    perform public._fail('Tu pedido ya está en producción o cerrado: escríbenos por WhatsApp si necesitas cambiar el diseño.');
  end if;
  select * into it from public.order_items where order_id = o.id and line_no = p_line and jsonb_typeof(custom) = 'object';
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

revoke all on function public.get_order_designs(text), public.request_design_upload(text, integer, text, text) from public;
grant execute on function public.get_order_designs(text), public.request_design_upload(text, integer, text, text) to anon, authenticated;
