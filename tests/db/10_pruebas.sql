-- Pruebas funcionales y de seguridad de las migraciones (Postgres local con stub de Supabase).
-- Cada bloque lanza una excepción si una expectativa falla. Ejecutar con tests/db/run.sh
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema if not exists t;
create or replace function t.as_anon() returns void language sql as $$ select set_config('role', 'anon', false), set_config('request.jwt.claim.sub', '', false); $$;
create or replace function t.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); $$;
create or replace function t.oid(n text) returns uuid language sql security definer as $$ select id from public.orders where number = n $$;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALLÓ: %', msg; end if; raise notice 'ok  %', msg; end; $$;
-- Ejecuta sql y exige que falle con un mensaje que contenga pat.
create or replace function t.fails(q text, pat text, msg text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm ilike '%' || pat || '%' then raise notice 'ok  %  (%)', msg, left(sqlerrm, 90); return; end if;
    raise exception 'FALLÓ: % — error inesperado: %', msg, sqlerrm;
  end;
  raise exception 'FALLÓ: % — debía fallar', msg;
end; $$;
grant usage on schema t to anon, authenticated; grant execute on all functions in schema t to anon, authenticated;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d4', 'prod2@test') on conflict do nothing;
insert into public.admins (user_id, role) values ('00000000-0000-0000-0000-0000000000b2', 'production') on conflict do nothing;
-- Producto de venta normal con inventario de 1 unidad (para probar el último cupo).
insert into public.products (id, name, category, price, sizes, colors) values ('tee-normal', 'Tee Normal', 'shirts', 80000, '["M"]', '[]');
update public.product_variants set stock_on_hand = 1, cost = 30000 where product_id = 'tee-normal';
insert into public.product_costs (product_id, unit_cost, materials) values ('anima-aetherna', 35000, '[{"name":"Camiseta blanca","unit":"und","qty":1},{"name":"Tinta DTF","unit":"ml","qty":12.5}]');

create or replace function t.cart(p text, sz text, col text, q int default 1) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('product_id', p, 'size', sz, 'color', col, 'qty', q, 'unit_price', 1)) $$;
create or replace function t.order_payload(items jsonb, k text, code text default '', plan text default 'deposit', email text default 'ana@test.co') returns jsonb language sql as $$
  select jsonb_build_object('idempotency_key', k, 'items', items, 'promo_code', code, 'payment_plan', plan, 'payment_method', 'nu',
    'shipping_method', 'coordinar', 'accept_terms', true, 'accept_data', true,
    'buyer', jsonb_build_object('full_name', 'Ana María Pérez', 'email', email, 'whatsapp', '3' || lpad((abs(hashtext(email)) % 1000000000)::text, 9, '0'),
      'department', 'Valle del Cauca', 'city', 'Cali', 'address', 'Calle 5 # 10-20', 'notes', '<script>x</script>'))
$$;

-- ============ 1. Seguridad básica ============
select t.as_anon();
select t.fails('select * from public.orders', 'permission denied', 'anon no lee pedidos');
select t.fails('select * from public.customers', 'permission denied', 'anon no lee clientes');
select t.fails('select * from public.promo_codes', 'permission denied', 'anon no lista códigos promocionales');
select t.fails('select * from public.payments', 'permission denied', 'anon no lee pagos');
select t.fails('select * from public.product_costs', 'permission denied', 'anon no ve costos');
select t.fails($$insert into public.promo_codes (code, discount_type, percent, status) values ('HACK', 'percent', 100, 'active')$$, 'permission denied', 'anon no crea códigos');
select t.fails($$select public.admin_cancel_order(gen_random_uuid(), 'x')$$, 'permission denied', 'anon no ejecuta funciones del panel');
select t.fails($$select public.expire_stale_orders()$$, 'permission denied', 'anon no ejecuta tareas internas');
select t.fails($$select public._confirm_order(gen_random_uuid(), 'x')$$, 'permission denied', 'anon no llama funciones internas');
reset role;
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000c3');
select t.ok((select count(*) from public.orders) = 0, 'usuario sin rol no ve pedidos (RLS)');
select t.fails($$select public.admin_set_fulfillment(array[gen_random_uuid()], 'packed')$$, 'permiso', 'usuario sin rol no cambia estados');
select t.fails($$insert into public.promo_codes (code, discount_type, percent) values ('HACK2', 'percent', 50)$$, 'row-level security', 'usuario sin rol no crea códigos');
reset role;

