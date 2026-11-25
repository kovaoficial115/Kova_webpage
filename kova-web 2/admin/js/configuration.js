/**
 * Configuración: opciones de envío, textos legales, reglas generales de pedidos y protección de rentabilidad.
 * Envíos y textos legales son públicos (store_settings); reglas y rentabilidad son privadas (admin_settings).
 * Pagos/WhatsApp y KOVA Custom conservan sus pantallas propias.
 */
import { db, saveSetting, getSettings } from './api.js';
import { run, errText, esc, toast, money, loading, errorBox, head, setBusy, intOrNull, dt } from './ops.js';
import { legalDefaults } from '../../js/data/legal.js';

export async function renderConfiguration(view) {
  loading(view, 'Cargando configuración');
  try {
    const [pub, { data: priv }] = await Promise.all([getSettings(), run(db().from('admin_settings').select('key,value,updated_at'))]);
    const p = Object.fromEntries(priv.map((r) => [r.key, r.value]));
    draw(view, pub, p, priv);
  } catch (err) { errorBox(view, err, () => renderConfiguration(view)); }
}

const shipRow = (o = {}) => `
  <li class="adm-pay" data-ship>
    <div class="adm-two">
      <label class="field"><span class="field__label">Nombre visible <span>*</span></span><input class="field__input" data-s="label" value="${esc(o.label ?? '')}" maxlength="80" placeholder="Ej. Envío a Cali"></label>
      <label class="field"><span class="field__label">Costo (COP)</span><input class="field__input" data-s="cost" inputmode="numeric" value="${o.cost ?? ''}" placeholder="Vacío = por confirmar"><span class="field__hint">0 = sin costo. Vacío = se confirma por WhatsApp.</span></label>
    </div>
    <label class="field"><span class="field__label">Descripción corta</span><input class="field__input" data-s="description" value="${esc(o.description ?? '')}" maxlength="120" placeholder="Ej. 2 a 4 días hábiles"></label>
    <input type="hidden" data-s="id" value="${esc(o.id ?? '')}">
    <label class="adm-check"><input type="checkbox" data-s="requires_address"${o.requires_address === false ? '' : ' checked'}> Pide dirección</label>
    <label class="adm-check"><input type="checkbox" data-s="active"${o.active === false ? '' : ' checked'}> Visible en el checkout</label>
    <button class="adm-link" type="button" data-ship-del>Quitar opción</button>
  </li>`;
