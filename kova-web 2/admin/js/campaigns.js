/**
 * Preventas: campañas (crear, editar, duplicar, activar, pausar, cerrar, archivar), productos participantes,
 * límites por producto y por talla × color. Las fechas se escriben y muestran en hora de Colombia.
 * El servidor impide activar una campaña sin fechas, sin vigencia de reserva o sin productos.
 */
import { db } from './api.js';
import {
  rpc, run, errText, esc, toast, money, dt, dateOnly, loading, errorBox, head, setBusy, intOrNull,
  toLocalInput, fromLocalInput,
} from './ops.js';

const STATUS = { draft: 'Borrador', active: 'Activa', paused: 'Pausada', closed: 'Cerrada', archived: 'Archivada' };
const PHASE = { draft: 'Borrador', scheduled: 'Programada', open: 'Abierta', paused: 'Pausada', sold_out: 'Agotada', closed: 'Cerrada', archived: 'Archivada' };
const phaseOf = (c, used) => {
  if (c.status === 'archived') return 'archived';
  if (c.status === 'draft') return 'draft';
  if (c.status === 'closed') return 'closed';
  if (c.status === 'paused') return 'paused';
  const now = Date.now();
  if (c.closes_at && Date.parse(c.closes_at) <= now) return 'closed';
  if (c.max_units && used >= c.max_units) return 'sold_out';
  if (c.opens_at && Date.parse(c.opens_at) > now) return 'scheduled';
  return 'open';
};
const tonePhase = { open: 'ok', scheduled: 'info', paused: 'warn', sold_out: 'warn', closed: 'muted', archived: 'muted', draft: 'muted' };
const phasePill = (p) => `<span class="adm-st adm-st--${tonePhase[p]}"><span aria-hidden="true">${p === 'open' ? '●' : '○'}</span>${esc(PHASE[p])}</span>`;

async function usedByCampaign() {
  const { data } = await run(db().from('order_items').select('campaign_id,product_id,size,color,qty,orders!inner(fulfillment_status)')
    .eq('kind', 'preorder').not('orders.fulfillment_status', 'in', '(cancelled,expired)').limit(20000));
  return data;
}

