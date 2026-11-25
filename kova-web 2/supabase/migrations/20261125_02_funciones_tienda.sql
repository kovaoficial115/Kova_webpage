-- =============================================================================
-- KOVA · Migración 02 — Funciones del servidor para la tienda
--
-- La tienda (clave pública anon) SOLO puede:
--   get_storefront()            Preventas abiertas, fechas, cupos (si la campaña los muestra), envío y textos legales.
--   validate_promo(...)         Valida un código contra el carrito (no consume usos).
--   create_order(...)           Crea el pedido: precios, descuentos, anticipo y cupos calculados AQUÍ.
--   get_order_public(token)     Seguimiento privado con el token del enlace.
--   request_proof_upload(...)   Reserva una ruta privada para subir el comprobante.
--   submit_payment_proof(...)   Registra el comprobante (queda "Comprobante recibido", nunca aprobado).
--
-- Nunca se confía en precios, porcentajes, descuentos, estados ni permisos enviados por el navegador.
-- Los errores para el cliente llegan como "KOVA:<mensaje>".
-- =============================================================================

-- ---------- Utilidades -------------------------------------------------------------
create or replace function public._fail(msg text) returns void language plpgsql as $$
begin raise exception 'KOVA:%', msg using errcode = 'P0001'; end; $$;

create or replace function public._client_ip() returns text language plpgsql stable as $$
declare h jsonb;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  return coalesce(h ->> 'cf-connecting-ip', split_part(h ->> 'x-forwarded-for', ',', 1), h ->> 'x-real-ip', 'local');
end; $$;

-- Huella del cliente (IP con sal): permite limitar abusos sin guardar la IP en claro.
create or replace function public._client_hash() returns text language sql stable security definer set search_path = public, kova_private as $$
  select encode(extensions.hmac(convert_to(public._client_ip(), 'UTF8'), (select value from kova_private.secrets where name = 'tracking_hmac'), 'sha256'), 'hex');
$$;

-- Límite de solicitudes por ventana. Lanza KOVA:… si se supera.
create or replace function public._rate_check(p_bucket text, p_max integer, p_window interval)
returns void language plpgsql security definer set search_path = public as $$
declare w timestamptz := date_bin(p_window, now(), timestamptz '2000-01-01'); n integer;
begin
  insert into public.rate_limits (bucket, window_start, hits) values (p_bucket || ':' || public._client_hash(), w, 1)
  on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
  returning hits into n;
  if n > p_max then perform public._fail('Demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.'); end if;
  if random() < 0.02 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
end; $$;

create or replace function public._norm_email(e text) returns text language sql immutable as $$
  select lower(btrim(coalesce(e, '')));
$$;
-- Teléfono: solo dígitos; un celular colombiano de 10 dígitos recibe el indicativo 57.
create or replace function public._norm_phone(p text) returns text language sql immutable as $$
  select case when d ~ '^3\d{9}$' then '57' || d else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;
create or replace function public._clean(t text, maxlen integer) returns text language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(t, ''), '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]', '', 'g'), '[ \t]+', ' ', 'g')), maxlen);
$$;

create or replace function public._setting(p_key text) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.admin_settings where key = p_key), '{}'::jsonb);
$$;
create or replace function public._store_setting(p_key text) returns jsonb language sql stable security definer set search_path = public as $$
  select (select value from public.store_settings where key = p_key);
$$;

create or replace function public._audit(p_action text, p_entity text, p_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor_id, action, entity, entity_id, details) values (auth.uid(), p_action, p_entity, p_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public._history(p_order uuid, p_actor text, p_event text, p_note text default '',
  p_from_fin text default null, p_to_fin text default null, p_from_ful text default null, p_to_ful text default null, p_public boolean default true)
returns void language sql security definer set search_path = public as $$
  insert into public.order_history (order_id, actor, actor_id, event, note, from_financial, to_financial, from_fulfillment, to_fulfillment, is_public)
  values (p_order, p_actor, auth.uid(), p_event, coalesce(p_note, ''), p_from_fin, p_to_fin, p_from_ful, p_to_ful, p_public);
$$;

-- Redondeo único de todo el sistema: pesos enteros, mitad hacia arriba.
create or replace function public._pct(amount integer, pct numeric) returns integer language sql immutable as $$
  select round(amount::numeric * pct / 100.0)::integer;
$$;

-- ---------- Preventas: fase vigente y cupos ---------------------------------------------
-- Unidades que ocupan cupo: todo pedido que no esté cancelado ni vencido.
create or replace function public._campaign_used(p_campaign uuid, p_product text default null, p_size text default null, p_color text default null)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(oi.qty), 0)::integer
    from public.order_items oi join public.orders o on o.id = oi.order_id
   where oi.campaign_id = p_campaign and oi.kind = 'preorder'
     and o.fulfillment_status not in ('cancelled', 'expired')
     and (p_product is null or oi.product_id = p_product)
     and (p_size is null or oi.size = p_size)
     and (p_color is null or oi.color = p_color);
$$;

-- draft | scheduled | open | paused | sold_out | closed | archived
create or replace function public.campaign_phase(c public.preorder_campaigns)
returns text language sql stable security definer set search_path = public as $$
  select case
    when c.status = 'archived' then 'archived'
    when c.status = 'draft' then 'draft'
    when c.status = 'closed' then 'closed'
    when c.status = 'paused' then 'paused'
    when c.closes_at is not null and now() >= c.closes_at then 'closed'
    when c.opens_at is not null and now() < c.opens_at then 'scheduled'
    when c.auto_close_on_limit and c.max_units is not null and public._campaign_used(c.id) >= c.max_units then 'sold_out'
    else 'open' end;
$$;

-- Configuración de KOVA CUSTOM: la guardada por el panel o los valores iniciales de js/data/custom.js.
create or replace function public._custom_config() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(public._store_setting('custom'), jsonb_build_object(
    'modes', jsonb_build_array(
      jsonb_build_object('id', 'mini', 'name', 'CUSTOM MINI', 'label', 'Pecho pequeño', 'price', 59000, 'active', true),
      jsonb_build_object('id', 'front', 'name', 'CUSTOM FRONT', 'label', 'Pecho grande', 'price', 65000, 'active', true),
      jsonb_build_object('id', 'back', 'name', 'CUSTOM BACK', 'label', 'Espalda', 'price', 69000, 'active', true),
      jsonb_build_object('id', 'classic', 'name', 'CUSTOM CLASSIC', 'label', 'Pecho pequeño + espalda', 'price', 72000, 'active', true),
      jsonb_build_object('id', 'full', 'name', 'CUSTOM FULL', 'label', 'Pecho grande + espalda', 'price', 79000, 'active', true)),
    'colors', jsonb_build_array(
      jsonb_build_object('id', 'negro', 'name', 'Negro', 'active', true),
      jsonb_build_object('id', 'blanco', 'name', 'Blanco', 'active', true),
      jsonb_build_object('id', 'azul-marino', 'name', 'Azul marino', 'active', false)),
    'sizes', jsonb_build_array(
      jsonb_build_object('id', 'XS', 'active', true), jsonb_build_object('id', 'S', 'active', true),
      jsonb_build_object('id', 'M', 'active', true), jsonb_build_object('id', 'L', 'active', true),
      jsonb_build_object('id', 'XL', 'active', true), jsonb_build_object('id', 'XXL', 'active', true)),
    'inventory', '{}'::jsonb));
