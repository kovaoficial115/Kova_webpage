/**
 * Categorías del catálogo, en el orden en que aparecen en la página.
 * Para una categoría nueva (p. ej. accesorios) agrega una entrada aquí y
 * usa su `id` en los productos: su filtro, su tarjeta y su enlace en el menú se crean solos.
 * Una categoría sin productos no se muestra.
 *
 *   cover  (opcional) Imagen de la tarjeta de categoría. Si no hay, se usa la del primer producto.
 *   item   (opcional) Nombre de una pieza en singular ("Camiseta"); se usa en los textos alternativos de las imágenes.
 */
export const categories = [
  { id: 'shirts', label: 'Camisetas', item: 'Camiseta', code: 'TEE', blurb: 'Algodón pesado, fit oversize, gráficos que no pasan desapercibidos.', cover: 'assets/img/campana-camisetas.jpg' },
  // { id: 'accessories', label: 'Accesorios', item: 'Accesorio', code: 'ACC', blurb: '...' },
];
