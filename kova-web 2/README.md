

## KOVA CUSTOM (`custom.html`)
Personalización de camisetas con el diseño del cliente: color → talla → estampado → precio → previsualización
opcional → carrito → resumen → **Enviar pedido por WhatsApp**.

- **Diseños originales (nov 2026):** el cliente sube su archivo en el estudio (sirve también para la vista
  previa). Mientras compra, el archivo queda en su navegador (IndexedDB, `js/services/designStore.js`); al registrar
  el pedido, `pedido.html` lo sube al bucket **privado** `custom-designs` usando el enlace privado del pedido. Si falta
  alguno (o es PDF), el cliente lo sube desde la página de su pedido hasta que empiece la producción.
  PNG, JPG, WEBP o PDF · máx. 25 MB. En `/admin` se ven y descargan en el detalle del pedido y en Producción (URL
  firmada de 10 min). Migración: `supabase/migrations/20261126_06_disenos_custom.sql`.
- Un solo carrito: cada personalización es una línea `{ id: 'kova-custom', ref, mode, color, size, qty }`
  en `js/services/cart.js`. El mensaje del pedido (con número `KV-AAMMDD-XXXX`) se arma en `js/services/contact.js`.
- El pedido nunca se marca como confirmado solo: KOVA verifica los diseños y el pago.
- Reglas centralizadas en `js/services/custom.js`; valores iniciales en `js/data/custom.js`
  (precios oficiales: MINI $59.000 · FRONT $65.000 · BACK $69.000 · CLASSIC $72.000 · FULL $79.000).

## Ajustes desde /admin (visibles para todos los clientes)
Pestañas **KOVA Custom** (modalidades, precios, zonas y medidas, colores, imágenes de camisetas, tallas,
inventario por color × talla) y **Pagos y WhatsApp** (número de WhatsApp Business y métodos de pago).
Se guardan en Supabase, tabla `public.store_settings` (lectura pública, escritura solo admins; ver
`supabase/schema.sql`). La tienda los lee en cada visita (`js/services/settings.js`); si la tabla no existe o
no responde, usa los valores de `js/data/custom.js` y `js/config.js`.

Pago por defecto: **Nu — Llave Nu 3145224180** (con botón para copiar) y Nequi con QR. Banco de Bogotá se retiró.

## Preventas, códigos, checkout y panel (nov 2026)
Ver [docs/MANUAL-PREVENTAS-Y-PANEL.md](docs/MANUAL-PREVENTAS-Y-PANEL.md): funciones, migraciones, primeros pasos, pruebas, despliegue y rollback.
