/**
 * Pedidos: tabla con búsqueda, filtros, paginación y acciones masivas; detalle con pagos, comprobantes,
 * estados, envío, notas, historial, recibo imprimible y contacto por WhatsApp.
 * Los cambios de dinero y estado pasan por funciones del servidor (admin_*), que validan y registran auditoría.
 */
import { db } from './api.js';
import {
  rpc, run, errText, esc, toast, money, dt, dateOnly, pill, loading, errorBox, head, kpi, setBusy, formDialog, fld, intOrNull,
  downloadCsv, pager, waLink, copy, isAdminRole,
  FINANCIAL, FULFILLMENT, FULFILLMENT_NEXT, KIND, PAYMENT_KIND, PAYMENT_STATUS,
} from './ops.js';
import { getPayments } from '../../js/services/settings.js';

const PAGE = 25;
const COLS = 'id,number,created_at,full_name,whatsapp,email,department,city,address,kind,campaign_id,payment_plan,payment_method,financial_status,fulfillment_status,subtotal_original,discount_total,shipping_amount,total,amount_due_now,paid_total,refunded_total,promo_code,est_dispatch_date,tracking_number,carrier,hold_expires_at';
const st = { page: 1, f: { q: '', fin: '', ful: '', kind: '', campaign: '', from: '', to: '', promo: '', attention: '' }, selected: new Set(), campaigns: [] };
const balanceOf = (o) => Math.max(o.total - (o.paid_total - o.refunded_total), 0);

function applyFilters(qb) {
  const f = st.f;
  if (f.q.trim()) {
    const s = f.q.trim().replace(/[,()*%]/g, ' ').trim();
    qb = qb.or(`number.ilike.*${s}*,full_name.ilike.*${s}*,email.ilike.*${s}*,whatsapp.ilike.*${s.replace(/\D/g, '') || s}*`);
  }
  if (f.fin) qb = qb.eq('financial_status', f.fin);
  if (f.ful) qb = qb.eq('fulfillment_status', f.ful);
  if (f.kind) qb = qb.eq('kind', f.kind);
  if (f.campaign) qb = qb.eq('campaign_id', f.campaign);
  if (f.promo) qb = qb.ilike('promo_code', f.promo.trim());
  if (f.from) qb = qb.gte('created_at', new Date(`${f.from}T00:00:00-05:00`).toISOString());
  if (f.to) qb = qb.lt('created_at', new Date(new Date(`${f.to}T00:00:00-05:00`).getTime() + 864e5).toISOString());
  if (f.attention === 'proofs') qb = qb.in('financial_status', ['proof_received', 'verifying']);
  if (f.attention === 'balance') qb = qb.eq('financial_status', 'deposit_confirmed');
  return qb;
}

export async function renderOrders(view) {
  if (!isAdminRole()) { view.innerHTML = '<div class="adm-wrap"><div class="adm-alert">Esta sección tiene datos personales y es solo para administradores. Usa <a href="#/produccion">Producción</a>.</div></div>'; return; }
  loading(view, 'Cargando pedidos');
  try {
    if (!st.campaigns.length) st.campaigns = (await run(db().from('preorder_campaigns').select('id,name').order('created_at', { ascending: false }))).data;
    const from = (st.page - 1) * PAGE;
    const { data, count } = await run(applyFilters(db().from('orders').select(COLS, { count: 'exact' })).order('created_at', { ascending: false }).range(from, from + PAGE - 1));
    const toReview = (await run(db().from('payments').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'verifying']))).count ?? 0;
    draw(view, data, count ?? data.length, toReview);
  } catch (err) { errorBox(view, err, () => renderOrders(view)); }
}

