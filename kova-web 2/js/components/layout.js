/** Monta cabecera, pie y carrito compartidos en cualquier página que tenga [data-slot]. */
import { renderHeader, initHeader } from './header.js';
import { renderFooter } from './footer.js';
import { mountCart } from './cartPanel.js';
import { initQuickAdd } from './productCard.js';

export function mountLayout() {
  const header = document.querySelector('[data-slot="header"]');
  const footer = document.querySelector('[data-slot="footer"]');
  if (header) {
    header.innerHTML = renderHeader();
    initHeader(header);
  }
  if (footer) footer.innerHTML = renderFooter();
  mountCart();
  initQuickAdd();
  initReveal();
}

/** Aparición suave de elementos con la clase .reveal al entrar en pantalla. */
export function initReveal(root = document) {
  const items = root.querySelectorAll('.reveal:not(.is-in)');
  if (!('IntersectionObserver' in window)) return items.forEach((el) => el.classList.add('is-in'));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((el) => io.observe(el));
}
