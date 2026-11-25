#!/bin/bash
# Reservas simultáneas: 12 clientes intentan a la vez el ÚLTIMO cupo de una preventa y el ÚLTIMO uso de un código.
# Debe ganar exactamente 1 en cada caso.
set -e
cd "$(dirname "$0")/../.."
tests/db/reset.sh
P="psql -h /tmp -p 5433 -U postgres -d kova -v ON_ERROR_STOP=1 -q -t"
$P <<'SQL' >/dev/null
update public.preorder_campaigns set opens_at = now() - interval '1 hour', closes_at = now() + interval '7 days', est_dispatch_date = current_date + 30,
  hold_minutes = 60, max_units = 1, status = 'active' where slug = 'psyche-01';
update public.products set sale_mode = 'preorder' where id in ('anima-aetherna', 'per-aspera-ad-astra');
insert into public.products (id, name, category, price, sizes) values ('tee-normal', 'Tee Normal', 'shirts', 80000, '["M"]');
insert into public.promo_codes (code, discount_type, percent, status, max_uses) values ('ULTIMO', 'percent', 10, 'active', 1);
SQL
order() { # $1 = n, $2 = producto, $3 = talla, $4 = color, $5 = código
  $P -c "set role anon; select public.create_order(jsonb_build_object('idempotency_key', 'concurrencia-$1-$2-xxxx', 'payment_plan', 'deposit',
    'items', jsonb_build_array(jsonb_build_object('product_id', '$2', 'size', '$3', 'color', '$4', 'qty', 1)), 'promo_code', '$5',
    'shipping_method', 'coordinar', 'accept_terms', true, 'accept_data', true,
    'buyer', jsonb_build_object('full_name', 'Cliente Prueba', 'email', 'c$1@test.co', 'whatsapp', '31100000$(printf %02d $1)',
      'department', 'Valle', 'city', 'Cali', 'address', 'Calle 1 # 2-3')))" >/dev/null 2>&1 && echo ok || echo no
}
export -f order; export P
seq 1 12 | xargs -P 12 -I{} bash -c 'order {} anima-aetherna M Arena ""' | sort | uniq -c
echo "pedidos de preventa creados: $($P -c "select count(*) from public.orders where campaign_id is not null")  (esperado 1)"
seq 1 12 | xargs -P 12 -I{} bash -c 'order 1{} tee-normal M "" ULTIMO' | sort | uniq -c
echo "usos de ULTIMO: $($P -c "select count(*) from public.promo_redemptions")  (esperado 1)"
test "$($P -c "select count(*) from public.orders where campaign_id is not null" | tr -d ' ')" = 1
test "$($P -c "select count(*) from public.promo_redemptions" | tr -d ' ')" = 1
echo "CONCURRENCIA OK"
