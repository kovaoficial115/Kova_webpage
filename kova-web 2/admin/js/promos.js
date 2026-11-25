/**
 * Códigos promocionales: lista (buscar, filtrar, ordenar, copiar, duplicar, activar/desactivar, archivar, exportar),
 * editor con vista previa de rentabilidad y estadísticas por código.
 * El descuento real lo calcula y valida el servidor; este panel solo guarda la configuración.
 */
import { db } from './api.js';
import {
  rpc, run, errText, esc, toast, money, dt, loading, errorBox, head, kpi, setBusy, intOrNull, formDialog, fld,
  toLocalInput, fromLocalInput, downloadCsv, copy, barChart, bindCharts, FINANCIAL, FULFILLMENT,
} from './ops.js';
import { categories } from '../../js/data/categories.js';

const STATUS = { active: 'Activo', inactive: 'Inactivo', archived: 'Archivado' };
const RED = { pending: 'Pendiente de pago', confirmed: 'Confirmado', released: 'Liberado', void_kept: 'Cancelado (uso conservado)', restored: 'Restaurado' };
const st = { q: '', status: '', sort: 'created_desc' };
const value = (p) => (p.discount_type === 'percent' ? `${p.percent}%` : money(p.fixed_amount));
const lifecycle = (p) => {
  if (p.status !== 'active') return STATUS[p.status];
  const now = Date.now();
  if (p.starts_at && Date.parse(p.starts_at) > now) return 'Programado';
  if (p.ends_at && Date.parse(p.ends_at) <= now) return 'Vencido';
  return 'Activo';
};
const tone = (l) => ({ Activo: 'ok', Programado: 'info', Vencido: 'muted', Inactivo: 'muted', Archivado: 'muted' }[l] ?? 'info');
export const randomCode = (prefix = 'KOVA') => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}${Array.from(r, (b) => abc[b % abc.length]).join('')}`;
};

export async function renderPromos(view) {
  loading(view, 'Cargando códigos');
  try {
    const [{ data: list }, { data: reds }] = await Promise.all([
      run(db().from('promo_codes').select('*').order('created_at', { ascending: false })),
      run(db().from('promo_redemptions').select('promo_id,status,discount_amount').limit(50000)),
    ]);
    const usage = (id) => {
      const r = reds.filter((x) => x.promo_id === id);
      return { confirmed: r.filter((x) => ['confirmed', 'void_kept'].includes(x.status)).length, pending: r.filter((x) => x.status === 'pending').length,
        discount: r.filter((x) => ['confirmed', 'void_kept'].includes(x.status)).reduce((n, x) => n + x.discount_amount, 0) };
    };
    draw(view, list, usage);
  } catch (err) { errorBox(view, err, () => renderPromos(view)); }
}

function draw(view, list, usage) {
  const needle = st.q.trim().toUpperCase();
  let rows = list.filter((p) => (!needle || p.code_norm.includes(needle) || p.name.toUpperCase().includes(needle) || p.influencer_name.toUpperCase().includes(needle))
    && (!st.status ? p.status !== 'archived' : st.status === 'expired' ? lifecycle(p) === 'Vencido' : st.status === 'scheduled' ? lifecycle(p) === 'Programado' : p.status === st.status));
  const sorters = {
    created_desc: (a, b) => b.created_at.localeCompare(a.created_at),
    code: (a, b) => a.code_norm.localeCompare(b.code_norm),
    uses: (a, b) => usage(b.id).confirmed - usage(a.id).confirmed,
    discount: (a, b) => usage(b.id).discount - usage(a.id).discount,
    ends: (a, b) => (a.ends_at ?? '9').localeCompare(b.ends_at ?? '9'),
  };
  rows = rows.sort(sorters[st.sort]);
  view.innerHTML = `
  <div class="adm-wrap adm-wrap--wide">
    ${head('Promo Codes', 'Códigos promocionales', `<button class="btn btn--line btn--sm" type="button" data-export>Exportar CSV</button>
      <a class="btn btn--primary" href="#/codigo/nuevo">Nuevo código <span class="btn__arrow" aria-hidden="true">+</span></a>`)}
    <div class="adm-toolbar">
      <label class="adm-search"><span class="sr-only">Buscar</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input type="search" placeholder="Código, nombre o influenciador" value="${esc(st.q)}" data-q></label>
      <label class="adm-select"><span class="sr-only">Estado</span><select data-st>
        ${[['', 'Todos (sin archivados)'], ['active', 'Activos'], ['scheduled', 'Programados'], ['expired', 'Vencidos'], ['inactive', 'Inactivos'], ['archived', 'Archivados']].map(([v, l]) => `<option value="${v}"${st.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="adm-select"><span class="sr-only">Ordenar</span><select data-sort>
        ${[['created_desc', 'Más recientes'], ['code', 'Código A-Z'], ['uses', 'Más usados'], ['discount', 'Más descuento otorgado'], ['ends', 'Vencen primero']].map(([v, l]) => `<option value="${v}"${st.sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    ${rows.length ? `<div class="adm-table-wrap"><table class="adm-table">
      <thead><tr><th>Código</th><th>Descuento</th><th>Estado</th><th>Vigencia</th><th class="num">Usos</th><th class="num">Descuento otorgado</th><th>Influenciador</th><th></th></tr></thead>
      <tbody>${rows.map((p) => { const u = usage(p.id); const l = lifecycle(p); return `<tr>
        <td><a class="adm-strong adm-code" href="#/codigo/${p.id}">${esc(p.code)}</a><small>${esc(p.name)}</small></td>
        <td>${value(p)}${p.max_discount ? `<small>tope ${money(p.max_discount)}</small>` : ''}</td>
        <td><span class="adm-st adm-st--${tone(l)}">${esc(l)}</span></td>
        <td><small>${p.starts_at ? esc(dt(p.starts_at)) : 'Desde ya'} → ${p.ends_at ? esc(dt(p.ends_at)) : 'sin fin'}</small></td>
        <td class="num">${u.confirmed}${p.max_uses ? ` / ${p.max_uses}` : ''}${u.pending ? `<small>+${u.pending} pendientes</small>` : ''}</td>
        <td class="num">${money(u.discount)}</td>
        <td>${esc(p.influencer_name || '—')}</td>
        <td class="adm-actions">
          <button class="adm-iconbtn" type="button" data-copy="${esc(p.code)}" title="Copiar código" aria-label="Copiar ${esc(p.code)}">⧉</button>
          <a class="adm-iconbtn" href="#/codigo-stats/${p.id}" title="Estadísticas e historial" aria-label="Estadísticas de ${esc(p.code)}">▤</a>
          <button class="adm-iconbtn" type="button" data-dup="${p.id}" title="Duplicar" aria-label="Duplicar ${esc(p.code)}">⎘</button>
          ${p.status !== 'archived' ? `<button class="adm-link" type="button" data-toggle="${p.id}" data-to="${p.status === 'active' ? 'inactive' : 'active'}">${p.status === 'active' ? 'Desactivar' : 'Activar'}</button>
          <button class="adm-link" type="button" data-toggle="${p.id}" data-to="archived">Archivar</button>` : ''}
        </td></tr>`; }).join('')}</tbody></table></div>`
    : '<div class="adm-empty grid-lines"><h2>No hay códigos<span class="dot">.</span></h2><p>Ningún código se crea ni se activa solo. Crea el primero con «Nuevo código».</p></div>'}
  </div>`;
  let t;
  view.querySelector('[data-q]').addEventListener('input', (e) => { st.q = e.target.value; clearTimeout(t); t = setTimeout(() => { draw(view, list, usage); const i = view.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  view.querySelector('[data-st]').addEventListener('change', (e) => { st.status = e.target.value; draw(view, list, usage); });
  view.querySelector('[data-sort]').addEventListener('change', (e) => { st.sort = e.target.value; draw(view, list, usage); });
  view.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)));
  view.querySelectorAll('[data-dup]').forEach((b) => b.addEventListener('click', async () => {
    const src = list.find((p) => p.id === b.dataset.dup);
    const v = await formDialog({ title: `Duplicar ${src.code}`, confirm: 'Duplicar', body: `<p>La copia queda inactiva para que la revises.</p>${fld('code', 'Código nuevo', { value: randomCode(src.code.replace(/[^A-Z]/gi, '').slice(0, 6).toUpperCase() || 'KOVA'), req: true })}`,
      validate: (x) => (!/^[A-Za-z0-9_-]{3,32}$/.test(x.code.trim()) ? 'Usa de 3 a 32 letras, números, guion o guion bajo.' : '') });
    if (!v) return;
    try { const id = await rpc('admin_promo_duplicate', { p_id: src.id, p_code: v.code.trim() }); toast('Código duplicado (inactivo).'); location.hash = `#/codigo/${id}`; } catch (err) { toast(errText(err)); }
  }));
  view.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const to = b.dataset.to;
    if (to === 'archived' && !(await window.kovaAdmin.confirmDialog({ title: 'Archivar código', body: '<p>Deja de funcionar y se oculta de la lista. Su historial se conserva.</p>', confirm: 'Archivar' }))) return;
    const done = setBusy(b, '…');
    try {
      const { data } = await run(db().from('promo_codes').update({ status: to }).eq('id', b.dataset.toggle).select('id'));
      if (!data.length) throw new Error('permission denied');
      toast(`Código ${STATUS[to].toLowerCase()}.`); renderPromos(view);
    } catch (err) { done(); toast(errText(err)); }
  }));
  view.querySelector('[data-export]').addEventListener('click', () => downloadCsv('kova-codigos', [
    { label: 'Código', key: 'code' }, { label: 'Nombre', key: 'name' }, { label: 'Tipo', get: (p) => (p.discount_type === 'percent' ? 'Porcentaje' : 'Valor fijo') },
    { label: 'Valor', get: (p) => p.percent ?? p.fixed_amount }, { label: 'Estado', get: lifecycle }, { label: 'Inicio', get: (p) => dt(p.starts_at) }, { label: 'Fin', get: (p) => dt(p.ends_at) },
    { label: 'Usos confirmados', get: (p) => usage(p.id).confirmed }, { label: 'Usos pendientes', get: (p) => usage(p.id).pending }, { label: 'Máximo de usos', key: 'max_uses' },
    { label: 'Descuento otorgado', get: (p) => usage(p.id).discount }, { label: 'Influenciador', key: 'influencer_name' }, { label: 'Comisión %', key: 'commission_pct' }, { label: 'Comisión fija', key: 'commission_fixed' },
  ], rows));
}