-- ============ 2. Campaña PSYCHE_01: borrador sin datos inventados ============
select t.ok((select status from public.preorder_campaigns where slug = 'psyche-01') = 'draft', 'PSYCHE_01 se crea en borrador');
select t.ok((select opens_at is null and closes_at is null and max_units is null and est_dispatch_date is null from public.preorder_campaigns where slug = 'psyche-01'), 'sin fechas ni límites inventados');
select t.ok((select count(*) from public.preorder_products pp join public.preorder_campaigns c on c.id = pp.campaign_id where c.slug = 'psyche-01') = 2, 'productos reales del drop vinculados');
select t.ok((select bool_and(sale_mode = 'normal') from public.products where id in ('anima-aetherna', 'per-aspera-ad-astra')), 'la tienda no cambia mientras la campaña sea borrador');
select t.ok((select count(*) from public.promo_codes) = 0, 'no se crean códigos promocionales automáticamente');

set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.fails($$select public.admin_campaign_status((select id from public.preorder_campaigns where slug='psyche-01'), 'active')$$, 'Antes de activar la campaña configura: fecha y hora de apertura', 'no se activa sin configurar fechas');
update public.preorder_campaigns set opens_at = now() - interval '1 hour', closes_at = now() + interval '7 days',
  est_dispatch_date = current_date + 30, hold_minutes = 120, max_units = 3, max_per_customer = 1, show_availability = true where slug = 'psyche-01';
select t.ok((select (public.admin_campaign_status((select id from public.preorder_campaigns where slug='psyche-01'), 'active')) ->> 'ok')::boolean, 'campaña se activa con datos completos');
select t.ok((select bool_and(sale_mode = 'preorder') from public.products where id in ('anima-aetherna', 'per-aspera-ad-astra')), 'productos pasan a Preventa al activar');
reset role;

-- ============ 3. Tienda: preventa, anticipo, código ============
select t.as_anon();
select t.ok((select (public.get_storefront() -> 'campaigns' -> 0 ->> 'phase') = 'open'), 'storefront muestra la preventa abierta');
select t.ok((select (public.get_storefront() -> 'campaigns' -> 0 ->> 'remaining')::int = 3), 'cupos reales visibles (3)');
do $$ declare r jsonb; o record; begin
  r := public.create_order(t.order_payload(t.cart('anima-aetherna', 'M', 'Arena'), 'k-aaaaaaaaaaaaaaaa1'));
  perform t.ok(r ->> 'number' = 'KOVA-PSY-000001', 'número de pedido KOVA-PSY-000001');
  perform t.ok(length(r ->> 'token') = 64, 'token privado de 256 bits');
  perform set_config('t.tok1', r ->> 'token', false);
end $$;
reset role;
select t.ok((select total = 72000 and amount_due_now = 36000 and financial_status = 'pending_payment' and fulfillment_status = 'pending_confirmation'
             from public.orders where number = 'KOVA-PSY-000001'), 'preventa $72.000 → anticipo 50% $36.000, pendiente de pago');
select t.ok((select unit_price = 72000 from public.order_items i join public.orders o on o.id = i.order_id where o.number = 'KOVA-PSY-000001'), 'el precio enviado por el navegador (1) se ignora');
select t.ok((select delivery_notes not like '%<%' from public.orders where number = 'KOVA-PSY-000001'), 'formulario sanitizado (sin < >)');
select t.ok((select whatsapp ~ '^573[0-9]{9}$' from public.orders where number = 'KOVA-PSY-000001'), 'WhatsApp normalizado con indicativo');

