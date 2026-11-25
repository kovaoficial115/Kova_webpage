

## KOVA CUSTOM (`custom.html`)
Personalización de camisetas con el diseño del cliente: color → talla → estampado → precio → previsualización
opcional → carrito → resumen → **Enviar pedido por WhatsApp**.

- **Los diseños NO se suben a ningún servidor.** La imagen elegida solo se usa en el navegador para la
  previsualización (mover, escalar con dedos/ratón/teclado, centrar, restablecer, aviso de resolución en ppp).
  Al carrito pasa solo el nombre del archivo y una miniatura pequeña (localStorage). El cliente adjunta los
  archivos originales en el chat de WhatsApp; el resumen le indica cuál es FRENTE y cuál ESPALDA.
- Un solo carrito: cada personalización es una línea `{ id: 'kova-custom', ref, mode, color, size, qty }`
  en `js/services/cart.js`. El mensaje del pedido (con número `KV-AAMMDD-XXXX`) se arma en `js/services/contact.js`.
- El pedido nunca se marca como confirmado: KOVA lo verifica por WhatsApp (mensaje, archivos y pago manual).
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