$$;

-- Campaña abierta (o no) en la que participa un producto. Un producto solo puede estar en una campaña activa.
create or replace function public._product_campaign(p_product text) returns public.preorder_campaigns
language sql stable security definer set search_path = public as $$
  select c.* from public.preorder_campaigns c join public.preorder_products pp on pp.campaign_id = c.id
   where pp.product_id = p_product and c.status in ('active', 'paused')
   order by c.opens_at nulls last limit 1;
$$;

-- ---------- Precios del carrito (servidor) ---------------------------------------------
-- Entrada: [{product_id,size,color,qty} | {custom:{mode,color,size,files,place,ref}, qty}]
-- Salida: líneas con precio vigente del catálogo. Lanza KOVA:… si algo no se puede comprar.
create or replace function public._price_lines(p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  it jsonb; out jsonb := '[]'::jsonb; n integer := 0;
  p public.products; c public.preorder_campaigns; v public.product_variants; lim public.preorder_variant_limits;
  q integer; sz text; col text; kind text; cost integer; maxq integer := coalesce((public._setting('general') ->> 'max_units_per_line')::int, 10);
  cfg jsonb; m jsonb; cc jsonb; inv integer; phase text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then perform public._fail('Tu carrito está vacío.'); end if;
  if jsonb_array_length(p_items) > 30 then perform public._fail('El pedido tiene demasiadas líneas.'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    q := case when (it ->> 'qty') ~ '^\d{1,3}$' then (it ->> 'qty')::int else 0 end;
    if q < 1 or q > maxq then perform public._fail(format('La cantidad de cada producto debe estar entre 1 y %s.', maxq)); end if;

    if it ? 'custom' then
      cfg := public._custom_config();
      select x into m from jsonb_array_elements(cfg -> 'modes') x
       where x ->> 'id' = it #>> '{custom,mode}' and coalesce((x ->> 'active')::boolean, true);
      select x into cc from jsonb_array_elements(cfg -> 'colors') x
       where x ->> 'id' = it #>> '{custom,color}' and coalesce((x ->> 'active')::boolean, true);
      sz := it #>> '{custom,size}';
      if m is null then perform public._fail('Una modalidad de KOVA CUSTOM ya no está disponible.'); end if;
      if cc is null then perform public._fail('Un color de KOVA CUSTOM ya no está disponible.'); end if;
      if not exists (select 1 from jsonb_array_elements(cfg -> 'sizes') s where s ->> 'id' = sz and coalesce((s ->> 'active')::boolean, true)) then
        perform public._fail('Una talla de KOVA CUSTOM ya no está disponible.');
      end if;
      inv := case when (cfg #>> array['inventory', cc ->> 'id', sz]) ~ '^\d+$' then (cfg #>> array['inventory', cc ->> 'id', sz])::int end;
      if inv is not null and q > inv then
        perform public._fail(format('KOVA CUSTOM %s talla %s: solo quedan %s unidades.', cc ->> 'name', sz, inv));
      end if;
      out := out || jsonb_build_object('line_no', n, 'kind', 'custom', 'product_id', null, 'variant_id', null, 'campaign_id', null,
        'name', 'KOVA CUSTOM — ' || (m ->> 'name'), 'category', 'custom', 'size', sz, 'color', cc ->> 'name', 'qty', q,
        'unit_price', (m ->> 'price')::int, 'line_original', (m ->> 'price')::int * q, 'unit_cost', null,
        'custom', jsonb_build_object('mode', m ->> 'id', 'mode_name', m ->> 'name', 'mode_label', m ->> 'label', 'color_id', cc ->> 'id',
          'files', coalesce(it #> '{custom,files}', '{}'::jsonb), 'ref', left(coalesce(it #>> '{custom,ref}', ''), 40)));
      continue;
    end if;

    select * into p from public.products where id = it ->> 'product_id';
    if p.id is null or not p.published or p.sale_mode = 'hidden' then perform public._fail('Un producto del carrito ya no está disponible.'); end if;
    sz := coalesce(nullif(it ->> 'size', ''), ''); col := coalesce(nullif(it ->> 'color', ''), '');
    if jsonb_array_length(p.sizes) > 0 and not (p.sizes ? sz) then perform public._fail(format('Elige una talla válida para %s.', p.name)); end if;
    if jsonb_array_length(p.sizes) = 0 and sz <> '' then perform public._fail(format('%s no tiene tallas.', p.name)); end if;
    if jsonb_array_length(p.colors) > 0 and not exists (select 1 from jsonb_array_elements(p.colors) x where x ->> 'name' = col) then
      perform public._fail(format('Elige un color válido para %s.', p.name));
    end if;
    if jsonb_array_length(p.colors) = 0 and col <> '' then perform public._fail(format('%s no tiene colores.', p.name)); end if;
    select * into v from public.product_variants where product_id = p.id and size = sz and color = col;

    c := public._product_campaign(p.id);
    if p.sale_mode = 'preorder' then
      if c.id is null then perform public._fail(format('La preventa de %s no está disponible.', p.name)); end if;
      phase := public.campaign_phase(c);
      if phase = 'scheduled' then perform public._fail(format('La preventa de %s todavía no abre.', p.name)); end if;
      if phase = 'sold_out' then perform public._fail(format('La preventa de %s alcanzó su límite de unidades.', p.name)); end if;
      if phase <> 'open' then perform public._fail(format('La preventa de %s está cerrada.', p.name)); end if;
      select * into lim from public.preorder_variant_limits where campaign_id = c.id and product_id = p.id and size = sz and color = col;
      if lim.campaign_id is not null and not lim.enabled then perform public._fail(format('%s %s %s no participa en la preventa.', p.name, sz, col)); end if;
      kind := 'preorder';
    elsif p.sale_mode = 'normal' then
      if not p.available or (p.sold_out_sizes ? sz) then perform public._fail(format('%s %s está agotado.', p.name, sz)); end if;
      if v.id is not null and v.stock_on_hand is not null and v.stock_on_hand - v.stock_reserved < q then
        perform public._fail(format('%s talla %s: solo quedan %s unidades.', p.name, sz, greatest(v.stock_on_hand - v.stock_reserved, 0)));
      end if;
      kind := 'normal'; c := null;
    elsif p.sale_mode = 'coming_soon' then perform public._fail(format('%s estará disponible próximamente.', p.name));
    else perform public._fail(format('%s está agotado.', p.name));
    end if;

    cost := coalesce(v.cost, (select unit_cost from public.product_costs where product_id = p.id));
    out := out || jsonb_build_object('line_no', n, 'kind', kind, 'product_id', p.id, 'variant_id', v.id, 'campaign_id', c.id,
      'name', p.name, 'category', p.category, 'size', sz, 'color', col, 'qty', q, 'unit_price', p.price,
      'line_original', p.price * q, 'unit_cost', cost, 'custom', null);
  end loop;
  if (select count(distinct x ->> 'campaign_id') from jsonb_array_elements(out) x where x ->> 'campaign_id' is not null) > 1 then
    perform public._fail('Un pedido solo puede incluir productos de una misma preventa. Haz un pedido por cada drop.');
  end if;
  return out;
end; $$;

-- ---------- Códigos promocionales: evaluación ------------------------------------------
-- Devuelve {ok, reason, message, discount, eligible_subtotal, alloc:[descuento por línea], requires_email}
create or replace function public._promo_eval(pc public.promo_codes, p_lines jsonb, p_email text, p_phone text, p_exclude_order uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ln jsonb; el boolean; elig integer := 0; subtotal integer := 0; units integer := 0; disc integer;
  alloc integer[] := '{}'; shares numeric[] := '{}'; idx integer := 0; used integer; mine integer;
  rem integer; i integer; camp public.preorder_campaigns; any_preorder_blocked boolean := false;
  e text := public._norm_email(p_email); ph text := public._norm_phone(p_phone);
begin
  if pc.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found', 'message', 'Este código no existe o no es válido.'); end if;
  if pc.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'inactive', 'message', 'Este código no está activo.'); end if;
  if pc.starts_at is not null and now() < pc.starts_at then return jsonb_build_object('ok', false, 'reason', 'not_started', 'message', 'Este código todavía no está vigente.'); end if;
  if pc.ends_at is not null and now() >= pc.ends_at then return jsonb_build_object('ok', false, 'reason', 'expired', 'message', 'Este código ya venció.'); end if;

  select count(*) into used from public.promo_redemptions r
   where r.promo_id = pc.id and r.status in ('pending', 'confirmed', 'void_kept') and r.order_id is distinct from p_exclude_order;
  if pc.max_uses is not null and used >= pc.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'exhausted', 'message', 'Este código ya alcanzó su número máximo de usos.');
  end if;

  if coalesce(array_length(pc.customer_emails, 1), 0) > 0 then
    if e = '' then return jsonb_build_object('ok', false, 'reason', 'needs_email', 'requires_email', true,
      'message', 'Este código es para clientes específicos: escribe tu correo en el formulario para validarlo.'); end if;
    if not (e = any (pc.customer_emails)) then return jsonb_build_object('ok', false, 'reason', 'not_for_customer', 'message', 'Este código no está disponible para tu correo.'); end if;
  end if;

  if pc.max_uses_per_customer is not null and (e <> '' or ph <> '') then
    select count(*) into mine from public.promo_redemptions r join public.customers cu on cu.id = r.customer_id
     where r.promo_id = pc.id and r.status in ('pending', 'confirmed', 'void_kept') and r.order_id is distinct from p_exclude_order
       and ((e <> '' and cu.email_norm = e) or (ph <> '' and cu.phone_norm = ph));
    if mine >= pc.max_uses_per_customer then
      return jsonb_build_object('ok', false, 'reason', 'customer_limit', 'message', 'Ya usaste este código el número máximo de veces permitido.');
    end if;
  end if;

  for ln in select * from jsonb_array_elements(p_lines) loop
    subtotal := subtotal + (ln ->> 'line_original')::int;
    units := units + (ln ->> 'qty')::int;
    el := case ln ->> 'kind' when 'normal' then pc.applies_normal when 'preorder' then pc.applies_preorder when 'custom' then pc.applies_custom else false end;
    if el and ln ->> 'kind' = 'preorder' then
      select * into camp from public.preorder_campaigns where id = (ln ->> 'campaign_id')::uuid;
      if not camp.allow_promo_codes then el := false; any_preorder_blocked := true; end if;
    end if;
    if el and coalesce(array_length(pc.product_ids, 1), 0) > 0 then
      el := coalesce(ln ->> 'product_id', 'kova-custom') = any (pc.product_ids);
    end if;
    if el and coalesce(array_length(pc.categories, 1), 0) > 0 then el := (ln ->> 'category') = any (pc.categories); end if;
    if el and coalesce(array_length(pc.campaign_ids, 1), 0) > 0 then
      el := (ln ->> 'campaign_id') is not null and (ln ->> 'campaign_id')::uuid = any (pc.campaign_ids);
    end if;
    alloc := alloc || 0;
    shares := shares || (case when el then (ln ->> 'line_original')::numeric else 0 end);
    if el then elig := elig + (ln ->> 'line_original')::int; end if;
  end loop;

  if elig = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_applicable', 'message',
      case when any_preorder_blocked then 'Esta preventa no admite códigos promocionales.' else 'Este código no aplica a los productos de tu carrito.' end);
  end if;
  if pc.min_subtotal is not null and subtotal < pc.min_subtotal then
    return jsonb_build_object('ok', false, 'reason', 'min_subtotal', 'message', format('Este código requiere una compra mínima de $%s.', to_char(pc.min_subtotal, 'FM999G999G999')));
  end if;
  if pc.min_items is not null and units < pc.min_items then
    return jsonb_build_object('ok', false, 'reason', 'min_items', 'message', format('Este código requiere mínimo %s productos en el carrito.', pc.min_items));
  end if;

  disc := case when pc.discount_type = 'percent' then public._pct(elig, pc.percent) else least(pc.fixed_amount, elig) end;
  if pc.max_discount is not null then disc := least(disc, pc.max_discount); end if;
  disc := least(disc, elig);

  -- Reparto proporcional entre líneas elegibles (método del mayor residuo): la suma es exacta
  -- y ninguna línea recibe más de un peso extra por redondeo.
  rem := disc;
  for i in 1 .. array_length(shares, 1) loop
    alloc[i] := floor(disc * shares[i] / elig)::int;
    rem := rem - alloc[i];
  end loop;
  for i in (select k from generate_subscripts(shares, 1) k
             where shares[k] > 0
             order by (disc * shares[k] / elig) - floor(disc * shares[k] / elig) desc, k limit rem) loop
    alloc[i] := alloc[i] + 1;
  end loop;

  return jsonb_build_object('ok', true, 'reason', 'ok', 'code', pc.code_norm, 'discount_type', pc.discount_type,
    'percent', pc.percent, 'fixed_amount', pc.fixed_amount, 'discount', disc, 'eligible_subtotal', elig,
    'alloc', to_jsonb(alloc), 'partial', elig < subtotal,
    'message', case when elig < subtotal then 'Código aplicado a los productos participantes.' else 'Código aplicado.' end);
end; $$;

-- ---------- Totales de un carrito (sin guardar nada) ------------------------------------
create or replace function public._quote(p_lines jsonb, p_eval jsonb, p_plan text, p_campaign public.preorder_campaigns, p_shipping jsonb)
returns jsonb language plpgsql stable as $$
declare
  ln jsonb; i integer := 0; d integer; fin integer; due integer; lines jsonb := '[]'::jsonb;
  sub integer := 0; disc integer := 0; due_now integer := 0; ship integer; charge text;
begin
  for ln in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    d := case when coalesce((p_eval ->> 'ok')::boolean, false) then (p_eval -> 'alloc' ->> (i - 1))::int else 0 end;
    fin := (ln ->> 'line_original')::int - d;
    due := case when ln ->> 'kind' = 'preorder' and p_plan = 'deposit' then public._pct(fin, p_campaign.deposit_pct) else fin end;
    lines := lines || (ln || jsonb_build_object('discount', d, 'line_final', fin, 'due_now', due,
      'deposit_pct', case when ln ->> 'kind' = 'preorder' and p_plan = 'deposit' then p_campaign.deposit_pct end));
    sub := sub + (ln ->> 'line_original')::int; disc := disc + d; due_now := due_now + due;
  end loop;
  ship := case when (p_shipping ->> 'cost') ~ '^\d+$' then (p_shipping ->> 'cost')::int end;
  charge := case when p_campaign.id is not null then p_campaign.shipping_charge else 'reservation' end;
  if ship is not null and charge = 'reservation' then due_now := due_now + ship; end if;
  return jsonb_build_object('lines', lines, 'subtotal_original', sub, 'discount_total', disc, 'subtotal_after', sub - disc,
    'shipping_amount', ship, 'shipping_charge_at', charge, 'total', sub - disc + coalesce(ship, 0),
    'amount_due_now', due_now, 'balance_after_now', sub - disc + coalesce(ship, 0) - due_now);
end; $$;

create or replace function public._shipping_option(p_id text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare opts jsonb := coalesce(public._store_setting('shipping') -> 'options', '[]'::jsonb); o jsonb;
begin
  if jsonb_array_length(opts) = 0 then
    opts := jsonb_build_array(jsonb_build_object('id', 'coordinar', 'label', 'Envío nacional (costo a confirmar por WhatsApp)',
      'cost', null, 'requires_address', true, 'active', true));
  end if;
  select x into o from jsonb_array_elements(opts) x where x ->> 'id' = p_id and coalesce((x ->> 'active')::boolean, true);
  return o;
end; $$;

-- ---------- Liberar / confirmar pedidos --------------------------------------------------
create or replace function public._release_order(p_order uuid, p_status text, p_actor text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; it record;
begin
  select * into o from public.orders where id = p_order for update;
  if o.fulfillment_status in ('cancelled', 'expired') then return; end if;
  for it in select oi.*, v.stock_on_hand from public.order_items oi left join public.product_variants v on v.id = oi.variant_id
             where oi.order_id = p_order loop
    if it.kind = 'normal' and it.variant_id is not null and it.stock_on_hand is not null then
      if o.confirmed_at is null then
        update public.product_variants set stock_reserved = greatest(stock_reserved - it.qty, 0) where id = it.variant_id;
        insert into public.inventory_movements (variant_id, product_id, order_id, kind, qty, note, actor_id)
        values (it.variant_id, it.product_id, p_order, 'release', it.qty, p_status, auth.uid());
      elsif o.fulfillment_status not in ('shipped', 'delivered') then
        update public.product_variants set stock_on_hand = stock_on_hand + it.qty where id = it.variant_id;
        insert into public.inventory_movements (variant_id, product_id, order_id, kind, qty, note, actor_id)
        values (it.variant_id, it.product_id, p_order, 'return', it.qty, 'pedido cancelado', auth.uid());
      end if;
    elsif it.kind = 'preorder' then
      insert into public.inventory_movements (variant_id, product_id, campaign_id, order_id, kind, qty, note, actor_id)
      values (it.variant_id, it.product_id, it.campaign_id, p_order, 'preorder_release', it.qty, p_status, auth.uid());
    end if;
  end loop;
  -- Regla de usos: sin pago confirmado → el uso se libera. Con pago confirmado → se conserva
  -- (void_kept), salvo que el reembolso indique explícitamente restaurarlo.
  update public.promo_redemptions set status = 'released', released_at = now(), reason = p_status
   where order_id = p_order and status = 'pending';
  update public.promo_redemptions set status = 'void_kept', reason = p_status
   where order_id = p_order and status = 'confirmed';
  update public.orders set fulfillment_status = p_status, cancelled_at = now(), updated_at = now() where id = p_order;
  perform public._history(p_order, p_actor, case p_status when 'expired' then 'Reserva vencida' else 'Pedido cancelado' end,
    p_note, null, null, o.fulfillment_status, p_status);
end; $$;

create or replace function public._confirm_order(p_order uuid, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; it record;
begin
  select * into o from public.orders where id = p_order for update;
  if o.fulfillment_status <> 'pending_confirmation' then return; end if;
  for it in select oi.*, v.stock_on_hand from public.order_items oi left join public.product_variants v on v.id = oi.variant_id
             where oi.order_id = p_order loop
    if it.kind = 'normal' and it.variant_id is not null and it.stock_on_hand is not null then
      update public.product_variants set stock_reserved = greatest(stock_reserved - it.qty, 0),
             stock_on_hand = greatest(stock_on_hand - it.qty, 0) where id = it.variant_id;
      insert into public.inventory_movements (variant_id, product_id, order_id, kind, qty, note, actor_id)
      values (it.variant_id, it.product_id, p_order, 'sale', -it.qty, 'pago confirmado', auth.uid());
    elsif it.kind = 'preorder' then
      insert into public.inventory_movements (variant_id, product_id, campaign_id, order_id, kind, qty, note, actor_id)
      values (it.variant_id, it.product_id, it.campaign_id, p_order, 'preorder_confirm', it.qty, 'pago confirmado', auth.uid());
    end if;
  end loop;
  update public.promo_redemptions set status = 'confirmed', confirmed_at = now() where order_id = p_order and status = 'pending';
  update public.orders set fulfillment_status = 'confirmed', confirmed_at = now(), hold_expires_at = null,
         verification_expires_at = null, updated_at = now() where id = p_order;
  perform public._history(p_order, p_actor, case when o.kind in ('preorder', 'mixed') then 'Reserva confirmada' else 'Pedido confirmado' end,
    '', null, null, 'pending_confirmation', 'confirmed');
end; $$;

-- Recalcula lo pagado y el estado financiero a partir de los pagos APROBADOS por KOVA.
create or replace function public._recompute_financial(p_order uuid, p_actor text default 'system')
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; paid integer; refunded integer; st text; has_sub boolean; has_ver boolean; has_rej boolean;
begin
  select * into o from public.orders where id = p_order for update;
  select coalesce(sum(amount) filter (where status = 'approved' and kind <> 'refund'), 0),
         coalesce(sum(amount) filter (where status = 'approved' and kind = 'refund'), 0),
         bool_or(status = 'submitted'), bool_or(status = 'verifying'), bool_or(status = 'rejected')
    into paid, refunded, has_sub, has_ver, has_rej
    from public.payments where order_id = p_order;
  st := case
    when refunded > 0 and paid - refunded <= 0 then 'refunded'
    when refunded > 0 then 'partial_refund'
    when paid >= o.total and (paid > 0 or o.total = 0) then 'paid'
    when paid > 0 and paid >= o.amount_due_now then 'deposit_confirmed'
    when coalesce(has_ver, false) then 'verifying'
    when coalesce(has_sub, false) then 'proof_received'
    when coalesce(has_rej, false) and paid = 0 then 'rejected'
    else 'pending_payment' end;
  update public.orders set paid_total = paid, refunded_total = refunded, financial_status = st, updated_at = now() where id = p_order;
  if st is distinct from o.financial_status then
    perform public._history(p_order, p_actor, 'Estado de pago actualizado', '', o.financial_status, st, null, null);
  end if;
  if o.fulfillment_status = 'pending_confirmation' and paid > 0 and paid >= o.amount_due_now and refunded = 0 then
    perform public._confirm_order(p_order, p_actor);
  end if;
end; $$;

-- Vence reservas sin pago. Las que tienen comprobante en revisión NO se liberan solas
-- (puede haber dinero real): se marcan como "verificación vencida" en el panel.
create or replace function public.expire_stale_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from public.orders
            where fulfillment_status = 'pending_confirmation' and financial_status in ('pending_payment', 'rejected')
              and hold_expires_at is not null and hold_expires_at < now()
            for update skip locked loop
    perform public._release_order(r.id, 'expired', 'system', 'Se venció el plazo para pagar la reserva.');
    n := n + 1;
  end loop;
  delete from public.proof_upload_slots where expires_at < now() - interval '1 day';
  return n;
end; $$;

-- ---------- API pública ---------------------------------------------------------------------
create or replace function public.get_storefront()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare res jsonb; camps jsonb;
begin
  if exists (select 1 from public.orders where fulfillment_status = 'pending_confirmation'
              and financial_status in ('pending_payment', 'rejected') and hold_expires_at < now()) then
    perform public.expire_stale_orders();
  end if;
  select coalesce(jsonb_agg(x order by x ->> 'opens_at' nulls first), '[]'::jsonb) into camps from (
    select jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'name', c.name, 'drop_name', c.drop_name, 'description', c.description,
      'banner_url', c.banner_url, 'phase', public.campaign_phase(c), 'opens_at', c.opens_at, 'closes_at', c.closes_at,
      'est_dispatch_date', c.est_dispatch_date, 'est_delivery_date', c.est_delivery_date,
      'deposit_pct', c.deposit_pct, 'allow_full_payment', c.allow_full_payment, 'allow_promo_codes', c.allow_promo_codes,
      'shipping_charge', c.shipping_charge, 'terms', c.terms, 'show_countdown', c.show_countdown,
      'show_availability', c.show_availability, 'max_per_customer', c.max_per_customer,
      'remaining', case when c.show_availability and c.max_units is not null then greatest(c.max_units - public._campaign_used(c.id), 0) end,
      'products', (select coalesce(jsonb_agg(jsonb_build_object(
          'product_id', pp.product_id,
          'remaining', case when c.show_availability and pp.max_units is not null
                            then greatest(pp.max_units - public._campaign_used(c.id, pp.product_id), 0) end,
          'variants', (select coalesce(jsonb_agg(jsonb_build_object('size', l.size, 'color', l.color, 'enabled', l.enabled,
              'remaining', case when c.show_availability and l.max_units is not null
                                then greatest(l.max_units - public._campaign_used(c.id, pp.product_id, l.size, l.color), 0) end)), '[]'::jsonb)
             from public.preorder_variant_limits l where l.campaign_id = c.id and l.product_id = pp.product_id)
        ) order by pp.position), '[]'::jsonb) from public.preorder_products pp where pp.campaign_id = c.id)
    ) as x
    from public.preorder_campaigns c where c.status in ('active', 'paused', 'closed')
      and (c.status <> 'closed' or c.updated_at > now() - interval '60 days')
  ) s;
  res := jsonb_build_object('now', now(), 'campaigns', camps,
    'shipping', coalesce(public._store_setting('shipping'), '{}'::jsonb),
    'legal', coalesce(public._store_setting('legal'), '{}'::jsonb),
    'max_units_per_line', coalesce((public._setting('general') ->> 'max_units_per_line')::int, 10));
  return res;
end; $$;

create or replace function public.validate_promo(p_code text, p_items jsonb, p_email text default '', p_phone text default '', p_plan text default 'deposit')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare pc public.promo_codes; v_lines jsonb; ev jsonb; camp public.preorder_campaigns; q jsonb; v_code text := upper(public._clean(p_code, 40));
begin
  perform public._rate_check('promo', coalesce((public._setting('general') ->> 'max_promo_checks_per_10min')::int, 25), interval '10 minutes');
  if v_code !~ '^[A-Z0-9_-]{3,32}$' then return jsonb_build_object('ok', false, 'reason', 'not_found', 'message', 'Este código no existe o no es válido.'); end if;
  v_lines := public._price_lines(p_items);
  select * into pc from public.promo_codes where code_norm = v_code;
  ev := public._promo_eval(pc, v_lines, p_email, p_phone);
  insert into public.promo_applications (promo_id, code_try, valid, reason, subtotal, discount, client_hash)
  values (pc.id, v_code, coalesce((ev ->> 'ok')::boolean, false), ev ->> 'reason',
          (select sum((x ->> 'line_original')::int) from jsonb_array_elements(v_lines) x), (ev ->> 'discount')::int, public._client_hash());
  if not coalesce((ev ->> 'ok')::boolean, false) then return ev - 'alloc'; end if;
  select * into camp from public.preorder_campaigns where id = (select (x ->> 'campaign_id')::uuid from jsonb_array_elements(v_lines) x where x ->> 'campaign_id' is not null limit 1);
  q := public._quote(v_lines, ev, case when p_plan = 'full' then 'full' else 'deposit' end, camp, null);
  return ev || jsonb_build_object('quote', q);
end; $$;

-- Calcula el resumen de un carrito con los precios del servidor (para mostrar en el checkout).
create or replace function public.quote_cart(p_items jsonb, p_code text default '', p_email text default '', p_phone text default '',
  p_plan text default 'deposit', p_shipping text default '')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare pc public.promo_codes; v_lines jsonb; ev jsonb := '{}'::jsonb; camp public.preorder_campaigns; v_code text := upper(public._clean(p_code, 40));
begin
  perform public._rate_check('quote', 120, interval '10 minutes');
  v_lines := public._price_lines(p_items);
  if v_code <> '' then
    select * into pc from public.promo_codes where code_norm = v_code;
    ev := public._promo_eval(pc, v_lines, p_email, p_phone);
  end if;
  select * into camp from public.preorder_campaigns where id = (select (x ->> 'campaign_id')::uuid from jsonb_array_elements(v_lines) x where x ->> 'campaign_id' is not null limit 1);
  return jsonb_build_object('promo', ev - 'alloc', 'quote',
    public._quote(v_lines, ev, case when p_plan = 'full' or camp.id is null then 'full' else 'deposit' end, camp, public._shipping_option(p_shipping)),
    'campaign', case when camp.id is not null then jsonb_build_object('id', camp.id, 'name', camp.name, 'deposit_pct', camp.deposit_pct,
      'allow_full_payment', camp.allow_full_payment, 'est_dispatch_date', camp.est_dispatch_date, 'shipping_charge', camp.shipping_charge) end);
end; $$;

create or replace function public._token_for(p_key text) returns text language sql stable security definer set search_path = public, kova_private as $$
  select encode(extensions.hmac(convert_to(p_key, 'UTF8'), (select value from kova_private.secrets where name = 'tracking_hmac'), 'sha256'), 'hex');
$$;

create or replace function public.create_order(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_ikey text := public._clean(p ->> 'idempotency_key', 80);
  b jsonb := coalesce(p -> 'buyer', '{}'::jsonb);
  v_name text := public._clean(b ->> 'full_name', 100);
  v_email text := public._norm_email(b ->> 'email');
  v_phone text := public._norm_phone(b ->> 'whatsapp');
  v_dept text := public._clean(b ->> 'department', 60);
  v_city text := public._clean(b ->> 'city', 80);
  v_addr text := public._clean(b ->> 'address', 200);
  v_notes text := public._clean(b ->> 'notes', 500);
  v_plan text := case when p ->> 'payment_plan' = 'full' then 'full' else 'deposit' end;
  v_method text := public._clean(p ->> 'payment_method', 40);
  v_code text := upper(public._clean(p ->> 'promo_code', 40));
  v_ship jsonb; v_lines jsonb; ev jsonb := '{}'::jsonb; q jsonb; ln jsonb;
  camp public.preorder_campaigns; pc public.promo_codes; v_cust uuid; oid uuid; v_num text; v_prefix text; v_seq integer;
  v_token text; existing public.orders; v_kinds text[]; v_kind text; v_hold timestamptz; g jsonb := public._setting('general');
  used integer; v_mine integer; pp public.preorder_products; lim public.preorder_variant_limits; v public.product_variants;
  v_new_units integer;
begin
  if v_ikey !~ '^[A-Za-z0-9_-]{16,80}$' then perform public._fail('Solicitud inválida. Recarga la página e inténtalo de nuevo.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('order:' || v_ikey, 0));
  select * into existing from public.orders where idempotency_key = v_ikey;
  if existing.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'number', existing.number, 'token', public._token_for(v_ikey));
  end if;
  perform public._rate_check('order', coalesce((g ->> 'max_orders_per_hour_per_ip')::int, 8), interval '1 hour');

  -- Datos del comprador
  if char_length(v_name) < 5 or v_name !~ '\S+\s+\S+' or v_name ~ '[0-9@]' then perform public._fail('Escribe tu nombre y apellido.'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or char_length(v_email) > 160 then perform public._fail('Escribe un correo electrónico válido.'); end if;
  if v_phone !~ '^\d{10,15}$' then perform public._fail('Escribe un número de WhatsApp válido.'); end if;
  if v_dept = '' or v_city = '' then perform public._fail('Escribe tu departamento y ciudad.'); end if;
  if coalesce((p ->> 'accept_terms')::boolean, false) is not true then perform public._fail('Debes aceptar las condiciones de compra.'); end if;
  if coalesce((p ->> 'accept_data')::boolean, false) is not true then perform public._fail('Debes autorizar el tratamiento de tus datos para gestionar el pedido.'); end if;
  if v_method <> '' and not exists (select 1 from jsonb_array_elements(coalesce(public._store_setting('payments'), '[]'::jsonb)) x where x ->> 'id' = v_method)
     and v_method not in ('nu', 'nequi') then
    perform public._fail('Elige un método de pago válido.');
  end if;
  v_ship := public._shipping_option(coalesce(p ->> 'shipping_method', ''));
  if v_ship is null then perform public._fail('Elige un método de entrega.'); end if;
  if coalesce((v_ship ->> 'requires_address')::boolean, true) and char_length(v_addr) < 6 then perform public._fail('Escribe la dirección de entrega.'); end if;

  perform public.expire_stale_orders();
  v_lines := public._price_lines(p -> 'items');
  select array_agg(distinct x ->> 'kind') into v_kinds from jsonb_array_elements(v_lines) x;
  v_kind := case when array_length(v_kinds, 1) > 1 then 'mixed' else v_kinds[1] end;

  -- Preventa: se bloquea la campaña para que dos personas no tomen el último cupo a la vez.
  select * into camp from public.preorder_campaigns
   where id = (select (x ->> 'campaign_id')::uuid from jsonb_array_elements(v_lines) x where x ->> 'campaign_id' is not null limit 1)
   for update;
  if camp.id is null then v_plan := 'full';
  else
    if public.campaign_phase(camp) <> 'open' then perform public._fail('La preventa ya no está abierta.'); end if;
    if v_plan = 'full' and not camp.allow_full_payment then perform public._fail('Esta preventa solo admite pago por anticipo.'); end if;
    select coalesce(sum((x ->> 'qty')::int), 0) into v_new_units from jsonb_array_elements(v_lines) x where x ->> 'kind' = 'preorder';
    if camp.max_units is not null and public._campaign_used(camp.id) + v_new_units > camp.max_units then
      perform public._fail(format('Solo quedan %s cupos en esta preventa.', greatest(camp.max_units - public._campaign_used(camp.id), 0)));
    end if;
    if camp.max_per_customer is not null then
      select coalesce(sum(oi.qty), 0) into v_mine from public.order_items oi join public.orders o on o.id = oi.order_id
        join public.customers cu on cu.id = o.customer_id
       where oi.campaign_id = camp.id and o.fulfillment_status not in ('cancelled', 'expired')
         and (cu.email_norm = v_email or cu.phone_norm = v_phone);
      if v_mine + v_new_units > camp.max_per_customer then
        perform public._fail(format('Máximo %s unidades por cliente en esta preventa (ya tienes %s).', camp.max_per_customer, v_mine));
      end if;
    end if;
    for ln in select x from jsonb_array_elements(v_lines) x where x ->> 'kind' = 'preorder' loop
      select * into pp from public.preorder_products where campaign_id = camp.id and product_id = ln ->> 'product_id';
      if pp.max_units is not null and public._campaign_used(camp.id, pp.product_id)
           + (select sum((y ->> 'qty')::int) from jsonb_array_elements(v_lines) y where y ->> 'product_id' = pp.product_id and y ->> 'kind' = 'preorder') > pp.max_units then
        perform public._fail(format('No hay cupos suficientes de %s en la preventa.', ln ->> 'name'));
      end if;
      select * into lim from public.preorder_variant_limits
       where campaign_id = camp.id and product_id = ln ->> 'product_id' and size = ln ->> 'size' and color = ln ->> 'color';
      if lim.max_units is not null and public._campaign_used(camp.id, ln ->> 'product_id', ln ->> 'size', ln ->> 'color') + (ln ->> 'qty')::int > lim.max_units then
        perform public._fail(format('No hay cupos suficientes de %s %s %s.', ln ->> 'name', ln ->> 'size', ln ->> 'color'));
      end if;
    end loop;
  end if;

  -- Venta normal con inventario controlado: se bloquea la variante y se reserva.
  for ln in select x from jsonb_array_elements(v_lines) x where x ->> 'kind' = 'normal' and x ->> 'variant_id' is not null loop
    select * into v from public.product_variants where id = (ln ->> 'variant_id')::uuid for update;
    if v.stock_on_hand is not null and v.stock_on_hand - v.stock_reserved < (ln ->> 'qty')::int then
      perform public._fail(format('%s talla %s: solo quedan %s unidades.', ln ->> 'name', ln ->> 'size', greatest(v.stock_on_hand - v.stock_reserved, 0)));
    end if;
  end loop;

  -- Código promocional: se bloquea la fila para que no se excedan los usos al mismo tiempo.
  if v_code <> '' then
    select * into pc from public.promo_codes where code_norm = v_code for update;
    ev := public._promo_eval(pc, v_lines, v_email, v_phone);
    if not coalesce((ev ->> 'ok')::boolean, false) then perform public._fail(ev ->> 'message'); end if;
  end if;

  q := public._quote(v_lines, ev, v_plan, camp, v_ship);

  insert into public.customers (email_norm, phone_norm, full_name) values (v_email, v_phone, v_name)
  on conflict (email_norm) do update set phone_norm = excluded.phone_norm, full_name = excluded.full_name, updated_at = now()
  returning id into v_cust;

  v_prefix := coalesce(camp.order_prefix, nullif(g ->> 'order_prefix', ''), 'WEB');
  insert into public.order_counters (prefix, last_value) values (v_prefix, 1)
  on conflict (prefix) do update set last_value = order_counters.last_value + 1 returning last_value into v_seq;
  v_num := format('KOVA-%s-%s', v_prefix, lpad(v_seq::text, 6, '0'));
  v_token := public._token_for(v_ikey);
  v_hold := case when camp.id is not null then now() + make_interval(mins => coalesce(camp.hold_minutes, 1440))
               else now() + make_interval(hours => coalesce((g ->> 'hold_hours_normal')::int, 24)) end;

  insert into public.orders (number, token_hash, idempotency_key, customer_id, kind, campaign_id, payment_plan, payment_method,
    subtotal_original, discount_total, subtotal_after, shipping_method, shipping_label, shipping_amount, shipping_charge_at,
    total, amount_due_now, deposit_pct, promo_code_id, promo_code, promo_snapshot, terms_snapshot,
    full_name, email, whatsapp, department, city, address, delivery_notes, delivery_method,
    accepted_terms_at, accepted_data_at, est_dispatch_date, hold_expires_at, client_fingerprint)
  values (v_num, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_ikey, v_cust, v_kind, camp.id, v_plan, v_method,
    (q ->> 'subtotal_original')::int, (q ->> 'discount_total')::int, (q ->> 'subtotal_after')::int,
    v_ship ->> 'id', v_ship ->> 'label', (q ->> 'shipping_amount')::int, q ->> 'shipping_charge_at',
    (q ->> 'total')::int, (q ->> 'amount_due_now')::int, case when camp.id is not null and v_plan = 'deposit' then camp.deposit_pct end,
    pc.id, pc.code_norm,
    case when pc.id is not null then jsonb_build_object('code', pc.code_norm, 'discount_type', pc.discount_type, 'percent', pc.percent,
      'fixed_amount', pc.fixed_amount, 'max_discount', pc.max_discount, 'discount', ev -> 'discount', 'influencer', pc.influencer_name,
      'commission_pct', pc.commission_pct, 'commission_fixed', pc.commission_fixed) end,
    jsonb_build_object('campaign', case when camp.id is not null then jsonb_build_object('id', camp.id, 'name', camp.name, 'drop', camp.drop_name,
        'deposit_pct', camp.deposit_pct, 'allow_full_payment', camp.allow_full_payment, 'shipping_charge', camp.shipping_charge,
        'terms', camp.terms, 'est_dispatch_date', camp.est_dispatch_date, 'est_delivery_date', camp.est_delivery_date) end,
      'legal_updated_at', (select updated_at from public.store_settings where key = 'legal'), 'rounding', 'peso entero, mitad hacia arriba'),
    v_name, v_email, v_phone, v_dept, v_city, v_addr, v_notes, v_ship ->> 'id', now(), now(), camp.est_dispatch_date, v_hold, public._client_hash())
  returning id into oid;

  insert into public.order_items (order_id, line_no, kind, product_id, variant_id, campaign_id, name, category, size, color, qty,
    unit_price, line_original, discount, line_final, deposit_pct, due_now, unit_cost, custom)
  select oid, (x ->> 'line_no')::int, x ->> 'kind', x ->> 'product_id', (x ->> 'variant_id')::uuid, (x ->> 'campaign_id')::uuid,
         x ->> 'name', x ->> 'category', x ->> 'size', x ->> 'color', (x ->> 'qty')::int, (x ->> 'unit_price')::int,
         (x ->> 'line_original')::int, (x ->> 'discount')::int, (x ->> 'line_final')::int, (x ->> 'deposit_pct')::int,
         (x ->> 'due_now')::int, (x ->> 'unit_cost')::int, x -> 'custom'
    from jsonb_array_elements(q -> 'lines') x;

  -- Reservas temporales de inventario
  for ln in select x from jsonb_array_elements(q -> 'lines') x loop
    if ln ->> 'kind' = 'normal' and ln ->> 'variant_id' is not null then
      update public.product_variants set stock_reserved = stock_reserved + (ln ->> 'qty')::int
       where id = (ln ->> 'variant_id')::uuid and stock_on_hand is not null;
      if found then
        insert into public.inventory_movements (variant_id, product_id, order_id, kind, qty, note)
        values ((ln ->> 'variant_id')::uuid, ln ->> 'product_id', oid, 'reserve', (ln ->> 'qty')::int, 'pedido pendiente');
      end if;
    elsif ln ->> 'kind' = 'preorder' then
      insert into public.inventory_movements (variant_id, product_id, campaign_id, order_id, kind, qty, note)
      values ((ln ->> 'variant_id')::uuid, ln ->> 'product_id', camp.id, oid, 'preorder_hold', (ln ->> 'qty')::int, 'reserva pendiente');
    end if;
  end loop;

  if pc.id is not null then
    insert into public.promo_redemptions (promo_id, order_id, customer_id, status, eligible_subtotal, discount_amount)
    values (pc.id, oid, v_cust, 'pending', (ev ->> 'eligible_subtotal')::int, (ev ->> 'discount')::int);
  end if;
  perform public._history(oid, 'customer', case when camp.id is not null then 'Solicitud de reserva registrada' else 'Solicitud de pedido registrada' end,
    'Pendiente de pago. La reserva se confirma cuando KOVA verifique el dinero recibido.', null, 'pending_payment', null, 'pending_confirmation');
  if (q ->> 'total')::int = 0 then perform public._recompute_financial(oid, 'system'); end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'number', v_num, 'token', v_token);
exception when unique_violation then
  select * into existing from public.orders where idempotency_key = v_ikey;
  if existing.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'number', existing.number, 'token', public._token_for(v_ikey));
  end if;
  raise;
end; $$;

create or replace function public._order_by_token(p_token text) returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform public._rate_check('track', 60, interval '10 minutes');
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then perform public._fail('Enlace de seguimiento inválido.'); end if;
  select * into o from public.orders where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if o.id is null then perform public._fail('No encontramos este pedido. Revisa el enlace completo.'); end if;
  return o;
end; $$;

create or replace function public.get_order_public(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare o public.orders; c public.preorder_campaigns;
begin
  o := public._order_by_token(p_token);
  if o.fulfillment_status = 'pending_confirmation' and o.financial_status in ('pending_payment', 'rejected') and o.hold_expires_at < now() then
    perform public._release_order(o.id, 'expired', 'system', 'Se venció el plazo para pagar la reserva.');
    select * into o from public.orders where id = o.id;
  end if;
  select * into c from public.preorder_campaigns where id = o.campaign_id;
  return jsonb_build_object(
    'number', o.number, 'created_at', o.created_at, 'kind', o.kind, 'payment_plan', o.payment_plan, 'payment_method', o.payment_method,
    'financial_status', o.financial_status, 'fulfillment_status', o.fulfillment_status,
    'subtotal_original', o.subtotal_original, 'discount_total', o.discount_total, 'subtotal_after', o.subtotal_after,
    'shipping_label', o.shipping_label, 'shipping_amount', o.shipping_amount, 'shipping_charge_at', o.shipping_charge_at,
    'total', o.total, 'amount_due_now', o.amount_due_now, 'paid_total', o.paid_total, 'refunded_total', o.refunded_total,
    'balance', greatest(o.total - o.paid_total + o.refunded_total, 0), 'deposit_pct', o.deposit_pct,
    'promo_code', o.promo_code, 'est_dispatch_date', o.est_dispatch_date, 'hold_expires_at', o.hold_expires_at,
    'tracking_number', o.tracking_number, 'carrier', o.carrier,
    'campaign', case when c.id is not null then jsonb_build_object('name', c.name, 'drop_name', c.drop_name, 'terms', c.terms,
      'est_delivery_date', c.est_delivery_date) end,
    -- Datos personales enmascarados: el enlace puede reenviarse por error.
    'buyer', jsonb_build_object('first_name', split_part(o.full_name, ' ', 1), 'city', o.city, 'department', o.department,
      'whatsapp_tail', right(o.whatsapp, 4)),
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'kind', i.kind, 'size', i.size, 'color', i.color, 'qty', i.qty,
        'unit_price', i.unit_price, 'line_original', i.line_original, 'discount', i.discount, 'line_final', i.line_final,
        'due_now', i.due_now, 'custom', case when i.custom is not null then jsonb_build_object('mode_name', i.custom ->> 'mode_name', 'mode_label', i.custom ->> 'mode_label') end)
        order by i.line_no) from public.order_items i where i.order_id = o.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('kind', pm.kind, 'amount', pm.amount, 'status', pm.status,
        'reject_reason', pm.reject_reason, 'created_at', pm.created_at, 'transfer_date', pm.transfer_date) order by pm.created_at), '[]'::jsonb)
        from public.payments pm where pm.order_id = o.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('at', h.at, 'event', h.event, 'note', h.note,
        'to_financial', h.to_financial, 'to_fulfillment', h.to_fulfillment) order by h.at), '[]'::jsonb)
        from public.order_history h where h.order_id = o.id and h.is_public),
    'can_upload', o.fulfillment_status not in ('cancelled', 'expired', 'delivered') and o.financial_status not in ('refunded')
      and o.paid_total - o.refunded_total < o.total);
