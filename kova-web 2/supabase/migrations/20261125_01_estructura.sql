-- =============================================================================
-- KOVA · Migración 01 — Estructura de preventas, códigos promocionales y pedidos
--
-- Aditiva: NO borra ni reescribe datos existentes. Se puede ejecutar de nuevo
-- (usa "if not exists" / "or replace"). Requiere supabase/schema.sql aplicado antes.
--
-- Tablas nuevas:
--   product_variants, product_costs, preorder_campaigns, preorder_products,
--   preorder_variant_limits, customers, orders, order_items, payments,
--   promo_codes, promo_redemptions, promo_applications, order_history,
--   inventory_movements, admin_settings, audit_logs
-- Internas (sin acceso público): rate_limits, order_counters, proof_upload_slots,
--   kova_private.secrets
--
-- Seguridad: TODAS las tablas nuevas tienen RLS. El público (clave anon) NO puede
-- leer ni escribir ninguna directamente: solo a través de funciones del servidor
-- (migración 02) que validan precios, descuentos, cupos e identidad.
-- =============================================================================

-- 0. Roles de administración ----------------------------------------------------
-- owner/admin: todo. production: ve pedidos y actualiza producción; no toca pagos,
-- códigos, precios ni exporta datos personales.
alter table public.admins add column if not exists role text not null default 'owner';
do $$ begin
  alter table public.admins add constraint admins_role_check check (role in ('owner', 'admin', 'production'));
exception when duplicate_object then null; end $$;

-- is_admin() conserva su significado (puede administrar catálogo y ajustes).
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role in ('owner', 'admin'));
$$;
-- is_staff(): cualquier rol del panel (incluye producción).
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
create or replace function public.admin_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.admins where user_id = auth.uid();
$$;
revoke all on function public.is_staff() from public;
revoke all on function public.admin_role() from public;
grant execute on function public.is_admin(), public.is_staff(), public.admin_role() to anon, authenticated;

create schema if not exists kova_private;
revoke all on schema kova_private from public, anon, authenticated;
create table if not exists kova_private.secrets (name text primary key, value bytea not null);
insert into kova_private.secrets (name, value) values ('tracking_hmac', extensions.gen_random_bytes(32)) on conflict do nothing;

