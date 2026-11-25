-- =============================================================================
-- KOVA · Migración 03 — Funciones del panel, auditoría, estadísticas y campaña inicial
--
-- Todas exigen sesión iniciada de un usuario en public.admins (owner/admin; producción solo
-- puede actualizar estados de producción, checklist y notas). Cada acción importante queda en audit_logs.
-- =============================================================================

create or replace function public._require_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin if not public.is_admin() then perform public._fail('No tienes permiso para hacer esto.'); end if; end; $$;
create or replace function public._require_staff() returns void language plpgsql stable security definer set search_path = public as $$
begin if not public.is_staff() then perform public._fail('No tienes permiso para hacer esto.'); end if; end; $$;

-- ---------- Auditoría automática de la configuración ---------------------------------------
create or replace function public._audit_trigger() returns trigger language plpgsql security definer set search_path = public as $$
declare id text; d jsonb;
begin
  id := coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'key', to_jsonb(old) ->> 'key',
                 to_jsonb(new) ->> 'product_id', to_jsonb(old) ->> 'product_id');
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('antes', o.value, 'despues', n.value)), '{}'::jsonb) into d
      from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value and n.key not in ('updated_at');
    if d = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then d := to_jsonb(new);
  else d := to_jsonb(old); end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details) values (auth.uid(), lower(tg_op), tg_table_name, id, d);
  return coalesce(new, old);
end; $$;

do $$
declare t text;
begin
  foreach t in array array['products', 'product_variants', 'product_costs', 'preorder_campaigns', 'preorder_products',
    'preorder_variant_limits', 'promo_codes', 'admin_settings', 'store_settings']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public._audit_trigger()', t || '_audit', t);
  end loop;
  foreach t in array array['product_variants', 'preorder_campaigns', 'promo_codes', 'admin_settings', 'customers', 'product_costs']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------- Rentabilidad de un código ------------------------------------------------------------
-- Por producto participante: precio, precio con descuento, costo registrado, ganancia y margen.
-- Sin costo registrado → no se inventa: se informa "sin costo".
create or replace function public.promo_profit_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  typ text := p ->> 'discount_type'; pct integer := nullif(p ->> 'percent', '')::int; fixed integer := nullif(p ->> 'fixed_amount', '')::int;
  maxd integer := nullif(p ->> 'max_discount', '')::int; prods text[]; cats text[]; prof jsonb := public._setting('profit');
  minm numeric := nullif(prof ->> 'min_margin_pct', '')::numeric; rows jsonb := '[]'::jsonb; r record; d integer; fin integer;
  warn text[]; profit integer; margin numeric; any_warn boolean := false;
begin
  perform public._require_admin();
  prods := (select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'product_ids') = 'array' then p -> 'product_ids' else '[]'::jsonb end) x);
  cats := (select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'categories') = 'array' then p -> 'categories' else '[]'::jsonb end) x);
  for r in select pr.id, pr.name, pr.price, coalesce(pc.unit_cost, (select min(v.cost) from public.product_variants v where v.product_id = pr.id)) as cost
             from public.products pr left join public.product_costs pc on pc.product_id = pr.id
            where pr.sale_mode <> 'hidden' and (prods is null or pr.id = any (prods)) and (cats is null or pr.category = any (cats))
            order by pr.position, pr.name loop
    d := case when typ = 'percent' then public._pct(r.price, coalesce(pct, 0)) else least(coalesce(fixed, 0), r.price) end;
    if maxd is not null then d := least(d, maxd); end if;
    fin := r.price - d; warn := '{}';
    if fin = 0 then warn := warn || 'El precio final queda en $0'::text; end if;
    if r.cost is not null then
      profit := fin - r.cost;
      margin := case when fin > 0 then round(profit * 100.0 / fin, 1) end;
      if profit < 0 then warn := warn || 'Genera pérdidas'::text;
      elsif profit = 0 then warn := warn || 'Vende al costo'::text;
      elsif minm is not null and margin < minm then warn := warn || format('Margen por debajo del mínimo (%s%%)', minm); end if;
    else profit := null; margin := null;
    end if;
    if array_length(warn, 1) > 0 then any_warn := true; end if;
    rows := rows || jsonb_build_object('product_id', r.id, 'name', r.name, 'price', r.price, 'discount', d, 'final', fin,
      'cost', r.cost, 'profit', profit, 'margin', margin, 'warnings', to_jsonb(warn));
  end loop;
  return jsonb_build_object('rows', rows, 'has_warnings', any_warn, 'mode', coalesce(prof ->> 'mode', 'warn'), 'min_margin_pct', minm,
    'high_discount', (typ = 'percent' and coalesce(pct, 0) >= 50) or exists (select 1 from jsonb_array_elements(rows) x where (x ->> 'final')::int = 0));
end; $$;

