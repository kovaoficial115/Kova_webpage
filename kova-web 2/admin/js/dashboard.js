/**
 * Dashboard (resumen y alertas) y Estadísticas (filtros, gráficas y exportación).
 * Separa SIEMPRE ventas comprometidas (pedidos confirmados) de dinero recaudado (pagos aprobados − reembolsos).
 */
import { db } from './api.js';
import { rpc, run, errText, esc, money, loading, errorBox, head, kpi, barChart, rankChart, bindCharts, downloadCsv, FINANCIAL, FULFILLMENT, KIND, todayYmd } from './ops.js';

const st = { range: '30', from: '', to: '', campaign: '', kind: '', product: '', bucket: 'day' };
const RANGES = [['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['90', 'Últimos 90 días'], ['month', 'Este mes'], ['all', 'Todo'], ['custom', 'Personalizado']];

function period() {
  const now = new Date();
  if (st.range === 'all') return [null, null];
  if (st.range === 'custom') return [st.from ? new Date(`${st.from}T00:00:00-05:00`).toISOString() : null, st.to ? new Date(new Date(`${st.to}T00:00:00-05:00`).getTime() + 864e5).toISOString() : null];
  if (st.range === 'month') { const ymd = todayYmd(); return [new Date(`${ymd.slice(0, 8)}01T00:00:00-05:00`).toISOString(), null]; }
  return [new Date(now.getTime() - Number(st.range) * 864e5).toISOString(), null];
}

/** Une las series de ventas comprometidas y recaudo por periodo. */
function merged(d) {
  const map = new Map();
  d.series.forEach((s) => map.set(s.bucket, { label: s.bucket, committed: s.committed, collected: 0, orders: s.orders }));
  d.collected_series.forEach((s) => { const r = map.get(s.bucket) ?? { label: s.bucket, committed: 0, collected: 0, orders: 0 }; r.collected = s.collected; map.set(s.bucket, r); });
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label)).map((r) => ({ ...r, label: st.bucket === 'month' ? r.label.slice(0, 7) : r.label.slice(5) }));
}

export async function renderDashboard(view, { full = false } = {}) {
  loading(view, 'Cargando indicadores');
  try {
    const [from, to] = period();
    const [d, { data: camps }, { data: prods }] = await Promise.all([
      rpc('admin_dashboard', { p_from: from, p_to: to, p_campaign: st.campaign || null, p_kind: st.kind || null, p_product: st.product || null, p_bucket: st.bucket }),
      run(db().from('preorder_campaigns').select('id,name,status,max_units,closes_at').neq('status', 'archived')),
      full ? run(db().from('products').select('id,name').order('position')) : Promise.resolve({ data: [] }),
    ]);
    draw(view, d, camps, prods, full);
  } catch (err) { errorBox(view, err, () => renderDashboard(view, { full })); }
}