-- Código KOVA10 creado por el admin (inactivo por defecto)
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.promo_codes (code, name, discount_type, percent) values ('kova10', 'Prueba', 'percent', 10);
select t.ok((select status from public.promo_codes where code_norm = 'KOVA10') = 'inactive', 'código nuevo queda inactivo');
select t.fails($$insert into public.promo_codes (code, discount_type, percent) values ('KoVa10', 'percent', 5)$$, 'duplicate', 'códigos únicos sin distinguir mayúsculas');
reset role;
select t.as_anon();
select t.ok((public.validate_promo('kova10', t.cart('anima-aetherna', 'M', 'Arena')) ->> 'reason') = 'inactive', 'código inactivo rechazado');
select t.ok((public.validate_promo('NOEXISTE', t.cart('anima-aetherna', 'M', 'Arena')) ->> 'reason') = 'not_found', 'código inexistente rechazado');
reset role;
update public.promo_codes set status = 'active' where code_norm = 'KOVA10';
select t.as_anon();
do $$ declare r jsonb; begin
  r := public.validate_promo('Kova10', t.cart('anima-aetherna', 'S', 'Arena'));
  perform t.ok((r ->> 'discount')::int = 7200 and (r #>> '{quote,total}')::int = 64800 and (r #>> '{quote,amount_due_now}')::int = 32400,
    'KOVA10: -$7.200 → total $64.800, anticipo $32.400 (descuento antes del anticipo)');
end $$;
reset role;
select t.ok((select count(*) from public.promo_redemptions) = 0, 'aplicar en el carrito no consume usos');
select t.as_anon();
select public.create_order(t.order_payload(t.cart('anima-aetherna', 'S', 'Arena'), 'k-aaaaaaaaaaaaaaaa2', 'KOVA10', 'deposit', 'beto@test.co'));
reset role;
select t.ok((select total = 64800 and amount_due_now = 32400 and discount_total = 7200 and promo_code = 'KOVA10' from public.orders where number = 'KOVA-PSY-000002'), 'pedido con KOVA10 guarda precio, descuento y anticipo');
select t.ok((select status from public.promo_redemptions) = 'pending', 'el uso queda reservado (pendiente) al crear el pedido');
select t.ok((select terms_snapshot -> 'campaign' ->> 'deposit_pct' = '50' from public.orders where number = 'KOVA-PSY-000002'), 'copia histórica de condiciones');

-- Idempotencia (doble clic / reintento)
select t.as_anon();
select t.ok((public.create_order(t.order_payload(t.cart('anima-aetherna', 'S', 'Arena'), 'k-aaaaaaaaaaaaaaaa2', 'KOVA10')) ->> 'duplicate')::boolean, 'reintento con la misma clave no duplica');
reset role;
select t.ok((select count(*) from public.orders) = 2, 'siguen existiendo 2 pedidos');

-- Límites de la campaña: max 3 unidades, máximo 2 por cliente
select t.as_anon();
select t.fails($$select public.create_order(t.order_payload(t.cart('per-aspera-ad-astra', 'M', 'Beige', 1), 'k-aaaaaaaaaaaaaaaa3', '', 'deposit', 'ana@test.co'))$$, 'Máximo 1 unidades por cliente', 'límite por cliente (ana ya tiene 1)');
select t.fails($$select public.create_order(t.order_payload(t.cart('per-aspera-ad-astra', 'M', 'Beige', 2), 'k-aaaaaaaaaaaaaaaa4', '', 'deposit', 'caro@test.co'))$$, 'Solo quedan 1 cupos', 'límite total de la campaña');
select public.create_order(t.order_payload(t.cart('per-aspera-ad-astra', 'M', 'Beige', 1), 'k-aaaaaaaaaaaaaaaa5', '', 'full', 'caro@test.co'));
select t.ok((public.get_storefront() -> 'campaigns' -> 0 ->> 'phase') = 'sold_out', 'cierre automático al llegar al límite');
select t.fails($$select public.create_order(t.order_payload(t.cart('per-aspera-ad-astra', 'S', 'Beige', 1), 'k-aaaaaaaaaaaaaaaa6', '', 'deposit', 'dani@test.co'))$$, 'límite de unidades', 'sin cupos no se reserva');
reset role;
select t.ok((select amount_due_now = total and total = 72000 from public.orders where number = 'KOVA-PSY-000003'), 'pago completo en preventa cobra el 100%');

-- Vencimiento: el pedido 1 vence y libera su cupo
update public.orders set hold_expires_at = now() - interval '1 minute' where number = 'KOVA-PSY-000001';
select t.ok(public.expire_stale_orders() = 1, 'vence 1 reserva sin pago');
select t.ok((select fulfillment_status = 'expired' from public.orders where number = 'KOVA-PSY-000001'), 'reserva vencida');
select t.as_anon();
select t.ok((public.get_storefront() -> 'campaigns' -> 0 ->> 'remaining')::int = 1, 'el cupo vencido se libera');
reset role;

-- ============ 4. Comprobante y aprobación ============
-- (el token se calcula como lo devolvió create_order; las pruebas lo obtienen con privilegios de prueba)
select set_config('t.tok2', public._token_for('k-aaaaaaaaaaaaaaaa2'), false);
select set_config('t.tok3', public._token_for('k-aaaaaaaaaaaaaaaa5'), false);
select t.as_anon();
select t.fails($$select public.get_order_public('KOVA-PSY-000002')$$, 'inválido', 'el número de pedido solo no da acceso');
select t.fails($$select public.get_order_public(repeat('a', 64))$$, 'No encontramos', 'token incorrecto no da acceso');
select t.ok((public.get_order_public(current_setting('t.tok2')) ->> 'number') = 'KOVA-PSY-000002', 'seguimiento con token privado');
select t.ok((public.get_order_public(current_setting('t.tok2')) -> 'buyer' ->> 'whatsapp_tail') ~ '^[0-9]{4}$', 'datos personales enmascarados en el seguimiento');
do $$ declare up jsonb; begin
  up := public.request_proof_upload(current_setting('t.tok2'), 'jpg');
  perform set_config('t.path2', up ->> 'path', false);
end $$;
insert into storage.objects (bucket_id, name) values ('payment-proofs', current_setting('t.path2'));
select t.fails($$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'otro/archivo.jpg')$$, 'row-level security', 'no se puede subir fuera del cupo reservado');
select t.ok((select count(*) from storage.objects where bucket_id = 'payment-proofs') = 0, 'anon no puede ver comprobantes');
select public.submit_payment_proof(current_setting('t.tok2'), jsonb_build_object('path', current_setting('t.path2'), 'sha256', repeat('ab', 32),
  'amount', 32400, 'reference', 'M123', 'transfer_date', current_date::text));