/* ---------- Editor ---------- */
const DEF = { code: '', name: '', internal_description: '', discount_type: 'percent', percent: null, fixed_amount: null, status: 'inactive', starts_at: null, ends_at: null,
  max_uses: null, max_uses_per_customer: 1, min_subtotal: null, min_items: null, product_ids: null, categories: null, campaign_ids: null,
  applies_normal: true, applies_preorder: true, applies_custom: false, customer_emails: null, max_discount: null, influencer_name: '', commission_pct: null, commission_fixed: null };

export async function renderPromo(view, id) {
  loading(view, 'Cargando código');
  try {
    const isNew = id === 'nuevo';
    const [p, { data: products }, { data: camps }] = await Promise.all([
      isNew ? { ...DEF, code: randomCode() } : run(db().from('promo_codes').select('*').eq('id', id).single()).then((r) => r.data),
      run(db().from('products').select('id,name,category,price').order('position')),
      run(db().from('preorder_campaigns').select('id,name,status').neq('status', 'archived')),
    ]);
    drawEditor(view, p, products, camps, isNew);
  } catch (err) { errorBox(view, err, () => renderPromo(view, id)); }
}

const inp = (name, label, val, { type = 'text', hint = '', attrs = '', req = false } = {}) => `
  <label class="field"><span class="field__label">${esc(label)}${req ? ' <span>*</span>' : ''}</span>
    ${type === 'textarea' ? `<textarea class="field__input" name="${name}" rows="3" ${attrs}>${esc(val ?? '')}</textarea>` : `<input class="field__input" name="${name}" type="${type}" value="${esc(val ?? '')}" ${attrs}>`}
    ${hint ? `<span class="field__hint">${hint}</span>` : ''}</label>`;