-- Normaliza y protege los códigos al guardar.
create or replace function public._promo_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare prev jsonb;
begin
  new.customer_emails := (select array_agg(distinct public._norm_email(e)) from unnest(new.customer_emails) e where btrim(e) <> '');
  new.product_ids := nullif(new.product_ids, '{}'); new.categories := nullif(new.categories, '{}'); new.campaign_ids := nullif(new.campaign_ids, '{}');
  if new.discount_type = 'percent' then new.fixed_amount := null; else new.percent := null; end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  if tg_op = 'UPDATE' and old.status = 'archived' and new.status <> 'archived' and not public.is_admin() then
    perform public._fail('Un código archivado no se puede reactivar.');
  end if;
  if new.status = 'active' and coalesce(public._setting('profit') ->> 'mode', 'warn') = 'block' and auth.uid() is not null then
    prev := public.promo_profit_preview(to_jsonb(new));
    if (prev ->> 'has_warnings')::boolean then
      perform public._fail('Este código deja productos por debajo del margen mínimo o con pérdidas. Ajusta el descuento o cambia la protección de rentabilidad a "Advertir".');
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists promo_codes_guard on public.promo_codes;
create trigger promo_codes_guard before insert or update on public.promo_codes for each row execute function public._promo_guard();

-- No se borran códigos con historial (la tabla no concede DELETE); se archivan.
create or replace function public.admin_promo_duplicate(p_id uuid, p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare src public.promo_codes; nid uuid;
begin
  perform public._require_admin();
  select * into src from public.promo_codes where id = p_id;
  if src.id is null then perform public._fail('Código no encontrado.'); end if;
  insert into public.promo_codes (code, name, internal_description, discount_type, percent, fixed_amount, status, starts_at, ends_at,
    max_uses, max_uses_per_customer, min_subtotal, min_items, product_ids, categories, campaign_ids, applies_normal, applies_preorder,
    applies_custom, customer_emails, max_discount, influencer_name, commission_pct, commission_fixed)
  values (upper(p_code), src.name, src.internal_description, src.discount_type, src.percent, src.fixed_amount, 'inactive', null, null,
    src.max_uses, src.max_uses_per_customer, src.min_subtotal, src.min_items, src.product_ids, src.categories, src.campaign_ids,
    src.applies_normal, src.applies_preorder, src.applies_custom, src.customer_emails, src.max_discount, src.influencer_name,
    src.commission_pct, src.commission_fixed)
  returning id into nid;
  return nid;
end; $$;

-- ---------- Campañas -------------------------------------------------------------------------------
create or replace function public.admin_campaign_status(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.preorder_campaigns; missing text[] := '{}'; clash text;
begin
  perform public._require_admin();
  select * into c from public.preorder_campaigns where id = p_id for update;
  if c.id is null then perform public._fail('Campaña no encontrada.'); end if;
  if p_status not in ('draft', 'active', 'paused', 'closed', 'archived') then perform public._fail('Estado inválido.'); end if;
  if p_status = 'active' then
    if c.opens_at is null then missing := missing || 'fecha y hora de apertura'::text; end if;
    if c.closes_at is null then missing := missing || 'fecha y hora de cierre'::text; end if;
    if c.est_dispatch_date is null then missing := missing || 'fecha estimada de despacho'::text; end if;
    if c.hold_minutes is null then missing := missing || 'vigencia de una reserva pendiente'::text; end if;
    if not exists (select 1 from public.preorder_products where campaign_id = c.id) then missing := missing || 'al menos un producto'::text; end if;
    if array_length(missing, 1) > 0 then
      perform public._fail('Antes de activar la campaña configura: ' || array_to_string(missing, ', ') || '.');
    end if;
    if c.closes_at <= now() then perform public._fail('La fecha de cierre ya pasó. Cámbiala antes de activar.'); end if;
    select string_agg(pr.name, ', ') into clash from public.preorder_products pp join public.preorder_products other on other.product_id = pp.product_id
      join public.preorder_campaigns oc on oc.id = other.campaign_id and oc.id <> c.id and oc.status in ('active', 'paused')
      join public.products pr on pr.id = pp.product_id where pp.campaign_id = c.id;
    if clash is not null then perform public._fail('Estos productos ya están en otra preventa activa: ' || clash || '.'); end if;
    -- Los productos participantes pasan a modalidad Preventa.
    update public.products set sale_mode = 'preorder' where id in (select product_id from public.preorder_products where campaign_id = c.id)
       and sale_mode in ('normal', 'coming_soon', 'sold_out');
  end if;
  update public.preorder_campaigns set status = p_status,
         closed_reason = case when p_status = 'closed' then 'cierre manual' else closed_reason end where id = c.id;
  perform public._audit('campaign_status', 'preorder_campaigns', c.id::text, jsonb_build_object('de', c.status, 'a', p_status));
  return jsonb_build_object('ok', true, 'status', p_status);
end; $$;

create or replace function public.admin_campaign_duplicate(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare src public.preorder_campaigns; nid uuid; n integer := 1; s text;
begin
  perform public._require_admin();
  select * into src from public.preorder_campaigns where id = p_id;
  if src.id is null then perform public._fail('Campaña no encontrada.'); end if;
  loop s := left(src.slug, 70) || '-copia' || case when n > 1 then '-' || n else '' end;
       exit when not exists (select 1 from public.preorder_campaigns where slug = s); n := n + 1; end loop;
  insert into public.preorder_campaigns (slug, name, drop_name, description, banner_url, status, max_units, max_per_customer, deposit_pct,
    allow_full_payment, allow_promo_codes, hold_minutes, verification_hours, shipping_charge, terms, show_countdown, show_availability,
    auto_close_on_limit, order_prefix, created_by)
  values (s, src.name || ' (copia)', src.drop_name, src.description, src.banner_url, 'draft', src.max_units, src.max_per_customer, src.deposit_pct,
    src.allow_full_payment, src.allow_promo_codes, src.hold_minutes, src.verification_hours, src.shipping_charge, src.terms,
    src.show_countdown, src.show_availability, src.auto_close_on_limit, src.order_prefix, auth.uid())
  returning id into nid;
  insert into public.preorder_products (campaign_id, product_id, max_units, position)
    select nid, product_id, max_units, position from public.preorder_products where campaign_id = p_id;
  insert into public.preorder_variant_limits (campaign_id, product_id, size, color, enabled, max_units)
    select nid, product_id, size, color, enabled, max_units from public.preorder_variant_limits where campaign_id = p_id;
  return nid;
end; $$;

-- Cierre automático por fecha: deja la campaña "closed" (los pedidos e historial se conservan).
create or replace function public.close_finished_campaigns()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.preorder_campaigns set status = 'closed', closed_reason = 'cierre automático por fecha'
   where status in ('active', 'paused') and closes_at is not null and closes_at <= now();
  get diagnostics n = row_count;
  return n;
end; $$;

-- ---------- Pagos ---------------------------------------------------------------------------------
create or replace function public.admin_review_payment(p_payment uuid, p_action text, p_reason text default '', p_amount integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pm public.payments; o public.orders;
begin
  perform public._require_admin();
  select * into pm from public.payments where id = p_payment for update;
  if pm.id is null then perform public._fail('Pago no encontrado.'); end if;
  select * into o from public.orders where id = pm.order_id for update;
  if pm.kind = 'refund' then perform public._fail('Los reembolsos se registran aparte.'); end if;
  if p_action = 'verifying' then
    if pm.status <> 'submitted' then perform public._fail('Este pago ya fue revisado.'); end if;
    update public.payments set status = 'verifying', reviewed_by = auth.uid(), reviewed_at = now() where id = pm.id;
    perform public._history(o.id, 'admin', 'Verificando pago', 'KOVA está verificando tu transferencia.');
  elsif p_action = 'approve' then
    if pm.status not in ('submitted', 'verifying') then perform public._fail('Este pago ya fue revisado.'); end if;
    if o.fulfillment_status in ('cancelled', 'expired') then
      perform public._fail('El pedido está cancelado o vencido. Si el dinero llegó, reactívalo creando un pedido nuevo o registra un reembolso.');
    end if;
    if p_amount is not null and (p_amount < 1 or p_amount > 100000000) then perform public._fail('Valor inválido.'); end if;
    begin
      update public.payments set status = 'approved', amount = coalesce(p_amount, amount), reviewed_by = auth.uid(), reviewed_at = now(),
             note = case when p_amount is not null and p_amount <> pm.amount then format('Valor ajustado por KOVA: %s → %s', pm.amount, p_amount) else note end
       where id = pm.id;
    exception when unique_violation then
      perform public._fail('Esa referencia de transferencia ya fue aprobada en otro pago. Revisa que no sea un comprobante repetido.');
    end;
    perform public._history(o.id, 'admin', 'Pago aprobado', format('Recibimos $%s.', to_char(coalesce(p_amount, pm.amount), 'FM999G999G999')));
  elsif p_action = 'reject' then
    if pm.status not in ('submitted', 'verifying') then perform public._fail('Este pago ya fue revisado.'); end if;
    if btrim(coalesce(p_reason, '')) = '' then perform public._fail('Escribe el motivo del rechazo (lo verá el cliente).'); end if;
    update public.payments set status = 'rejected', reject_reason = public._clean(p_reason, 300), reviewed_by = auth.uid(), reviewed_at = now() where id = pm.id;
    perform public._history(o.id, 'admin', 'Comprobante rechazado', public._clean(p_reason, 300));
  else perform public._fail('Acción inválida.');
  end if;
  perform public._recompute_financial(o.id, 'admin');
  perform public._audit('payment_' || p_action, 'payments', pm.id::text, jsonb_build_object('order', o.number, 'amount', coalesce(p_amount, pm.amount), 'reason', p_reason));
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.admin_add_payment(p_order uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; amt integer := nullif(p ->> 'amount', '')::int; k text := coalesce(p ->> 'kind', 'extra'); td date;
begin
  perform public._require_admin();
  select * into o from public.orders where id = p_order for update;
  if o.id is null then perform public._fail('Pedido no encontrado.'); end if;
  if o.fulfillment_status in ('cancelled', 'expired') then perform public._fail('El pedido está cancelado o vencido.'); end if;
  if amt is null or amt < 1 then perform public._fail('Escribe el valor recibido.'); end if;
  if k not in ('deposit', 'balance', 'full', 'extra') then perform public._fail('Tipo de pago inválido.'); end if;
  begin td := (p ->> 'transfer_date')::date; exception when others then td := null; end;
  begin
    insert into public.payments (order_id, kind, method, amount, reference, transfer_date, status, source, note, reviewed_by, reviewed_at)
    values (o.id, k, public._clean(p ->> 'method', 40), amt, public._clean(p ->> 'reference', 80), coalesce(td, (now() at time zone 'America/Bogota')::date),
            'approved', 'admin', public._clean(p ->> 'note', 300), auth.uid(), now());
  exception when unique_violation then
    perform public._fail('Esa referencia de transferencia ya fue aprobada en otro pago.');
  end;
  perform public._history(o.id, 'admin', 'Pago registrado', format('KOVA registró un pago de $%s.', to_char(amt, 'FM999G999G999')));
  perform public._recompute_financial(o.id, 'admin');
  perform public._audit('payment_add', 'orders', o.id::text, p);
  return jsonb_build_object('ok', true);
end; $$;

-- Reembolso. restore_promo = true devuelve el uso del código (solo si se reembolsa todo).
create or replace function public.admin_refund(p_order uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; amt integer := nullif(p ->> 'amount', '')::int; restore boolean := coalesce((p ->> 'restore_promo')::boolean, false);
begin
  perform public._require_admin();
  select * into o from public.orders where id = p_order for update;
  if o.id is null then perform public._fail('Pedido no encontrado.'); end if;
  if amt is null or amt < 1 or amt > o.paid_total - o.refunded_total then
    perform public._fail(format('El reembolso debe estar entre $1 y lo pagado neto ($%s).', to_char(o.paid_total - o.refunded_total, 'FM999G999G999')));
  end if;
  if restore and amt <> o.paid_total - o.refunded_total then perform public._fail('Solo se restaura el uso del código con un reembolso total.'); end if;
  insert into public.payments (order_id, kind, method, amount, reference, status, source, note, restore_promo, reviewed_by, reviewed_at, transfer_date)
  values (o.id, 'refund', public._clean(p ->> 'method', 40), amt, public._clean(p ->> 'reference', 80), 'approved', 'admin',
          public._clean(p ->> 'note', 300), restore, auth.uid(), now(), (now() at time zone 'America/Bogota')::date);
  if restore then
    update public.promo_redemptions set status = 'restored', released_at = now(), reason = 'reembolso total con restauración'
     where order_id = o.id and status in ('confirmed', 'void_kept', 'pending');
  end if;
  perform public._history(o.id, 'admin', 'Reembolso registrado', format('KOVA registró un reembolso de $%s.', to_char(amt, 'FM999G999G999')));
  perform public._recompute_financial(o.id, 'admin');
  perform public._audit('refund', 'orders', o.id::text, p);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.admin_request_new_proof(p_order uuid, p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform public._require_admin();
  select * into o from public.orders where id = p_order for update;
  if o.id is null then perform public._fail('Pedido no encontrado.'); end if;
  update public.orders set hold_expires_at = greatest(coalesce(hold_expires_at, now()), now() + interval '24 hours') where id = o.id;
  perform public._history(o.id, 'admin', 'KOVA solicita un nuevo comprobante',
    coalesce(nullif(public._clean(p_message, 300), ''), 'Sube un comprobante legible desde tu enlace de seguimiento.'));
  perform public._audit('request_new_proof', 'orders', o.id::text, jsonb_build_object('message', p_message));
  return jsonb_build_object('ok', true);
end; $$;

-- ---------- Estados de producción y cumplimiento ------------------------------------------------
create or replace function public._fulfillment_allowed(p_from text, p_to text) returns boolean language sql immutable as $$
  select case p_from
    when 'confirmed'     then p_to in ('in_production', 'packed', 'ready')
    when 'in_production' then p_to in ('quality_check', 'confirmed')
    when 'quality_check' then p_to in ('packed', 'in_production')
    when 'packed'        then p_to in ('ready', 'shipped', 'quality_check')
    when 'ready'         then p_to in ('shipped', 'delivered', 'packed')
    when 'shipped'       then p_to in ('delivered')
    else false end;
$$;

create or replace function public.admin_set_fulfillment(p_orders uuid[], p_status text, p_note text default '', p_tracking text default null, p_carrier text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; done integer := 0; skipped jsonb := '[]'::jsonb; oid uuid;
begin
  perform public._require_staff();
  if p_status in ('cancelled', 'expired', 'pending_confirmation') then perform public._fail('Usa la acción Cancelar pedido.'); end if;
  foreach oid in array p_orders loop
    select * into o from public.orders where id = oid for update;
    if o.id is null then continue; end if;
    if o.fulfillment_status = 'pending_confirmation' and p_status = 'confirmed' then
      if not public.is_admin() then skipped := skipped || jsonb_build_object('number', o.number, 'reason', 'Solo un administrador confirma pagos'); continue; end if;
      if o.paid_total < o.amount_due_now then skipped := skipped || jsonb_build_object('number', o.number, 'reason', 'Falta el pago requerido'); continue; end if;
      perform public._confirm_order(o.id, 'admin'); done := done + 1; continue;
    end if;
    if p_status = 'shipped' and o.kind in ('preorder', 'mixed') and o.paid_total - o.refunded_total < o.total then
      skipped := skipped || jsonb_build_object('number', o.number, 'reason', 'Tiene saldo pendiente'); continue;
    end if;
    if not public._fulfillment_allowed(o.fulfillment_status, p_status) then
      skipped := skipped || jsonb_build_object('number', o.number, 'reason', format('No se puede pasar de %s a %s', o.fulfillment_status, p_status)); continue;
    end if;
    update public.orders set fulfillment_status = p_status, updated_at = now(),
           tracking_number = coalesce(nullif(public._clean(p_tracking, 80), ''), tracking_number),
           carrier = coalesce(nullif(public._clean(p_carrier, 60), ''), carrier) where id = o.id;
    perform public._history(o.id, 'admin', 'Estado actualizado', public._clean(p_note, 300), null, null, o.fulfillment_status, p_status);
    done := done + 1;
  end loop;
  perform public._audit('fulfillment_bulk', 'orders', null, jsonb_build_object('status', p_status, 'count', done, 'orders', to_jsonb(p_orders)));
  return jsonb_build_object('updated', done, 'skipped', skipped);
end; $$;

create or replace function public.admin_cancel_order(p_order uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform public._require_admin();
  select * into o from public.orders where id = p_order for update;
  if o.id is null then perform public._fail('Pedido no encontrado.'); end if;
  if o.fulfillment_status in ('shipped', 'delivered') then perform public._fail('Un pedido enviado o entregado no se cancela: registra una devolución o reembolso.'); end if;
  if btrim(coalesce(p_reason, '')) = '' then perform public._fail('Escribe el motivo de la cancelación.'); end if;
  perform public._release_order(o.id, 'cancelled', 'admin', public._clean(p_reason, 300));
  perform public._audit('cancel', 'orders', o.id::text, jsonb_build_object('number', o.number, 'reason', p_reason, 'paid', o.paid_total));
  return jsonb_build_object('ok', true, 'paid_to_refund', o.paid_total - o.refunded_total);
end; $$;

create or replace function public.admin_add_note(p_order uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._require_staff();
  if btrim(coalesce(p_note, '')) = '' then perform public._fail('La nota está vacía.'); end if;
  perform public._history(p_order, 'admin', 'Nota interna', public._clean(p_note, 1000), null, null, null, null, false);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.admin_update_order(p_order uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; ship integer; due integer;
begin
  perform public._require_staff();
  select * into o from public.orders where id = p_order for update;
  if o.id is null then perform public._fail('Pedido no encontrado.'); end if;
  if p ? 'production_checklist' then
    update public.orders set production_checklist = p -> 'production_checklist', updated_at = now() where id = o.id;
  end if;
  if p ? 'tracking_number' or p ? 'carrier' then
    update public.orders set tracking_number = public._clean(coalesce(p ->> 'tracking_number', tracking_number), 80),
           carrier = public._clean(coalesce(p ->> 'carrier', carrier), 60), updated_at = now() where id = o.id;
    perform public._history(o.id, 'admin', 'Guía de envío actualizada', public._clean(p ->> 'tracking_number', 80));
  end if;
  if p ? 'shipping_amount' then
    perform public._require_admin();
    ship := nullif(p ->> 'shipping_amount', '')::int;
    if ship is not null and ship < 0 then perform public._fail('Valor de envío inválido.'); end if;
    due := o.amount_due_now;
    if o.fulfillment_status = 'pending_confirmation' and o.shipping_charge_at = 'reservation' then
      due := o.amount_due_now - coalesce(o.shipping_amount, 0) + coalesce(ship, 0);
    end if;
    update public.orders set shipping_amount = ship, total = subtotal_after + coalesce(ship, 0), amount_due_now = due, updated_at = now() where id = o.id;
    perform public._history(o.id, 'admin', 'Costo de envío definido', format('Envío: $%s.', to_char(coalesce(ship, 0), 'FM999G999G999')));
    perform public._recompute_financial(o.id, 'admin');
  end if;
  if p ? 'est_dispatch_date' then
    perform public._require_admin();
    update public.orders set est_dispatch_date = nullif(p ->> 'est_dispatch_date', '')::date where id = o.id;
    perform public._history(o.id, 'admin', 'Fecha estimada de despacho actualizada', coalesce(p ->> 'est_dispatch_date', ''));
  end if;
  perform public._audit('order_update', 'orders', o.id::text, p);
  return jsonb_build_object('ok', true);
end; $$;

-- URL firmada del comprobante: la crea el panel con supabase-js (storage.createSignedUrl); la
-- política "payment-proofs: personal lee" solo lo permite al personal.

-- ---------- Estadísticas -------------------------------------------------------------------------
create or replace function public._orders_in(p_from timestamptz, p_to timestamptz, p_campaign uuid, p_kind text, p_product text)
returns setof public.orders language sql stable security definer set search_path = public as $$
  select o.* from public.orders o
   where o.created_at >= coalesce(p_from, '-infinity') and o.created_at < coalesce(p_to, 'infinity')
     and (p_campaign is null or o.campaign_id = p_campaign)
     and (p_kind is null or p_kind = '' or o.kind = p_kind or exists (select 1 from public.order_items i where i.order_id = o.id and i.kind = p_kind))
     and (p_product is null or p_product = '' or exists (select 1 from public.order_items i where i.order_id = o.id and i.product_id = p_product));
$$;

create or replace function public.admin_dashboard(p_from timestamptz default null, p_to timestamptz default null,
  p_campaign uuid default null, p_kind text default null, p_product text default null, p_bucket text default 'day')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare res jsonb; b text := case when p_bucket in ('day', 'week', 'month') then p_bucket else 'day' end; tz text := 'America/Bogota';
begin
  perform public._require_admin();
  create temp table if not exists _o on commit drop as select * from public.orders limit 0;
  truncate _o;
  insert into _o select * from public._orders_in(p_from, p_to, p_campaign, p_kind, p_product);
  with
  live as (select * from _o where fulfillment_status not in ('cancelled', 'expired')),
  conf as (select * from _o where fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired')),
  items as (select i.*, o.fulfillment_status, o.created_at as ocreated from public.order_items i join _o o on o.id = i.order_id),
  pays as (select pm.* from public.payments pm join _o o on o.id = pm.order_id where pm.status = 'approved')
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'committed_sales', (select coalesce(sum(total), 0) from conf),
      'collected', (select coalesce(sum(amount) filter (where kind <> 'refund'), 0) - coalesce(sum(amount) filter (where kind = 'refund'), 0) from pays),
      'deposits', (select coalesce(sum(amount), 0) from pays where kind = 'deposit'),
      'refunds', (select coalesce(sum(amount), 0) from pays where kind = 'refund'),
      'balance_due', (select coalesce(sum(greatest(total - paid_total + refunded_total, 0)), 0) from conf),
      'orders_pending', (select count(*) from _o where fulfillment_status = 'pending_confirmation'),
      'orders_confirmed', (select count(*) from conf),
      'orders_cancelled', (select count(*) from _o where fulfillment_status = 'cancelled'),
      'orders_expired', (select count(*) from _o where fulfillment_status = 'expired'),
      'proofs_to_review', (select count(*) from public.payments pm join _o o on o.id = pm.order_id where pm.status in ('submitted', 'verifying')),
      'verification_overdue', (select count(*) from _o where fulfillment_status = 'pending_confirmation' and verification_expires_at < now()),
      'units_sold', (select coalesce(sum(qty), 0) from items where fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired')),
      'units_reserved', (select coalesce(sum(qty), 0) from items where fulfillment_status = 'pending_confirmation'),
      'units_to_produce', (select coalesce(sum(qty), 0) from items where kind in ('preorder', 'custom') and fulfillment_status in ('confirmed', 'in_production', 'quality_check')),
      'promo_active', (select count(*) from public.promo_codes where status = 'active'),
      'promo_confirmed_uses', (select count(*) from public.promo_redemptions r join _o o on o.id = r.order_id where r.status in ('confirmed', 'void_kept')),
      'discount_given', (select coalesce(sum(discount_total), 0) from conf),
      'production_cost', (select coalesce(sum(unit_cost * qty), 0) from items where unit_cost is not null and fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired')),
      'units_without_cost', (select coalesce(sum(qty), 0) from items where unit_cost is null and fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired')),
      'revenue_with_cost', (select coalesce(sum(line_final), 0) from items where unit_cost is not null and fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired'))
    ),
    'series', (select coalesce(jsonb_agg(s order by s ->> 'bucket'), '[]'::jsonb) from (
       select jsonb_build_object('bucket', to_char(date_trunc(b, created_at at time zone tz), 'YYYY-MM-DD'),
         'orders', count(*), 'committed', coalesce(sum(total) filter (where fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired')), 0),
         'created_value', coalesce(sum(total), 0)) s
       from _o group by date_trunc(b, created_at at time zone tz)) x),
    'collected_series', (select coalesce(jsonb_agg(s order by s ->> 'bucket'), '[]'::jsonb) from (
       select jsonb_build_object('bucket', to_char(date_trunc(b, coalesce(reviewed_at, created_at) at time zone tz), 'YYYY-MM-DD'),
         'collected', coalesce(sum(amount) filter (where kind <> 'refund'), 0) - coalesce(sum(amount) filter (where kind = 'refund'), 0)) s
       from pays group by date_trunc(b, coalesce(reviewed_at, created_at) at time zone tz)) x),
    'top_products', (select coalesce(jsonb_agg(s order by (s ->> 'units')::int desc), '[]'::jsonb) from (
       select jsonb_build_object('name', name, 'units', sum(qty), 'revenue', sum(line_final)) s from items
        where fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired') group by name) x),
    'sizes', (select coalesce(jsonb_agg(s order by (s ->> 'units')::int desc), '[]'::jsonb) from (
       select jsonb_build_object('label', nullif(size, ''), 'units', sum(qty)) s from items
        where fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired') group by size) x),
    'colors', (select coalesce(jsonb_agg(s order by (s ->> 'units')::int desc), '[]'::jsonb) from (
       select jsonb_build_object('label', nullif(color, ''), 'units', sum(qty)) s from items
        where fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired') group by color) x),
    'by_campaign', (select coalesce(jsonb_agg(s), '[]'::jsonb) from (
       select jsonb_build_object('name', coalesce(c.name, 'Venta normal / Custom'), 'orders', count(*),
         'committed', coalesce(sum(o.total) filter (where o.fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired')), 0),
         'collected', coalesce(sum(o.paid_total - o.refunded_total), 0)) s
       from _o o left join public.preorder_campaigns c on c.id = o.campaign_id group by c.name) x),
    'by_promo', (select coalesce(jsonb_agg(s), '[]'::jsonb) from (
       select jsonb_build_object('code', o.promo_code, 'orders', count(*), 'discount', sum(o.discount_total),
         'committed', coalesce(sum(o.total) filter (where o.fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired')), 0)) s
       from _o o where o.promo_code is not null group by o.promo_code) x),
    'status_financial', (select coalesce(jsonb_object_agg(financial_status, n), '{}'::jsonb) from (select financial_status, count(*) n from _o group by 1) x),
    'status_fulfillment', (select coalesce(jsonb_object_agg(fulfillment_status, n), '{}'::jsonb) from (select fulfillment_status, count(*) n from _o group by 1) x),
    'conversion', jsonb_build_object('created', (select count(*) from _o),
       'confirmed', (select count(*) from _o where confirmed_at is not null),
       'expired', (select count(*) from _o where fulfillment_status = 'expired'))
  ) into res;
  return res;
end; $$;

create or replace function public.admin_promo_stats(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pc public.promo_codes; res jsonb;
begin
  perform public._require_admin();
  select * into pc from public.promo_codes where id = p_id;
  if pc.id is null then perform public._fail('Código no encontrado.'); end if;
  with red as (select r.*, o.number, o.full_name, o.email, o.total, o.subtotal_original, o.paid_total, o.refunded_total,
                      o.financial_status, o.fulfillment_status, o.created_at as ordered_at
                 from public.promo_redemptions r join public.orders o on o.id = r.order_id where r.promo_id = pc.id),
       conf as (select * from red where status in ('confirmed', 'void_kept')),
       apps as (select * from public.promo_applications where promo_id = pc.id)
  select jsonb_build_object(
    'applications', (select count(*) from apps where valid),
    'applications_unique', (select count(distinct client_hash) from apps where valid),
    'failed_attempts', (select count(*) from apps where not valid),
    'pending_orders', (select count(*) from red where status = 'pending'),
    'confirmed_uses', (select count(*) from conf),
    'released', (select count(*) from red where status in ('released', 'restored')),
    'unique_customers', (select count(distinct customer_id) from conf),
    'units', (select coalesce(sum(i.qty), 0) from public.order_items i join conf on conf.order_id = i.order_id),
    'revenue_before', (select coalesce(sum(subtotal_original), 0) from conf),
    'revenue_after', (select coalesce(sum(total), 0) from conf),
    'discount_total', (select coalesce(sum(discount_amount), 0) from conf),
    'collected', (select coalesce(sum(paid_total - refunded_total), 0) from conf),
    'balance_due', (select coalesce(sum(greatest(total - paid_total + refunded_total, 0)), 0) from conf),
    'est_profit', (select case when count(*) filter (where i.unit_cost is null) = 0 and count(*) > 0
                          then sum(i.line_final - i.unit_cost * i.qty) end
                     from public.order_items i join conf on conf.order_id = i.order_id),
    'items_without_cost', (select count(*) from public.order_items i join conf on conf.order_id = i.order_id where i.unit_cost is null),
    'conversion_pct', (select case when count(distinct client_hash) > 0
                          then round((select count(*) from conf) * 100.0 / count(distinct client_hash), 1) end from apps where valid),
    'commission', (select round(coalesce(sum(total), 0) * coalesce(pc.commission_pct, 0) / 100.0) + count(*) * coalesce(pc.commission_fixed, 0) from conf),
    'series', (select coalesce(jsonb_agg(s order by s ->> 'day'), '[]'::jsonb) from (
       select jsonb_build_object('day', d, 'applications', sum(a), 'confirmed', sum(c), 'discount', sum(ds)) s from (
         select to_char(created_at at time zone 'America/Bogota', 'YYYY-MM-DD') d, 1 a, 0 c, 0 ds from apps where valid
         union all
         select to_char(coalesce(confirmed_at, created_at) at time zone 'America/Bogota', 'YYYY-MM-DD'), 0, 1, discount_amount from conf) u
       group by d) x),
    'uses', (select coalesce(jsonb_agg(jsonb_build_object('order_id', order_id, 'number', number, 'name', full_name, 'email', email,
        'status', status, 'at', ordered_at, 'original', subtotal_original, 'discount', discount_amount, 'total', total,
        'financial_status', financial_status, 'fulfillment_status', fulfillment_status,
        'customer_uses', (select count(*) from red r2 where r2.customer_id = red.customer_id and r2.status in ('pending', 'confirmed', 'void_kept')),
        'products', (select string_agg(i.name || coalesce(' ' || nullif(i.size, ''), '') || ' ×' || i.qty, ', ') from public.order_items i where i.order_id = red.order_id))
        order by ordered_at desc), '[]'::jsonb) from red)
  ) into res;
  return res;
end; $$;

create or replace function public.admin_production(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform public._require_staff();
  with it as (
    select i.*, o.fulfillment_status fs from public.order_items i join public.orders o on o.id = i.order_id
     where (p_campaign is null and i.kind in ('preorder', 'custom')) or i.campaign_id = p_campaign
  ), c as (select * from it where fs not in ('pending_confirmation', 'cancelled', 'expired'))
  select jsonb_build_object(
    'confirmed_units', (select coalesce(sum(qty), 0) from c),
    'reserved_units', (select coalesce(sum(qty), 0) from it where fs = 'pending_confirmation'),
    'pending_production', (select coalesce(sum(qty), 0) from c where fs in ('confirmed', 'in_production')),
    'finished', (select coalesce(sum(qty), 0) from c where fs in ('quality_check', 'packed', 'ready', 'shipped', 'delivered')),
    'packed', (select coalesce(sum(qty), 0) from c where fs in ('packed', 'ready', 'shipped', 'delivered')),
    'delivered', (select coalesce(sum(qty), 0) from c where fs = 'delivered'),
    'by_design', (select coalesce(jsonb_agg(jsonb_build_object('label', name, 'units', u) order by u desc), '[]'::jsonb)
                    from (select name, sum(qty) u from c group by name) x),
    'by_size', (select coalesce(jsonb_agg(jsonb_build_object('label', size, 'units', u) order by size), '[]'::jsonb)
                    from (select size, sum(qty) u from c group by size) x),
    'by_color', (select coalesce(jsonb_agg(jsonb_build_object('label', color, 'units', u) order by u desc), '[]'::jsonb)
                    from (select color, sum(qty) u from c group by color) x),
    'matrix', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'size', size, 'color', color, 'units', u) order by name, color, size), '[]'::jsonb)
                    from (select name, size, color, sum(qty) u from c group by name, size, color) x),
    'materials', (select coalesce(jsonb_agg(jsonb_build_object('material', mname, 'unit', munit, 'qty', mqty) order by mname), '[]'::jsonb)
                    from (select m ->> 'name' mname, m ->> 'unit' munit, round(sum(coalesce((m ->> 'qty')::numeric, 0) * c.qty), 2) mqty
                            from c join public.product_costs pc on pc.product_id = c.product_id
                            cross join lateral jsonb_array_elements(pc.materials) m group by 1, 2) x),
    'products_without_materials', (select coalesce(jsonb_agg(distinct c.name), '[]'::jsonb) from c
                    left join public.product_costs pc on pc.product_id = c.product_id
                    where pc.product_id is null or jsonb_array_length(pc.materials) = 0)
  ) into res;
  return res;
end; $$;


-- Pedidos para producción SIN datos personales ni montos: número, estado, ciudad, artículos y checklist.
create or replace function public.admin_production_orders(p_campaign uuid default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'number', o.number, 'kind', o.kind, 'campaign_id', o.campaign_id,
      'financial_status', o.financial_status, 'fulfillment_status', o.fulfillment_status,
      'created_at', o.created_at, 'confirmed_at', o.confirmed_at, 'est_dispatch_date', o.est_dispatch_date,
      'city', o.city, 'department', o.department, 'shipping_label', o.shipping_label,
      'balance_due', (o.total - (o.paid_total - o.refunded_total)) > 0,
      'tracking_number', o.tracking_number, 'carrier', o.carrier, 'checklist', o.production_checklist,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'kind', i.kind, 'size', i.size, 'color', i.color,
                  'qty', i.qty, 'custom', i.custom) order by i.line_no), '[]'::jsonb) from public.order_items i where i.order_id = o.id)
    ) order by o.est_dispatch_date nulls last, o.created_at)
    from public.orders o
    where o.fulfillment_status not in ('pending_confirmation', 'cancelled', 'expired')
      and (p_campaign is null or o.campaign_id = p_campaign or exists (select 1 from public.order_items i where i.order_id = o.id and i.campaign_id = p_campaign))
      and (p_status is null or p_status = '' or o.fulfillment_status = p_status)
  ), '[]'::jsonb);
end; $$;

-- ---------- Permisos ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like '\_%' escape '\') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'admin\_%' escape '\' or p.proname = 'promo_profit_preview') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.close_finished_campaigns() from public, anon, authenticated;

-- ---------- Tareas programadas (pg_cron) ------------------------------------------------------
-- Cada 5 minutos: vence reservas sin pago y cierra campañas cuya fecha de cierre pasó.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('kova-vencer-reservas', '*/5 * * * *', 'select public.expire_stale_orders(); select public.close_finished_campaigns();');
exception when others then
  raise notice 'pg_cron no disponible (%): las reservas se vencen igualmente al visitar la tienda o crear pedidos.', sqlerrm;
end $$;

-- ---------- Campaña inicial PSYCHE_01 (BORRADOR) ------------------------------------------------
-- Sin fechas, límites ni cupos: se configuran en el panel antes de activarla. Los productos actuales
-- del drop quedan vinculados, pero la tienda NO cambia hasta que la campaña se active.
insert into public.preorder_campaigns (slug, name, drop_name, description, status, deposit_pct, allow_full_payment, allow_promo_codes, order_prefix)
values ('psyche-01', 'PSYCHE_01', 'PSYCHE_01', '', 'draft', 50, true, true, 'PSY')
on conflict (slug) do nothing;
insert into public.preorder_products (campaign_id, product_id, position)
select c.id, p.id, p.position from public.preorder_campaigns c cross join public.products p
 where c.slug = 'psyche-01' and c.status = 'draft' and p.tag = 'DROP 01' and p.published
on conflict do nothing;