const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function draw(view, pub, priv, privRows) {
  const ship = pub.shipping?.options?.length ? pub.shipping.options : [{ id: 'coordinar', label: 'Envío nacional (costo a confirmar por WhatsApp)', cost: null, requires_address: true, active: true }];
  const legal = pub.legal?.sections?.length ? pub.legal : legalDefaults;
  const g = priv.general ?? {};
  const pr = priv.profit ?? { mode: 'warn', min_margin_pct: null };
  const upd = (k) => privRows.find((r) => r.key === k)?.updated_at;
  view.innerHTML = `
  <div class="adm-wrap">
    ${head('Tienda', 'Configuración')}
    <nav class="adm-subnav" aria-label="Secciones de configuración">
      <a href="#cfg-envios">Envíos</a><a href="#cfg-legal">Textos legales</a><a href="#cfg-reglas">Reglas de pedidos</a><a href="#cfg-rent">Rentabilidad</a>
      <a href="#/ajustes">Pagos y WhatsApp →</a><a href="#/custom">KOVA Custom →</a></nav>

    <form class="adm-card" id="cfg-envios" data-form="ship"><h2 class="adm-card__title">Opciones de envío</h2>
      <p class="adm-muted">El cliente elige una en el checkout. Si el costo está vacío, el pedido queda «+ envío por confirmar» y lo defines después en el detalle del pedido.</p>
      <ul class="adm-pays" data-ships>${ship.map(shipRow).join('')}</ul>
      <button class="adm-link" type="button" data-ship-add>+ Agregar opción</button>
      <div class="adm-card__foot"><button class="btn btn--primary btn--sm">Guardar envíos</button></div></form>

    <form class="adm-card" id="cfg-legal" data-form="legal"><h2 class="adm-card__title">Textos legales</h2>
      <p class="adm-muted">Se muestran en <a href="../condiciones.html" target="_blank" rel="noopener">condiciones.html</a> y el cliente los acepta en el checkout (se guarda la versión aceptada con cada pedido). Son un borrador basado en la Ley 1480 de 2011 y la Ley 1581 de 2012: <b>revísalos con un abogado</b> y completa los datos entre [corchetes].</p>
      ${legal.sections.map((s, i) => `<fieldset class="adm-fs"><legend>${esc(s.title)}</legend>
        <input type="hidden" data-l-id="${i}" value="${esc(s.id)}"><label class="field"><span class="field__label">Título</span><input class="field__input" data-l-title="${i}" value="${esc(s.title)}" maxlength="80"></label>
        <label class="field"><span class="field__label">Texto</span><textarea class="field__input" data-l-body="${i}" rows="8" maxlength="8000">${esc(s.body)}</textarea></label></fieldset>`).join('')}
      <label class="adm-check"><input type="checkbox" name="reviewed"${legal.reviewed ? ' checked' : ''}> Los textos fueron revisados por KOVA (quita el aviso «pendiente de revisión»)</label>
      ${/\[[^\]]+\]/.test(legal.sections.map((s) => s.body).join(' ')) ? '<p class="adm-bad">Aún hay datos entre [corchetes] por completar.</p>' : ''}
      <div class="adm-card__foot"><button class="btn btn--primary btn--sm">Guardar textos legales</button></div></form>

    <form class="adm-card" id="cfg-reglas" data-form="general"><h2 class="adm-card__title">Reglas de pedidos</h2>
      <div class="adm-two">
        <label class="field"><span class="field__label">Prefijo de pedidos de venta normal</span><input class="field__input" name="order_prefix" value="${esc(g.order_prefix ?? 'WEB')}" maxlength="6" style="text-transform:uppercase"><span class="field__hint">Quedan como KOVA-${esc(g.order_prefix ?? 'WEB')}-000001. Las preventas usan el prefijo de su campaña.</span></label>
        <label class="field"><span class="field__label">Vigencia de un pedido normal sin pago (horas)</span><input class="field__input" name="hold_hours_normal" inputmode="numeric" value="${g.hold_hours_normal ?? 24}"></label>
        <label class="field"><span class="field__label">Plazo para revisar comprobantes (horas)</span><input class="field__input" name="verification_hours" inputmode="numeric" value="${g.verification_hours ?? 48}"><span class="field__hint">Pasado el plazo el pedido aparece como «verificación vencida» en el Dashboard.</span></label>
        <label class="field"><span class="field__label">Máximo de unidades por producto en un pedido</span><input class="field__input" name="max_units_per_line" inputmode="numeric" value="${g.max_units_per_line ?? 10}"></label>
        <label class="field"><span class="field__label">Pedidos por hora desde una misma conexión</span><input class="field__input" name="max_orders_per_hour_per_ip" inputmode="numeric" value="${g.max_orders_per_hour_per_ip ?? 8}"><span class="field__hint">Protección contra abuso.</span></label>
        <label class="field"><span class="field__label">Intentos de código cada 10 minutos</span><input class="field__input" name="max_promo_checks_per_10min" inputmode="numeric" value="${g.max_promo_checks_per_10min ?? 25}"><span class="field__hint">Evita que adivinen códigos.</span></label>
      </div>
      <p class="adm-muted">Moneda COP · Zona horaria America/Bogota.${upd('general') ? ` Última modificación: ${esc(dt(upd('general')))}.` : ''}</p>
      <div class="adm-card__foot"><button class="btn btn--primary btn--sm">Guardar reglas</button></div></form>

    <form class="adm-card" id="cfg-rent" data-form="profit"><h2 class="adm-card__title">Protección de rentabilidad</h2>
      <p class="adm-muted">Al crear o editar un código, el panel compara el precio final con el costo de cada producto (Inventario → Costos).</p>
      <div class="adm-two">
        <label class="field"><span class="field__label">Margen mínimo (%)</span><input class="field__input" name="min_margin_pct" inputmode="decimal" value="${pr.min_margin_pct ?? ''}" placeholder="Sin mínimo"><span class="field__hint">Vacío = solo avisa si hay pérdida o venta al costo.</span></label>
        <label class="field"><span class="field__label">Si un código no cumple</span><select class="field__input" name="mode">
          <option value="warn"${pr.mode !== 'block' ? ' selected' : ''}>Advertir (permite activarlo)</option>
          <option value="block"${pr.mode === 'block' ? ' selected' : ''}>Bloquear la activación</option></select></label>
      </div>
      <div class="adm-card__foot"><button class="btn btn--primary btn--sm">Guardar rentabilidad</button></div></form>

    <section class="adm-card"><h2 class="adm-card__title">Equipo y permisos</h2>
      <p class="adm-muted">Roles: <b>owner</b> y <b>admin</b> (todo), <b>production</b> (solo Producción, sin datos personales ni dinero). Para agregar a alguien: crea su usuario en Supabase → Authentication y ejecuta en SQL Editor:<br>
      <code>insert into public.admins (user_id, role) select id, 'production' from auth.users where email = 'correo@ejemplo.com';</code></p>
    </section>
  </div>`;

  view.querySelector('[data-ship-add]').addEventListener('click', () => view.querySelector('[data-ships]').insertAdjacentHTML('beforeend', shipRow({ active: true, requires_address: true })));
  view.addEventListener('click', (e) => { if (e.target.matches('[data-ship-del]')) e.target.closest('[data-ship]').remove(); });
  const save = (form, fn, ok) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const done = setBusy(form.querySelector('.adm-card__foot button'), 'Guardando…');
    try { await fn(form); toast(ok); renderConfiguration(view); } catch (err) { done(); toast(errText(err)); }
  });
  save(view.querySelector('[data-form="ship"]'), async (f) => {
    const opts = [...f.querySelectorAll('[data-ship]')].map((li) => {
      const g2 = (k) => li.querySelector(`[data-s="${k}"]`);
      const label = g2('label').value.trim();
      return { id: g2('id').value || slug(label) || `envio-${Date.now().toString(36)}`, label, cost: intOrNull(g2('cost').value), description: g2('description').value.trim(),
        requires_address: g2('requires_address').checked, active: g2('active').checked };
    }).filter((o) => o.label);
    if (!opts.some((o) => o.active)) throw new Error('KOVA:Deja al menos una opción de envío visible.');
    if (new Set(opts.map((o) => o.id)).size !== opts.length) throw new Error('KOVA:Hay dos opciones con el mismo nombre.');
    await saveSetting('shipping', { options: opts });
  }, 'Envíos guardados. El checkout ya los usa.');
  save(view.querySelector('[data-form="legal"]'), async (f) => {
    const sections = [...f.querySelectorAll('[data-l-id]')].map((el) => { const i = el.dataset.lId; return { id: el.value, title: f.querySelector(`[data-l-title="${i}"]`).value.trim(), body: f.querySelector(`[data-l-body="${i}"]`).value.trim() }; });
    await saveSetting('legal', { reviewed: f.reviewed.checked, sections, updated_at: new Date().toISOString(),
      updated_label: new Date().toLocaleDateString('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }) });
  }, 'Textos legales guardados.');
  save(view.querySelector('[data-form="general"]'), async (f) => {
    const n = (k, min, max) => { const v = intOrNull(f[k].value); if (v == null || v < min || v > max) throw new Error(`KOVA:Revisa «${f[k].closest('label').querySelector('.field__label').textContent}» (entre ${min} y ${max}).`); return v; };
    const prefix = f.order_prefix.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(prefix)) throw new Error('KOVA:El prefijo debe tener de 2 a 6 letras o números.');
    const value = { ...(priv.general ?? {}), order_prefix: prefix, hold_hours_normal: n('hold_hours_normal', 1, 336), verification_hours: n('verification_hours', 1, 720),
      max_units_per_line: n('max_units_per_line', 1, 100), max_orders_per_hour_per_ip: n('max_orders_per_hour_per_ip', 1, 1000), max_promo_checks_per_10min: n('max_promo_checks_per_10min', 3, 1000) };
    await run(db().from('admin_settings').upsert({ key: 'general', value }, { onConflict: 'key' }));
  }, 'Reglas guardadas.');
  save(view.querySelector('[data-form="profit"]'), async (f) => {
    const raw = f.min_margin_pct.value.trim().replace(',', '.');
    const min = raw === '' ? null : Number(raw);
    if (min != null && (Number.isNaN(min) || min < 0 || min > 95)) throw new Error('KOVA:El margen mínimo debe estar entre 0 y 95%.');
    await run(db().from('admin_settings').upsert({ key: 'profit', value: { min_margin_pct: min, mode: f.mode.value } }, { onConflict: 'key' }));
  }, `Protección de rentabilidad guardada.`);
  void money;
}