export async function renderCampaigns(view) {
  loading(view, 'Cargando preventas');
  try {
    const [{ data: list }, used, { data: links }] = await Promise.all([
      run(db().from('preorder_campaigns').select('*').order('created_at', { ascending: false })),
      usedByCampaign(),
      run(db().from('preorder_products').select('campaign_id,product_id,products(name)')),
    ]);
    const showArchived = view.dataset.archived === '1';
    const rows = list.filter((c) => showArchived || c.status !== 'archived');
    view.innerHTML = `
    <div class="adm-wrap adm-wrap--wide">
      ${head('Pre-Order', 'Preventas', '<a class="btn btn--primary" href="#/preventa/nueva">Nueva campaña <span class="btn__arrow" aria-hidden="true">+</span></a>')}
      <p class="adm-muted">Una campaña agrupa los productos que se venden por preventa, con su anticipo, fechas, cupos y condiciones. Las fechas están en hora de Colombia.</p>
      ${rows.length ? `<div class="adm-cards">${rows.map((c) => {
        const u = used.filter((x) => x.campaign_id === c.id).reduce((n, x) => n + x.qty, 0);
        const ph = phaseOf(c, u);
        const prods = links.filter((l) => l.campaign_id === c.id).map((l) => l.products?.name ?? l.product_id);
        return `
        <article class="adm-camp">
          <div class="adm-camp__top">${phasePill(ph)}<span class="adm-muted">${esc(c.drop_name || '')} · Prefijo ${esc(c.order_prefix)}</span></div>
          <h2 class="adm-camp__name"><a href="#/preventa/${c.id}">${esc(c.name)}</a></h2>
          <p class="adm-muted">${prods.length ? esc(prods.join(', ')) : 'Sin productos'}</p>
          <dl class="adm-camp__facts">
            <div><dt>Abre</dt><dd>${c.opens_at ? esc(dt(c.opens_at)) : '<span class="adm-bad">Sin fecha</span>'}</dd></div>
            <div><dt>Cierra</dt><dd>${c.closes_at ? esc(dt(c.closes_at)) : '<span class="adm-bad">Sin fecha</span>'}</dd></div>
            <div><dt>Despacho</dt><dd>${c.est_dispatch_date ? esc(dateOnly(c.est_dispatch_date)) : '<span class="adm-bad">Sin fecha</span>'}</dd></div>
            <div><dt>Unidades</dt><dd>${u}${c.max_units ? ` / ${c.max_units}` : ' (sin límite)'}</dd></div>
            <div><dt>Anticipo</dt><dd>${c.deposit_pct}%${c.allow_full_payment ? ' · o pago total' : ''}</dd></div>
          </dl>
          ${c.max_units ? `<div class="adm-meter" role="meter" aria-valuemin="0" aria-valuemax="${c.max_units}" aria-valuenow="${u}" aria-label="Cupo usado"><span style="width:${Math.min(100, (u / c.max_units) * 100)}%"></span></div>` : ''}
          <div class="adm-camp__actions">
            <a class="btn btn--line btn--sm" href="#/preventa/${c.id}">Editar</a>
            ${statusButtons(c)}
            <button class="adm-link" type="button" data-dup="${c.id}">Duplicar</button>
            <a class="adm-link" href="#/produccion?c=${c.id}">Producción</a>
          </div>
        </article>`;
      }).join('')}</div>` : '<div class="adm-empty grid-lines"><h2>Aún no hay campañas<span class="dot">.</span></h2><p>Crea la primera preventa con el botón de arriba.</p></div>'}
      <button class="adm-link" type="button" data-arch>${showArchived ? 'Ocultar archivadas' : 'Ver archivadas'}</button>
    </div>`;
    view.querySelector('[data-arch]').addEventListener('click', () => { view.dataset.archived = showArchived ? '0' : '1'; renderCampaigns(view); });
    bindStatus(view, () => renderCampaigns(view));
    view.querySelectorAll('[data-dup]').forEach((b) => b.addEventListener('click', async () => {
      const done = setBusy(b, 'Duplicando…');
      try { const id = await rpc('admin_campaign_duplicate', { p_id: b.dataset.dup }); toast('Campaña duplicada como borrador (sin fechas).'); location.hash = `#/preventa/${id}`; } catch (err) { done(); toast(errText(err)); }
    }));
  } catch (err) { errorBox(view, err, () => renderCampaigns(view)); }
}

function statusButtons(c) {
  const b = (s, label, cls = 'btn--line') => `<button class="btn ${cls} btn--sm" type="button" data-status="${s}" data-id="${c.id}" data-name="${esc(c.name)}">${label}</button>`;
  switch (c.status) {
    case 'draft': return b('active', 'Activar', 'btn--primary');
    case 'active': return b('paused', 'Pausar') + b('closed', 'Cerrar');
    case 'paused': return b('active', 'Reanudar', 'btn--primary') + b('closed', 'Cerrar');
    case 'closed': return b('archived', 'Archivar') + b('active', 'Reabrir');
    default: return b('draft', 'Restaurar como borrador');
  }
}
function bindStatus(view, reload) {
  const { confirmDialog } = window.kovaAdmin;
  view.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => {
    const s = b.dataset.status;
    const text = {
      active: 'Los productos de la campaña pasarán a modo Preventa y los clientes podrán reservar dentro de las fechas configuradas.',
      paused: 'Nadie podrá reservar mientras esté pausada. Las reservas existentes se conservan.',
      closed: 'Se detienen las reservas nuevas. Los pedidos, pagos e historial se conservan.',
      archived: 'Deja de verse en la lista principal. No se borra nada.',
      draft: 'Vuelve a borrador para editarla.',
    }[s];
    if (!(await confirmDialog({ title: `${b.textContent.trim()} «${b.dataset.name}»`, body: `<p>${text}</p>`, confirm: b.textContent.trim() }))) return;
    const done = setBusy(b, 'Guardando…');
    try { await rpc('admin_campaign_status', { p_id: b.dataset.id, p_status: s }); toast(`Campaña: ${STATUS[s]}.`); reload(); } catch (err) { done(); toast(errText(err)); }
  }));
}

