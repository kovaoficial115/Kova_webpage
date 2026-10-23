/**
 * Acceso a los datos del catálogo. Las páginas nunca leen products.js directamente:
 * si algún día los productos vienen de una API o un CMS, solo cambia este archivo.
 */
import { products } from '../data/products.js';
import { categories } from '../data/categories.js';

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
