/**
 * CATÁLOGO DE PRODUCTOS — el único archivo que necesitas tocar para agregar productos.
 *
 * Para agregar un producto:
 *   1. Pon sus imágenes en assets/products/<categoría>/ (JPG o WebP, ~1200px de ancho, proporción 4:5).
 *   2. Copia un objeto de esta lista y cambia sus datos.
 *   3. Listo: aparece en el catálogo, en su categoría y tiene su propia página (producto.html#<id>).
 *      No hay que tocar HTML ni CSS: tarjetas, filtros, página y botón de compra se generan solos.
 *
 * Campos:
 *   id            Texto único, sin espacios ni tildes. Se usa en la URL.
 *   name          Nombre visible.
 *   category      El `id` de una categoría de js/data/categories.js.
 *   price         Número en pesos, sin puntos (65000 → $65.000).
 *   images        Lista de rutas. La primera es la principal; la segunda (si existe)
 *                 aparece al pasar el cursor por la tarjeta (p. ej. la espalda de la camiseta).
 *   description   Texto de la página del producto.
 *   featured      true para mostrarlo en "Destacados".
 *   tag           (opcional) Etiqueta corta: 'NEW', 'DROP 01', 'LIMITED'...
 *   available     (opcional) false para marcarlo como agotado.
 *   sizes         (opcional) Tallas: ['S', 'M', 'L', 'XL']. Si existen, el cliente elige una
 *                 antes de escribir y la talla se agrega al mensaje de WhatsApp.
 *   soldOutSizes  (opcional) Tallas agotadas: ['XL']. Se muestran tachadas y no se pueden elegir.
 *   details       (opcional) Lista corta de datos para la etiqueta del producto:
 *                 ['100% algodón', '220 g', 'Hecho en Colombia'].
 *
 *   colors        (opcional) Colores: [{ name: 'Azul marino', hex: '#00001f' }]. Si existen, el
 *                 cliente elige uno y el carrito guarda talla + color como variantes distintas.
 *
 * Preparado para el futuro (aún no se usan; la página los ignora si no existen):
 *   stock: 12,
 *   variants: [{ sku: 'KV-TEE-001-M', size: 'M', stock: 3 }],
 */
export const products = [
  {
    id: 'cyber-star-tee',
    name: 'Cyber Star Tee',
    category: 'shirts',
    price: 85000,
    images: ['assets/products/shirts/cyber-star-tee-front.svg', 'assets/products/shirts/cyber-star-tee-back.svg'],
    description: 'Camiseta azul marino oversize con destellos al frente y conector gráfico en la espalda. Algodón 100% de 220 g.',
    sizes: ['S', 'M', 'L', 'XL'],
    details: ['100% algodón', '220 g', 'Fit oversize', 'Hecho en Colombia'],
    featured: true,
    tag: 'DROP 01',
  },
  {
    id: 'orbit-2k-tee',
    name: 'Orbit 2K Tee',
    category: 'shirts',
    price: 80000,
    images: ['assets/products/shirts/orbit-tee-front.svg'],
    description: 'Camiseta color hueso con el elemento orbital de Kova en el pecho. Corte boxy y cuello reforzado.',
    sizes: ['S', 'M', 'L', 'XL'],
    details: ['100% algodón', '220 g', 'Fit oversize', 'Hecho en Colombia'],
    soldOutSizes: ['XL'],
    featured: true,
  },
  {
    id: 'grid-runner-tee',
    name: 'Grid Runner Tee',
    category: 'shirts',
    price: 85000,
    images: ['assets/products/shirts/grid-runner-tee-front.svg'],
    description: 'Globo en línea fina sobre azul marino. Inspirada en la estética digital de los 2000.',
    sizes: ['S', 'M', 'L', 'XL'],
    details: ['100% algodón', '220 g', 'Fit oversize', 'Hecho en Colombia'],
    tag: 'NEW',
  },
  {
    id: 'y2k-heart-tee',
    name: 'Y2K Heart Tee',
    category: 'shirts',
    price: 80000,
    images: ['assets/products/shirts/y2k-heart-tee-front.svg'],
    description: 'Doble destello Y2K en escarlata. Camiseta hueso, fit relajado.',
    sizes: ['S', 'M', 'L', 'XL'],
    details: ['100% algodón', '220 g', 'Fit oversize', 'Hecho en Colombia'],
  },
  {
    id: 'chrome-kv-tee',
    name: 'Chrome K//V Tee',
    category: 'shirts',
    price: 90000,
    images: ['assets/products/shirts/chrome-logo-tee-front.svg', 'assets/products/shirts/chrome-logo-tee-back.svg'],
    description: 'Espiral de Kova al frente y alas gráficas en la espalda. Edición limitada.',
    sizes: ['S', 'M', 'L', 'XL'],
    details: ['100% algodón', '220 g', 'Fit oversize', 'Hecho en Colombia'],
    featured: true,
    tag: 'LIMITED',
  },
];
