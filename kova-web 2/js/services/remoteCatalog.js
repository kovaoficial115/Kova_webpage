/**
 * Catálogo remoto (Supabase): lectura pública de productos publicados.
 * La tienda no carga la librería de Supabase: usa la API REST con la clave pública (anon),
 * que solo puede LEER productos con published = true (lo garantiza la base, ver supabase/schema.sql).
 *
 * La misma conversión fila ↔ producto la usa el panel de administración, para que ambos
 * hablen exactamente el mismo formato que js/data/products.js.
 */
import { CONFIG } from '../config.js';

const B = CONFIG.backend ?? {};
export const isRemoteConfigured = () => Boolean(B.supabaseUrl && B.supabaseAnonKey);

/** Fila de la base → objeto con la forma de js/data/products.js. Omite campos vacíos opcionales. */
export function rowToProduct(row) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const product = {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    images: list(row.images),
    description: row.description ?? '',
  };
  if (list(row.sizes).length) product.sizes = list(row.sizes);
  if (list(row.sold_out_sizes).length) product.soldOutSizes = list(row.sold_out_sizes);
  if (list(row.details).length) product.details = list(row.details);
  if (list(row.colors).length) product.colors = list(row.colors);
  if (row.featured) product.featured = true;
  if (row.tag) product.tag = row.tag;
  if (row.available === false) product.available = false;
  product.published = row.published !== false;
  return product;
}

/** Producto (forma de products.js) → fila de la base. */
export function productToRow(p, position = 0) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.price,
    images: p.images ?? [],
    description: p.description ?? '',
    sizes: p.sizes ?? [],
    sold_out_sizes: p.soldOutSizes ?? [],
    details: p.details ?? [],
    colors: p.colors ?? [],
    featured: Boolean(p.featured),
    tag: p.tag || null,
    available: p.available !== false,
    published: p.published !== false,
    position,
  };
}

// Las claves "anon" antiguas son JWT y van también como Bearer; las nuevas "sb_publishable_" solo como apikey.
const publicHeaders = () => (B.supabaseAnonKey.startsWith('eyJ')
  ? { apikey: B.supabaseAnonKey, Authorization: `Bearer ${B.supabaseAnonKey}` }
  : { apikey: B.supabaseAnonKey });

/** Lee los productos publicados. Lanza un error si falla o tarda más de timeoutMs. */
export async function fetchPublishedProducts() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), B.timeoutMs ?? 6000);
  try {
    const url = `${B.supabaseUrl.replace(/\/$/, '')}/rest/v1/${B.table}?select=*&published=eq.true&order=position.asc,created_at.asc`;
    const res = await fetch(url, {
      headers: publicHeaders(),
      cache: 'no-store',          // siempre la versión más reciente, nunca una copia vieja del navegador
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Catálogo remoto: HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Catálogo remoto: respuesta inesperada');
    return rows.map(rowToProduct).filter((p) => p.published && p.id && p.name && Number.isInteger(p.price));
  } finally {
    clearTimeout(timer);
  }
}
