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

  // Métodos de pago que el comprador elige al finalizar. El pago se hace por fuera de la web
  // (app de Nequi o de su banco) y el comprobante se comparte en el chat de WhatsApp.
  payments: [
    {
      id: 'nequi',
      label: 'Nequi',
      detail: 'Código QR',
      qr: 'assets/pagos/nequi-qr.png',
      holder: 'Kova · Juan Machado',
      hint: 'Escanéalo desde la app de Nequi o de tu banco.',
    },
    {
      id: 'banco-bogota',
      label: 'Banco de Bogotá',
      detail: 'Llave',
      key: '1107849275',
      hint: 'Transfiere a esta llave desde la app de tu banco.',
    },
  ],

  cart: {
    // Clave del carrito en localStorage (solo productos, tallas y cantidades; nunca datos personales).
    storageKey: 'kova.cart.v1',
    // Máximo de unidades por variante (camiseta + talla + color) en un mismo pedido.
    maxQtyPerItem: 10,
  },

  currency: { locale: 'es-CO', code: 'COP' },
};
