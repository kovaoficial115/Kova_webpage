# KOVA — Catálogo web

Sitio estático (HTML + CSS + JavaScript sin frameworks ni compilación).

## Ejecutar en local
Los módulos de JavaScript necesitan un servidor (abrir el HTML con doble clic no funciona). Desde esta carpeta:

```bash
npx serve .            # o: python3 -m http.server 8080
```
Luego abre http://localhost:3000 (o :8080).

## Administrar productos (panel /admin)
Los productos se gestionan desde un panel visual, sin tocar código: **`<dirección de la tienda>/admin/`**
(por ejemplo `https://kovaoficial115.github.io/kova_webpage/kova-web%202/admin/`). El enlace no aparece en la tienda.

### Cómo funciona
| Pieza | Dónde vive |
|---|---|
| Catálogo público (HTML/CSS/JS) | Este repositorio, en GitHub Pages (hosting estático) |
| Productos | Base de datos **Supabase** (tabla `products`) |
| Imágenes subidas | **Supabase Storage** (bucket público `product-images`) |
| Inicio de sesión del administrador | **Supabase Auth** (correo + contraseña) |
| Respaldo si Supabase no responde | Última copia guardada en el navegador del visitante y, si no hay, `js/data/products.js` |

**Por qué Supabase:** GitHub Pages solo sirve archivos; no puede guardar datos ni verificar contraseñas. Supabase
da en un solo servicio (plan gratuito) base de datos, inicio de sesión real y almacenamiento de imágenes, y se usa
directamente desde el navegador, así que la web sigue siendo estática y no hace falta un servidor propio.

**Seguridad:** el navegador solo conoce la clave *pública* (`anon`/`publishable`). La protección la hace la base de
datos con reglas RLS (`supabase/schema.sql`):
- Cualquiera puede **leer** los productos con `published = true` y ver las imágenes (lo necesita la tienda).
- **Crear, editar, ocultar, eliminar y subir/borrar imágenes** exige una sesión iniciada **y** que ese usuario esté
  en la tabla `admins`. Aunque alguien encuentre `/admin` o use la API a mano, la base rechaza la operación.
- Los productos ocultos no se entregan al público (la base no los devuelve sin sesión de administrador).

