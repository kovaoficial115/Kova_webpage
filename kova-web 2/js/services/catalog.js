/**
 * Acceso a los datos del catálogo. Las páginas nunca leen products.js directamente.
 *
 * Origen de los productos, en este orden:
 *   1. La base de datos (Supabase), si está configurada en CONFIG.backend: es lo que se edita
 *      desde el panel /admin. Se consulta sin caché en cada visita.
 *   2. Si la base falla o no responde a tiempo: la última copia buena guardada en este navegador.
 *   3. Si no hay copia: js/data/products.js (respaldo incluido en la web).
 *
 * El módulo espera la carga (top-level await) antes de que el resto de la página se ejecute,
 * así que getProducts() y compañía siguen siendo síncronos para todas las páginas y el carrito.
 */
import { products as fallbackProducts } from '../data/products.js';
import { categories } from '../data/categories.js';
import { isRemoteConfigured, fetchPublishedProducts } from './remoteCatalog.js';

const SNAPSHOT_KEY = 'kova.catalog.snapshot.v1';
const visible = (list) => list.filter((p) => p.published !== false);

function readSnapshot() {
  try {
    const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
    return Array.isArray(snap?.products) ? snap.products : null;
  } catch { return null; }
}

async function loadProducts() {
  if (!isRemoteConfigured()) return { list: visible(fallbackProducts), source: 'local' };
  try {
    const list = await fetchPublishedProducts();
    try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), products: list })); } catch { /* sin almacenamiento */ }
    return { list, source: 'remote' };
  } catch (err) {
    console.warn('[Kova] No se pudo leer el catálogo en línea; se usa la copia de respaldo.', err);
    const snap = readSnapshot();
    return snap ? { list: visible(snap), source: 'snapshot' } : { list: visible(fallbackProducts), source: 'local' };
  }
}

const { list: products, source } = await loadProducts();

/** De dónde salieron los productos: 'remote' | 'snapshot' | 'local'. */
export const catalogSource = source;

export const getProducts = () => products;
export const getProductById = (id) => products.find((p) => p.id === id);
export const getFeatured = () => products.filter((p) => p.featured);
export const getByCategory = (categoryId) => products.filter((p) => p.category === categoryId);
export const getCategory = (id) => categories.find((c) => c.id === id);

/** Categorías que tienen al menos un producto. */
export const getActiveCategories = () => categories.filter((c) => getByCategory(c.id).length > 0);

/** Disponible salvo que diga `available: false` o que todas sus tallas estén agotadas. */
export const isAvailable = (product) =>
  product.available !== false &&
  !(product.sizes?.length && product.sizes.every((s) => product.soldOutSizes?.includes(s)));

export const getRelated = (product, limit = 4) =>
  products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, limit);