function draw(view, rows, total, toReview) {
  const f = st.f;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const opt = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${v === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
  view.innerHTML = `
  <div class="adm-wrap adm-wrap--wide">
    ${head('Ventas', 'Pedidos', `<button class="btn btn--line btn--sm" type="button" data-export>Exportar CSV</button>`)}
    ${toReview ? `<button class="adm-alert adm-alert--info adm-alert--btn" type="button" data-attn="proofs"><b>${toReview} comprobante(s) por revisar.</b> Ver pedidos con comprobante pendiente →</button>` : ''}
    <div class="adm-toolbar adm-toolbar--wrap">
      <label class="adm-search"><span class="sr-only">Buscar</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input type="search" placeholder="Número, nombre, correo o WhatsApp" value="${esc(f.q)}" data-f="q"></label>
      <label class="adm-select"><span class="sr-only">Pago</span><select data-f="fin"><option value="">Pago: todos</option>${opt(FINANCIAL, f.fin)}</select></label>
      <label class="adm-select"><span class="sr-only">Pedido</span><select data-f="ful"><option value="">Pedido: todos</option>${opt(FULFILLMENT, f.ful)}</select></label>
      <label class="adm-select"><span class="sr-only">Tipo</span><select data-f="kind"><option value="">Tipo: todos</option>${opt(KIND, f.kind)}</select></label>
      <label class="adm-select"><span class="sr-only">Campaña</span><select data-f="campaign"><option value="">Campaña: todas</option>${st.campaigns.map((c) => `<option value="${c.id}"${f.campaign === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="adm-select"><span class="sr-only">Atención</span><select data-f="attention"><option value="">Todos</option>
        <option value="proofs"${f.attention === 'proofs' ? ' selected' : ''}>Con comprobante por revisar</option>
        <option value="balance"${f.attention === 'balance' ? ' selected' : ''}>Con saldo pendiente (anticipo pagado)</option></select></label>
      <label class="adm-mini"><span>Desde</span><input type="date" value="${f.from}" data-f="from"></label>
      <label class="adm-mini"><span>Hasta</span><input type="date" value="${f.to}" data-f="to"></label>
      <label class="adm-mini"><span>Código</span><input type="text" value="${esc(f.promo)}" data-f="promo" placeholder="KOVA10" size="8"></label>
      <button class="adm-link" type="button" data-clear>Limpiar filtros</button>
    </div>

    <div class="adm-bulk" data-bulk hidden>
      <span data-bulk-n></span>
      <label class="adm-select"><span class="sr-only">Nuevo estado</span><select data-bulk-status>
        <option value="">Cambiar estado a…</option>${['confirmed', 'in_production', 'quality_check', 'packed', 'ready', 'shipped', 'delivered'].map((s) => `<option value="${s}">${esc(FULFILLMENT[s])}</option>`).join('')}</select></label>
      <button class="btn btn--primary btn--sm" type="button" data-bulk-apply>Aplicar</button>
      <button class="btn btn--line btn--sm" type="button" data-bulk-export>Exportar selección</button>
      <button class="adm-link" type="button" data-bulk-clear>Quitar selección</button>
    </div>

    ${rows.length ? `
    <div class="adm-table-wrap">
      <table class="adm-table adm-orders">
        <thead><tr>
          <th><input type="checkbox" aria-label="Seleccionar todos" data-all></th>
          <th>Pedido</th><th>Cliente</th><th>Tipo</th><th>Pago</th><th>Pedido</th>
          <th class="num">Total</th><th class="num">Pagado</th><th class="num">Saldo</th><th>Despacho</th><th></th>
        </tr></thead>
        <tbody>${rows.map((o) => `
          <tr>
            <td><input type="checkbox" aria-label="Seleccionar ${esc(o.number)}" data-sel="${o.id}"${st.selected.has(o.id) ? ' checked' : ''}></td>
            <td><a class="adm-strong" href="#/pedido/${o.id}">${esc(o.number)}</a><small>${esc(dt(o.created_at))}</small></td>
            <td>${esc(o.full_name)}<small>${esc(o.city)}${o.promo_code ? ` · ${esc(o.promo_code)}` : ''}</small></td>
            <td>${esc(KIND[o.kind] ?? o.kind)}</td>
            <td>${pill(o.financial_status, FINANCIAL)}</td>
            <td>${pill(o.fulfillment_status, FULFILLMENT)}</td>
            <td class="num">${money(o.total)}</td>
            <td class="num">${money(o.paid_total - o.refunded_total)}</td>
            <td class="num">${balanceOf(o) ? money(balanceOf(o)) : '—'}</td>
            <td>${o.est_dispatch_date ? esc(dateOnly(o.est_dispatch_date)) : '—'}</td>
            <td class="adm-actions">
              <a class="adm-iconbtn" href="#/pedido/${o.id}" title="Ver detalle" aria-label="Ver ${esc(o.number)}">→</a>
              <a class="adm-iconbtn" href="${waLink(o.whatsapp, `Hola ${o.full_name.split(' ')[0]}, te escribimos de KOVA sobre tu pedido ${o.number}.`)}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp a ${esc(o.full_name)}">✆</a>
            </td>
          </tr>`).join('')}</tbody>
      </table>
    </div>` : `<div class="adm-empty grid-lines"><h2>No hay pedidos con estos filtros<span class="dot">.</span></h2><p>Los pedidos aparecen aquí cuando un cliente finaliza una compra o reserva.</p></div>`}
    ${pager(st.page, pages, total)}
  </div>`;

  let timer;
  view.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', () => {
    st.f[el.dataset.f] = el.value; st.page = 1;
    clearTimeout(timer); timer = setTimeout(() => renderOrders(view), el.type === 'search' || el.type === 'text' ? 350 : 0);
  }));
  view.querySelector('[data-clear]').addEventListener('click', () => { Object.keys(st.f).forEach((k) => { st.f[k] = ''; }); st.page = 1; renderOrders(view); });
  view.querySelector('[data-attn]')?.addEventListener('click', () => { st.f.attention = 'proofs'; st.page = 1; renderOrders(view); });
  view.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { st.page = Number(b.dataset.page); renderOrders(view); }));

  const bulk = view.querySelector('[data-bulk]');
  const syncBulk = () => { bulk.hidden = !st.selected.size; bulk.querySelector('[data-bulk-n]').textContent = `${st.selected.size} seleccionado(s)`; };
  view.querySelectorAll('[data-sel]').forEach((c) => c.addEventListener('change', () => { if (c.checked) st.selected.add(c.dataset.sel); else st.selected.delete(c.dataset.sel); syncBulk(); }));
  view.querySelector('[data-all]')?.addEventListener('change', (e) => {
    view.querySelectorAll('[data-sel]').forEach((c) => { c.checked = e.target.checked; if (c.checked) st.selected.add(c.dataset.sel); else st.selected.delete(c.dataset.sel); });
    syncBulk();
  });
  syncBulk();
  bulk.querySelector('[data-bulk-clear]').addEventListener('click', () => { st.selected.clear(); renderOrders(view); });
  bulk.querySelector('[data-bulk-apply]').addEventListener('click', async (e) => {
    const status = bulk.querySelector('[data-bulk-status]').value;
    if (!status) { toast('Elige el nuevo estado.'); return; }
    let extra = {};
    if (status === 'shipped') {
      const v = await formDialog({ title: `Marcar ${st.selected.size} como enviados`, body: `${fld('carrier', 'Transportadora')}${fld('tracking', 'Guía (si es una sola)')}${fld('note', 'Nota para el cliente', { type: 'textarea' })}`, confirm: 'Marcar enviados' });
      if (!v) return; extra = v;
    }
    const done = setBusy(e.currentTarget, 'Aplicando…');
    try {
      const r = await rpc('admin_set_fulfillment', { p_orders: [...st.selected], p_status: status, p_note: extra.note ?? '', p_tracking: extra.tracking || null, p_carrier: extra.carrier || null });
      toast(`${r.updated} pedido(s) actualizado(s).${r.skipped.length ? ` ${r.skipped.length} sin cambio: ${r.skipped.map((s) => `${s.number} (${s.reason})`).join('; ')}` : ''}`);
      st.selected.clear(); renderOrders(view);
    } catch (err) { done(); toast(errText(err)); }
  });
  view.querySelector('[data-export]').addEventListener('click', (e) => exportOrders(e.currentTarget, null));
  bulk.querySelector('[data-bulk-export]').addEventListener('click', (e) => exportOrders(e.currentTarget, [...st.selected]));
}

async function exportOrders(btn, ids) {
  const done = setBusy(btn, 'Preparando…');
  try {
    let qb = db().from('orders').select(`${COLS},order_items(name,size,color,qty,kind)`).order('created_at', { ascending: false }).limit(5000);
    qb = ids ? qb.in('id', ids) : applyFilters(qb);
    const { data } = await run(qb);
    downloadCsv('kova-pedidos', [
      { label: 'Pedido', key: 'number' }, { label: 'Fecha', get: (o) => dt(o.created_at) }, { label: 'Tipo', get: (o) => KIND[o.kind] },
      { label: 'Cliente', key: 'full_name' }, { label: 'WhatsApp', key: 'whatsapp' }, { label: 'Correo', key: 'email' },
      { label: 'Departamento', key: 'department' }, { label: 'Ciudad', key: 'city' }, { label: 'Dirección', key: 'address' },
      { label: 'Productos', get: (o) => (o.order_items ?? []).map((i) => `${i.name} ${[i.color, i.size].filter(Boolean).join(' ')} x${i.qty}`).join(' | ') },
      { label: 'Código', key: 'promo_code' }, { label: 'Subtotal', key: 'subtotal_original' }, { label: 'Descuento', key: 'discount_total' },
      { label: 'Envío', key: 'shipping_amount' }, { label: 'Total', key: 'total' }, { label: 'Para reservar', key: 'amount_due_now' },
      { label: 'Pagado neto', get: (o) => o.paid_total - o.refunded_total }, { label: 'Saldo', get: balanceOf },
      { label: 'Estado de pago', get: (o) => FINANCIAL[o.financial_status] }, { label: 'Estado del pedido', get: (o) => FULFILLMENT[o.fulfillment_status] },
      { label: 'Despacho estimado', key: 'est_dispatch_date' }, { label: 'Guía', key: 'tracking_number' }, { label: 'Transportadora', key: 'carrier' },
    ], data);
  } catch (err) { toast(errText(err)); } finally { done(); }
}

/* =========================================================================
 * Detalle
 * ========================================================================= */
export async function renderOrder(view, id) {
  if (!isAdminRole()) { view.innerHTML = '<div class="adm-wrap"><div class="adm-alert">Solo administradores.</div></div>'; return; }
  loading(view, 'Cargando pedido');
  try {
    const [{ data: o }, { data: items }, { data: pays }, { data: hist }, { data: designs }] = await Promise.all([
      run(db().from('orders').select('*').eq('id', id).single()),
      run(db().from('order_items').select('*').eq('order_id', id).order('line_no')),
      run(db().from('payments').select('*').eq('order_id', id).order('created_at')),
      run(db().from('order_history').select('*').eq('order_id', id).order('at', { ascending: false })),
      run(db().from('order_design_files').select('*').eq('order_id', id).order('created_at', { ascending: false })).catch(() => ({ data: [] })),
    ]);
    let campaign = null;
    if (o.campaign_id) campaign = (await run(db().from('preorder_campaigns').select('id,name,est_dispatch_date').eq('id', o.campaign_id).maybeSingle())).data;
    drawOrder(view, o, items, pays, hist, campaign, designs ?? []);
  } catch (err) { errorBox(view, err, () => renderOrder(view, id)); }
}

/* ---------- Diseños de KOVA CUSTOM (bucket privado custom-designs) ---------- */
const FACE = { front: 'Frente', back: 'Espalda' };
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const designFaces = (i) => {
  const m = i.custom?.mode;
  return m === 'mini' || m === 'front' ? ['front'] : m === 'back' ? ['back'] : ['front', 'back'];
};

function designButtons(d) {
  return `<button class="btn btn--line btn--sm" type="button" data-design="${esc(d.path)}">Ver</button>
    <button class="btn btn--line btn--sm" type="button" data-design="${esc(d.path)}" data-dl="${esc(d.file_name)}">Descargar</button>`;
}

/** Tabla de diseños por producto y cara; vacía si el pedido no tiene KOVA CUSTOM. */
export function designsSection(items, designs) {
  const custom = items.filter((i) => i.custom);
  if (!custom.length) return '';
  const rows = custom.flatMap((i) => {
    const faces = [...new Set([...designFaces(i), ...designs.filter((d) => d.line_no === i.line_no).map((d) => d.face)])];
    return faces.map((face) => {
      const all = designs.filter((d) => d.line_no === i.line_no && d.face === face);
      const cur = all.find((d) => d.status === 'active');
      const old = all.filter((d) => d.status !== 'active');
      return `<tr><td>Producto ${i.line_no}<small>${esc(i.custom.mode_label ?? i.name)}</small></td><td>${FACE[face]}</td>
        <td>${cur ? `<b>${esc(cur.file_name)}</b><small>${esc([cur.mime?.split('/').pop()?.toUpperCase(), cur.size_bytes && kb(cur.size_bytes), dt(cur.created_at)].filter(Boolean).join(' · '))}</small>` : '<span class="adm-bad">Pendiente</span>'}
          ${old.length ? `<details><summary class="adm-muted">${old.length} versión(es) anterior(es)</summary>${old.map((d) => `<div>${esc(d.file_name)} <small>${esc(dt(d.created_at))}</small> ${designButtons(d)}</div>`).join('')}</details>` : ''}</td>
        <td class="num">${cur ? designButtons(cur) : ''}</td></tr>`;
    });
  });
  const missing = rows.filter((r) => r.includes('adm-bad')).length;
  return `<section class="adm-card"><h2 class="adm-card__title">Diseños KOVA Custom</h2>
    ${missing ? `<div class="adm-alert">${missing} diseño(s) pendiente(s). El cliente puede subirlos desde su enlace de seguimiento.</div>` : ''}
    <table class="adm-table"><thead><tr><th>Producto</th><th>Cara</th><th>Archivo</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="adm-muted">Archivos privados: cada enlace dura 10 minutos.</p></section>`;
}

/** Abre o descarga un diseño con una URL firmada temporal. */
export function bindDesignFiles(view) {
  view.querySelectorAll('[data-design]').forEach((b) => b.addEventListener('click', async () => {
    const dl = b.dataset.dl;
    const win = dl ? null : window.open('about:blank', '_blank');
    if (win) win.opener = null;
    const done = setBusy(b, dl ? 'Preparando…' : 'Abriendo…');
    try {
      const { data, error } = await db().storage.from('custom-designs').createSignedUrl(b.dataset.design, 600, dl ? { download: dl } : undefined);
      if (error) throw error;
      if (dl) location.assign(data.signedUrl);
      else if (win) win.location.href = data.signedUrl; else location.assign(data.signedUrl);
    } catch (err) { win?.close(); toast(errText(err)); } finally { done(); }
  }));
}

const CHECK = [['cut', 'Corte'], ['print', 'Estampado / bordado'], ['sewing', 'Confección'], ['qc', 'Control de calidad'], ['label', 'Etiquetado'], ['pack', 'Empaque'], ['guide', 'Guía generada']];

function drawOrder(view, o, items, pays, hist, campaign, designs = []) {
  const net = o.paid_total - o.refunded_total;
  const balance = Math.max(o.total - net, 0);
  const next = o.fulfillment_status === 'pending_confirmation' ? ['confirmed'] : (FULFILLMENT_NEXT[o.fulfillment_status] ?? []);
  const closed = ['cancelled', 'expired'].includes(o.fulfillment_status);
  const first = o.full_name.split(' ')[0];
  const wa = [
    ['Pago recibido', `Hola ${first}, confirmamos el pago de tu pedido ${o.number}. ¡Gracias por comprar en KOVA!`],
    ['Pedir comprobante', `Hola ${first}, para confirmar tu pedido ${o.number} necesitamos un comprobante legible. Puedes subirlo desde tu enlace de seguimiento.`],
    ['Saldo pendiente', `Hola ${first}, tu pedido ${o.number} está casi listo. Para despacharlo falta el saldo de ${money(balance)}. Puedes pagarlo y subir el comprobante desde tu enlace de seguimiento.`],
    ['Pedido enviado', `Hola ${first}, tu pedido ${o.number} fue enviado${o.carrier ? ` con ${o.carrier}` : ''}${o.tracking_number ? `. Guía: ${o.tracking_number}` : ''}.`],
  ];
  const ck = o.production_checklist ?? {};
  view.innerHTML = `
  <div class="adm-wrap adm-wrap--wide">
    <a class="adm-crumb" href="#/pedidos">← Pedidos</a>
    ${head(`${KIND[o.kind] ?? o.kind}${campaign ? ` · ${campaign.name}` : ''}`, o.number, `
      <button class="btn btn--line btn--sm" type="button" data-print>Imprimir recibo</button>
      ${!closed && !['shipped', 'delivered'].includes(o.fulfillment_status) ? '<button class="btn btn--danger btn--sm" type="button" data-cancel>Cancelar pedido</button>' : ''}`)}
    <div class="adm-status-row">${pill(o.financial_status, FINANCIAL)} ${pill(o.fulfillment_status, FULFILLMENT)}
      <span class="adm-muted">Registrado ${esc(dt(o.created_at))}${o.hold_expires_at && o.fulfillment_status === 'pending_confirmation' ? ` · Reserva hasta ${esc(dt(o.hold_expires_at))}` : ''}</span></div>

    <dl class="adm-kpis">
      ${kpi('Total del pedido', money(o.total), o.shipping_amount == null ? '+ envío por definir' : '')}
      ${kpi('Para confirmar', money(o.amount_due_now), o.deposit_pct && o.payment_plan === 'deposit' ? `Anticipo ${o.deposit_pct}%` : 'Pago completo')}
      ${kpi('Pagado (verificado)', money(net), o.refunded_total ? `Reembolsado ${money(o.refunded_total)}` : '')}
      ${kpi('Saldo pendiente', money(balance), '', balance > 0)}
    </dl>

    <div class="adm-detail">
      <div class="adm-detail__main">
        <section class="adm-card"><h2 class="adm-card__title">Productos</h2>
          <table class="adm-table"><thead><tr><th>Producto</th><th>Variante</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Descuento</th><th class="num">Total</th></tr></thead>
          <tbody>${items.map((i) => `<tr><td>${esc(i.name)}${i.kind !== 'normal' ? ` <span class="adm-chip">${esc(KIND[i.kind])}</span>` : ''}
            ${i.custom ? `<small>${esc([i.custom.mode_label, i.custom.zones?.join?.(', '), i.custom.notes].filter(Boolean).join(' · '))}</small>` : ''}</td>
            <td>${esc([i.color, i.size && `Talla ${i.size}`].filter(Boolean).join(' · ') || '—')}</td>
            <td class="num">${i.qty}</td><td class="num">${money(i.unit_price)}</td><td class="num">${i.discount ? `−${money(i.discount)}` : '—'}</td><td class="num">${money(i.line_final)}</td></tr>`).join('')}</tbody>
          <tfoot>
            <tr><td colspan="5">Subtotal</td><td class="num">${money(o.subtotal_original)}</td></tr>
            ${o.discount_total ? `<tr><td colspan="5">Código ${esc(o.promo_code ?? '')}</td><td class="num">−${money(o.discount_total)}</td></tr>` : ''}
            <tr><td colspan="5">Envío (${esc(o.shipping_label || o.shipping_method)}${o.kind !== 'normal' ? `, se cobra ${o.shipping_charge_at === 'balance' ? 'con el saldo' : 'con la reserva'}` : ''})</td><td class="num">${o.shipping_amount == null ? 'Por definir' : money(o.shipping_amount)}</td></tr>
            <tr class="adm-strong"><td colspan="5">Total</td><td class="num">${money(o.total)}</td></tr>
          </tfoot></table>
        </section>

        ${designsSection(items, designs)}

        <section class="adm-card"><div class="adm-card__head"><h2 class="adm-card__title">Pagos</h2>
          ${!closed ? `<div><button class="btn btn--line btn--sm" type="button" data-addpay>Registrar pago</button>
            ${net > 0 ? '<button class="btn btn--line btn--sm" type="button" data-refund>Registrar reembolso</button>' : ''}
            <button class="adm-link" type="button" data-newproof>Pedir nuevo comprobante</button></div>` : net > 0 ? '<button class="btn btn--line btn--sm" type="button" data-refund>Registrar reembolso</button>' : ''}</div>
          ${pays.length ? `<ul class="adm-paylist">${pays.map((p) => `
            <li class="adm-paym adm-paym--${p.status}">
              <div class="adm-paym__top"><b>${esc(PAYMENT_KIND[p.kind] ?? p.kind)} · ${money(p.amount)}</b>${pill(p.status, PAYMENT_STATUS)}</div>
              <p class="adm-muted">${esc([p.method && (getPayments().find((m) => m.id === p.method)?.label ?? p.method), p.reference && `Ref. ${p.reference}`, p.transfer_date && `Transferido ${dateOnly(p.transfer_date)}`, `${p.source === 'admin' ? 'Registrado por KOVA' : 'Enviado por el cliente'} ${dt(p.created_at)}`].filter(Boolean).join(' · '))}</p>
              ${p.reject_reason ? `<p class="adm-bad">Motivo: ${esc(p.reject_reason)}</p>` : ''}${p.note ? `<p class="adm-muted">${esc(p.note)}</p>` : ''}
              <div class="adm-paym__actions">
                ${p.proof_path ? `<button class="btn btn--line btn--sm" type="button" data-proof="${esc(p.proof_path)}">Ver comprobante</button>` : ''}
                ${['submitted', 'verifying'].includes(p.status) && !closed ? `
                  ${p.status === 'submitted' ? `<button class="adm-link" type="button" data-review="verifying" data-id="${p.id}">Marcar en verificación</button>` : ''}
                  <button class="btn btn--primary btn--sm" type="button" data-review="approve" data-id="${p.id}" data-amount="${p.amount}">Aprobar</button>
                  <button class="btn btn--danger btn--sm" type="button" data-review="reject" data-id="${p.id}">Rechazar</button>` : ''}
              </div>
            </li>`).join('')}</ul>` : '<p class="adm-muted">Aún no hay pagos ni comprobantes.</p>'}
        </section>

        <section class="adm-card"><h2 class="adm-card__title">Historial</h2>
          <form class="adm-inline" data-note><input class="field__input" name="note" placeholder="Agregar nota interna (no la ve el cliente)" maxlength="1000"><button class="btn btn--line btn--sm">Agregar</button></form>
          <ol class="adm-history">${hist.map((h) => `<li${h.is_public ? '' : ' class="is-internal"'}><time>${esc(dt(h.at))}</time>
            <b>${esc(h.event)}</b>${h.to_fulfillment ? ` <span class="adm-muted">→ ${esc(FULFILLMENT[h.to_fulfillment] ?? h.to_fulfillment)}</span>` : ''}${h.to_financial ? ` <span class="adm-muted">→ ${esc(FINANCIAL[h.to_financial] ?? h.to_financial)}</span>` : ''}
            ${h.note ? `<span>${esc(h.note)}</span>` : ''}<small>${h.actor === 'admin' ? 'KOVA' : h.actor === 'customer' ? 'Cliente' : 'Sistema'}${h.is_public ? '' : ' · interna'}</small></li>`).join('')}</ol>
        </section>
      </div>

      <aside class="adm-detail__side">
        <section class="adm-card"><h2 class="adm-card__title">Cliente</h2>
          <p class="adm-strong">${esc(o.full_name)}</p>
          <p><a href="${waLink(o.whatsapp, `Hola ${first}, te escribimos de KOVA sobre tu pedido ${o.number}.`)}" target="_blank" rel="noopener">WhatsApp ${esc(o.whatsapp)} ↗</a></p>
          <p><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></p>
          <p>${esc([o.address, o.city, o.department].filter(Boolean).join(', ') || 'Sin dirección')}</p>
          ${o.delivery_notes ? `<p class="adm-muted">“${esc(o.delivery_notes)}”</p>` : ''}
          <button class="adm-link" type="button" data-copyaddr>Copiar datos de envío</button>
          <details class="adm-wa"><summary>Mensajes rápidos de WhatsApp</summary>
            ${wa.map(([l, t]) => `<a class="btn btn--line btn--sm btn--block" href="${waLink(o.whatsapp, t)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}</details>
        </section>

        <section class="adm-card"><h2 class="adm-card__title">Estado del pedido</h2>
          ${closed ? '<p class="adm-muted">Pedido cerrado.</p>' : next.length ? `
            <div class="adm-next">${next.map((s) => `<button class="btn ${s === next[0] ? 'btn--primary' : 'btn--line'} btn--sm" type="button" data-ful="${s}">${esc(FULFILLMENT[s])}</button>`).join('')}</div>
            ${o.kind !== 'normal' && balance > 0 ? '<p class="adm-muted">No se puede marcar como enviado mientras haya saldo pendiente.</p>' : ''}` : '<p class="adm-muted">Sin cambios disponibles.</p>'}
          <form class="adm-form-grid" data-ship>
            ${fld('carrier', 'Transportadora', { value: o.carrier })}
            ${fld('tracking_number', 'Número de guía', { value: o.tracking_number })}
            <button class="btn btn--line btn--sm">Guardar guía</button>
          </form>
        </section>

        <section class="adm-card"><h2 class="adm-card__title">Envío y fechas</h2>
          <form class="adm-form-grid" data-shipcost>
            ${fld('shipping_amount', 'Costo de envío (COP)', { value: o.shipping_amount ?? '', attrs: 'inputmode="numeric"', hint: 'Vacío = por definir. Se suma al total.' })}
            ${fld('est_dispatch_date', 'Despacho estimado', { type: 'date', value: o.est_dispatch_date ?? '' })}
            <button class="btn btn--line btn--sm">Guardar</button>
          </form>
        </section>

        <section class="adm-card"><h2 class="adm-card__title">Checklist de producción</h2>
          <div class="adm-checklist">${CHECK.map(([k, l]) => `<label class="adm-check"><input type="checkbox" data-ck="${k}"${ck[k] ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
        </section>
      </aside>
    </div>
  </div>`;
  bindOrder(view, o, balance, net);
}

function bindOrder(view, o, balance, net) {
  const reload = () => renderOrder(view, o.id);
  const act = async (btn, text, fn, okMsg) => {
    const done = setBusy(btn, text);
    try { await fn(); toast(okMsg); reload(); } catch (err) { done(); toast(errText(err)); }
  };
  view.querySelector('[data-print]').addEventListener('click', () => printReceipt(view, o));
  view.querySelector('[data-copyaddr]').addEventListener('click', () => copy(`${o.full_name}\n${o.whatsapp}\n${[o.address, o.city, o.department].filter(Boolean).join(', ')}\nPedido ${o.number}`));

  view.querySelectorAll('[data-proof]').forEach((b) => b.addEventListener('click', async () => {
    // La ventana se abre en el mismo clic (Safari bloquea ventanas abiertas después de esperar la red).
    const win = window.open('about:blank', '_blank');
    if (win) win.opener = null;
    const done = setBusy(b, 'Abriendo…');
    try {
      const { data, error } = await db().storage.from('payment-proofs').createSignedUrl(b.dataset.proof, 300);
      if (error) throw error;
      if (win) win.location.href = data.signedUrl; else location.assign(data.signedUrl);
    } catch (err) { win?.close(); toast(errText(err)); } finally { done(); }
  }));

  bindDesignFiles(view);

  view.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', async () => {
    const action = b.dataset.review;
    if (action === 'reject') {
      const v = await formDialog({ title: 'Rechazar comprobante', danger: true, confirm: 'Rechazar',
        body: `<p>El cliente verá el motivo en su enlace de seguimiento y podrá subir otro comprobante.</p>${fld('reason', 'Motivo', { type: 'textarea', req: true, attrs: 'maxlength="300"' })}`,
        validate: (x) => (!x.reason.trim() ? 'Escribe el motivo.' : '') });
      if (!v) return;
      return act(b, 'Rechazando…', () => rpc('admin_review_payment', { p_payment: b.dataset.id, p_action: 'reject', p_reason: v.reason }), 'Comprobante rechazado.');
    }
    if (action === 'approve') {
      const v = await formDialog({ title: 'Aprobar pago', confirm: 'Aprobar pago',
        body: `<p>Aprueba solo si el dinero ya está en la cuenta. Si llegó un valor distinto, corrígelo aquí.</p>${fld('amount', 'Valor recibido (COP)', { value: b.dataset.amount, req: true, attrs: 'inputmode="numeric"' })}`,
        validate: (x) => (!intOrNull(x.amount) ? 'Escribe el valor.' : '') });
      if (!v) return;
      const amt = intOrNull(v.amount);
      return act(b, 'Aprobando…', () => rpc('admin_review_payment', { p_payment: b.dataset.id, p_action: 'approve', p_reason: '', p_amount: amt === Number(b.dataset.amount) ? null : amt }), 'Pago aprobado.');
    }
    return act(b, 'Guardando…', () => rpc('admin_review_payment', { p_payment: b.dataset.id, p_action: 'verifying', p_reason: '' }), 'Pago en verificación.');
  }));

  const methods = getPayments();
  const methodSel = `<label class="field"><span class="field__label">Método</span><select class="field__input" name="method">${methods.map((m) => `<option value="${esc(m.id)}"${m.id === o.payment_method ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}<option value="efectivo">Efectivo</option><option value="otro">Otro</option></select></label>`;
  view.querySelector('[data-addpay]')?.addEventListener('click', async (e) => {
    const v = await formDialog({ title: 'Registrar pago recibido', confirm: 'Registrar',
      body: `<p>Úsalo para pagos que llegaron por otro medio o pagos adicionales. Queda aprobado de inmediato.</p>
        <label class="field"><span class="field__label">Tipo</span><select class="field__input" name="kind">
          <option value="${net === 0 ? (o.payment_plan === 'full' || o.kind === 'normal' ? 'full' : 'deposit') : 'balance'}">${net === 0 ? 'Pago para confirmar' : 'Saldo'}</option><option value="extra">Pago adicional</option></select></label>
        ${fld('amount', 'Valor (COP)', { value: balance || '', req: true, attrs: 'inputmode="numeric"' })}${methodSel}
        ${fld('reference', 'Referencia')}${fld('transfer_date', 'Fecha', { type: 'date' })}${fld('note', 'Nota interna', { type: 'textarea' })}`,
      validate: (x) => (!intOrNull(x.amount) ? 'Escribe el valor.' : '') });
    if (!v) return;
    act(e.currentTarget, 'Registrando…', () => rpc('admin_add_payment', { p_order: o.id, p: { ...v, amount: intOrNull(v.amount) } }), 'Pago registrado.');
  });
  view.querySelector('[data-refund]')?.addEventListener('click', async (e) => {
    const v = await formDialog({ title: 'Registrar reembolso', danger: true, confirm: 'Registrar reembolso',
      body: `<p>Registra el dinero que KOVA devolvió al cliente (máximo ${money(net)}).</p>
        ${fld('amount', 'Valor reembolsado (COP)', { value: net, req: true, attrs: 'inputmode="numeric"' })}${methodSel}${fld('reference', 'Referencia de la devolución')}
        ${fld('note', 'Motivo', { type: 'textarea' })}
        ${o.promo_code ? '<label class="adm-check"><input type="checkbox" name="restore_promo"> Devolver el uso del código promocional (solo reembolso total)</label>' : ''}`,
      validate: (x) => { const a = intOrNull(x.amount); return !a || a > net ? `El valor debe estar entre $1 y ${money(net)}.` : ''; } });
    if (!v) return;
    act(e.currentTarget, 'Registrando…', () => rpc('admin_refund', { p_order: o.id, p: { ...v, amount: intOrNull(v.amount) } }), 'Reembolso registrado.');
  });
  view.querySelector('[data-newproof]')?.addEventListener('click', async (e) => {
    const v = await formDialog({ title: 'Pedir nuevo comprobante', confirm: 'Enviar al historial',
      body: `<p>El mensaje aparece en el enlace de seguimiento del cliente y la reserva se extiende 24 horas. Avísale también por WhatsApp.</p>${fld('message', 'Mensaje', { type: 'textarea', value: 'El comprobante no se ve completo. Sube una captura donde se vea el valor, la fecha y la referencia.' })}` });
    if (!v) return;
    act(e.currentTarget, 'Guardando…', () => rpc('admin_request_new_proof', { p_order: o.id, p_message: v.message }), 'Solicitud registrada.');
  });
  view.querySelector('[data-cancel]')?.addEventListener('click', async (e) => {
    const v = await formDialog({ title: `Cancelar ${o.number}`, danger: true, confirm: 'Cancelar pedido',
      body: `<p>Se liberan los cupos y el uso del código.${net > 0 ? ` <b>El cliente pagó ${money(net)}:</b> registra el reembolso después de devolver el dinero.` : ''}</p>${fld('reason', 'Motivo (lo verá el cliente)', { type: 'textarea', req: true })}`,
      validate: (x) => (!x.reason.trim() ? 'Escribe el motivo.' : '') });
    if (!v) return;
    act(e.currentTarget, 'Cancelando…', () => rpc('admin_cancel_order', { p_order: o.id, p_reason: v.reason }), 'Pedido cancelado.');
  });
  view.querySelectorAll('[data-ful]').forEach((b) => b.addEventListener('click', async () => {
    const s = b.dataset.ful;
    let extra = { note: '' };
    if (s === 'shipped') {
      const v = await formDialog({ title: 'Marcar como enviado', confirm: 'Marcar enviado', body: `${fld('carrier', 'Transportadora', { value: o.carrier })}${fld('tracking', 'Número de guía', { value: o.tracking_number })}${fld('note', 'Nota para el cliente', { type: 'textarea' })}` });
      if (!v) return; extra = v;
    }
    act(b, 'Guardando…', async () => {
      const r = await rpc('admin_set_fulfillment', { p_orders: [o.id], p_status: s, p_note: extra.note ?? '', p_tracking: extra.tracking || null, p_carrier: extra.carrier || null });
      if (!r.updated) throw new Error(`KOVA:${r.skipped[0]?.reason ?? 'No se pudo cambiar el estado.'}`);
    }, `Estado: ${FULFILLMENT[s]}.`);
  }));
  view.querySelector('[data-ship]').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget;
    act(f.querySelector('button'), 'Guardando…', () => rpc('admin_update_order', { p_order: o.id, p: { carrier: f.carrier.value, tracking_number: f.tracking_number.value } }), 'Guía guardada.');
  });
  view.querySelector('[data-shipcost]').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget;
    const p = {};
    const ship = intOrNull(f.shipping_amount.value);
    if (ship !== o.shipping_amount) p.shipping_amount = ship;
    if ((f.est_dispatch_date.value || null) !== o.est_dispatch_date) p.est_dispatch_date = f.est_dispatch_date.value;
    if (!Object.keys(p).length) { toast('Sin cambios.'); return; }
    act(f.querySelector('button'), 'Guardando…', () => rpc('admin_update_order', { p_order: o.id, p }), 'Guardado.');
  });
  view.querySelector('[data-note]').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget;
    if (!f.note.value.trim()) return;
    act(f.querySelector('button'), 'Guardando…', () => rpc('admin_add_note', { p_order: o.id, p_note: f.note.value }), 'Nota agregada.');
  });
  view.querySelectorAll('[data-ck]').forEach((c) => c.addEventListener('change', async () => {
    const ck = Object.fromEntries([...view.querySelectorAll('[data-ck]')].map((x) => [x.dataset.ck, x.checked]));
    try { await rpc('admin_update_order', { p_order: o.id, p: { production_checklist: ck } }); toast('Checklist guardado.'); } catch (err) { c.checked = !c.checked; toast(errText(err)); }
  }));
}

function printReceipt(view, o) {
  const items = [...view.querySelectorAll('.adm-detail__main .adm-card:first-child tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim().replace(/\s+/g, ' ')));
  const w = window.open('', '_blank', 'noopener=no,width=720,height=900');
  if (!w) { toast('Permite las ventanas emergentes para imprimir.'); return; }
  const net = o.paid_total - o.refunded_total;
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recibo ${esc(o.number)}</title>
    <style>body{font:14px/1.45 system-ui,sans-serif;color:#00001f;margin:32px}h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:18px 0}
    td,th{border-bottom:1px solid #ccc;padding:6px 4px;text-align:left}.n{text-align:right}.t{font-weight:700}small{color:#555}</style></head><body>
    <h1>KOVA — Recibo de pedido ${esc(o.number)}</h1><small>Fecha: ${esc(dt(o.created_at))}. Documento informativo, no es factura electrónica.</small>
    <p><b>${esc(o.full_name)}</b><br>${esc(o.whatsapp)} · ${esc(o.email)}<br>${esc([o.address, o.city, o.department].filter(Boolean).join(', '))}</p>
    <table><tr><th>Producto</th><th>Variante</th><th class="n">Cant.</th><th class="n">Total</th></tr>
    ${items.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="n">${esc(r[2])}</td><td class="n">${esc(r[5])}</td></tr>`).join('')}</table>
    <table><tr><td>Subtotal</td><td class="n">${money(o.subtotal_original)}</td></tr>
    ${o.discount_total ? `<tr><td>Descuento (${esc(o.promo_code ?? '')})</td><td class="n">−${money(o.discount_total)}</td></tr>` : ''}
    <tr><td>Envío</td><td class="n">${o.shipping_amount == null ? 'Por definir' : money(o.shipping_amount)}</td></tr>
    <tr class="t"><td>Total</td><td class="n">${money(o.total)}</td></tr><tr><td>Pagado</td><td class="n">${money(net)}</td></tr>
    <tr class="t"><td>Saldo</td><td class="n">${money(Math.max(o.total - net, 0))}</td></tr></table>
    <p>Estado: ${esc(FINANCIAL[o.financial_status])} · ${esc(FULFILLMENT[o.fulfillment_status])}${o.est_dispatch_date ? ` · Despacho estimado ${esc(dateOnly(o.est_dispatch_date))}` : ''}</p>
    <script>print()</script></body></html>`);
  w.document.close();
}
