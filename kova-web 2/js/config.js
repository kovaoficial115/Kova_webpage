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

  instagram: {
    handle: 'kova.wear.co',
    profileUrl: 'https://www.instagram.com/kova.wear.co/',
    // Enlace oficial de Instagram que abre directamente el chat (DM) con la cuenta.
    // Instagram NO permite prellenar el mensaje desde una URL pública, por eso
    // el mensaje se copia al portapapeles antes de abrir el enlace.
    // Si prefieres llevar al perfil, usa: contactUrl: 'https://www.instagram.com/kova.wear.co/'
    contactUrl: 'https://ig.me/m/kova.wear.co',
  },

  // Mensaje predeterminado. {name}, {size}, {price} y {url} se reemplazan automáticamente.
  // {size} queda vacío si el producto no tiene tallas.
  contactMessage: 'Estoy interesado en este producto. {name}{size} ({price}) {url}',

  // Correo para consultas generales y colaboraciones. NO recibe pedidos: los pedidos van por Instagram.
  contactEmail: 'kova.oficial.115@gmail.com',

  cart: {
    // Clave del carrito en localStorage (solo productos, tallas y cantidades; nunca datos personales).
    storageKey: 'kova.cart.v1',
    // Máximo de unidades por variante (camiseta + talla + color) en un mismo pedido.
    maxQtyPerItem: 10,
  },

  currency: { locale: 'es-CO', code: 'COP' },
};