/* ---------- Editor ---------- */
const DEFAULTS = { name: '', slug: '', drop_name: '', description: '', banner_url: '', opens_at: null, closes_at: null, est_dispatch_date: null, est_delivery_date: null,
  max_units: null, max_per_customer: null, deposit_pct: 50, allow_full_payment: true, allow_promo_codes: true, hold_minutes: null, verification_hours: null,
  shipping_charge: 'balance', terms: '', show_countdown: false, show_availability: false, auto_close_on_limit: true, order_prefix: 'PRE', status: 'draft' };
const slugify = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export async function renderCampaign(view, id) {
  loading(view, 'Cargando campaña');
  try {
    const isNew = id === 'nueva';
    const [camp, { data: products }, links, limits, used] = await Promise.all([
      isNew ? { ...DEFAULTS } : run(db().from('preorder_campaigns').select('*').eq('id', id).single()).then((r) => r.data),
      run(db().from('products').select('id,name,price,sizes,colors,sale_mode,published').order('position')),
      isNew ? [] : run(db().from('preorder_products').select('*').eq('campaign_id', id)).then((r) => r.data),
      isNew ? [] : run(db().from('preorder_variant_limits').select('*').eq('campaign_id', id)).then((r) => r.data),
      isNew ? [] : usedByCampaign().then((u) => u.filter((x) => x.campaign_id === id)),
    ]);
    drawEditor(view, camp, products, links, limits, used, isNew);
  } catch (err) { errorBox(view, err, () => renderCampaign(view, id)); }
}

const inp = (name, label, value, { type = 'text', hint = '', attrs = '', req = false } = {}) => `
  <label class="field" data-field="${name}"><span class="field__label">${esc(label)}${req ? ' <span>*</span>' : ''}</span>
    ${type === 'textarea' ? `<textarea class="field__input" name="${name}" rows="4" ${attrs}>${esc(value ?? '')}</textarea>` : `<input class="field__input" name="${name}" type="${type}" value="${esc(value ?? '')}" ${attrs}>`}
    ${hint ? `<span class="field__hint">${hint}</span>` : ''}</label>`;
/** Fecha + hora en dos campos: un datetime-local a medio llenar (p. ej. Safari sin la hora) devuelve '' y se perdía. */
const inpDT = (name, label, iso, req = false) => {
  const [d, t] = (toLocalInput(iso) || 'T').split('T');
  return `<fieldset class="field adm-dt" data-field="${name}"><legend class="field__label">${esc(label)} (hora Colombia)${req ? ' <span>*</span>' : ''}</legend>
    <div class="adm-dt__row"><input class="field__input" name="${name}_d" type="date" value="${esc(d)}" aria-label="${esc(label)}: fecha">
    <input class="field__input" name="${name}_t" type="time" step="60" value="${esc(t)}" aria-label="${esc(label)}: hora"></div></fieldset>`;
};
const sw = (name, label, on, hint = '') => `<label class="adm-switch"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span class="adm-switch__ui" aria-hidden="true"></span><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`;

