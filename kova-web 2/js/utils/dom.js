/** Escapa texto antes de insertarlo como HTML. */
export const esc = (value = '') =>
  String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export const $ = (selector, root = document) => root.querySelector(selector);

/** Muestra un aviso breve en pantalla. */
export function toast(message) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<i class="ico ico--destellos" aria-hidden="true"></i><span></span>';
    document.body.append(el);
  }
  el.querySelector('span').textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('is-visible'), 3200);
}
