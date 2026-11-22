/**
 * KOVA CUSTOM — valores iniciales.
 *
 * Son los que usa la tienda mientras el panel /admin no haya guardado su propia configuración
 * (tabla public.store_settings, fila 'custom'). Desde /admin → KOVA Custom se cambian precios,
 * modalidades, medidas y posición de las zonas, colores, tallas, inventario e imágenes.
 *
 * Los diseños de los clientes NO se suben a ningún servidor: la previsualización ocurre solo en el
 * navegador y los archivos originales se envían por WhatsApp.
 *
 * Coordenadas de las zonas: porcentaje del lienzo de la camiseta (proporción 6:7).
 *   x  centro horizontal de la zona (0 = borde izquierdo, 100 = derecho)
 *   y  borde superior de la zona (0 = arriba, 100 = abajo)
 * El tamaño en pantalla sale de las medidas en cm y de `mockup.cmPerWidth`
 * (cuántos centímetros reales representa el ancho completo del lienzo).
 */
export const customDefaults = {
  modes: [
    { id: 'mini', name: 'CUSTOM MINI', label: 'Pecho pequeño', zones: ['chest-small'], price: 59000, active: true },
    { id: 'front', name: 'CUSTOM FRONT', label: 'Pecho grande', zones: ['chest-large'], price: 65000, active: true },
    { id: 'back', name: 'CUSTOM BACK', label: 'Espalda', zones: ['back'], price: 69000, active: true },
    { id: 'classic', name: 'CUSTOM CLASSIC', label: 'Pecho pequeño + espalda', zones: ['chest-small', 'back'], price: 72000, active: true },
    { id: 'full', name: 'CUSTOM FULL', label: 'Pecho grande + espalda', zones: ['chest-large', 'back'], price: 79000, active: true },
  ],

  zones: [
    { id: 'chest-small', label: 'Pecho pequeño', face: 'front', widthCm: 9, heightCm: 12, x: 61, y: 21 },
    { id: 'chest-large', label: 'Pecho grande', face: 'front', widthCm: 28, heightCm: 35, x: 50, y: 20 },
    { id: 'back', label: 'Espalda', face: 'back', widthCm: 30, heightCm: 40, x: 50, y: 17 },
  ],

  // Ancho real (cm) que representa el ancho completo del lienzo de cada cara.
  // La camiseta dibujada mide ~57% del lienzo en el pecho ≈ 56 cm de pecho (talla L oversize).
  mockup: { cmPerWidth: { front: 98, back: 98 } },

  // images.front / images.back: foto o render de la camiseta en ese color (proporción 6:7,
  // camiseta centrada). Vacío = se dibuja la camiseta con el color `hex`.
  colors: [
    { id: 'negro', name: 'Negro', hex: '#141414', active: true, images: { front: '', back: '' } },
    { id: 'blanco', name: 'Blanco', hex: '#f3f1ec', active: true, images: { front: '', back: '' } },
    { id: 'azul-marino', name: 'Azul marino', hex: '#0b0b33', active: false, images: { front: '', back: '' } },
  ],

  sizes: [
    { id: 'XS', active: true }, { id: 'S', active: true }, { id: 'M', active: true },
    { id: 'L', active: true }, { id: 'XL', active: true }, { id: 'XXL', active: true },
  ],

  // Unidades por color y talla: inventory[colorId][sizeId].
  // Vacío o sin dato = disponible sin límite · 0 = agotado · número = unidades disponibles.
  inventory: {},

  // Validación de la imagen de previsualización (en el navegador).
  upload: { maxMb: 25, minDpi: 100, goodDpi: 150 },
};

/** Identificador de las líneas de KOVA CUSTOM en el carrito. */
export const CUSTOM_PRODUCT_ID = 'kova-custom';