end; $$;

create or replace function public.request_proof_upload(p_token text, p_ext text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare o public.orders; v_path text; v_ext text := lower(coalesce(p_ext, ''));
begin
  perform public._rate_check('upload', 12, interval '1 hour');
  o := public._order_by_token(p_token);
  if o.fulfillment_status in ('cancelled', 'expired') then perform public._fail('Este pedido ya no está activo.'); end if;
  if v_ext not in ('jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf') then perform public._fail('Sube una imagen (JPG, PNG, WEBP, HEIC) o un PDF.'); end if;
  if (select count(*) from public.payments where order_id = o.id and status in ('submitted', 'verifying')) >= 3 then
    perform public._fail('Ya tienes comprobantes en revisión. Espera la respuesta de KOVA.');
  end if;
  v_path := format('%s/%s.%s', o.id, gen_random_uuid(), v_ext);
  insert into public.proof_upload_slots (path, order_id, expires_at) values (v_path, o.id, now() + interval '15 minutes');
  return jsonb_build_object('bucket', 'payment-proofs', 'path', v_path);
end; $$;

create or replace function public.submit_payment_proof(p_token text, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  o public.orders; s public.proof_upload_slots; v_amt integer; v_kind text; v_vh integer; c public.preorder_campaigns;
  v_sha text := lower(coalesce(p ->> 'sha256', '')); v_ref text := public._clean(p ->> 'reference', 80); v_td date;
begin
  perform public._rate_check('proof', 12, interval '1 hour');
  o := public._order_by_token(p_token);
  if o.fulfillment_status in ('cancelled', 'expired') then perform public._fail('Este pedido ya no está activo.'); end if;
  select * into s from public.proof_upload_slots where path = p ->> 'path' for update;
  if s.path is null or s.order_id <> o.id or s.used then perform public._fail('No encontramos el archivo del comprobante. Súbelo de nuevo.'); end if;
  if not exists (select 1 from storage.objects where bucket_id = 'payment-proofs' and name = s.path) then
    perform public._fail('El archivo del comprobante no terminó de subir. Inténtalo de nuevo.');
  end if;
  if v_sha !~ '^[0-9a-f]{64}$' then perform public._fail('No se pudo verificar el archivo. Inténtalo de nuevo.'); end if;
  if exists (select 1 from public.payments where proof_sha256 = v_sha and status <> 'rejected') then
    perform public._fail('Este comprobante ya fue registrado en otro pago. Sube el comprobante de esta transferencia.');
  end if;
  v_amt := case when (p ->> 'amount') ~ '^\d{1,9}$' then (p ->> 'amount')::int else 0 end;
  if v_amt < 1 or v_amt > greatest(o.total - o.paid_total + o.refunded_total, 1) then
    perform public._fail('Escribe el valor exacto que transferiste (no puede superar el saldo del pedido).');
  end if;
  begin v_td := (p ->> 'transfer_date')::date; exception when others then v_td := null; end;
  if v_td is null or v_td > (now() at time zone 'America/Bogota')::date + 1 or v_td < o.created_at::date - 1 then
    perform public._fail('Escribe la fecha en que hiciste la transferencia.');
  end if;
  v_kind := case when o.paid_total = 0 then case when o.payment_plan = 'full' or o.amount_due_now >= o.total then 'full' else 'deposit' end else 'balance' end;

  insert into public.payments (order_id, kind, method, amount, reference, transfer_date, proof_path, proof_sha256, status, source)
  values (o.id, v_kind, coalesce(nullif(public._clean(p ->> 'method', 40), ''), o.payment_method), v_amt, v_ref, v_td, s.path, v_sha, 'submitted', 'customer');
  update public.proof_upload_slots set used = true where path = s.path;

  select * into c from public.preorder_campaigns where id = o.campaign_id;
  v_vh := coalesce(c.verification_hours, (public._setting('general') ->> 'verification_hours')::int, 48);
  update public.orders set verification_expires_at = now() + make_interval(hours => v_vh),
         hold_expires_at = greatest(coalesce(hold_expires_at, now()), now() + make_interval(hours => v_vh)) where id = o.id;
  perform public._history(o.id, 'customer', 'Comprobante recibido', 'KOVA revisará el pago. La reserva aún no está confirmada.');
  perform public._recompute_financial(o.id, 'customer');
  return jsonb_build_object('ok', true);
end; $$;

-- ---------- Permisos de ejecución ------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like '\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.expire_stale_orders() from public, anon, authenticated;
revoke all on function public.campaign_phase(public.preorder_campaigns) from public;
grant execute on function public.campaign_phase(public.preorder_campaigns) to authenticated;
grant execute on function public.get_storefront(), public.validate_promo(text, jsonb, text, text, text),
  public.quote_cart(jsonb, text, text, text, text, text), public.create_order(jsonb), public.get_order_public(text),
  public.request_proof_upload(text, text), public.submit_payment_proof(text, jsonb) to anon, authenticated;