const sw = (name, label, on) => `<label class="adm-switch"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span class="adm-switch__ui" aria-hidden="true"></span><span>${esc(label)}</span></label>`;

function drawEditor(view, p, products, camps, isNew) {
  const cats = [...new Set([...categories.map((c) => c.id), ...products.map((x) => x.category)])];
  view.innerHTML = `
  <div class="adm-wrap">
    <a class="adm-crumb" href="#/codigos">← Códigos</a>
    ${head(isNew ? 'Nuevo código' : `Estado: ${lifecycle(p)}`, isNew ? 'Nuevo código promocional' : p.code, !isNew ? `<a class="btn btn--line btn--sm" href="#/codigo-stats/${p.id}">Estadísticas e historial</a>` : '')}
    <form class="adm-editor" data-promo novalidate>
      <section class="adm-card"><h2 class="adm-card__title">Código</h2>
        <div class="adm-two">
          <label class="field"><span class="field__label">Código <span>*</span></span>
            <div class="adm-prefix"><input class="field__input adm-code" name="code" value="${esc(p.code)}" maxlength="32" style="text-transform:uppercase" required>
            <button class="btn btn--line btn--sm" type="button" data-gen>Generar</button></div>
            <span class="field__hint">Sin distinguir mayúsculas. Letras, números, guion o guion bajo.</span></label>
          ${inp('name', 'Nombre interno', p.name, { attrs: 'maxlength="120"', hint: 'Ej.: Lanzamiento PSYCHE_01' })}
        </div>
        ${inp('internal_description', 'Descripción interna', p.internal_description, { type: 'textarea', attrs: 'maxlength="2000"' })}
      </section>

      <section class="adm-card"><h2 class="adm-card__title">Descuento</h2>
        <div class="adm-seg" role="radiogroup" aria-label="Tipo de descuento">
          <label><input type="radio" name="discount_type" value="percent"${p.discount_type === 'percent' ? ' checked' : ''}> Porcentaje</label>
          <label><input type="radio" name="discount_type" value="fixed"${p.discount_type === 'fixed' ? ' checked' : ''}> Valor fijo (COP)</label>
        </div>
        <div class="adm-two">
          ${inp('amount', 'Valor del descuento', p.discount_type === 'percent' ? p.percent : p.fixed_amount, { req: true, attrs: 'inputmode="numeric"', hint: 'Porcentaje de 1 a 100, o pesos.' })}
          ${inp('max_discount', 'Descuento máximo por pedido (COP)', p.max_discount, { attrs: 'inputmode="numeric"', hint: 'Opcional.' })}
        </div>
        <div class="adm-alert adm-alert--info" data-warn hidden></div>
        <div data-preview class="adm-preview-profit"></div>
      </section>

      <section class="adm-card"><h2 class="adm-card__title">Vigencia y límites</h2>
        <div class="adm-two">${inp('starts_at', 'Inicio (hora de Colombia)', toLocalInput(p.starts_at), { type: 'datetime-local', hint: 'Vacío = desde que se active.' })}
          ${inp('ends_at', 'Fin (hora de Colombia)', toLocalInput(p.ends_at), { type: 'datetime-local', hint: 'Vacío = sin fecha de fin.' })}</div>
        <div class="adm-two">${inp('max_uses', 'Usos totales máximos', p.max_uses, { attrs: 'inputmode="numeric"', hint: 'Vacío = ilimitado.' })}
          ${inp('max_uses_per_customer', 'Usos por cliente', p.max_uses_per_customer, { attrs: 'inputmode="numeric"', hint: 'Por correo o WhatsApp. Vacío = ilimitado.' })}</div>
        <div class="adm-two">${inp('min_subtotal', 'Compra mínima (COP)', p.min_subtotal, { attrs: 'inputmode="numeric"' })}${inp('min_items', 'Mínimo de productos', p.min_items, { attrs: 'inputmode="numeric"' })}</div>
      </section>

      <section class="adm-card"><h2 class="adm-card__title">Dónde aplica</h2>
        ${sw('applies_normal', 'Productos en venta normal', p.applies_normal)}${sw('applies_preorder', 'Preventas', p.applies_preorder)}${sw('applies_custom', 'KOVA Custom', p.applies_custom)}
        <fieldset class="adm-fs"><legend>Productos específicos <small>(ninguno marcado = todos)</small></legend>
          <div class="adm-chips">${products.map((x) => `<label class="adm-chip adm-chip--check"><input type="checkbox" name="product_ids" value="${esc(x.id)}"${p.product_ids?.includes(x.id) ? ' checked' : ''}> ${esc(x.name)}</label>`).join('')}</div></fieldset>
        <fieldset class="adm-fs"><legend>Categorías <small>(ninguna = todas)</small></legend>
          <div class="adm-chips">${cats.map((c) => `<label class="adm-chip adm-chip--check"><input type="checkbox" name="categories" value="${esc(c)}"${p.categories?.includes(c) ? ' checked' : ''}> ${esc(categories.find((x) => x.id === c)?.label ?? c)}</label>`).join('')}</div></fieldset>
        ${camps.length ? `<fieldset class="adm-fs"><legend>Campañas / drops <small>(ninguna = todas)</small></legend>
          <div class="adm-chips">${camps.map((c) => `<label class="adm-chip adm-chip--check"><input type="checkbox" name="campaign_ids" value="${c.id}"${p.campaign_ids?.includes(c.id) ? ' checked' : ''}> ${esc(c.name)}</label>`).join('')}</div></fieldset>` : ''}
        ${inp('customer_emails', 'Solo para estos clientes (correos, uno por línea)', (p.customer_emails ?? []).join('\n'), { type: 'textarea', hint: 'Vacío = cualquier cliente.' })}
      </section>

      <section class="adm-card"><h2 class="adm-card__title">Influenciador o aliado</h2>
        <div class="adm-two">${inp('influencer_name', 'Nombre', p.influencer_name, { attrs: 'maxlength="120"' })}<div class="adm-two">
          ${inp('commission_pct', 'Comisión (%)', p.commission_pct, { attrs: 'inputmode="decimal"' })}${inp('commission_fixed', 'Comisión fija por venta (COP)', p.commission_fixed, { attrs: 'inputmode="numeric"' })}</div></div>
      </section>

      <section class="adm-card"><h2 class="adm-card__title">Estado</h2>
        <label class="field"><span class="field__label">Estado del código</span><select class="field__input" name="status">
          ${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${p.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <span class="field__hint">Un código solo funciona en la tienda cuando está Activo y dentro de su vigencia.</span></label>
      </section>

      <div class="adm-savebar"><p class="adm-form-msg" data-msg role="alert"></p><a class="btn btn--line" href="#/codigos">Cancelar</a>
        <button class="btn btn--primary" type="submit" data-save>${isNew ? 'Crear código' : 'Guardar cambios'}</button></div>
    </form>
  </div>`;

  const form = view.querySelector('[data-promo]');
  const collect = () => {
    const v = (n) => form.elements[n].value.trim();
    const typ = form.querySelector('[name="discount_type"]:checked').value;
    const amt = typ === 'percent' ? intOrNull(v('amount')) : intOrNull(v('amount'));
    const many = (n) => { const a = [...form.querySelectorAll(`[name="${n}"]:checked`)].map((x) => x.value); return a.length ? a : null; };
    return {
      code: v('code').toUpperCase(), name: v('name'), internal_description: v('internal_description'), discount_type: typ,
      percent: typ === 'percent' ? amt : null, fixed_amount: typ === 'fixed' ? amt : null, max_discount: intOrNull(v('max_discount')),
      starts_at: fromLocalInput(v('starts_at')), ends_at: fromLocalInput(v('ends_at')), max_uses: intOrNull(v('max_uses')),
      max_uses_per_customer: intOrNull(v('max_uses_per_customer')), min_subtotal: intOrNull(v('min_subtotal')), min_items: intOrNull(v('min_items')),
      applies_normal: form.elements.applies_normal.checked, applies_preorder: form.elements.applies_preorder.checked, applies_custom: form.elements.applies_custom.checked,
      product_ids: many('product_ids'), categories: many('categories'), campaign_ids: many('campaign_ids'),
      customer_emails: (() => { const a = v('customer_emails').split(/[\s,;]+/).filter(Boolean); return a.length ? a : null; })(),
      influencer_name: v('influencer_name'), commission_pct: v('commission_pct') === '' ? null : Number(v('commission_pct').replace(',', '.')),
      commission_fixed: intOrNull(v('commission_fixed')), status: v('status'),
    };
  };
  let pt;
  const preview = async () => {
    const row = collect();
    const box = form.querySelector('[data-preview]');
    const warn = form.querySelector('[data-warn]');
    const big = (row.discount_type === 'percent' && row.percent >= 50) || (row.discount_type === 'fixed' && row.fixed_amount >= 36000);
    warn.hidden = !big;
    warn.innerHTML = big ? '<b>Descuento alto.</b> Revisa la rentabilidad antes de activarlo.' : '';
    if (!(row.percent || row.fixed_amount)) { box.innerHTML = ''; return; }
    try {
      const r = await rpc('promo_profit_preview', { p: row });
      box.innerHTML = `
        <p class="adm-muted">Vista previa por producto (precio de catálogo). Protección de rentabilidad: <b>${r.mode === 'block' ? 'bloquear' : 'advertir'}</b>${r.min_margin_pct != null ? `, margen mínimo ${r.min_margin_pct}%` : ', sin margen mínimo configurado'}.</p>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Producto</th><th class="num">Precio</th><th class="num">Descuento</th><th class="num">Final</th><th class="num">Costo</th><th class="num">Utilidad</th><th class="num">Margen</th><th></th></tr></thead>
        <tbody>${r.rows.map((x) => `<tr${x.warnings.length ? ' class="is-warn"' : ''}><td>${esc(x.name)}</td><td class="num">${money(x.price)}</td><td class="num">−${money(x.discount)}</td>
          <td class="num">${money(x.final)}</td><td class="num">${x.cost == null ? '<span class="adm-muted">Sin costo</span>' : money(x.cost)}</td>
          <td class="num">${x.profit == null ? '—' : money(x.profit)}</td><td class="num">${x.margin == null ? '—' : `${x.margin}%`}</td>
          <td>${x.warnings.map((w) => `<span class="adm-st adm-st--bad">! ${esc(w)}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>
        ${r.rows.some((x) => x.cost == null) ? '<p class="adm-muted">Registra los costos en Inventario para calcular utilidad y margen.</p>' : ''}
        ${r.has_warnings && r.mode === 'block' ? '<p class="adm-bad"><b>Con la protección en «bloquear», este código no se podrá activar.</b></p>' : ''}`;
    } catch (err) { box.innerHTML = `<p class="adm-bad">${esc(errText(err))}</p>`; }
  };
  form.addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(preview, 400); });
  preview();
  form.querySelector('[data-gen]').addEventListener('click', () => { form.elements.code.value = randomCode(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('[data-msg]');
    const row = collect();
    const errs = [];
    if (!/^[A-Z0-9_-]{3,32}$/.test(row.code)) errs.push('un código de 3 a 32 caracteres (letras, números, - o _)');
    if (row.discount_type === 'percent' && !(row.percent >= 1 && row.percent <= 100)) errs.push('un porcentaje entre 1 y 100');
    if (row.discount_type === 'fixed' && !(row.fixed_amount >= 1)) errs.push('un valor fijo mayor que 0');
    if (row.starts_at && row.ends_at && row.ends_at <= row.starts_at) errs.push('un fin posterior al inicio');
    if (row.commission_pct != null && (Number.isNaN(row.commission_pct) || row.commission_pct < 0 || row.commission_pct > 100)) errs.push('una comisión entre 0 y 100%');
    if (errs.length) { msg.textContent = `Revisa: ${errs.join(', ')}.`; return; }
    if (row.status === 'active' && ((row.percent ?? 0) >= 50 || row.fixed_amount >= 36000)
      && !(await window.kovaAdmin.confirmDialog({ title: 'Descuento alto', body: `<p>Vas a activar un descuento de <b>${row.discount_type === 'percent' ? `${row.percent}%` : money(row.fixed_amount)}</b>. ¿Confirmas?</p>`, confirm: 'Sí, activar' }))) return;
    const done = setBusy(form.querySelector('[data-save]'), 'Guardando…');
    try {
      let id = p.id;
      if (isNew) id = (await run(db().from('promo_codes').insert(row).select('id').single())).data.id;
      else { const { data } = await run(db().from('promo_codes').update(row).eq('id', id).select('id')); if (!data.length) throw new Error('permission denied'); }
      toast(isNew ? `Código creado (${STATUS[row.status].toLowerCase()}).` : 'Código guardado.');
      if (isNew) location.hash = `#/codigo/${id}`; else renderPromo(view, id);
    } catch (err) {
      done();
      msg.textContent = /duplicate|23505|code_norm/.test(String(err?.message)) ? 'Ya existe un código con ese nombre (sin importar mayúsculas).' : errText(err);
    }
  });
}

/* ---------- Estadísticas e historial ---------- */
export async function renderPromoStats(view, id) {
  loading(view, 'Cargando estadísticas');
  try {
    const [{ data: p }, s] = await Promise.all([run(db().from('promo_codes').select('*').eq('id', id).single()), rpc('admin_promo_stats', { p_id: id })]);
    view.innerHTML = `
    <div class="adm-wrap adm-wrap--wide">
      <a class="adm-crumb" href="#/codigos">← Códigos</a>
      ${head(`${value(p)} · ${lifecycle(p)}${p.influencer_name ? ` · ${p.influencer_name}` : ''}`, p.code, `<a class="btn btn--line btn--sm" href="#/codigo/${p.id}">Editar</a><button class="btn btn--line btn--sm" type="button" data-exp>Exportar usos</button>`)}
      <dl class="adm-kpis">
        ${kpi('Usos confirmados', s.confirmed_uses, p.max_uses ? `de ${p.max_uses} disponibles` : 'sin límite', true)}
        ${kpi('Pedidos pendientes', s.pending_orders, 'reservan un uso hasta pagar o vencer')}
        ${kpi('Clientes únicos', s.unique_customers)}
        ${kpi('Aplicaciones en carrito', s.applications, `${s.failed_attempts} intentos fallidos`)}
        ${kpi('Conversión', s.conversion_pct == null ? '—' : `${s.conversion_pct}%`, 'usos confirmados / visitantes que lo aplicaron')}
        ${kpi('Unidades vendidas', s.units)}
        ${kpi('Ventas antes del descuento', money(s.revenue_before))}
        ${kpi('Ventas después del descuento', money(s.revenue_after))}
        ${kpi('Descuento otorgado', money(s.discount_total))}
        ${kpi('Recaudado', money(s.collected), `Saldo por cobrar ${money(s.balance_due)}`)}
        ${kpi('Utilidad estimada', s.est_profit == null ? '—' : money(s.est_profit), s.items_without_cost ? `${s.items_without_cost} línea(s) sin costo registrado` : '')}
        ${p.commission_pct || p.commission_fixed ? kpi('Comisión del aliado', money(s.commission)) : ''}
      </dl>
      <div class="adm-charts">
        ${barChart({ id: 'pc-uses', title: 'Aplicaciones y usos confirmados por día', data: s.series.map((x) => ({ label: x.day.slice(5), values: [x.applications, x.confirmed] })), series: ['Aplicaciones', 'Usos confirmados'] })}
        ${barChart({ id: 'pc-disc', title: 'Descuento otorgado por día', data: s.series.map((x) => ({ label: x.day.slice(5), values: [x.discount] })), series: ['Descuento'], money: true })}
      </div>
      <section class="adm-card"><h2 class="adm-card__title">Historial de usos</h2>
        ${s.uses.length ? `<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Productos</th><th class="num">Antes</th><th class="num">Descuento</th><th class="num">Total</th><th>Pago</th><th>Pedido</th><th>Uso</th><th class="num">Usos del cliente</th></tr></thead>
        <tbody>${s.uses.map((u) => `<tr><td>${esc(dt(u.at))}</td><td><a href="#/pedido/${u.order_id}">${esc(u.number)}</a></td><td>${esc(u.name)}<small>${esc(u.email)}</small></td>
          <td><small>${esc(u.products ?? '')}</small></td><td class="num">${money(u.original)}</td><td class="num">−${money(u.discount)}</td><td class="num">${money(u.total)}</td>
          <td>${esc(FINANCIAL[u.financial_status] ?? '')}</td><td>${esc(FULFILLMENT[u.fulfillment_status] ?? '')}</td><td>${esc(RED[u.status] ?? u.status)}</td><td class="num">${u.customer_uses}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="adm-muted">Este código aún no se ha usado en ningún pedido.</p>'}
      </section>
    </div>`;
    bindCharts(view);
    view.querySelector('[data-exp]').addEventListener('click', () => downloadCsv(`kova-codigo-${p.code}`, [
      { label: 'Fecha', get: (u) => dt(u.at) }, { label: 'Pedido', key: 'number' }, { label: 'Cliente', key: 'name' }, { label: 'Correo', key: 'email' },
      { label: 'Productos', key: 'products' }, { label: 'Antes', key: 'original' }, { label: 'Descuento', key: 'discount' }, { label: 'Total', key: 'total' },
      { label: 'Pago', get: (u) => FINANCIAL[u.financial_status] }, { label: 'Pedido', get: (u) => FULFILLMENT[u.fulfillment_status] }, { label: 'Uso', get: (u) => RED[u.status] },
    ], s.uses));
  } catch (err) { errorBox(view, err, () => renderPromoStats(view, id)); }
}
