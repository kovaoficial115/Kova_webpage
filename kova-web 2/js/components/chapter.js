import { esc } from '../utils/dom.js';

/**
 * Encabezado de sección con la composición de las portadas de capítulo del manual:
 * número grande translúcido, titular en Anton alineado a la derecha y línea fina con folio.
 *
 *   num    Número del capítulo ('01').
 *   title  Titular.
 *   note   Texto pequeño bajo la línea, a la izquierda.
 *   folio  Texto pequeño bajo la línea, a la derecha (p. ej. un conteo).
 */
export const chapter = ({ num, title, note = '', folio = '', id = '' }) => `
  <header class="chapter reveal">
    <span class="chapter__num" aria-hidden="true">${esc(num)}</span>
    <div class="chapter__body">
      <h2 class="chapter__title"${id ? ` id="${id}"` : ''}>${esc(title)}<span class="dot">.</span></h2>
      <div class="folio chapter__folio"><span>${esc(note)}</span><span>${esc(folio)}</span></div>
    </div>
  </header>`;
