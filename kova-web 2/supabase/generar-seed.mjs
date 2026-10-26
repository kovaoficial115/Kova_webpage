/**
 * Genera supabase/seed.sql a partir de js/data/products.js (migración inicial del catálogo).
 * Uso (desde la carpeta del sitio):  node supabase/generar-seed.mjs > supabase/seed.sql
 * Solo hace falta si cambias products.js a mano antes de la migración; el seed.sql incluido ya está generado.
 */
const { products } = await import('../js/data/products.js');
const q = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const j = (v) => `${q(JSON.stringify(v ?? []))}::jsonb`;

const rows = products.map((p, i) => `  (${[
  q(p.id), q(p.name), q(p.category), Number(p.price), j(p.images), q(p.description ?? ''),
  j(p.sizes), j(p.soldOutSizes), j(p.details), j(p.colors),
  Boolean(p.featured), q(p.tag || null), p.available !== false, p.published !== false, i,
].join(', ')})`);

console.log(`-- Productos actuales de KOVA (generado desde js/data/products.js).
-- Ejecútalo en Supabase → SQL Editor DESPUÉS de schema.sql. No sobrescribe productos que ya existan.
insert into public.products
  (id, name, category, price, images, description, sizes, sold_out_sizes, details, colors, featured, tag, available, published, position)
values
${rows.join(',\n')}
on conflict (id) do nothing;`);
