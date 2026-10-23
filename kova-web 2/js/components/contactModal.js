import { CONFIG } from '../config.js';
import { buildContactMessage, copyContactMessage } from '../services/contact.js';
import { formatPrice } from '../utils/format.js';
import { esc, toast } from '../utils/dom.js';

/**
 * Crea el modal de contacto para un producto y devuelve la función para abrirlo.
 * `open(size)` recibe la talla elegida (si el producto tiene tallas).
 */
export function createContactModal(product) {
  let size = null;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal s-navy';
  dialog.setAttribute('aria-labelledby', 'modal-title');
  dialog.innerHTML = `
    <div class="modal__panel grid-lines">
      <button class="modal__close" type="button" data-close aria-label="Cerrar"><span></span><span></span></button>
      <p class="eyebrow">Pedido directo</p>
      <h2 class="modal__title" id="modal-title">¿Lo quieres?<br>Escríbenos<span class="dot">.</span></h2>

      <div class="modal__product">
        <img src="${product.images[0]}" alt="" width="80" height="100">
        <div>
          <strong>${esc(product.name)}</strong>
          <span class="modal__meta"><span data-size-label></span>${formatPrice(product.price)}</span>
        </div>
      </div>

      <div class="modal__message">
        <span class="modal__label">Mensaje para Instagram</span>
        <p data-message></p>
      </div>

      <a class="btn btn--primary btn--xl btn--block modal__cta" href="${CONFIG.instagram.contactUrl}" target="_blank" rel="noopener">
        Abrir Instagram <span class="btn__arrow" aria-hidden="true">↗</span>
      </a>
      <p class="modal__hint">Al pulsar, copiamos el mensaje: solo pégalo en el chat de @${esc(CONFIG.instagram.handle)}.</p>
    </div>`;
  document.body.append(dialog);

  const close = () => {
    dialog.classList.add('is-closing');
    setTimeout(() => { dialog.classList.remove('is-closing'); dialog.close(); }, 220);
  };
  dialog.querySelector('[data-close]').addEventListener('click', close);
  // Cerrar al hacer clic fuera del panel.
  dialog.addEventListener('click', (e) => e.target === dialog && close());
  dialog.addEventListener('close', () => document.body.classList.remove('no-scroll'));
  dialog.querySelector('.modal__cta').addEventListener('click', async () => {
    const copied = await copyContactMessage(product, size);
    toast(copied ? 'Mensaje copiado. Pégalo en el chat de Instagram.' : 'Abriendo Instagram…');
  });

  return (chosenSize = null) => {
    size = chosenSize;
    dialog.querySelector('[data-message]').textContent = buildContactMessage(product, size);
    dialog.querySelector('[data-size-label]').textContent = size ? `Talla ${size} · ` : '';
    dialog.showModal();
    document.body.classList.add('no-scroll');
  };
}