function filters(camps, prods, full) {
  return `
  <div class="adm-toolbar adm-toolbar--wrap" role="group" aria-label="Filtros">
    <label class="adm-select"><span class="sr-only">Periodo</span><select data-k="range">${RANGES.map(([v, l]) => `<option value="${v}"${st.range === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    ${st.range === 'custom' ? `<label class="adm-mini"><span>Desde</span><input type="date" data-k="from" value="${st.from}"></label><label class="adm-mini"><span>Hasta</span><input type="date" data-k="to" value="${st.to}"></label>` : ''}
    ${full ? `
    <label class="adm-select"><span class="sr-only">Campaña</span><select data-k="campaign"><option value="">Todas las campañas</option>${camps.map((c) => `<option value="${c.id}"${st.campaign === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="adm-select"><span class="sr-only">Tipo</span><select data-k="kind"><option value="">Todos los tipos</option>${['normal', 'preorder', 'custom'].map((k) => `<option value="${k}"${st.kind === k ? ' selected' : ''}>${esc(KIND[k])}</option>`).join('')}</select></label>
    <label class="adm-select"><span class="sr-only">Producto</span><select data-k="product"><option value="">Todos los productos</option>${prods.map((p) => `<option value="${esc(p.id)}"${st.product === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label class="adm-select"><span class="sr-only">Agrupar</span><select data-k="bucket">${[['day', 'Por día'], ['week', 'Por semana'], ['month', 'Por mes']].map(([v, l]) => `<option value="${v}"${st.bucket === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
  </div>`;
}

function draw(view, d, camps, prods, full) {
  const k = d.kpis;
  const series = merged(d);
  const margin = k.revenue_with_cost > 0 ? Math.round(((k.revenue_with_cost - k.production_cost) / k.revenue_with_cost) * 1000) / 10 : null;
  const alerts = [
    k.proofs_to_review && `<a href="#/pedidos" data-go-proofs><b>${k.proofs_to_review}</b> comprobante(s) por revisar</a>`,
    k.verification_overdue && `<a href="#/pedidos"><b>${k.verification_overdue}</b> pedido(s) con verificación vencida</a>`,
    ...camps.filter((c) => c.status === 'active' && c.closes_at && Date.parse(c.closes_at) - Date.now() < 3 * 864e5 && Date.parse(c.closes_at) > Date.now())
      .map((c) => `<a href="#/preventa/${c.id}">La preventa <b>${esc(c.name)}</b> cierra pronto</a>`),
    k.units_without_cost && `<a href="#/inventario"><b>${k.units_without_cost}</b> unidad(es) vendidas sin costo registrado</a>`,
  ].filter(Boolean);
  view.innerHTML = `
  <div class="adm-wrap adm-wrap--wide">
    ${head(full ? 'Análisis' : 'Resumen', full ? 'Estadísticas' : 'Dashboard', full ? '<button class="btn btn--line btn--sm" type="button" data-csv>Exportar CSV</button>' : '<a class="btn btn--line btn--sm" href="#/estadisticas">Ver estadísticas</a>')}
    ${filters(camps, prods, full)}
    ${alerts.length ? `<ul class="adm-alerts" aria-label="Pendientes">${alerts.map((a) => `<li>${a}</li>`).join('')}</ul>` : ''}
    <h2 class="adm-sub">Dinero</h2>
    <dl class="adm-kpis">
      ${kpi('Ventas comprometidas', money(k.committed_sales), 'pedidos confirmados (con pago verificado)', true)}
      ${kpi('Dinero recaudado', money(k.collected), 'pagos aprobados − reembolsos', true)}
      ${kpi('Anticipos recibidos', money(k.deposits))}
      ${kpi('Saldos por cobrar', money(k.balance_due))}
      ${kpi('Reembolsos', money(k.refunds))}
      ${kpi('Descuentos otorgados', money(k.discount_given), `${k.promo_confirmed_uses} uso(s) de códigos · ${k.promo_active} activo(s)`)}
      ${kpi('Margen estimado', margin == null ? '—' : `${margin}%`, k.units_without_cost ? 'solo sobre productos con costo registrado' : 'sobre ventas con costo')}
    </dl>
    <h2 class="adm-sub">Pedidos y unidades</h2>
    <dl class="adm-kpis">
      ${kpi('Pendientes de pago', k.orders_pending)}
      ${kpi('Confirmados', k.orders_confirmed)}
      ${kpi('Cancelados / vencidos', `${k.orders_cancelled} / ${k.orders_expired}`)}
      ${kpi('Unidades vendidas', k.units_sold)}
      ${kpi('Unidades reservadas sin pagar', k.units_reserved)}
      ${kpi('Unidades por producir', k.units_to_produce)}
      ${kpi('Conversión de reservas', d.conversion.created ? `${Math.round((d.conversion.confirmed / d.conversion.created) * 100)}%` : '—', `${d.conversion.confirmed} de ${d.conversion.created} pedidos se confirmaron`)}
    </dl>
    <div class="adm-charts">
      ${barChart({ id: 'ch-money', title: 'Ventas comprometidas vs. dinero recaudado', data: series.map((s) => ({ label: s.label, values: [s.committed, s.collected] })), series: ['Comprometidas', 'Recaudado'], money: true })}
      ${barChart({ id: 'ch-orders', title: 'Pedidos registrados', data: series.map((s) => ({ label: s.label, values: [s.orders] })), series: ['Pedidos'] })}
      ${rankChart({ title: 'Productos más vendidos (unidades)', data: d.top_products.map((p) => ({ label: p.name, value: p.units, note: money(p.revenue) })) })}
      ${full ? `
      ${rankChart({ title: 'Tallas más vendidas', data: d.sizes.map((s) => ({ label: s.label ?? 'Única', value: s.units })) })}
      ${rankChart({ title: 'Colores más vendidos', data: d.colors.map((s) => ({ label: s.label ?? 'Único', value: s.units })) })}
      ${rankChart({ title: 'Ventas comprometidas por campaña', data: d.by_campaign.map((c) => ({ label: c.name, value: c.committed, note: `${c.orders} pedidos` })), money: true })}
      ${rankChart({ title: 'Descuento por código', data: d.by_promo.map((c) => ({ label: c.code, value: c.discount, note: `${c.orders} pedidos` })), money: true })}
      ${rankChart({ title: 'Pedidos por estado de pago', data: Object.entries(d.status_financial).map(([s, n]) => ({ label: FINANCIAL[s] ?? s, value: n })) })}
      ${rankChart({ title: 'Pedidos por estado de producción', data: Object.entries(d.status_fulfillment).map(([s, n]) => ({ label: FULFILLMENT[s] ?? s, value: n })) })}` : ''}
    </div>
  </div>`;
  bindCharts(view);
  view.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('change', () => { st[el.dataset.k] = el.value; renderDashboard(view, { full }); }));
  view.querySelector('[data-csv]')?.addEventListener('click', () => downloadCsv('kova-estadisticas', [
    { label: 'Periodo', key: 'label' }, { label: 'Pedidos', key: 'orders' }, { label: 'Ventas comprometidas', key: 'committed' }, { label: 'Recaudado', key: 'collected' },
  ], series));
}