reset role;
select t.ok((select financial_status = 'proof_received' and fulfillment_status = 'pending_confirmation' from public.orders where number = 'KOVA-PSY-000002'),
  'subir comprobante NO confirma la reserva');
select t.as_anon();
do $$ declare up jsonb; begin
  up := public.request_proof_upload(current_setting('t.tok3'), 'png');
  insert into storage.objects (bucket_id, name) values ('payment-proofs', up ->> 'path');
  perform set_config('t.path3', up ->> 'path', false);
end $$;
select t.fails($$select public.submit_payment_proof(current_setting('t.tok3'), jsonb_build_object('path', current_setting('t.path3'), 'sha256', repeat('ab', 32), 'amount', 72000, 'reference', 'X', 'transfer_date', current_date::text))$$,
  'ya fue registrado', 'un mismo comprobante no sirve para dos pedidos');
select t.fails($$select public.submit_payment_proof(current_setting('t.tok3'), jsonb_build_object('path', current_setting('t.path3'), 'sha256', repeat('cd', 32), 'amount', 999999, 'reference', 'X', 'transfer_date', current_date::text))$$,
  'no puede superar', 'no se registra un valor mayor al saldo');
reset role;

set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.fails($$select public.admin_review_payment((select id from public.payments limit 1), 'approve')$$, 'permiso', 'producción no aprueba pagos');
select t.ok((select count(*) from public.orders) = 0, 'producción NO lee pedidos con datos personales');
select t.ok((select count(*) from public.customers) = 0 and (select count(*) from public.payments) = 0, 'producción NO lee clientes ni pagos');
select t.ok(public.admin_production_orders() is not null and public.admin_production_orders()::text !~ '@', 'producción ve sus pedidos sin correos ni teléfonos');
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select public.admin_review_payment((select id from public.payments where amount = 32400), 'approve');
reset role;
select t.ok((select financial_status = 'deposit_confirmed' and fulfillment_status = 'confirmed' from public.orders where number = 'KOVA-PSY-000002'), 'admin aprueba → anticipo confirmado + reserva confirmada');
select t.ok((select status from public.promo_redemptions) = 'confirmed', 'el uso del código se confirma con el pago');
select t.ok((select public.get_order_public(current_setting('t.tok2')) ->> 'balance')::int = 32400, 'saldo pendiente $32.400');