-- 1. Productos: modalidad de venta y drop -----------------------------------------
alter table public.products add column if not exists sale_mode text not null default 'normal';
alter table public.products add column if not exists drop_code text;
do $$ begin
  alter table public.products add constraint products_sale_mode_check
    check (sale_mode in ('normal', 'preorder', 'coming_soon', 'sold_out', 'hidden'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.products add constraint products_drop_code_check
    check (drop_code is null or drop_code ~ '^[A-Z0-9_]{1,32}$');
exception when duplicate_object then null; end $$;

-- "Oculto" nunca se ve en la tienda, aunque published siga en true.
drop policy if exists "products: el público ve los publicados" on public.products;
create policy "products: el público ve los publicados" on public.products
  for select to anon, authenticated using ((published and sale_mode <> 'hidden') or public.is_staff());

-- 2. Variantes (talla × color) e inventario físico -----------------------------------
create table if not exists public.product_variants (
  id             uuid primary key default gen_random_uuid(),
  product_id     text not null references public.products (id) on delete cascade,
  size           text not null default '',
  color          text not null default '',
  sku            text unique,
  cost           integer check (cost is null or cost between 0 and 100000000),
  stock_on_hand  integer check (stock_on_hand is null or stock_on_hand >= 0),   -- null = sin control de inventario
  stock_reserved integer not null default 0 check (stock_reserved >= 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (product_id, size, color)
);
create index if not exists product_variants_product_idx on public.product_variants (product_id);

-- Costo de producción por producto y materiales por unidad (privado: solo panel).
create table if not exists public.product_costs (
  product_id  text primary key references public.products (id) on delete cascade,
  unit_cost   integer check (unit_cost is null or unit_cost between 0 and 100000000),
  materials   jsonb not null default '[]'::jsonb check (jsonb_typeof(materials) = 'array'),
  updated_at  timestamptz not null default now()
);

-- Crea las variantes que falten cuando un producto se crea o cambia sus tallas/colores.
-- Nunca borra variantes: las que ya no existen quedan inactivas (conservan su historial).
create or replace function public.sync_product_variants()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sizes text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(new.sizes) x), '{}');
  colors text[] := coalesce((select array_agg(c ->> 'name') from jsonb_array_elements(new.colors) c), '{}');
begin
  if array_length(sizes, 1) is null then sizes := array['']; end if;
  if array_length(colors, 1) is null then colors := array['']; end if;
  insert into public.product_variants (product_id, size, color)
  select new.id, s, c from unnest(sizes) s cross join unnest(colors) c
  on conflict (product_id, size, color) do update set active = true;
  update public.product_variants v set active = false
   where v.product_id = new.id and not (v.size = any(sizes) and v.color = any(colors)) and v.active;
  return new;
end;
$$;
drop trigger if exists products_variants_sync on public.products;
create trigger products_variants_sync after insert or update of sizes, colors on public.products
  for each row execute function public.sync_product_variants();

-- Variantes de los productos que ya existen (no modifica los productos).
insert into public.product_variants (product_id, size, color)
select p.id, coalesce(s.size, ''), coalesce(c.color, '')
  from public.products p
  left join lateral (select x as size from jsonb_array_elements_text(p.sizes) x) s on true
  left join lateral (select x ->> 'name' as color from jsonb_array_elements(p.colors) x) c on true
on conflict (product_id, size, color) do nothing;

-- 3. Ajustes privados del panel ---------------------------------------------------------
create table if not exists public.admin_settings (
  key        text primary key check (key ~ '^[a-z_]{2,40}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
-- Valores iniciales (todos editables desde el panel → Configuración).
insert into public.admin_settings (key, value) values
  ('general', jsonb_build_object(
     'brand', 'KOVA STREETWEAR', 'currency', 'COP', 'timezone', 'America/Bogota',
     'order_prefix', 'WEB',                 -- pedidos de venta normal: KOVA-WEB-000001
     'hold_hours_normal', 24,               -- vigencia de un pedido normal sin comprobante
     'verification_hours', 48,              -- plazo para revisar un comprobante (luego se marca como vencido para revisión)
     'max_orders_per_hour_per_ip', 8,
     'max_promo_checks_per_10min', 25,
     'max_units_per_line', 10)),
  ('profit', jsonb_build_object('min_margin_pct', null, 'mode', 'warn'))   -- 'warn' o 'block'
on conflict (key) do nothing;

-- Ajustes públicos nuevos de la tienda: envío y textos legales.
alter table public.store_settings drop constraint if exists store_settings_key_check;
alter table public.store_settings add constraint store_settings_key_check
  check (key in ('custom', 'contact', 'payments', 'shipping', 'legal'));

-- 4. Campañas de preventa -----------------------------------------------------------------
create table if not exists public.preorder_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name                text not null check (char_length(btrim(name)) between 1 and 120),
  drop_name           text not null default '' check (char_length(drop_name) <= 60),
  description         text not null default '' check (char_length(description) <= 4000),
  banner_url          text not null default '' check (char_length(banner_url) <= 600),
  status              text not null default 'draft' check (status in ('draft', 'active', 'paused', 'closed', 'archived')),
  opens_at            timestamptz,
  closes_at           timestamptz,
  est_dispatch_date   date,
  est_delivery_date   date,
  max_units           integer check (max_units is null or max_units > 0),
  max_per_customer    integer check (max_per_customer is null or max_per_customer > 0),
  deposit_pct         integer not null default 50 check (deposit_pct between 1 and 100),
  allow_full_payment  boolean not null default true,
  allow_promo_codes   boolean not null default true,
  hold_minutes        integer check (hold_minutes is null or hold_minutes between 5 and 20160),
  verification_hours  integer check (verification_hours is null or verification_hours between 1 and 720),
  shipping_charge     text not null default 'balance' check (shipping_charge in ('reservation', 'balance')),
  terms               text not null default '' check (char_length(terms) <= 8000),
  show_countdown      boolean not null default false,
  show_availability   boolean not null default false,
  auto_close_on_limit boolean not null default true,
  order_prefix        text not null default 'PRE' check (order_prefix ~ '^[A-Z0-9]{2,6}$'),
  closed_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  check (closes_at is null or opens_at is null or closes_at > opens_at)
);

create table if not exists public.preorder_products (
  campaign_id uuid not null references public.preorder_campaigns (id) on delete cascade,
  product_id  text not null references public.products (id) on delete restrict,
  max_units   integer check (max_units is null or max_units > 0),
  position    integer not null default 0,
  primary key (campaign_id, product_id)
);
create index if not exists preorder_products_product_idx on public.preorder_products (product_id);

-- Variantes participantes y límite por talla × color (sin fila = participa sin límite propio).
create table if not exists public.preorder_variant_limits (
  campaign_id uuid not null,
  product_id  text not null,
  size        text not null default '',
  color       text not null default '',
  enabled     boolean not null default true,
  max_units   integer check (max_units is null or max_units >= 0),
  primary key (campaign_id, product_id, size, color),
  foreign key (campaign_id, product_id) references public.preorder_products (campaign_id, product_id) on delete cascade
);

-- 5. Clientes -------------------------------------------------------------------------------
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  email_norm  text not null unique check (email_norm ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email_norm) <= 160),
  phone_norm  text not null check (phone_norm ~ '^\d{7,15}$'),
  full_name   text not null check (char_length(full_name) between 3 and 100),
  user_id     uuid references auth.users (id) on delete set null,   -- si algún día hay cuentas de cliente
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists customers_phone_idx on public.customers (phone_norm);

-- 6. Códigos promocionales ------------------------------------------------------------------
create table if not exists public.promo_codes (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null check (code ~ '^[A-Za-z0-9_-]{3,32}$'),
  code_norm             text generated always as (upper(code)) stored unique,
  name                  text not null default '' check (char_length(name) <= 120),
  internal_description  text not null default '' check (char_length(internal_description) <= 2000),
  discount_type         text not null check (discount_type in ('percent', 'fixed')),
  percent               integer check (percent is null or percent between 1 and 100),
  fixed_amount          integer check (fixed_amount is null or fixed_amount between 1 and 100000000),
  status                text not null default 'inactive' check (status in ('active', 'inactive', 'archived')),
  starts_at             timestamptz,
  ends_at               timestamptz,
  max_uses              integer check (max_uses is null or max_uses > 0),           -- null = ilimitado
  max_uses_per_customer integer check (max_uses_per_customer is null or max_uses_per_customer > 0),
  min_subtotal          integer check (min_subtotal is null or min_subtotal >= 0),
  min_items             integer check (min_items is null or min_items >= 1),
  product_ids           text[],      -- null o vacío = todos
  categories            text[],
  campaign_ids          uuid[],      -- drops / campañas participantes
  applies_normal        boolean not null default true,
  applies_preorder      boolean not null default true,
  applies_custom        boolean not null default false,
  customer_emails       text[],      -- clientes específicos (correos normalizados); null = cualquiera
  max_discount          integer check (max_discount is null or max_discount > 0),
  influencer_name       text not null default '' check (char_length(influencer_name) <= 120),
  commission_pct        numeric(5, 2) check (commission_pct is null or commission_pct between 0 and 100),
  commission_fixed      integer check (commission_fixed is null or commission_fixed >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  check ((discount_type = 'percent' and percent is not null) or (discount_type = 'fixed' and fixed_amount is not null)),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

-- 7. Pedidos ---------------------------------------------------------------------------------
create table if not exists public.orders (
  id                     uuid primary key default gen_random_uuid(),
  number                 text not null unique,
  token_hash             text not null unique,
  idempotency_key        text not null unique check (char_length(idempotency_key) between 16 and 80),
  customer_id            uuid not null references public.customers (id),
  kind                   text not null check (kind in ('normal', 'preorder', 'custom', 'mixed')),
  campaign_id            uuid references public.preorder_campaigns (id),
  payment_plan           text not null check (payment_plan in ('deposit', 'full')),
  payment_method         text not null default '' check (char_length(payment_method) <= 40),
  financial_status       text not null default 'pending_payment' check (financial_status in
    ('pending_payment', 'proof_received', 'verifying', 'deposit_confirmed', 'paid', 'rejected', 'partial_refund', 'refunded')),
  fulfillment_status     text not null default 'pending_confirmation' check (fulfillment_status in
    ('pending_confirmation', 'confirmed', 'in_production', 'quality_check', 'packed', 'ready', 'shipped', 'delivered', 'cancelled', 'expired')),
  subtotal_original      integer not null check (subtotal_original >= 0),
  discount_total         integer not null default 0 check (discount_total >= 0),
  subtotal_after         integer not null check (subtotal_after >= 0),
  shipping_method        text not null default '',
  shipping_label         text not null default '',
  shipping_amount        integer check (shipping_amount is null or shipping_amount >= 0),   -- null = por cotizar
  shipping_charge_at     text not null default 'reservation' check (shipping_charge_at in ('reservation', 'balance')),
  total                  integer not null check (total >= 0),             -- productos con descuento + envío conocido
  amount_due_now         integer not null check (amount_due_now >= 0),    -- requerido para confirmar la reserva
  paid_total             integer not null default 0,
  refunded_total         integer not null default 0,
  deposit_pct            integer,
  promo_code_id          uuid references public.promo_codes (id),
  promo_code             text,
  promo_snapshot         jsonb,
  terms_snapshot         jsonb not null default '{}'::jsonb,
  full_name              text not null,
  email                  text not null,
  whatsapp               text not null,
  department             text not null default '',
  city                   text not null default '',
  address                text not null default '',
  delivery_notes         text not null default '',
  delivery_method        text not null default '',
  accepted_terms_at      timestamptz not null,
  accepted_data_at       timestamptz not null,
  est_dispatch_date      date,
  hold_expires_at        timestamptz,
  verification_expires_at timestamptz,
  tracking_number        text not null default '',
  carrier                text not null default '',
  production_checklist   jsonb not null default '{}'::jsonb,
  client_fingerprint     text not null default '',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  confirmed_at           timestamptz,
  cancelled_at           timestamptz
);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_campaign_idx on public.orders (campaign_id);
create index if not exists orders_status_idx on public.orders (fulfillment_status, financial_status);
create index if not exists orders_hold_idx on public.orders (hold_expires_at) where fulfillment_status = 'pending_confirmation';

create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  line_no         integer not null,
  kind            text not null check (kind in ('normal', 'preorder', 'custom')),
  product_id      text references public.products (id),
  variant_id      uuid references public.product_variants (id),
  campaign_id     uuid references public.preorder_campaigns (id),
  name            text not null,
  category        text not null default '',
  size            text not null default '',
  color           text not null default '',
  qty             integer not null check (qty between 1 and 100),
  unit_price      integer not null check (unit_price >= 0),
  line_original   integer not null check (line_original >= 0),
  discount        integer not null default 0 check (discount >= 0),
  line_final      integer not null check (line_final >= 0),
  deposit_pct     integer,
  due_now         integer not null check (due_now >= 0),
  unit_cost       integer,                 -- copia del costo registrado al comprar (si existía)
  custom          jsonb,
  unique (order_id, line_no)
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_campaign_idx on public.order_items (campaign_id, product_id);
create index if not exists order_items_variant_idx on public.order_items (variant_id);

create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete restrict,
  kind           text not null check (kind in ('deposit', 'balance', 'full', 'extra', 'refund')),
  method         text not null default '' check (char_length(method) <= 40),
  amount         integer not null check (amount > 0),
  reference      text not null default '' check (char_length(reference) <= 80),
  transfer_date  date,
  proof_path     text,
  proof_sha256   text check (proof_sha256 is null or proof_sha256 ~ '^[0-9a-f]{64}$'),
  status         text not null default 'submitted' check (status in ('submitted', 'verifying', 'approved', 'rejected')),
  reject_reason  text not null default '',
  note           text not null default '',
  source         text not null default 'customer' check (source in ('customer', 'admin')),
  restore_promo  boolean not null default false,
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists payments_order_idx on public.payments (order_id);
-- Un mismo archivo de comprobante no puede usarse en dos pagos vigentes.
create unique index if not exists payments_proof_unique on public.payments (proof_sha256)
  where proof_sha256 is not null and status <> 'rejected';
-- Una misma referencia de transferencia no puede aprobarse dos veces con el mismo método.
create unique index if not exists payments_reference_unique on public.payments (method, upper(reference))
  where status = 'approved' and reference <> '' and kind <> 'refund';

create table if not exists public.promo_redemptions (
  id                uuid primary key default gen_random_uuid(),
  promo_id          uuid not null references public.promo_codes (id),
  order_id          uuid not null unique references public.orders (id),
  customer_id       uuid not null references public.customers (id),
  status            text not null default 'pending' check (status in ('pending', 'confirmed', 'released', 'void_kept', 'restored')),
  eligible_subtotal integer not null,
  discount_amount   integer not null,
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz,
  released_at       timestamptz,
  reason            text not null default ''
);
create index if not exists promo_redemptions_promo_idx on public.promo_redemptions (promo_id, status);
create index if not exists promo_redemptions_customer_idx on public.promo_redemptions (customer_id);

-- Aplicaciones del código en el carrito (no consumen usos; sirven para la conversión).
create table if not exists public.promo_applications (
  id          bigserial primary key,
  promo_id    uuid references public.promo_codes (id),
  code_try    text not null,
  valid       boolean not null,
  reason      text not null default '',
  subtotal    integer,
  discount    integer,
  client_hash text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists promo_applications_promo_idx on public.promo_applications (promo_id, created_at);

create table if not exists public.order_history (
  id               bigserial primary key,
  order_id         uuid not null references public.orders (id) on delete cascade,
  at               timestamptz not null default now(),
  actor            text not null check (actor in ('system', 'customer', 'admin')),
  actor_id         uuid,
  event            text not null,
  from_financial   text,
  to_financial     text,
  from_fulfillment text,
  to_fulfillment   text,
  note             text not null default '',
  is_public        boolean not null default true
);
create index if not exists order_history_order_idx on public.order_history (order_id, at);

create table if not exists public.inventory_movements (
  id          bigserial primary key,
  variant_id  uuid references public.product_variants (id),
  product_id  text,
  campaign_id uuid,
  order_id    uuid references public.orders (id),
  kind        text not null check (kind in ('reserve', 'release', 'sale', 'adjust', 'return',
                                             'preorder_hold', 'preorder_release', 'preorder_confirm')),
  qty         integer not null,
  note        text not null default '',
  actor_id    uuid,
  at          timestamptz not null default now()
);
create index if not exists inventory_movements_variant_idx on public.inventory_movements (variant_id, at);

create table if not exists public.audit_logs (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb
);
create index if not exists audit_logs_at_idx on public.audit_logs (at desc);

-- Internas -----------------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);
create table if not exists public.order_counters (prefix text primary key, last_value integer not null default 0);
create table if not exists public.proof_upload_slots (
  path       text primary key,
  order_id   uuid not null references public.orders (id) on delete cascade,
  expires_at timestamptz not null,
  used       boolean not null default false
);

-- 8. RLS: todo cerrado al público; lectura para el personal, escritura vía funciones ---------
do $$
declare t text;
begin
  foreach t in array array['product_variants', 'product_costs', 'preorder_campaigns', 'preorder_products',
    'preorder_variant_limits', 'customers', 'orders', 'order_items', 'payments', 'promo_codes',
    'promo_redemptions', 'promo_applications', 'order_history', 'inventory_movements', 'admin_settings',
    'audit_logs', 'rate_limits', 'order_counters', 'proof_upload_slots']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Lectura: personal del panel (producción incluida) para lo operativo.
do $$
declare t text;
begin
  foreach t in array array['product_variants', 'preorder_campaigns', 'preorder_products', 'preorder_variant_limits',
    'inventory_movements']
  loop
    execute format('drop policy if exists "staff lee" on public.%I', t);
    execute format('create policy "staff lee" on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  -- Solo owner/admin: datos personales (clientes, pedidos, pagos, historial), costos, códigos, ajustes y auditoría.
  -- El rol producción ve los pedidos sin datos personales a través de admin_production_orders().
  foreach t in array array['customers', 'orders', 'order_items', 'payments', 'order_history', 'product_costs', 'promo_codes', 'promo_redemptions', 'promo_applications', 'admin_settings', 'audit_logs']
  loop
    execute format('drop policy if exists "admin lee" on public.%I', t);
    execute format('create policy "admin lee" on public.%I for select to authenticated using (public.is_admin())', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Escritura directa (con RLS) solo donde es configuración: campañas, códigos, costos, variantes, ajustes.
-- Pedidos, pagos, usos y movimientos SOLO cambian a través de funciones (migración 02).
do $$
declare t text;
begin
  foreach t in array array['preorder_campaigns', 'preorder_products', 'preorder_variant_limits', 'promo_codes',
    'product_costs', 'product_variants', 'admin_settings']
  loop
    execute format('drop policy if exists "admin escribe" on public.%I', t);
    execute format('create policy "admin escribe" on public.%I for insert to authenticated with check (public.is_admin())', t);
    execute format('drop policy if exists "admin edita" on public.%I', t);
    execute format('create policy "admin edita" on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('grant insert, update on public.%I to authenticated', t);
  end loop;
  -- Borrar solo filas de relación (productos de una campaña); campañas y códigos se archivan.
  foreach t in array array['preorder_products', 'preorder_variant_limits']
  loop
    execute format('drop policy if exists "admin borra" on public.%I', t);
    execute format('create policy "admin borra" on public.%I for delete to authenticated using (public.is_admin())', t);
    execute format('grant delete on public.%I to authenticated', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to authenticated;

-- 9. Comprobantes de pago: bucket PRIVADO ------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ¿Hay un cupo de subida vigente para esta ruta? (security definer: no expone la tabla de cupos)
create or replace function public.proof_slot_open(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.proof_upload_slots s where s.path = p_path and not s.used and s.expires_at > now());
$$;
revoke all on function public.proof_slot_open(text) from public;
grant execute on function public.proof_slot_open(text) to anon, authenticated;

-- Subir: solo a una ruta reservada por request_proof_upload() (token privado del pedido), una vez y por 15 min.
drop policy if exists "payment-proofs: subida con cupo" on storage.objects;
create policy "payment-proofs: subida con cupo" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'payment-proofs' and public.proof_slot_open(name));
-- Ver: solo owner/admin (con URL firmada temporal). El público nunca lista ni lee.
drop policy if exists "payment-proofs: personal lee" on storage.objects;
create policy "payment-proofs: personal lee" on storage.objects
  for select to authenticated using (bucket_id = 'payment-proofs' and public.is_admin());