function variantGrid(p, limits, used) {
  const sizes = p.sizes?.length ? p.sizes : [''];
  const colors = p.colors?.length ? p.colors.map((c) => c.name) : [''];
  return `<table class="adm-table adm-vgrid"><thead><tr><th>Color \\ Talla</th>${sizes.map((s) => `<th>${esc(s || 'Única')}</th>`).join('')}</tr></thead><tbody>
    ${colors.map((c) => `<tr><th>${esc(c || 'Único')}</th>${sizes.map((s) => {
      const l = limits.find((x) => x.product_id === p.id && x.size === s && x.color === c);
      const u = used.filter((x) => x.product_id === p.id && x.size === s && x.color === c).reduce((n, x) => n + x.qty, 0);
      return `<td><label class="adm-vcell"><input type="checkbox" data-v-en="${esc(p.id)}|${esc(s)}|${esc(c)}"${l?.enabled === false ? '' : ' checked'} aria-label="Participa ${esc(c)} ${esc(s)}">
        <input class="field__input" data-v-max="${esc(p.id)}|${esc(s)}|${esc(c)}" inputmode="numeric" placeholder="∞" value="${l?.max_units ?? ''}" aria-label="Límite ${esc(c)} ${esc(s)}"></label>
        ${u ? `<small>${u} usadas</small>` : ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
}

function drawEditor(view, c, products, links, limits, used, isNew) {
  const total = used.reduce((n, x) => n + x.qty, 0);
  view.innerHTML = `
  <div class="adm-wrap">
    <a class="adm-crumb" href="#/preventas">← Preventas</a>
    ${head(isNew ? 'Nueva campaña' : `Estado: ${STATUS[c.status]}${total ? ` · ${total} unidades reservadas` : ''}`, isNew ? 'Nueva preventa' : c.name)}
    <form class="adm-editor" data-camp novalidate>
      <section class="adm-card"><h2 class="adm-card__title">Información</h2>
        <div class="adm-two">${inp('name', 'Nombre de la campaña', c.name, { req: true, attrs: 'maxlength="120"' })}${inp('drop_name', 'Drop asociado', c.drop_name, { attrs: 'maxlength="60"', hint: 'Ej.: PSYCHE_01' })}</div>
        <div class="adm-two">${inp('slug', 'Identificador', c.slug, { req: true, attrs: 'maxlength="80" pattern="[a-z0-9-]+"', hint: 'Minúsculas y guiones. No cambia la URL de la tienda.' })}
          ${inp('order_prefix', 'Prefijo de pedidos', c.order_prefix, { req: true, attrs: 'maxlength="6" style="text-transform:uppercase"', hint: 'Los pedidos quedan como KOVA-PREFIJO-000001.' })}</div>
        ${inp('description', 'Descripción', c.description, { type: 'textarea', attrs: 'maxlength="4000"' })}
        ${inp('banner_url', 'Imagen o banner (URL)', c.banner_url, { attrs: 'maxlength="600"', hint: 'Opcional.' })}
      </section>

      <section class="adm-card"><h2 class="adm-card__title">Fechas (hora de Colombia)</h2>
        <div class="adm-two">${inpDT('opens_at', 'Apertura', c.opens_at, true)}${inpDT('closes_at', 'Cierre', c.closes_at, true)}</div>
        <div class="adm-two">${inp('est_dispatch_date', 'Despacho estimado', c.est_dispatch_date, { type: 'date', req: true })}${inp('est_delivery_date', 'Entrega estimada', c.est_delivery_date, { type: 'date' })}</div>
        <div class="adm-two">${inp('hold_minutes', 'Vigencia de una reserva sin pago (minutos)', c.hold_minutes, { req: true, attrs: 'inputmode="numeric"', hint: 'Tiempo para pagar antes de liberar el cupo. Ej.: 1440 = 24 horas.' })}
          ${inp('verification_hours', 'Plazo para verificar un comprobante (horas)', c.verification_hours, { attrs: 'inputmode="numeric"', hint: 'Vacío = valor general de Configuración.' })}</div>
      </section>

      <section class="adm-card"><h2 class="adm-card__title">Pago</h2>
        <div class="adm-two">${inp('deposit_pct', 'Anticipo (%)', c.deposit_pct, { req: true, attrs: 'inputmode="numeric"', hint: 'Se calcula sobre el precio después del descuento.' })}
          <label class="field"><span class="field__label">El envío se cobra</span><select class="field__input" name="shipping_charge">
            <option value="balance"${c.shipping_charge === 'balance' ? ' selected' : ''}>Con el saldo (antes del despacho)</option>
            <option value="reservation"${c.shipping_charge === 'reservation' ? ' selected' : ''}>Con la reserva</option></select></label></div>
        ${sw('allow_full_payment', 'Permitir pagar el 100% al reservar', c.allow_full_payment)}
        ${sw('allow_promo_codes', 'Permitir códigos promocionales', c.allow_promo_codes)}
      </section>

      <section class="adm-card"><h2 class="adm-card__title">Cupos</h2>
        <div class="adm-two">${inp('max_units', 'Máximo de unidades de la campaña', c.max_units, { attrs: 'inputmode="numeric"', hint: 'Vacío = sin límite.' })}
          ${inp('max_per_customer', 'Máximo por cliente', c.max_per_customer, { attrs: 'inputmode="numeric"', hint: 'Por correo o WhatsApp. Vacío = sin límite.' })}</div>
        ${sw('auto_close_on_limit', 'Mostrar «Agotado» al llegar al límite', c.auto_close_on_limit)}
        ${sw('show_countdown', 'Mostrar contador regresivo en la tienda', c.show_countdown)}
        ${sw('show_availability', 'Mostrar unidades disponibles en la tienda', c.show_availability)}
      </section>

      <section class="adm-card"><h2 class="adm-card__title">Productos participantes</h2>
        <p class="adm-muted">Marca los productos de la preventa. Opcionalmente limita unidades por producto y por talla × color (vacío = sin límite propio; desmarcado = esa variante no se vende).</p>
        <div class="adm-pp">${products.map((p) => {
          const l = links.find((x) => x.product_id === p.id);
          const u = used.filter((x) => x.product_id === p.id).reduce((n, x) => n + x.qty, 0);
          return `<div class="adm-pp__item${l ? ' is-on' : ''}" data-pp="${esc(p.id)}">
            <label class="adm-check"><input type="checkbox" data-pp-on${l ? ' checked' : ''}> <b>${esc(p.name)}</b> <span class="adm-muted">${money(p.price)}${p.published ? '' : ' · oculto'}${u ? ` · ${u} reservadas` : ''}</span></label>
            <div class="adm-pp__more" ${l ? '' : 'hidden'}>
              <label class="adm-mini"><span>Límite del producto</span><input class="field__input" data-pp-max inputmode="numeric" placeholder="∞" value="${l?.max_units ?? ''}"></label>
              <details${limits.some((x) => x.product_id === p.id) ? ' open' : ''}><summary>Límites por talla y color</summary>${variantGrid(p, limits, used)}</details>
            </div></div>`;
        }).join('')}</div>
      </section>

      <section class="adm-card"><h2 class="adm-card__title">Condiciones de la preventa</h2>
        ${inp('terms', 'Condiciones específicas (las ve el cliente en la ficha)', c.terms, { type: 'textarea', attrs: 'maxlength="8000" rows="6"', hint: 'Ej.: tiempos de producción, qué pasa si no se paga el saldo, cambios de talla. Las condiciones generales se editan en Configuración → Textos legales.' })}
      </section>

      <div class="adm-savebar">
        <p class="adm-form-msg" data-msg role="alert"></p>
        <a class="btn btn--line" href="#/preventas">Cancelar</a>
        <button class="btn btn--primary" type="submit" data-save>${isNew ? 'Crear borrador' : 'Guardar cambios'}</button>
      </div>
    </form>
    ${!isNew ? `<div class="adm-tools">${statusButtons(c)}</div>` : ''}
  </div>`;

  const form = view.querySelector('[data-camp]');
  if (isNew) form.name.addEventListener('input', () => { if (!form.slug.dataset.touched) form.slug.value = slugify(form.name.value); });
  form.slug.addEventListener('input', () => { form.slug.dataset.touched = '1'; });
  form.querySelectorAll('[data-pp-on]').forEach((cb) => cb.addEventListener('change', () => {
    const item = cb.closest('[data-pp]'); item.classList.toggle('is-on', cb.checked); item.querySelector('.adm-pp__more').hidden = !cb.checked;
  }));
  bindStatus(view, () => renderCampaign(view, c.id));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('[data-msg]');
    const v = (n) => form.elements[n].value.trim();
    const chk = (n) => form.elements[n].checked;
    const errs = [];
    const when = (n, label) => {
      const d = form.elements[`${n}_d`], t = form.elements[`${n}_t`];
      if (d.validity.badInput || t.validity.badInput) { errs.push(`una fecha y hora de ${label} completas`); return null; }
      if (!d.value && !t.value) return null;
      if (!d.value || !t.value) { errs.push(`${d.value ? 'la hora' : 'la fecha'} de ${label}`); return null; }
      return fromLocalInput(`${d.value}T${t.value.slice(0, 5)}`);
    };
    const row = {
      name: v('name'), slug: v('slug'), drop_name: v('drop_name'), description: v('description'), banner_url: v('banner_url'),
      order_prefix: v('order_prefix').toUpperCase(), opens_at: when('opens_at', 'apertura'), closes_at: when('closes_at', 'cierre'),
      est_dispatch_date: v('est_dispatch_date') || null, est_delivery_date: v('est_delivery_date') || null,
      hold_minutes: intOrNull(v('hold_minutes')), verification_hours: intOrNull(v('verification_hours')), deposit_pct: intOrNull(v('deposit_pct')),
      shipping_charge: v('shipping_charge'), allow_full_payment: chk('allow_full_payment'), allow_promo_codes: chk('allow_promo_codes'),
      max_units: intOrNull(v('max_units')), max_per_customer: intOrNull(v('max_per_customer')), auto_close_on_limit: chk('auto_close_on_limit'),
      show_countdown: chk('show_countdown'), show_availability: chk('show_availability'), terms: v('terms'),
    };
    if (!row.name) errs.push('el nombre');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug)) errs.push('un identificador válido');
    if (!/^[A-Z0-9]{2,6}$/.test(row.order_prefix)) errs.push('un prefijo de 2 a 6 letras o números');
    if (!row.deposit_pct || row.deposit_pct < 1 || row.deposit_pct > 100) errs.push('un anticipo entre 1 y 100%');
    if (row.opens_at && row.closes_at && row.closes_at <= row.opens_at) errs.push('un cierre posterior a la apertura');
    if (row.hold_minutes != null && (row.hold_minutes < 5 || row.hold_minutes > 20160)) errs.push('una vigencia de reserva entre 5 minutos y 14 días');
    if (row.est_delivery_date && row.est_dispatch_date && row.est_delivery_date < row.est_dispatch_date) errs.push('una entrega posterior al despacho');
    if (errs.length) { msg.textContent = `Revisa: ${errs.join(', ')}.`; return; }
    const sel = [...form.querySelectorAll('[data-pp]')].filter((el) => el.querySelector('[data-pp-on]').checked);
    const done = setBusy(form.querySelector('[data-save]'), 'Guardando…');
    try {
      let id = c.id;
      if (isNew) id = (await run(db().from('preorder_campaigns').insert(row).select('id').single())).data.id;
      else {
        const { data } = await run(db().from('preorder_campaigns').update(row).eq('id', id).select('id'));
        if (!data.length) throw new Error('permission denied');
      }
      const keep = sel.map((el) => el.dataset.pp);
      const removed = links.filter((l) => !keep.includes(l.product_id)).map((l) => l.product_id);
      if (removed.length) await run(db().from('preorder_products').delete().eq('campaign_id', id).in('product_id', removed));
      if (keep.length) {
        await run(db().from('preorder_products').upsert(sel.map((el, i) => ({ campaign_id: id, product_id: el.dataset.pp, position: i,
          max_units: intOrNull(el.querySelector('[data-pp-max]').value) })), { onConflict: 'campaign_id,product_id' }));
        await run(db().from('preorder_variant_limits').delete().eq('campaign_id', id));
        const lim = [];
        sel.forEach((el) => el.querySelectorAll('[data-v-en]').forEach((cb) => {
          const [pid, size, color] = cb.dataset.vEn.split('|');
          const max = intOrNull(el.querySelector(`[data-v-max="${CSS.escape(cb.dataset.vEn)}"]`).value);
          if (!cb.checked || max != null) lim.push({ campaign_id: id, product_id: pid, size, color, enabled: cb.checked, max_units: max });
        }));
        if (lim.length) await run(db().from('preorder_variant_limits').insert(lim));
      }
      toast(isNew ? 'Borrador creado. Actívalo cuando esté listo.' : 'Campaña guardada.');
      if (isNew) location.hash = `#/preventa/${id}`; else renderCampaign(view, id);
    } catch (err) {
      done();
      msg.textContent = /duplicate|23505/.test(String(err?.message)) ? 'Ya existe una campaña con ese identificador.' : errText(err);
    }
  });
}