-- Envío bloqueado con saldo, transiciones válidas
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.ok((public.admin_set_fulfillment(array[t.oid('KOVA-PSY-000002')], 'shipped') ->> 'updated')::int = 0, 'no se envía con saldo pendiente');
select t.ok((public.admin_set_fulfillment(array[t.oid('KOVA-PSY-000002')], 'delivered') ->> 'updated')::int = 0, 'transición inválida rechazada (confirmado → entregado)');
select t.ok((public.admin_set_fulfillment(array[t.oid('KOVA-PSY-000002')], 'in_production') ->> 'updated')::int = 1, 'producción mueve a En producción');
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select public.admin_add_payment((select id from public.orders where number='KOVA-PSY-000002'), '{"kind":"balance","amount":32400,"method":"nu","reference":"M999"}');
reset role;
select t.ok((select financial_status = 'paid' and paid_total = 64800 from public.orders where number = 'KOVA-PSY-000002'), 'saldo registrado → pago completo');
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.fails($$select public.admin_add_payment((select id from public.orders where number='KOVA-PSY-000002'), '{"kind":"extra","amount":1000,"method":"nu","reference":"m999"}')$$, 'ya fue aprobada', 'misma referencia no se aprueba dos veces');
reset role;

-- Reembolso parcial y cancelación con pago: el uso se conserva
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000a1');
select public.admin_refund((select id from public.orders where number='KOVA-PSY-000002'), '{"amount":10000,"method":"nu","note":"ajuste"}');
reset role;
select t.ok((select financial_status = 'partial_refund' and refunded_total = 10000 from public.orders where number = 'KOVA-PSY-000002'), 'reembolso parcial');
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000a1');
select public.admin_cancel_order((select id from public.orders where number='KOVA-PSY-000002'), 'Cliente desiste');
reset role;
select t.ok((select status from public.promo_redemptions) = 'void_kept', 'cancelar tras pago confirmado conserva el uso (no se reutiliza)');
select t.ok((select count(*) from public.order_history h join public.orders o on o.id = h.order_id where o.number = 'KOVA-PSY-000002') >= 6, 'historial del pedido completo');
select t.ok((select count(*) from public.audit_logs where action in ('refund', 'cancel', 'payment_approve')) >= 3, 'acciones administrativas auditadas');

-- ============ 5. Códigos: límites ============
update public.promo_codes set max_uses = 1 where code_norm = 'KOVA10';
select t.as_anon();
select t.ok((public.validate_promo('KOVA10', t.cart('tee-normal', 'M', '')) ->> 'reason') = 'exhausted', 'código con usos agotados (void_kept cuenta)');
reset role;
insert into public.promo_codes (code, discount_type, fixed_amount, status, product_ids, applies_preorder) values ('FIJO5', 'fixed', 5000, 'active', array['tee-normal'], false);
insert into public.promo_codes (code, discount_type, percent, status, ends_at, starts_at) values ('VENCIDO', 'percent', 15, 'active', now() - interval '1 day', now() - interval '5 days');
insert into public.promo_codes (code, discount_type, percent, status, max_uses_per_customer) values ('GRATIS', 'percent', 100, 'active', 1);
insert into public.promo_codes (code, discount_type, percent, status, min_subtotal) values ('MIN200', 'percent', 10, 'active', 200000);
select t.as_anon();
select t.ok((public.validate_promo('VENCIDO', t.cart('tee-normal', 'M', '')) ->> 'reason') = 'expired', 'código vencido');
select t.ok((public.validate_promo('FIJO5', t.cart('tee-normal', 'M', '')) ->> 'discount')::int = 5000, 'descuento fijo $5.000');
select t.ok((public.validate_promo('MIN200', t.cart('tee-normal', 'M', '')) ->> 'reason') = 'min_subtotal', 'valor mínimo de compra');
select t.ok((public.validate_promo('FIJO5', jsonb_build_array(jsonb_build_object('custom', jsonb_build_object('mode','mini','color','negro','size','M'), 'qty', 1))) ->> 'reason') = 'not_applicable', 'código exclusivo de producto no aplica a otros');
do $$ declare r jsonb; begin
  r := public.create_order(t.order_payload(t.cart('tee-normal', 'M', ''), 'k-bbbbbbbbbbbbbbbb1', 'GRATIS', 'full', 'eva@test.co'));
  perform t.ok(r ->> 'number' = 'KOVA-WEB-000001', 'venta normal usa prefijo WEB');
