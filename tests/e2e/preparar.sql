-- Datos de PRUEBA (solo base local): abre la campaña PSYCHE_01 y crea un código para probar el flujo completo.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
update public.preorder_campaigns set opens_at = now() - interval '1 hour', closes_at = now() + interval '10 days',
  est_dispatch_date = current_date + 30, est_delivery_date = current_date + 35, hold_minutes = 120, max_units = 40,
  max_per_customer = 3, show_availability = true, show_countdown = true where slug = 'psyche-01';
select public.admin_campaign_status((select id from public.preorder_campaigns where slug='psyche-01'), 'active');
insert into public.promo_codes (code, name, discount_type, percent, status, starts_at)
  values ('prueba10', 'Prueba local', 'percent', 10, 'active', now() - interval '1 hour');
