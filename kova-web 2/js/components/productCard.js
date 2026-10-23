import { getCategory, getByCategory, isAvailable, getProductById } from '../services/catalog.js';
import { addItem } from '../services/cart.js';
import { CONFIG } from '../config.js';
import { formatPrice } from '../utils/format.js';
import { esc, toast } from '../utils/dom.js';

// El id va después de # para que funcione en cualquier servidor (algunos, como `npx serve`,
// redirigen producto.html → /producto y borran lo que va después de ?).
export const productUrl = (product) => `producto.html#${encodeURIComponent(product.id)}`;

/** Referencia visible tipo "KV-TEE-01", según la posición del producto en su categoría. */
export const productRef = (product) =>
  `KV-${getCategory(product.category)?.code ?? 'ITM'}-${String(getByCategory(product.category).indexOf(product) + 1).padStart(2, '0')}`;

/**
 * Añadir rápido: botón junto a "Ver producto" (fuera del enlace, para no anidar botones en un <a>).
 * Si el producto tiene tallas, abre un selector de talla sobre la imagen.
 */
function quickAdd(product) {
  const out = product.soldOutSizes ?? [];
  const picker = product.sizes?.length ? `
    <div class="card__picker" role="group" aria-label="Elige la talla de ${esc(product.name)}" hidden>
      <span class="card__pickerLabel">Talla</span>
      ${product.sizes.map((s) => `<button class="card__size" type="button" data-quick-size="${esc(s)}"${out.includes(s) ? ' disabled aria-label="Talla ' + esc(s) + ' agotada"' : ` aria-label="Añadir talla ${esc(s)}"`}>${esc(s)}</button>`).join('')}
      <button class="card__pickerClose" type="button" data-quick-close aria-label="Cerrar selector de talla"><span></span><span></span></button>
    </div>` : '';
  return `
    <div class="card__quick" data-quick="${esc(product.id)}">
      <button class="card__add" type="button" data-quick-add aria-label="Añadir ${esc(product.name)} al carrito"${picker ? ' aria-expanded="false"' : ''}>
        <span class="card__addLabel">Añadir</span><span class="card__addPlus" aria-hidden="true">+</span>
      </button>
      ${picker}
    </div>`;
}

const closePicker = (quick, { focus = false } = {}) => {
  const picker = quick?.querySelector('.card__picker');
  if (!picker || picker.hidden) return;
  picker.hidden = true;
  quick.classList.remove('is-picking');
  quick.closest('.card').classList.remove('is-picking');
  const btn = quick.querySelector('[data-quick-add]');
  btn.setAttribute('aria-expanded', 'false');
  if (focus) btn.focus();
};

function quickAddDone(quick, product, size) {
  const result = addItem(product.id, { size });
  if (!result.ok) return toast('Esta talla no está disponible.');
  toast(result.capped
    ? `Máximo ${CONFIG.cart.maxQtyPerItem} unidades por variante en un pedido.`
    : `Añadido al carrito: ${product.name}${size ? ` (talla ${size})` : ''} · ${result.qty} en el carrito.`);
  closePicker(quick);
  const btn = quick.querySelector('[data-quick-add]');
  btn.classList.add('is-done');
  const [label, plus] = btn.children;
  label.textContent = 'Añadido';
  plus.textContent = '✓';
  btn.focus();
  clearTimeout(btn.timer);
  btn.timer = setTimeout(() => { btn.classList.remove('is-done'); label.textContent = 'Añadir'; plus.textContent = '+'; }, 1600);
}

/** Un solo manejador para todas las tarjetas (también las que se repintan al filtrar). */
export function initQuickAdd() {
  if (initQuickAdd.done) return;
  initQuickAdd.done = true;
  document.addEventListener('click', (e) => {
    const quick = e.target.closest('[data-quick]');
    // Clic fuera: se cierra cualquier selector abierto.
    document.querySelectorAll('.card__quick.is-picking').forEach((q) => q !== quick && closePicker(q));
    if (!quick) return;
    const product = getProductById(quick.dataset.quick);
    if (!product) return;
    if (e.target.closest('[data-quick-close]')) return closePicker(quick, { focus: true });
    const sizeBtn = e.target.closest('[data-quick-size]');
    if (sizeBtn) return quickAddDone(quick, product, sizeBtn.dataset.quickSize);
    if (!e.target.closest('[data-quick-add]')) return;
    const picker = quick.querySelector('.card__picker');
    if (!picker) return quickAddDone(quick, product, null);
    picker.hidden = false;
    quick.classList.add('is-picking');
    quick.closest('.card').classList.add('is-picking');
    quick.querySelector('[data-quick-add]').setAttribute('aria-expanded', 'true');
    picker.querySelector('[data-quick-size]:not([disabled])')?.focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.card__quick.is-picking');
    if (open) closePicker(open, { focus: true });
  });
}

export function productCard(product, index = 0) {
  const soldOut = !isAvailable(product);
  const [front, back] = product.images;
  const tag = soldOut
    ? '<span class="tag tag--out card__tag">Agotado</span>'
    : product.tag ? `<span class="tag card__tag">${esc(product.tag)}</span>` : '';
  const sizes = product.sizes?.length
    ? `<span class="card__sizes" aria-label="Tallas">${product.sizes.map((s) => `<span${product.soldOutSizes?.includes(s) ? ' class="is-out"' : ''}>${esc(s)}</span>`).join('')}</span>`
    : '';
  return `
    <article class="card reveal${soldOut ? ' is-soldout' : ''}${back ? ' has-back' : ''}" style="--i:${index % 4}" data-category="${esc(product.category)}">
      <a class="card__link" href="${productUrl(product)}">
        <div class="card__media">
          <img class="card__img" src="${front}" alt="${esc(product.name)}" width="800" height="1000" loading="lazy" decoding="async">
          ${back ? `<img class="card__img card__img--back" src="${back}" alt="" width="800" height="1000" loading="lazy" decoding="async">` : ''}
          ${tag}
          <i class="ico ico--destellos card__spark" aria-hidden="true"></i>
          <span class="card__cta" aria-hidden="true">Ver producto <span class="btn__arrow">→</span></span>
        </div>
        <div class="card__info">
          <div class="card__row">
            <span class="card__ref">${productRef(product)}</span>
            ${sizes}
          </div>
          <h3 class="card__name">${esc(product.name)}</h3>
          <span class="card__price">${formatPrice(product.price)}</span>
        </div>
      </a>
      ${soldOut ? '' : quickAdd(product)}
    </article>`;
}

export const productGrid = (items) => `<div class="grid">${items.map((p, i) => productCard(p, i)).join('')}</div>`;
