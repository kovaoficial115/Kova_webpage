/**
 * KOVA CUSTOM: reglas de negocio en un solo lugar (precios, disponibilidad, zonas y textos).
 * Todos los datos salen de la configuración centralizada (services/settings.js): ningún
 * componente tiene precios ni medidas propios.
 */
import { getCustomConfig } from './settings.js';

const cfg = () => getCustomConfig();

export const getModes = () => cfg().modes.filter((m) => m.active);
export const getMode = (id) => getModes().find((m) => m.id === id);
export const getZone = (id) => cfg().zones.find((z) => z.id === id);
export const getColors = () => cfg().colors.filter((c) => c.active);
export const getColor = (id) => getColors().find((c) => c.id === id);
export const getSizes = () => cfg().sizes.filter((s) => s.active);

/** Zonas de una modalidad, en orden: primero el frente y luego la espalda. */
export const modeZones = (mode) => (mode?.zones ?? []).map(getZone).filter(Boolean)
  .sort((a, b) => (a.face === b.face ? 0 : a.face === 'front' ? -1 : 1));

export const zoneOnFace = (mode, face) => modeZones(mode).find((z) => z.face === face) ?? null;

/** Medidas legibles: "28 × 35 cm". */
export const cmText = (z) => `${fmtCm(z.widthCm)} × ${fmtCm(z.heightCm)} cm`;
const fmtCm = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

/** "9 × 12 cm + 30 × 40 cm" */
export const modeMeasures = (mode) => modeZones(mode).map(cmText).join(' + ');

/**
 * Unidades disponibles de un color y una talla.
 * null = sin control de inventario (disponible) · 0 = agotado · n = unidades.
 */
export function stockOf(colorId, sizeId) {
  const v = cfg().inventory?.[colorId]?.[sizeId];
  return Number.isInteger(v) ? v : null;
}

/** ¿Se puede pedir esta combinación? */
export function isComboAvailable(colorId, sizeId) {
  if (!getColor(colorId) || !getSizes().some((s) => s.id === sizeId)) return false;
  const stock = stockOf(colorId, sizeId);
  return stock === null || stock > 0;
}

/** ¿El color tiene al menos una talla disponible? */
export const colorHasStock = (colorId) => getSizes().some((s) => isComboAvailable(colorId, s.id));

/** Valida una personalización. Devuelve el texto del problema o '' si todo está bien. */
export function validateCustom({ mode, color, size } = {}) {
  if (!getMode(mode)) return 'Esa modalidad de estampado ya no está disponible.';
  if (!getColor(color)) return 'Ese color ya no está disponible.';
  if (!getSizes().some((s) => s.id === size)) return 'Esa talla ya no está disponible.';
  if (!isComboAvailable(color, size)) return `La talla ${size} en ${getColor(color).name.toLowerCase()} está agotada.`;
  return '';
}

/** Precio vigente de una modalidad (incluye camiseta y estampados). */
export const priceOf = (modeId) => getMode(modeId)?.price ?? null;

/** Texto de un estampado para el resumen: "Pecho grande — 28 × 35 cm" o "No aplica". */
export function faceText(mode, face) {
  const z = zoneOnFace(mode, face);
  return z ? `${z.label} — ${cmText(z)}` : 'No aplica';
}

/** Escala de la cara: centímetros reales que representa el ancho del lienzo. */
export const cmPerWidth = (face) => cfg().mockup.cmPerWidth[face] ?? 98;

/** Rectángulo de una zona en porcentaje del lienzo 6:7 (left, top, width, height). */
export function zoneRect(z) {
  const w = (z.widthCm / cmPerWidth(z.face)) * 100;
  // El lienzo es 6:7, así que 1 % de alto equivale a 6/7 % de ancho.
  const h = (z.heightCm / cmPerWidth(z.face)) * 100 * (6 / 7);
  return { left: z.x - w / 2, top: z.y, width: w, height: h };
}

export const uploadRules = () => cfg().upload;