## Configuración inicial (una sola vez)
1. **Crear el proyecto:** entra a [supabase.com](https://supabase.com), crea una cuenta y un proyecto nuevo
   (región *South America (São Paulo)* es la más cercana).
2. **Crear tablas y reglas:** en *SQL Editor → New query* pega todo `supabase/schema.sql` y pulsa *Run*.
3. **Migrar los productos actuales:** en otra consulta pega `supabase/seed.sql` y pulsa *Run*. Copia los 5 productos
   de `products.js` con todos sus campos (no sobrescribe nada si ya existen). *(Alternativa: el panel ofrece un botón
   «Importar productos actuales» cuando la base está vacía.)*
4. **Crear tu usuario:** *Authentication → Users → Add user → Create new user*, con tu correo y una contraseña segura,
   marcando *Auto Confirm User*.
5. **Primer administrador:** en *SQL Editor* ejecuta (con tu correo):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'TU-CORREO@gmail.com'
   on conflict do nothing;
   ```
   Para quitarle el acceso a alguien: `delete from public.admins where user_id = (select id from auth.users where email = '...');`
6. **Cerrar registros públicos:** *Authentication → Sign In / Providers →* desactiva **Allow new users to sign up**.
   (Aunque quedara activo, una cuenta nueva no es administradora y no puede modificar nada.)
7. **Recuperar contraseña (opcional):** en *Authentication → URL Configuration* pon como *Site URL* la dirección del
   panel (`…/admin/`) para que el enlace de «¿Olvidaste tu contraseña?» vuelva al panel.
8. **Conectar la web:** en *Project Settings → API* copia **Project URL** y la clave **anon public** (o
   **publishable**) y pégalas en `js/config.js`:
   ```js
   backend: {
     supabaseUrl: 'https://xxxxxxxx.supabase.co',
     supabaseAnonKey: 'eyJhbGciOi…',   // clave pública. NUNCA la "service_role" / "secret"
     …
   }
   ```
   Sube el cambio a GitHub. Desde ese momento la tienda lee los productos de Supabase.

No hay variables de entorno ni archivos `.env`: al ser un sitio estático sin compilación, la configuración son estos
dos valores públicos en `js/config.js`. La clave `service_role`/`secret` y la contraseña de la base **no se usan en
la web** y no deben ponerse en ningún archivo del repositorio.

## Uso del panel
- **Entrar:** `/admin/` → correo y contraseña. **Salir:** botón *Salir* (arriba a la derecha).
- **Inventario:** todos los productos con miniatura, precio, categoría, tallas y estado; contadores de publicados,
  ocultos y destacados; buscador por nombre o identificador; filtros por categoría, etiqueta y estado.
- **Crear:** *Nuevo producto*. El identificador (la URL `producto.html#…`) se genera solo desde el nombre.
- **Editar:** *Editar* en la fila. El identificador de un producto existente no se cambia (rompería enlaces y
  carritos guardados); para usar otro, *Duplicar* y luego eliminar el original.
- **Publicar / Ocultar:** botón rápido en la fila o interruptor *Publicado* en el formulario. Oculto = no aparece en
  la tienda, pero se conserva.
- **Duplicar:** crea una copia oculta con todos los datos, para variantes de un diseño.
- **Eliminar:** pide confirmación; borra el producto y sus imágenes subidas (si ningún otro producto las usa).
  No se puede deshacer.
- **Tallas:** pulsa las tallas estándar o escribe otra (3XL, 28…); debajo marcas las agotadas (salen tachadas).
- **Destacado** (portada), **Disponible** (si se apaga sale «Agotado»), **Etiqueta** (NEW, DROP 01, LIMITED…),
  **Detalles** y **Colores** (opcional) tienen su control propio. Hay una vista previa de la tarjeta.
- Si sales con cambios sin guardar, el panel avisa. Los errores (falta el nombre, precio inválido, identificador
  repetido, sin imágenes…) se muestran junto a cada campo.

### Imágenes
- *Subir imágenes* o arrastra fotos desde el computador (JPG, PNG, WebP, SVG). Se ven en miniatura antes de guardar
  y se suben al pulsar *Guardar*.
- El panel las reduce a 1600 px y las convierte a WebP automáticamente (máx. 5 MB ya optimizadas).
  Recomendado: proporción 4:5 (p. ej. 1200 × 1500).
- La **01** es la principal; la **02** aparece al pasar el cursor por la tarjeta. Cambia el orden con las flechas,
  arrastrando, o con ★ (usar como principal). ⟳ reemplaza y ✕ quita.
- Se guardan en Supabase Storage con una URL pública permanente; la tienda las carga desde ahí. Las imágenes que ya
  estaban en el repositorio (`assets/products/…`) siguen funcionando igual.

### Caché y respaldo
- La tienda consulta la base en cada visita sin caché (`cache: 'no-store'`): un cambio guardado se ve al recargar,
  en cualquier dispositivo.
- Si Supabase falla o tarda más de 6 s (`CONFIG.backend.timeoutMs`), la tienda usa la última copia que ese navegador
  vio y, si no hay, `js/data/products.js`. El carrito y el pedido por WhatsApp funcionan igual en los tres casos.
- *Descargar respaldo (products.js)* (al pie del inventario) genera un `products.js` con el catálogo actual: súbelo
  a `js/data/` de vez en cuando para que el respaldo esté al día.

### Limitaciones
- **GitHub Pages** no ejecuta código de servidor: por eso toda la seguridad está en las reglas de Supabase, no en
  la página. Las páginas de la tienda y del panel son públicas; los datos y las escrituras no.
- Plan gratuito de Supabase: 500 MB de base, 1 GB de imágenes y el proyecto se **pausa tras 7 días sin actividad**
  (visitas a la tienda cuentan). Si se pausa, la tienda usa el respaldo hasta que lo reactives desde supabase.com.
- Las **categorías** siguen en `js/data/categories.js` (hoy solo Camisetas); agregar una nueva es un cambio de código.
- El orden de los productos es el de creación (los nuevos al final).

## Ejecutar el panel en local
Igual que la tienda (`npx serve .`) y abre `http://localhost:3000/admin/`. Usa la misma base de Supabase de
`js/config.js`.

## Agregar una categoría (p. ej. accesorios)
Añade una entrada en `js/data/categories.js` (con `cover` opcional para la imagen de su tarjeta). Su filtro, su tarjeta y su enlace del menú se generan solos cuando tenga productos.

## Qué se cambia dónde
| Qué | Dónde |
|---|---|
| WhatsApp (pedidos), Instagram (contacto) y mensaje predeterminado | `js/config.js` |
| Logo | `assets/brand/` + `CONFIG.brand.logo` en `js/config.js` |
| Tipografías | `assets/fonts/` + `css/fonts.css` |
| Colores y medidas | variables al inicio de `css/base.css` |
| Productos | Panel `/admin` (Supabase). `js/data/products.js` es solo el respaldo |
| Categorías | `js/data/categories.js` |
| Conexión a Supabase | `CONFIG.backend` en `js/config.js` |

## Estructura
```
index.html, producto.html,
carrito.html                  Páginas (solo contenedores; el contenido lo genera JS)
css/  fonts · base (variables, botones, ventana) · components · pages
js/
  config.js                   Configuración de marca y contacto
  data/                       products.js (respaldo), categories.js
  services/catalog.js         Único acceso a los datos: Supabase → copia del navegador → products.js
  services/remoteCatalog.js   Lectura pública de Supabase y conversión fila ↔ producto
  services/cart.js            Estado único del carrito (localStorage) y validación del comprador
  services/contact.js         Mensaje del pedido y apertura de WhatsApp con el texto ya escrito
  components/                 header, footer, productCard, contactModal, layout, cartPanel, cartView
  pages/                      home.js, product.js, cart.js
  utils/                      formato de precio, helpers del DOM
assets/  brand · fonts · products
admin/                        Panel de administración (index.html, admin.css, js/, vendor/supabase-js)
supabase/                     schema.sql (tablas + seguridad), seed.sql (productos actuales), generar-seed.mjs
```

## WhatsApp e Instagram
Los pedidos llegan al WhatsApp Business de Kova (`CONFIG.whatsapp` en `js/config.js`). El botón abre
`https://wa.me/573116983724?text=…` con el mensaje del pedido ya escrito; además lo copia al portapapeles
como respaldo. Instagram (`CONFIG.instagram`) queda solo como canal de contacto.

## Carrito y compra
- En la página de producto se elige la talla y se pulsa **Añadir al carrito**. Cada talla (y color, si el
  producto define `colors`) es una línea distinta.
- Botón flotante con el total de unidades + panel de resumen, y página completa `carrito.html` (enlace
  "Carrito" en la cabecera). Los tres usan el mismo estado (`js/services/cart.js`).
- El carrito se guarda en `localStorage` (solo id, talla, color y cantidad; precios y nombres siempre salen
  del catálogo). Nombre y teléfono del comprador solo se guardan en la pestaña (`sessionStorage`).
- **Finalizar compra** valida nombre, teléfono y método de pago, y abre WhatsApp con el pedido ya escrito.
  El aviso final muestra el mensaje por si hay que copiarlo a mano.
- Métodos de pago (Nequi con QR y llave Banco de Bogotá): `CONFIG.payments` en `js/config.js`. El QR está en
  `assets/pagos/nequi-qr.png`. El método elegido va en el mensaje y el aviso final muestra cómo pagar.
- Máximo de unidades por variante: `CONFIG.cart.maxQtyPerItem`.
- Correo para asuntos que no son pedidos: `CONFIG.contactEmail` (aparece en el pie).

## Preparado para ventas
- Precios como número (`85000`) → listos para sumar en un carrito.
- Campos opcionales documentados en `products.js`: `sizes`, `colors`, `stock`, `variants`.
- `services/contact.js` es el único punto a reemplazar por "agregar al carrito"/checkout.
- `services/catalog.js` aísla los datos: las páginas no saben si vienen de Supabase o del respaldo.

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
