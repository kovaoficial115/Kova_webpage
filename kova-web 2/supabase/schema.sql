-- =============================================================================
-- KOVA · Base de datos del catálogo (Supabase)
--
-- Ejecuta este archivo UNA VEZ en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin perder datos (todo usa "if not exists" / "or replace").
--
-- Crea:
--   1. public.admins     Quién puede administrar (solo usuarios agregados aquí).
--   2. public.products   El catálogo. Mismos campos que js/data/products.js + published y position.
--   3. Reglas de seguridad (RLS): el público solo LEE productos publicados;
--      crear, editar, ocultar y eliminar exige sesión iniciada Y estar en public.admins.
--   4. Bucket "product-images" para las fotos: lectura pública, escritura solo para admins.
-- =============================================================================

-- 1. Administradores ----------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- ¿El usuario de la sesión actual es administrador? (security definer: puede leer admins sin exponerla)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "admins: cada quien ve su propia fila" on public.admins;
create policy "admins: cada quien ve su propia fila" on public.admins
  for select to authenticated using (user_id = auth.uid());
-- Sin políticas de insert/update/delete: los administradores solo se agregan desde el SQL Editor.

-- 2. Productos ----------------------------------------------------------------
create table if not exists public.products (
  id             text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 80),
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  category       text not null check (category ~ '^[a-z0-9-]+$'),
  price          integer not null check (price >= 0 and price <= 100000000),
  images         jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  description    text not null default '',
  sizes          jsonb not null default '[]'::jsonb check (jsonb_typeof(sizes) = 'array'),
  sold_out_sizes jsonb not null default '[]'::jsonb check (jsonb_typeof(sold_out_sizes) = 'array'),
  details        jsonb not null default '[]'::jsonb check (jsonb_typeof(details) = 'array'),
  colors         jsonb not null default '[]'::jsonb check (jsonb_typeof(colors) = 'array'),
  featured       boolean not null default false,
  tag            text check (tag is null or char_length(tag) <= 24),
  available      boolean not null default true,
  published      boolean not null default true,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists products_position_idx on public.products (position, created_at);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

alter table public.products enable row level security;

drop policy if exists "products: el público ve los publicados" on public.products;
create policy "products: el público ve los publicados" on public.products
  for select to anon, authenticated using (published or public.is_admin());

drop policy if exists "products: admins crean" on public.products;
create policy "products: admins crean" on public.products
  for insert to authenticated with check (public.is_admin());

drop policy if exists "products: admins editan" on public.products;
create policy "products: admins editan" on public.products
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "products: admins eliminan" on public.products;
create policy "products: admins eliminan" on public.products
  for delete to authenticated using (public.is_admin());

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.admins to authenticated;

-- 3. Imágenes (Storage) -------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- El bucket es público: cualquiera puede VER una imagen por su URL (lo necesita el catálogo).
-- Subir, reemplazar y borrar: solo administradores.
drop policy if exists "product-images: admins suben" on storage.objects;
create policy "product-images: admins suben" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product-images: admins actualizan" on storage.objects;
create policy "product-images: admins actualizan" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product-images: admins borran" on storage.objects;
create policy "product-images: admins borran" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product-images: admins listan" on storage.objects;
create policy "product-images: admins listan" on storage.objects
  for select to authenticated using (bucket_id = 'product-images' and public.is_admin());

-- =============================================================================
-- PRIMER ADMINISTRADOR (hazlo después de crear tu usuario en Authentication → Users):
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'TU-CORREO@ejemplo.com'
--   on conflict do nothing;
-- =============================================================================
