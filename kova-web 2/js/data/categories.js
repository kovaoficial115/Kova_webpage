/**
 * Categorías del catálogo, en el orden en que aparecen en la página.
 * Para una categoría nueva (p. ej. accesorios) agrega una entrada aquí y
 * usa su `id` en los productos: su filtro, su tarjeta y su enlace en el menú se crean solos.
 * Una categoría sin productos no se muestra.
 *
 *   cover  (opcional) Imagen de la tarjeta de categoría. Si no hay, se usa la del primer producto.
 */
export const categories = [
  { id: 'shirts', label: 'Camisetas', code: 'TEE', blurb: 'Algodón pesado, fit oversize, gráficos que no pasan desapercibidos.', cover: 'assets/img/campana-camisetas.jpg' },
  // { id: 'accessories', label: 'Accesorios', code: 'ACC', blurb: '...' },
];
