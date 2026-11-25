# KOVA STREETWEAR · Preventas, códigos, checkout y panel

Guía de lo que se agregó en noviembre de 2026, cómo usarlo y cómo deshacerlo.

## 1. Qué incluye
- **Preventas (Pre-Order):** campañas con fechas de apertura y cierre en hora de Bogotá, productos participantes, límites por producto y por talla × color, anticipo (por defecto 50 %) o pago completo, contador opcional.
- **Códigos promocionales:** porcentaje o valor fijo, vigencia, usos totales y por cliente, mínimo de compra, productos incluidos o excluidos, y bloqueo de códigos que dejan pérdidas o quedan bajo el margen mínimo.
- **Carrito, checkout y pagos:** todos los precios, descuentos y saldos se calculan en la base de datos (`quote_cart`, `create_order`). El navegador nunca decide montos ni estados de pago. El cliente sube su comprobante desde la página de su pedido. Los métodos de pago no cambian: Llave Nu 3145224180 y Nequi con QR.
- **Seguimiento del pedido:** `pedido.html?t=<token>` muestra el estado, los pagos, el saldo pendiente y la guía de envío.
- **Panel /admin:** Dashboard, Productos, Inventario, Pedidos, Preventas, Códigos, Producción, Clientes, KOVA Custom, Estadísticas y Configuración.

## 2. Base de datos
Migraciones en `supabase/migrations/`, en orden:
1. `20261125_01_estructura.sql`: tablas, RLS y roles (`owner`, `admin`, `production`).
2. `20261125_02_funciones_tienda.sql`: funciones públicas de la tienda.
3. `20261125_03_funciones_panel.sql`: funciones del panel (todas verifican el rol dentro de la función).
4. `20261125_04_endurecimiento.sql`: ajustes del asesor de seguridad de Supabase.

Estado en producción (25 nov 2026): las 4 aplicadas, 22 tablas con RLS, productos intactos, 0 pedidos, 0 códigos, y la preventa PSYCHE_01 en **borrador, sin fechas**.

No hay variables de entorno nuevas. La tienda sigue usando solo la clave pública de Supabase.

## 3. Primeros pasos en el panel
**Activar la primera preventa**
1. Entra a `/admin` → **Preventas** → PSYCHE_01.
2. Llena la fecha de apertura, la fecha de cierre y la entrega estimada. Ninguna viene precargada: deben ser fechas reales.
3. Revisa los productos participantes y los límites (déjalos vacíos si no hay límite).
4. Guarda y pulsa **Activar**. Si falta algún dato obligatorio, el panel te dice cuál.

**Crear el primer código**
1. **Códigos** → **Nuevo código**. Puedes escribirlo o generarlo al azar.
2. Mira la vista de rentabilidad antes de guardar. Los productos sin costo registrado se marcan como "sin costo".
3. El código se crea **inactivo** hasta que lo actives tú.

**Agregar a alguien de producción**
1. La persona crea su usuario en Supabase → Authentication → Users.
2. En el SQL Editor ejecuta:
   `insert into public.admins (user_id, role) select id, 'production' from auth.users where email = 'correo@ejemplo.com';`
3. Esa persona solo verá **Producción**, sin datos personales ni montos.

## 4. Pruebas
Se ejecutan en local, nunca contra producción:
- `sh tests/db/run.sh`: 95 comprobaciones de base de datos (precios, descuentos, permisos y RLS).
- `bash tests/db/concurrencia.sh`: compras simultáneas del último cupo y del último uso de un código.
- `bash tests/e2e/run.sh`: 25 comprobaciones de la tienda y 33 del panel en Chrome, contra un simulador local de Supabase.

Resultado del 25 nov 2026: todo correcto.

## 5. Despliegue
`npx wrangler pages deploy "kova-web 2" --project-name catalogo-hova --branch main` desde la raíz del repositorio.

## 6. Cómo deshacer (rollback)
- **Sitio web:** en Cloudflare Pages → catalogo-hova → Deployments, elige el despliegue anterior y pulsa **Rollback**. El código anterior también queda en la rama `respaldo-pre-preventas-2026-11-25`.
- **Base de datos:** las migraciones solo agregan; no borran ni modifican datos existentes. El sitio anterior sigue funcionando con la base nueva, así que no es necesario revertirla. Si de todas formas quieres apagar las preventas, deja la campaña en **Pausada** o **Cerrada** desde el panel. No borres tablas que ya tengan pedidos.
