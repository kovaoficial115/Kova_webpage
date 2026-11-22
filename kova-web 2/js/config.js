/**
 * Configuración general de Kova.
 * Todo lo que suele cambiar (enlaces, textos de contacto, moneda) vive aquí.
 */
export const CONFIG = {
  brand: {
    name: 'KOVA',
    tagline: 'Diseño streetwear',
    // Logotipo principal (Manual 2.2): solo sobre azul marino #00001F y nunca por debajo de 200 px de ancho (2.6).
    logo: 'assets/brand/logo-wide.png',
    logoSquare: 'assets/brand/logo.png',
    // Marca responsive (Manual 2.3): para espacios reducidos donde el logotipo principal no cabe.
    mark: 'assets/brand/marca-responsive.svg',
  },

  // WhatsApp Business: aquí llegan los pedidos. El enlace wa.me abre el chat con el mensaje ya escrito.
  whatsapp: {
    number: '573116983724',          // con indicativo de Colombia (57), sin + ni espacios
    display: '+57 311 698 3724',
  },

  // Instagram: solo como canal de contacto (perfil y mensajes directos), no para pedidos.
  instagram: {
    handle: 'kova.wear.co',
    profileUrl: 'https://www.instagram.com/kova.wear.co/',
    contactUrl: 'https://ig.me/m/kova.wear.co',
  },

  // Mensaje predeterminado. {name}, {size}, {price} y {url} se reemplazan automáticamente.
  // {size} queda vacío si el producto no tiene tallas.
  contactMessage: 'Estoy interesado en este producto. {name}{size} ({price}) {url}',

  // Correo para consultas generales y colaboraciones. NO recibe pedidos: los pedidos van por WhatsApp.
  contactEmail: 'kova.oficial.115@gmail.com',

  // WhatsApp e información bancaria se administran desde /admin → Pagos y WhatsApp (Supabase,
  // tabla store_settings). Estos son los valores iniciales mientras el panel no guarde los suyos.
  // Métodos de pago que el comprador elige al finalizar. El pago se hace por fuera de la web y el
  // comprobante se comparte en el chat de WhatsApp. La confirmación del pago es manual.
  payments: [
    {
      id: 'nu',
      label: 'Nu',
      detail: 'Llave Nu',
      key: '3145224180',
      hint: 'Transfiere a esta llave desde la app de Nu o de tu banco. Confirmamos el pago manualmente por WhatsApp.',
    },
    {
      id: 'nequi',
      label: 'Nequi',
      detail: 'Código QR',
      qr: 'assets/pagos/nequi-qr.png',
      holder: 'Kova · Juan Machado',
      hint: 'Escanéalo desde la app de Nequi o de tu banco.',
    },
  ],

  cart: {
    // Clave del carrito en localStorage (solo productos, tallas y cantidades; nunca datos personales).
    storageKey: 'kova.cart.v1',
    // Máximo de unidades por variante (camiseta + talla + color) en un mismo pedido.
    maxQtyPerItem: 10,
  },

  currency: { locale: 'es-CO', code: 'COP' },

  // Base de datos del catálogo (Supabase). Con estos dos datos vacíos la tienda usa js/data/products.js.
  // Se copian de Supabase → Project Settings → API. La clave "anon"/"publishable" es PÚBLICA por diseño:
  // solo permite leer productos publicados; escribir exige iniciar sesión como administrador (ver README).
  // NUNCA pongas aquí la clave "service_role"/"secret".
  backend: {
    supabaseUrl: 'https://vfdpkmqncbhrauqtrnay.supabase.co',
    supabaseAnonKey: 'sb_publishable_oBeBITx1TCiLsVvvK0kA1g_jTXeV6hW',
    table: 'products',
    bucket: 'product-images',
    settingsTable: 'store_settings', // ajustes de KOVA CUSTOM, WhatsApp y pagos
    timeoutMs: 6000,                 // si la base no responde a tiempo, se usa la última copia o products.js
  },
};
