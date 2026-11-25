/**
 * Clientes: lista con búsqueda, número de pedidos, ventas comprometidas, pagado y último pedido. Solo administradores
 * (datos personales, Ley 1581 de 2012). La exportación incluye datos personales: úsala solo para gestionar pedidos.
 */
import { db } from './api.js';
import { run, esc, money, dt, loading, errorBox, head, downloadCsv, pager, waLink } from './ops.js';

const PAGE = 30;
const st = { q: '', page: 1 };

export async function renderCustomers(view) {
  loading(view, 'Cargando clientes');
  try {
    const [{ data: customers }, { data: orders }] = await Promise.all([
      run(db().from('customers').select('*').order('created_at', { ascending: false }).limit(10000)),
      run(db().from('orders').select('customer_id,number,total,paid_total,refunded_total,fulfillment_status,created_at,promo_code,city').limit(50000)),
    ]);
    const stats = new Map();
    orders.forEach((o) => {
      const s = stats.get(o.customer_id) ?? { orders: 0, committed: 0, paid: 0, last: null, codes: new Set(), city: '' };
      s.orders += 1;
      if (!['pending_confirmation', 'cancelled', 'expired'].includes(o.fulfillment_status)) s.committed += o.total;
      s.paid += o.paid_total - o.refunded_total;
      if (!s.last || o.created_at > s.last.created_at) { s.last = o; s.city = o.city; }
      if (o.promo_code) s.codes.add(o.promo_code);
      stats.set(o.customer_id, s);
    });
    const rows = customers.map((c) => ({ ...c, ...(stats.get(c.id) ?? { orders: 0, committed: 0, paid: 0, last: null, codes: new Set(), city: '' }) }));
    draw(view, rows);
  } catch (err) { errorBox(view, err, () => renderCustomers(view)); }
}

function draw(view, all) {
  const n = st.q.trim().toLowerCase();
  const list = all.filter((c) => !n || c.full_name.toLowerCase().includes(n) || c.email_norm.includes(n) || c.phone_norm.includes(n.replace(/\D/g, '') || '¬'));
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  st.page = Math.min(st.page, pages);
  const rows = list.slice((st.page - 1) * PAGE, st.page * PAGE);
  view.innerHTML = `
  <div class="adm-wrap adm-wrap--wide">
    ${head('Compradores', 'Clientes', '<button class="btn btn--line btn--sm" type="button" data-csv>Exportar CSV</button>')}
    <div class="adm-toolbar"><label class="adm-search"><span class="sr-only">Buscar</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      <input type="search" placeholder="Nombre, correo o WhatsApp" value="${esc(st.q)}" data-q></label></div>
    ${rows.length ? `<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Cliente</th><th>Contacto</th><th>Ciudad</th><th class="num">Pedidos</th><th class="num">Comprometido</th><th class="num">Pagado</th><th>Último pedido</th><th>Códigos</th></tr></thead>
      <tbody>${rows.map((c) => `<tr><td class="adm-strong">${esc(c.full_name)}<small>Desde ${esc(dt(c.created_at))}</small></td>
        <td><a href="mailto:${esc(c.email_norm)}">${esc(c.email_norm)}</a><small><a href="${waLink(c.phone_norm, `Hola ${c.full_name.split(' ')[0]}, te escribimos de KOVA.`)}" target="_blank" rel="noopener">+${esc(c.phone_norm)}</a></small></td>
        <td>${esc(c.city || '—')}</td><td class="num">${c.orders}</td><td class="num">${money(c.committed)}</td><td class="num">${money(c.paid)}</td>
        <td>${c.last ? `<a href="#/pedidos?q=${encodeURIComponent(c.email_norm)}">${esc(c.last.number)}</a><small>${esc(dt(c.last.created_at))}</small>` : '—'}</td>
        <td>${esc([...c.codes].join(', ') || '—')}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="adm-empty grid-lines"><h2>Sin clientes todavía<span class="dot">.</span></h2><p>Cada comprador queda registrado al hacer su primer pedido.</p></div>'}
    ${pager(st.page, pages, list.length)}
  </div>`;
  let t;
  view.querySelector('[data-q]').addEventListener('input', (e) => { st.q = e.target.value; st.page = 1; clearTimeout(t); t = setTimeout(() => { draw(view, all); const i = view.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  view.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { st.page = Number(b.dataset.page); draw(view, all); }));
  view.querySelector('[data-csv]').addEventListener('click', () => downloadCsv('kova-clientes', [
    { label: 'Nombre', key: 'full_name' }, { label: 'Correo', key: 'email_norm' }, { label: 'WhatsApp', key: 'phone_norm' }, { label: 'Ciudad', key: 'city' },
    { label: 'Pedidos', key: 'orders' }, { label: 'Comprometido', key: 'committed' }, { label: 'Pagado', key: 'paid' },
    { label: 'Último pedido', get: (c) => c.last?.number }, { label: 'Fecha último pedido', get: (c) => (c.last ? dt(c.last.created_at) : '') }, { label: 'Códigos usados', get: (c) => [...c.codes].join(' ') },
  ], list));
}
