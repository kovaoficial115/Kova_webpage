/**
 * Botón flotante del carrito + panel de resumen rápido.
 * Lo monta layout.js en todas las páginas. En carrito.html no se muestra:
 * esa página ya es el carrito completo.
 * También mantiene al día todos los contadores [data-cart-count] (cabecera incluida).
 */
import { subscribe } from '../services/cart.js';
import { bindCart, linesHtml, summaryHtml, emptyHtml, buyerFormHtml, copyHintHtml, unitsLabel, renderList } from './cartView.js';

export const bagIcon = (cls = '') => `
  <svg class="bag ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4.5 8.5h15l-1.2 12h-12.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/>
    <path d="M8.5 8.5V7a3.5 3.5 0 0 1 7 0v1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
  </svg>`;

/** Actualiza contadores y etiquetas accesibles en toda la página. */
function updateCounters({ units }) {
  document.querySelectorAll('[data-cart-count]').forEach((el) => {
    el.textContent = units > 99 ? '99+' : String(units);
    el.hidden = units === 0;
  });
  document.querySelectorAll('[data-cart-link]').forEach((el) => {
    el.setAttribute('aria-label', units ? `Carrito: ${units} ${units === 1 ? 'unidad' : 'unidades'}` : 'Carrito vacío');
    el.classList.toggle('is-empty', units === 0);
  });
}

export function mountCart() {
  let lastUnits = null;
  const onCartPage = document.body.dataset.page === 'cart';

  if (onCartPage) {
    subscribe((cart) => updateCounters(cart));
    return { open() {} };
  }

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'cart-fab';
  fab.setAttribute('data-cart-link', '');
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.setAttribute('aria-controls', 'cart-panel');
  fab.innerHTML = `${bagIcon()}<span class="cart-fab__count" data-cart-count hidden>0</span>`;

  const panel = document.createElement('dialog');
  panel.id = 'cart-panel';
  panel.className = 'cart-panel s-navy';
  panel.setAttribute('aria-labelledby', 'cart-panel-title');
  panel.innerHTML = `
    <div class="cart-panel__head">
      <div>
        <p class="eyebrow">Tu pedido</p>
        <h2 class="cart-panel__title" id="cart-panel-title">Carrito<span class="dot">.</span></h2>
      </div>
      <span class="cart-panel__units" data-units></span>
      <button class="modal__close" type="button" data-close aria-label="Cerrar carrito"><span></span><span></span></button>
    </div>
    <div class="cart-panel__body">
      <div data-empty-slot></div>
      <div data-filled>
        <ul class="cart-lines cart-lines--compact" data-lines aria-label="Productos en el carrito"></ul>
        <div class="cart-panel__summary" data-summary></div>
        ${buyerFormHtml('cart-panel')}
      </div>
    </div>
    <div class="cart-panel__foot" data-filled>
      ${copyHintHtml()}
      <button class="btn btn--primary btn--xl btn--block" type="submit" form="cart-panel-form">
        Finalizar compra <i class="ico ico--destellos" aria-hidden="true"></i>
      </button>
      <div class="cart-panel__links">
        <button class="btn btn--line btn--sm" type="button" data-close>Seguir comprando</button>
        <a class="btn btn--line btn--sm" href="carrito.html">Ver carrito <span class="btn__arrow" aria-hidden="true">→</span></a>
      </div>
    </div>`;
  document.body.append(fab, panel);

  const lines = panel.querySelector('[data-lines]');
  const emptySlot = panel.querySelector('[data-empty-slot]');
  emptySlot.innerHTML = emptyHtml({ cta: 'Ir al catálogo' });

  const close = () => {
    if (!panel.open) return;
    panel.classList.add('is-closing');
    setTimeout(() => { panel.classList.remove('is-closing'); panel.close(); }, 220);
  };
  const open = () => {
    if (panel.open) return;
    form.fill();
    form.refresh();
    panel.showModal();
    document.body.classList.add('no-scroll');
  };

  fab.addEventListener('click', open);
  panel.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  panel.addEventListener('click', (e) => e.target === panel && close());
  panel.addEventListener('close', () => { document.body.classList.remove('no-scroll'); fab.focus({ preventScroll: true }); });
  // "Ir al catálogo" desde el panel: si ya estamos en el inicio, solo se cierra el panel.
  emptySlot.querySelector('[data-continue]').addEventListener('click', close);

  const form = bindCart(panel, { onCheckoutStart: () => panel.close() });

  subscribe((cart) => {
    updateCounters(cart);
    const empty = cart.lines.length === 0;
    emptySlot.hidden = !empty;
    panel.querySelectorAll('[data-filled]').forEach((el) => { el.hidden = empty; });
    panel.querySelector('[data-units]').textContent = unitsLabel(cart.units);
    const lostFocus = renderList(lines, linesHtml(cart));
    if (lostFocus && panel.open) (empty ? emptySlot.querySelector('a') : panel.querySelector('.modal__close')).focus();
    panel.querySelector('[data-summary]').innerHTML = summaryHtml(cart);
    form.refresh();
    // Pequeño rebote del botón cuando se agregan unidades.
    if (lastUnits !== null && cart.units > lastUnits) {
      fab.classList.remove('is-bump');
      void fab.offsetWidth;
      fab.classList.add('is-bump');
    }
    lastUnits = cart.units;
  });

  return { open, close };
}