end $$;
reset role;
select t.ok((select total = 0 and financial_status = 'paid' and fulfillment_status = 'pending_confirmation' from public.orders where number = 'KOVA-WEB-000001'), 'descuento 100%: total $0, espera confirmación manual');
select t.ok((select stock_reserved = 1 from public.product_variants where product_id = 'tee-normal'), 'inventario reservado temporalmente');
select t.as_anon();
select t.fails($$select public.create_order(t.order_payload(t.cart('tee-normal', 'M', ''), 'k-bbbbbbbbbbbbbbbb2', '', 'full', 'fer@test.co'))$$, 'solo quedan 0', 'último cupo de inventario no se vende dos veces');
select t.ok((public.validate_promo('GRATIS', t.cart('anima-aetherna', 'M', 'Arena'), 'EVA@test.co') ->> 'reason') = 'customer_limit', 'límite de usos por cliente (correo normalizado)');
-- KOVA CUSTOM con precio del servidor y carrito mixto
select t.ok((public.quote_cart(jsonb_build_array(jsonb_build_object('custom', jsonb_build_object('mode','mini','color','negro','size','M'), 'qty', 2))) #>> '{quote,total}')::int = 118000, 'KOVA CUSTOM MINI ×2 = $118.000 (precio oficial)');
select t.fails($$select public.quote_cart(jsonb_build_array(jsonb_build_object('custom', jsonb_build_object('mode','mini','color','azul-marino','size','M'), 'qty', 1)))$$, 'color', 'color inactivo de KOVA CUSTOM rechazado');
reset role;
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000a1');
select public.admin_cancel_order((select id from public.orders where number='KOVA-WEB-000001'), 'prueba');
reset role;
select t.ok((select stock_reserved = 0 and stock_on_hand = 1 from public.product_variants where product_id = 'tee-normal'), 'cancelar libera inventario reservado');
select t.ok((select status from public.promo_redemptions r join public.orders o on o.id = r.order_id where o.number = 'KOVA-WEB-000001') = 'released', 'cancelar sin pago libera el uso');
select t.as_anon();
do $$ declare r jsonb; begin
  r := public.quote_cart(t.cart('tee-normal', 'M', '') || t.cart('per-aspera-ad-astra', 'S', 'Blanco'), '', '', '', 'deposit', 'coordinar');
  perform t.ok((r #>> '{quote,amount_due_now}')::int = 80000 + 36000, 'carrito mixto: normal 100% + preventa 50%');
end $$;
select t.fails($$select public.create_order(t.order_payload(t.cart('anima-aetherna', 'M', 'Arena'), 'k-cccccccccccccccc1', '', 'deposit', 'x@test'))$$, 'correo', 'correo inválido rechazado');
select t.fails($$select public.create_order(jsonb_set(t.order_payload(t.cart('anima-aetherna', 'M', 'Arena'), 'k-cccccccccccccccc2'), '{accept_terms}', 'false'))$$, 'condiciones', 'sin aceptar condiciones no se crea');
reset role;

-- Rentabilidad
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.ok((select (x ->> 'margin')::numeric = 46.0 from jsonb_array_elements(public.promo_profit_preview('{"discount_type":"percent","percent":10}') -> 'rows') x where x ->> 'product_id' = 'anima-aetherna'),
  'vista de rentabilidad: 72.000 -10% = 64.800, costo 35.000 → margen 46%');
select t.ok((select x ->> 'cost' is null from jsonb_array_elements(public.promo_profit_preview('{"discount_type":"percent","percent":10}') -> 'rows') x where x ->> 'product_id' = 'per-aspera-ad-astra'),
  'sin costo registrado no se inventa');
update public.admin_settings set value = '{"min_margin_pct": 40, "mode": "block"}' where key = 'profit';
select t.fails($$insert into public.promo_codes (code, discount_type, percent, status) values ('PERDIDA', 'percent', 60, 'active')$$, 'margen', 'bloqueo de códigos que generan pérdidas');
select t.ok((public.admin_dashboard() -> 'kpis' ->> 'collected')::int = 64800 - 10000, 'dashboard: dinero recaudado = pagos aprobados − reembolsos');
select t.ok((public.admin_promo_stats((select id from public.promo_codes where code_norm='KOVA10')) ->> 'confirmed_uses')::int = 1, 'estadísticas del código');
select t.ok((public.admin_production(null) ->> 'confirmed_units')::int >= 0, 'panel de producción responde');
reset role;

-- ============ KOVA CUSTOM: diseños originales subidos desde la página ============
select t.as_anon();
do $$ declare r jsonb; begin
  r := public.create_order(t.order_payload(jsonb_build_array(
         jsonb_build_object('custom', jsonb_build_object('mode','classic','color','negro','size','M','ref','refdisenio1'), 'qty', 1),
         jsonb_build_object('custom', jsonb_build_object('mode','mini','color','blanco','size','L','ref','refdisenio2'), 'qty', 1)),
       'k-dddddddddddddddd1', '', 'full', 'dis@test.co'));
  perform set_config('t.dtok', r ->> 'token', false);
end $$;
select t.ok(jsonb_array_length(public.get_order_designs(current_setting('t.dtok')) -> 'lines') = 2, 'diseños: el pedido lista sus 2 líneas KOVA CUSTOM');
select t.ok((public.get_order_designs(current_setting('t.dtok')) #> '{lines,0,faces}') = '["front","back"]'::jsonb, 'diseños: CLASSIC lleva frente y espalda');
select t.ok((public.get_order_designs(current_setting('t.dtok')) #> '{lines,1,faces}') = '["front"]'::jsonb, 'diseños: MINI solo lleva frente');
select t.fails($$select public.get_order_designs(repeat('b', 64))$$, 'No encontramos', 'diseños: sin el token correcto no se ve nada');
select t.fails($$select public.request_design_upload(current_setting('t.dtok'), 2, 'back', 'png')$$, 'no lleva estampado', 'diseños: no se sube a una cara que no se estampa');
select t.fails($$select public.request_design_upload(current_setting('t.dtok'), 1, 'front', 'svg')$$, 'PNG, JPG, WEBP o PDF', 'diseños: SVG y otros tipos rechazados');
select t.fails($$select public.request_design_upload(current_setting('t.dtok'), 9, 'front', 'png')$$, 'no es de KOVA CUSTOM', 'diseños: línea inexistente rechazada');
do $$ declare up jsonb; begin
  up := public.request_design_upload(current_setting('t.dtok'), 1, 'front', 'PNG');
  perform t.ok(up ->> 'bucket' = 'custom-designs' and (up ->> 'path') like '%/1-front-%.png', 'diseños: ruta reservada en el bucket privado');
  perform set_config('t.dpath1', up ->> 'path', false);
end $$;
select t.fails($$insert into storage.objects (bucket_id, name) values ('custom-designs', 'otro/archivo.png')$$, 'row-level security', 'diseños: no se puede subir fuera del cupo reservado');
select t.fails($$select public.submit_design_file(current_setting('t.dtok'), jsonb_build_object('path', current_setting('t.dpath1'), 'file_name', 'logo.png'))$$,
  'no terminó de subir', 'diseños: no se registra un archivo que no se subió');
insert into storage.objects (bucket_id, name, metadata) values ('custom-designs', current_setting('t.dpath1'), '{"size": 2048, "mimetype": "image/png"}');
select t.ok((select count(*) from storage.objects where bucket_id = 'custom-designs') = 0, 'diseños: anon no puede ver ni listar los archivos');
select t.fails($$select * from public.order_design_files$$, 'permission denied', 'diseños: anon no lee la tabla de diseños');
select public.submit_design_file(current_setting('t.dtok'), jsonb_build_object('path', current_setting('t.dpath1'), 'file_name', '../mi logo.png', 'sha256', repeat('ef', 32)));
select t.fails($$select public.submit_design_file(current_setting('t.dtok'), jsonb_build_object('path', current_setting('t.dpath1'), 'file_name', 'x.png'))$$,
  'Súbelo de nuevo', 'diseños: un cupo solo sirve una vez');
select t.fails($$insert into storage.objects (bucket_id, name) values ('custom-designs', current_setting('t.dpath1') || 'x')$$, 'row-level security', 'diseños: cupo usado ya no admite más archivos');
select t.ok((public.get_order_designs(current_setting('t.dtok')) #>> '{lines,0,designs,0,file_name}') = '.._mi logo.png', 'diseños: el cliente ve su diseño recibido (nombre saneado)');
do $$ declare up jsonb; begin   -- archivo vacío
  up := public.request_design_upload(current_setting('t.dtok'), 1, 'back', 'png');
  insert into storage.objects (bucket_id, name, metadata) values ('custom-designs', up ->> 'path', '{"size": 0, "mimetype": "image/png"}');
  perform set_config('t.dpath0', up ->> 'path', false);
end $$;
select t.fails($$select public.submit_design_file(current_setting('t.dtok'), jsonb_build_object('path', current_setting('t.dpath0'), 'file_name', 'vacio.png'))$$,
  'vacío', 'diseños: un archivo vacío no se registra');
do $$ declare up jsonb; begin   -- reemplazo
  up := public.request_design_upload(current_setting('t.dtok'), 1, 'front', 'pdf');
  insert into storage.objects (bucket_id, name, metadata) values ('custom-designs', up ->> 'path', '{"size": 4096, "mimetype": "application/pdf"}');
  perform public.submit_design_file(current_setting('t.dtok'), jsonb_build_object('path', up ->> 'path', 'file_name', 'logo-final.pdf'));
end $$;
reset role;
select t.ok((select count(*) filter (where status = 'active') = 1 and count(*) = 2 from public.order_design_files where order_id = t.oid((select number from public.orders where idempotency_key = 'k-dddddddddddddddd1')) and line_no = 1 and face = 'front'),
  'diseños: reemplazar deja un solo archivo vigente y guarda el anterior');
select t.ok((select size_bytes = 4096 and mime = 'application/pdf' from public.order_design_files where file_name = 'logo-final.pdf'), 'diseños: se guarda tamaño y tipo reales del archivo');
select t.ok(exists (select 1 from public.order_history where event = 'Diseño recibido' and is_public), 'diseños: queda en el historial del pedido');
-- Personal del panel: admin y producción ven los diseños; un usuario cualquiera no.
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.ok((select count(*) from public.order_design_files) = 2, 'diseños: admin los ve');
select t.ok((select count(*) from storage.objects where bucket_id = 'custom-designs') = 3, 'diseños: admin puede abrir los archivos (URL firmada)');
select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.ok((select count(*) from public.order_design_files) = 2, 'diseños: producción los ve para estampar');
select t.as_user('00000000-0000-0000-0000-0000000000d4');
select t.ok((select count(*) from public.order_design_files) = 0, 'diseños: un usuario que no es del equipo no ve nada');
select t.ok((select count(*) from storage.objects where bucket_id = 'custom-designs') = 0, 'diseños: un usuario que no es del equipo no abre archivos');
reset role;
update public.orders set fulfillment_status = 'in_production' where idempotency_key = 'k-dddddddddddddddd1';
select t.as_anon();
select t.fails($$select public.request_design_upload(current_setting('t.dtok'), 1, 'back', 'png')$$, 'en producción', 'diseños: en producción ya no se cambian desde la página');
select t.ok((public.get_order_designs(current_setting('t.dtok')) ->> 'can_upload')::boolean = false, 'diseños: la página sabe que ya no se pueden cambiar');
reset role;
select 'TODAS LAS PRUEBAS PASARON' as resultado;
