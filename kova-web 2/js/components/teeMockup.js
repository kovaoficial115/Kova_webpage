/**
 * Camiseta dibujada en SVG para KOVA CUSTOM (frente y espalda), en el color que se elija.
 * Lienzo 600 × 700 (proporción 6:7), el mismo sistema de coordenadas de las zonas de estampado.
 * Si el administrador sube fotos de la camiseta para un color, se usan esas en lugar del dibujo.
 */

const BODY = 'M206 58 L130 86 L18 192 L76 276 L132 246 L128 656 Q300 676 472 656 L468 246 L524 276 L582 192 L470 86 L394 58 Z';
const NECK = {
  front: 'M206 58 C232 112 368 112 394 58',
  back: 'M206 58 C238 78 362 78 394 58',
};
const RIB = {
  front: 'M206 58 C232 112 368 112 394 58 L382 60 C356 96 244 96 218 60 Z',
  back: 'M206 58 C238 78 362 78 394 58 L384 60 C352 70 248 70 216 60 Z',
};

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** ¿El color es claro? (para elegir sombras y líneas de las zonas). */
export const isLight = (hex) => luminance(hex) > 0.35;

/** SVG completo de la camiseta. `id` evita choques de gradientes si hay varias en la página. */
export function teeSvg(face = 'front', hex = '#141414', id = 'tee') {
  const light = isLight(hex);
  const shade = light ? '0,0,31' : '0,0,0';
  const hi = light ? '255,255,255' : '255,255,255';
  const hiA = light ? 0.55 : 0.09;
  const shA = light ? 0.10 : 0.45;
  const g = `${id}-${face}`;
  return `
<svg class="tee" viewBox="0 0 600 700" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Camiseta ${face === 'front' ? 'de frente' : 'de espalda'}">
  <defs>
    <linearGradient id="${g}-v" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgb(${hi})" stop-opacity="${hiA}"/>
      <stop offset=".45" stop-color="rgb(${hi})" stop-opacity="0"/>
      <stop offset="1" stop-color="rgb(${shade})" stop-opacity="${shA}"/>
    </linearGradient>
    <linearGradient id="${g}-h" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="rgb(${shade})" stop-opacity="${shA * 0.9}"/>
      <stop offset=".22" stop-color="rgb(${shade})" stop-opacity="0"/>
      <stop offset=".78" stop-color="rgb(${shade})" stop-opacity="0"/>
      <stop offset="1" stop-color="rgb(${shade})" stop-opacity="${shA * 0.9}"/>
    </linearGradient>
    <filter id="${g}-soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="7"/></filter>
    <clipPath id="${g}-clip"><path d="${BODY}"/></clipPath>
  </defs>
  <ellipse cx="300" cy="672" rx="220" ry="14" fill="rgb(0,0,0)" opacity=".18"/>
  <path d="${BODY}" fill="${hex}"/>
  <g clip-path="url(#${g}-clip)">
    <rect width="600" height="700" fill="url(#${g}-v)"/>
    <rect width="600" height="700" fill="url(#${g}-h)"/>
    <g filter="url(#${g}-soft)" fill="none" stroke-linecap="round">
      <path d="M150 300 C175 420 160 540 175 640" stroke="rgb(${shade})" stroke-opacity="${shA * 0.8}" stroke-width="16"/>
      <path d="M452 300 C428 420 444 540 428 640" stroke="rgb(${shade})" stroke-opacity="${shA * 0.8}" stroke-width="16"/>
      <path d="M210 600 C260 585 340 590 395 610" stroke="rgb(${hi})" stroke-opacity="${hiA * 0.6}" stroke-width="10"/>
      <path d="M132 246 C140 210 150 160 170 120" stroke="rgb(${shade})" stroke-opacity="${shA}" stroke-width="10"/>
      <path d="M468 246 C460 210 450 160 430 120" stroke="rgb(${shade})" stroke-opacity="${shA}" stroke-width="10"/>
    </g>
    <path d="M128 640 Q300 660 472 640" fill="none" stroke="rgb(${shade})" stroke-opacity="${shA * 0.9}" stroke-width="2"/>
    <path d="M86 262 L124 242 M514 262 L476 242" stroke="rgb(${shade})" stroke-opacity="${shA * 0.9}" stroke-width="2"/>
  </g>
  <path d="${RIB[face]}" fill="rgb(${shade})" fill-opacity="${light ? 0.08 : 0.35}"/>
  <path d="${NECK[face]}" fill="none" stroke="rgb(${shade})" stroke-opacity="${light ? 0.25 : 0.6}" stroke-width="3"/>
  <path d="${BODY}" fill="none" stroke="rgb(${shade})" stroke-opacity="${light ? 0.22 : 0.5}" stroke-width="2"/>
</svg>`;
}

/** La misma camiseta como imagen (data URL), para miniaturas del carrito. */
export const teeDataUrl = (face, hex) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(teeSvg(face, hex, 'mini').trim())}`;
