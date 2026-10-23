/**
 * Página del carrito completo (carrito.html).
 * Usa el mismo estado que el panel flotante y la cabecera (services/cart.js).
 */
import { subscribe } from '../services/cart.js';
import { bindCart, linesHtml, summaryHtml, emptyHtml, buyerFormHtml, unitsLabel, renderList } from '../components/cartView.js';
import { chapter } from '../components/chapter.js';
import { mountLayout } from '../components/layout.js';

const main = document.querySelector('main');

main.innerHTML = `
  <section class="section s-arena cartpage">
    <div class="container">
      <nav class="crumbs" aria-label="Ruta">
        <a href="index.html">Inicio</a><i class="ico ico--destellos" aria-hidden="true"></i>
        <a href="index.html#catalogo">Catálogo</a><i class="ico ico--destellos" aria-hidden="true"></i>
        <span aria-current="page">Carrito</span>
      </nav>
      ${chapter({ num: 'KV', title: 'Tu carrito', note: 'Revisa tu pedido antes de enviarlo por Instagram', folio: '00 unidades' })}

      <div class="cartpage__empty grid-lines" data-empty hidden>${emptyHtml({ cta: 'Volver al catálogo' })}</div>

      <div class="cartpage__grid" data-filled hidden>
        <div class="cartpage__list">
          <div class="cartpage__cols" aria-hidden="true">
            <span>Producto</span><span>Cantidad</span><span>Subtotal</span><span>Acción</span>
          </div>
          <ul class="cart-lines" data-lines aria-label="Productos en el carrito"></ul>
          <a class="cartpage__back" href="index.html#catalogo"><span class="btn__arrow" aria-hidden="true">←</span> Seguir comprando</a>
        </div>

        <aside class="cartpage__summary s-navy grid-lines" aria-labelledby="cart-summary-title">
          <p class="eyebrow">Pedido directo</p>
          <h2 class="cartpage__sumTitle" id="cart-summary-title">Resumen<span class="dot">.</span></h2>
          <div data-summary></div>
          ${buyerFormHtml('cart-page')}
          <button class="btn btn--primary btn--xl btn--block" type="submit" form="cart-page-form">
            Finalizar compra <i class="ico ico--destellos" aria-hidden="true"></i>
          </button>
          <a class="btn btn--line btn--block cartpage__continue" href="index.html#catalogo">Seguir comprando</a>
          <p class="cartpage__note"><i class="ico ico--orbita" aria-hidden="true"></i> Al finalizar copiamos tu pedido y abrimos el chat de Instagram. Pago y envío se acuerdan por mensaje.</p>
        </aside>
      </div>
    </div>
  </section>`;

mountLayout();

const page = main.querySelector('.cartpage');
const lines = page.querySelector('[data-lines]');
const folio = page.querySelector('.chapter__folio span:last-child');
const form = bindCart(page);

subscribe((cart) => {
  const empty = cart.lines.length === 0;
  page.querySelector('[data-empty]').hidden = !empty;
  page.querySelector('[data-filled]').hidden = empty;
  folio.textContent = unitsLabel(cart.units);
  const lostFocus = renderList(lines, linesHtml(cart));
  if (lostFocus) (empty ? page.querySelector('[data-empty] a') : page.querySelector('.cartpage__back')).focus();
  page.querySelector('[data-summary]').innerHTML = summaryHtml(cart);
  form.refresh();
});
