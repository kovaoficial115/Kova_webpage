# KOVA — Catálogo web

Sitio estático (HTML + CSS + JavaScript sin frameworks ni compilación).

## Ejecutar en local
Los módulos de JavaScript necesitan un servidor (abrir el HTML con doble clic no funciona). Desde esta carpeta:

```bash
npx serve .            # o: python3 -m http.server 8080
```
Luego abre http://localhost:3000 (o :8080).

## Agregar un producto
1. Copia las imágenes a `assets/products/<categoría>/` (JPG o WebP, proporción 4:5, ~1200 px de ancho, idealmente < 250 KB).
2. Agrega un objeto en `js/data/products.js` (el archivo explica cada campo: nombre, precio, imágenes,
   descripción, categoría, tallas, tallas agotadas, disponibilidad y detalles de la etiqueta).
3. Listo: aparece en el catálogo y en su filtro, en "Destacados" si `featured: true`, y tiene su página en
   `producto.html#<id>` con selector de tallas y botón de compra. No hay que tocar HTML ni CSS.

## Agregar una categoría (p. ej. accesorios)
Añade una entrada en `js/data/categories.js` (con `cover` opcional para la imagen de su tarjeta). Su filtro, su tarjeta y su enlace del menú se generan solos cuando tenga productos.

## Qué se cambia dónde
| Qué | Dónde |
|---|---|
| Enlace de Instagram y mensaje predeterminado | `js/config.js` |
| Logo | `assets/brand/` + `CONFIG.brand.logo` en `js/config.js` |
| Tipografías | `assets/fonts/` + `css/fonts.css` |
| Colores y medidas | variables al inicio de `css/base.css` |
| Productos / categorías | `js/data/` |

## Estructura
```
index.html, producto.html,
carrito.html                  Páginas (solo contenedores; el contenido lo genera JS)
css/  fonts · base (variables, botones, ventana) · components · pages
js/
  config.js                   Configuración de marca y contacto
  data/                       products.js, categories.js
  services/catalog.js         Único acceso a los datos (cambiar aquí si luego vienen de una API/CMS)
  services/cart.js            Estado único del carrito (localStorage) y validación del comprador
  services/contact.js         Mensaje del pedido, copia al portapapeles y apertura del chat de Instagram
  components/                 header, footer, productCard, contactModal, layout, cartPanel, cartView
  pages/                      home.js, product.js, cart.js
  utils/                      formato de precio, helpers del DOM
assets/  brand · fonts · products
```

## Instagram
Instagram no permite prellenar un mensaje desde una URL pública. Por eso el botón copia el mensaje
al portapapeles y abre `https://ig.me/m/kova.wear.co` (enlace oficial al chat directo). Si prefieres
llevar al perfil, cambia `contactUrl` en `js/config.js`.

## Carrito y compra
- En la página de producto se elige la talla y se pulsa **Añadir al carrito**. Cada talla (y color, si el
  producto define `colors`) es una línea distinta.
- Botón flotante con el total de unidades + panel de resumen, y página completa `carrito.html` (enlace
  "Carrito" en la cabecera). Los tres usan el mismo estado (`js/services/cart.js`).
- El carrito se guarda en `localStorage` (solo id, talla, color y cantidad; precios y nombres siempre salen
  del catálogo). Nombre y teléfono del comprador solo se guardan en la pestaña (`sessionStorage`).
- **Finalizar compra** valida nombre y teléfono, copia el mensaje del pedido y abre `contactUrl`
  (`js/config.js`). Si la copia falla, el aviso muestra el mensaje para copiarlo a mano.
- Métodos de pago (Nequi con QR y llave Banco de Bogotá): `CONFIG.payments` en `js/config.js`. El QR está en
  `assets/pagos/nequi-qr.png`. El método elegido va en el mensaje y el aviso final muestra cómo pagar.
- Máximo de unidades por variante: `CONFIG.cart.maxQtyPerItem`.
- Correo para asuntos que no son pedidos: `CONFIG.contactEmail` (aparece en el pie).

## Preparado para ventas
- Precios como número (`85000`) → listos para sumar en un carrito.
- Campos opcionales documentados en `products.js`: `sizes`, `colors`, `stock`, `variants`.
- `services/contact.js` es el único punto a reemplazar por "agregar al carrito"/checkout.
- `services/catalog.js` aísla los datos: se puede pasar a una API o panel de gestión sin tocar las páginas.

## Sistema visual (Manual de marca de Kova)
El diseño traduce el manual (`/Manual de marca.ai`) a la web:
- **Paleta** (3.3): azul marino `#00001F` como base, arena `#F0E7DE` como neutro y escarlata `#D21625`
  solo como acento (compra, etiquetas, puntos finales de los titulares). Variables al inicio de `css/base.css`.
- **Tipografías** (3.1–3.2): Anton para titulares, destacados y subtítulos; Satoshi para textos.
- **Logotipo** (2.2–2.6): siempre sobre azul marino, en una esquina, a 200 px de ancho (mínimo web)
  y con su área de limpieza. La **marca responsive** (`assets/brand/marca-responsive.svg`) se usa en
  espacios reducidos: favicon y etiqueta del producto.
- **Íconos y patrones** (3.5–3.6): extraídos tal cual del manual en `assets/brand/icons/` y
  `assets/brand/patterns/` (órbitas, "kova" y conectores). Los íconos se colorean con CSS (`.ico--<nombre>`).
- **Composición**: retícula de líneas finas, números de capítulo grandes y translúcidos, titular a la
  derecha y línea con folio, como las portadas del manual. Superficies alternas azul marino / arena.
- **Fotografía**: `assets/img/` tiene las imágenes de campaña (mockups editoriales de Kova).

## Recursos de marca y provisionales
- Logo oficial en `assets/brand/` (logo.png cuadrado, logo-wide.png horizontal con fondo transparente,
  favicon.png y apple-touch-icon.png con la marca responsive).
- Tipografías en WOFF2: Anton (títulos, licencia OFL en `assets/fonts/Anton-OFL.txt`) y Satoshi variable (textos).
- `assets/products/**/*.svg` — imágenes provisionales hechas con los íconos del manual; reemplazar por fotos reales.
