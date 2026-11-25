/** Campo de código promocional: escribir, APLICAR, carga, éxito/error y retirar. */
import { applyPromo, removePromo, onPromo, promoValueText } from '../services/promo.js';
import { formatPrice } from '../utils/format.js';
import { esc } from '../utils/dom.js';

export const promoFieldHtml = (prefix) => `
  <div class="promo" data-promo>
    <label class="promo__label" for="${prefix}-promo">Código promocional</label>
    <div class="promo__row" data-promo-form>
      <input class="field__input promo__input" id="${prefix}-promo" type="text" inputmode="text" autocomplete="off" autocapitalize="characters"
        spellcheck="false" maxlength="32" placeholder="Escribe tu código" aria-describedby="${prefix}-promo-msg">
      <button class="btn btn--light promo__apply" type="button" data-promo-apply>Aplicar</button>
    </div>
    <div class="promo__applied" data-promo-applied hidden>
      <span class="promo__chip"><i class="ico ico--destellos" aria-hidden="true"></i><b data-promo-code></b><span data-promo-value></span></span>
      <button class="promo__remove" type="button" data-promo-remove>Quitar código</button>
    </div>
    <p class="promo__msg" id="${prefix}-promo-msg" data-promo-msg aria-live="polite"></p>
  </div>`;

export function bindPromo(root) {
  const box = root.querySelector('[data-promo]');
  if (!box) return;
  const input = box.querySelector('input');
  const apply = box.querySelector('[data-promo-apply]');
  const go = () => applyPromo(input.value);
  apply.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  box.querySelector('[data-promo-remove]').addEventListener('click', () => { removePromo(); input.value = ''; input.focus(); });
  onPromo((s) => {
    const applied = s.status === 'ok';
    box.querySelector('[data-promo-form]').hidden = applied;
    box.querySelector('[data-promo-applied]').hidden = !applied;
    box.classList.toggle('is-loading', s.status === 'loading');
    box.classList.toggle('is-error', s.status === 'error');
    box.classList.toggle('is-ok', applied);
    apply.disabled = s.status === 'loading';
    apply.innerHTML = s.status === 'loading' ? '<span class="spin" aria-hidden="true"></span><span class="sr-only">Validando</span>' : 'Aplicar';
    if (document.activeElement !== input && s.code && !applied) input.value = s.code;
    if (applied) {
      box.querySelector('[data-promo-code]').textContent = s.result.code;
      box.querySelector('[data-promo-value]').textContent = ` −${promoValueText(s.result, formatPrice)} · −${formatPrice(s.result.discount)}`;
    }
    const msg = box.querySelector('[data-promo-msg]');
    msg.textContent = s.status === 'loading' ? 'Validando código…' : s.message ?? '';
    msg.className = `promo__msg${s.status === 'error' ? ' is-error' : ''}${applied ? ' is-ok' : ''}`;
  });
}

/** Filas del resumen relacionadas con el código (si hay uno aplicado). */
export const promoSummaryRows = (s) => (s.status === 'ok' ? `
  <div class="cart-sum__promo"><dt>Código ${esc(s.result.code)} (${esc(promoValueText(s.result, formatPrice))})</dt><dd>−${formatPrice(s.result.discount)}</dd></div>` : '');
