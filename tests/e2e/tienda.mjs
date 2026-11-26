/**
 * Prueba de punta a punta de la tienda en Chrome (sin conexión a producción):
 * las llamadas a Supabase se redirigen al simulador local (mock-supabase.mjs) que usa la base de pruebas.
 *   node tests/e2e/tienda.mjs            (requiere http-server en :8080 y el simulador en :54321)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const SITE = 'http://localhost:8080';
const SHOTS = process.env.SHOTS || '/tmp/e2e-shots';
const results = [];
const ok = (cond, msg) => { results.push([Boolean(cond), msg]); console.log(`${cond ? 'ok  ' : 'FALLA'} ${msg}`); };

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'es-CO', timezoneId: 'America/Bogota' });
  await ctx.route(/vfdpkmqncbhrauqtrnay\.supabase\.co/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const res = await fetch(`http://localhost:54321${u.pathname}${u.search}`, { method: req.method(), headers: req.headers(), body: req.postDataBuffer() ?? undefined });
    route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|api\.fontshare\.com|cdn\.fontshare\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  return page;
}

const page = await newPage({ width: 390, height: 844 });

// 1. Catálogo
await page.goto(`${SITE}/index.html`);
await page.waitForSelector('.card, .product-card, [data-quick]', { timeout: 10000 });
const html = await page.content();
ok(/Pre-order/i.test(html), 'catálogo muestra la etiqueta PRE-ORDER');
ok(/Reserva con/.test(html), 'catálogo muestra el anticipo (Reserva con $...)');
await page.screenshot({ path: `${SHOTS}/01-catalogo.png`, fullPage: false });

// 2. Ficha de producto en preventa
await page.goto(`${SITE}/producto.html?id=anima-aetherna`);
await page.waitForSelector('[data-countdown]', { timeout: 10000 });
const pdp = await page.textContent('main');
ok(/RESERVAR AHORA/i.test(pdp), 'ficha: botón RESERVAR AHORA');
ok(/Despacho estimado|despacho/i.test(pdp), 'ficha: fecha estimada de despacho');
ok(/36\.000/.test(pdp), 'ficha: anticipo del 50% = $36.000');
const cd1 = await page.textContent('[data-countdown]');
await page.waitForTimeout(1500);
const cd2 = await page.textContent('[data-countdown]');
ok(cd1 !== cd2, 'ficha: el contador avanza en tiempo real');
await page.screenshot({ path: `${SHOTS}/02-ficha-preventa.png`, fullPage: true });
await page.click('[data-add]');
ok(/Elige/i.test(await page.textContent('main')), 'ficha: pide elegir talla/color antes de reservar');
await page.click('.color >> nth=0');
await page.click('.size:not(.color) >> text=M');
await page.click('[data-qty-step="1"]');
await page.click('[data-add]');
await page.waitForTimeout(400);
const cart = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /cart/i.test(k) && !/buyer|promo|key/i.test(k))) || 'null'));
ok(JSON.stringify(cart).includes('anima-aetherna'), 'ficha: la reserva queda en el carrito');

// 3. Carrito y código promocional
await page.goto(`${SITE}/carrito.html`);
await page.waitForSelector('[data-promo]');
await page.fill('[data-promo] input', 'noexiste');
await page.click('[data-promo-apply]');
await page.waitForSelector('[data-promo-msg].is-error', { timeout: 8000 });
ok(true, 'carrito: código inexistente muestra error');
await page.fill('[data-promo] input', 'prueba10');
await page.click('[data-promo-apply]');
await page.waitForSelector('[data-promo-applied]:not([hidden])', { timeout: 8000 });
const cartTxt = await page.textContent('main');
ok(/PRUEBA10/.test(cartTxt), 'carrito: código aplicado sin importar mayúsculas');
ok(/14\.400/.test(cartTxt), 'carrito: descuento 10% de 2 × $72.000 = $14.400');
await page.screenshot({ path: `${SHOTS}/03-carrito.png`, fullPage: true });
await page.click('[data-checkout-cta]');

// 4. Checkout
await page.waitForURL(/checkout\.html/);
await page.waitForSelector('.co-sum', { timeout: 10000 });
let sum = await page.textContent('[data-quote]');
ok(/129\.600/.test(sum), 'checkout: total con descuento $129.600 (calculado por el servidor)');
ok(/64\.800/.test(sum), 'checkout: valor a pagar ahora = 50% después del descuento ($64.800)');
await page.click('[data-submit]');
ok(/Revisa los campos/.test(await page.textContent('[data-state]')), 'checkout: valida campos obligatorios');
await page.fill('#co-name', 'Cliente Prueba');
await page.fill('#co-phone', '3001234567');
await page.fill('#co-email', 'cliente@prueba.co');
await page.fill('#co-department', 'Valle del Cauca');
await page.fill('#co-city', 'Cali');
const addr = await page.$('#co-address');
if (await addr.isVisible()) await page.fill('#co-address', 'Calle 1 # 2-3');
await page.click('.co-option:has([name="payment"]) >> nth=0');
await page.click('.co-option:has([name="plan"][value="full"])');
await page.waitForTimeout(800);
sum = await page.textContent('[data-quote]');
ok(/Valor a pagar ahora\s*\$\s?129\.600/.test(sum.replace(/\s+/g, ' ')), 'checkout: pago completo cobra el 100% ahora');
await page.click('.co-option:has([name="plan"][value="deposit"])');
await page.waitForTimeout(800);
await page.click('[data-submit]');
ok(/acepta las condiciones/.test(await page.textContent('[data-legal-error]')), 'checkout: exige aceptar condiciones y datos');
await page.check('[name="accept_terms"]', { force: true });
await page.check('[name="accept_data"]', { force: true });
await page.screenshot({ path: `${SHOTS}/04-checkout.png`, fullPage: true });
await page.click('[data-submit]');

// 5. Confirmación y seguimiento
await page.waitForTimeout(2500);
if (!/pedido\.html/.test(page.url())) console.log('estado checkout:', await page.textContent('[data-state]'), await page.textContent('[data-quote]'));
await page.waitForURL(/pedido\.html\?nuevo=1#[0-9a-f]{64}/, { timeout: 15000 });
await page.waitForSelector('.o-grid', { timeout: 10000 });
const ord = await page.textContent('main');
const num = (ord.match(/KOVA-PSY-\d{6}|PSY-\d{6}/) || [])[0];
ok(num, `seguimiento: número de pedido con prefijo de la campaña (${num})`);
ok(/Solicitud registrada/.test(ord), 'seguimiento: banner de solicitud registrada');
ok(/Pendiente/i.test(ord), 'seguimiento: estado pendiente hasta verificar el pago');
const wa = await page.getAttribute('[data-wa]', 'href');
ok(wa.startsWith('https://wa.me/573116983724') && decodeURIComponent(wa).includes(num), 'seguimiento: WhatsApp con el número de pedido al número de KOVA');
await page.screenshot({ path: `${SHOTS}/05-seguimiento.png`, fullPage: true });

// 6. Comprobante
const proof = '/tmp/e2e-comprobante.png';
fs.writeFileSync(proof, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
await page.setInputFiles('#up-file', proof);
await page.fill('#up-ref', 'M123456');
await page.click('[data-up-btn]');
await page.waitForFunction(() => /Recibimos tu comprobante/.test(document.querySelector('main').textContent), null, { timeout: 15000 });
ok(true, 'seguimiento: comprobante subido y en revisión');
const token = page.url().split('#')[1];

// 7. El mismo comprobante no se puede reutilizar (otro pedido)
const page2 = await newPage({ width: 1280, height: 900 });
await page2.goto(`${SITE}/pedido.html#${'0'.repeat(64)}`);
await page2.waitForSelector('.o-error', { timeout: 10000 });
ok(/No pudimos abrir/.test(await page2.textContent('main')), 'seguimiento: un token inválido no muestra ningún pedido');
await page2.goto(`${SITE}/pedido.html#${token}`);
await page2.waitForSelector('.o-grid');
await page2.waitForTimeout(900);
await page2.screenshot({ path: `${SHOTS}/06-seguimiento-escritorio.png`, fullPage: true });
const lay = await page2.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const clipped = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o !== 'visible') return true; } return false; };
  const wide = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > W + 1 && !clipped(el))
    .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}:${Math.round(el.getBoundingClientRect().right)}`).slice(0, 12);
  const ch = document.querySelector('.orderpage .chapter');
  return { W, sw: document.documentElement.scrollWidth, wide, chapter: ch ? getComputedStyle(ch).opacity : 'none' };
});
if (process.env.DEBUG_LAYOUT) console.log(JSON.stringify(lay));
ok(lay.sw <= lay.W, `seguimiento (escritorio): sin desborde horizontal (${lay.sw}/${lay.W}px)`);
ok(lay.chapter === '1', 'seguimiento (escritorio): el encabezado del pedido es visible, sin hueco');
for (const w of [1101, 1280, 1440, 1920]) {
  await page2.setViewportSize({ width: w, height: 900 });
  for (const path of ['index.html', `pedido.html#${token}`, 'checkout.html', 'admin/']) {
    await page2.goto(`${SITE}/${path}`);
    await page2.waitForTimeout(500);
    const d = await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (d > 0) ok(false, `sin desborde horizontal en ${path} a ${w}px (sobran ${d}px)`);
  }
}
ok(true, 'cabecera y páginas sin desborde horizontal de 1101 a 1920 px');
await page2.setViewportSize({ width: 1280, height: 900 });
await page2.goto(`${SITE}/condiciones.html`);
await page2.waitForTimeout(800);
ok(/Ley 1480/.test(await page2.textContent('main')), 'condiciones: textos legales visibles');

// 8. KOVA CUSTOM: el diseño elegido en la página se sube solo al registrar el pedido (bucket privado)
const zlib = await import('node:zlib');
function pngFile(file, w = 240, h = 240) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = (x * 7) & 255; raw[i + 1] = 22; raw[i + 2] = (y * 5) & 255; }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}
const front = pngFile('/tmp/e2e-diseno-frente.png');
const back = pngFile('/tmp/e2e-diseno-espalda.png', 300, 400);
const pc = await newPage({ width: 390, height: 844 });
await pc.goto(`${SITE}/custom.html`);
await pc.waitForSelector('[data-panel]', { timeout: 10000 });
ok(!/se envía por WhatsApp/.test(await pc.textContent('main')), 'KOVA Custom: ya no pide enviar el diseño por WhatsApp');
await pc.click('.cx-mode:has(input[value="classic"])');
await pc.click('[data-sizes] .size >> text=M');
const [chooser] = await Promise.all([pc.waitForEvent('filechooser'), pc.click('[data-slot] [data-pick] >> nth=0')]);
await chooser.setFiles(front);
await pc.waitForSelector('.cx-slot.has-file', { timeout: 8000 });
ok(true, 'KOVA Custom: el diseño del frente se previsualiza');
await pc.click('[data-add]');
await pc.waitForSelector('[data-added]:not([hidden])', { timeout: 8000 });
ok(/se sube de forma privada/.test(await pc.textContent('[data-added]')), 'KOVA Custom: avisa que el diseño se sube con el pedido');
await pc.goto(`${SITE}/checkout.html`);
await pc.waitForSelector('.co-sum', { timeout: 10000 });
await pc.fill('#co-name', 'Diseño Prueba');
await pc.fill('#co-phone', '3009998877');
await pc.fill('#co-email', 'disenio@prueba.co');
await pc.fill('#co-department', 'Valle del Cauca');
await pc.fill('#co-city', 'Cali');
if (await (await pc.$('#co-address')).isVisible()) await pc.fill('#co-address', 'Calle 1 # 2-3');
await pc.click('.co-option:has([name="payment"]) >> nth=0');
await pc.check('[name="accept_terms"]', { force: true });
await pc.check('[name="accept_data"]', { force: true });
await pc.waitForTimeout(800);
await pc.click('[data-submit]');
await pc.waitForURL(/pedido\.html\?nuevo=1#[0-9a-f]{64}/, { timeout: 15000 });
await pc.waitForSelector('#disenos', { timeout: 10000 });
await pc.waitForFunction(() => /Recibido: .*e2e-diseno-frente\.png/.test(document.querySelector('#disenos')?.textContent ?? ''), null, { timeout: 15000 });
ok(true, 'pedido: el diseño del frente se subió solo al registrar el pedido');
ok(/Pendiente/.test(await pc.textContent('#disenos')), 'pedido: la espalda aparece pendiente');
// El archivo se crea en memoria: la intercepción de Playwright no copia cuerpos de archivos leídos del disco.
await pc.evaluate((b64) => {
  const input = document.querySelector('[data-dfile="1:back"]');
  const dt = new DataTransfer();
  dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'e2e-diseno-espalda.png', { type: 'image/png' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, fs.readFileSync(back).toString('base64'));
await pc.waitForFunction(() => /Recibimos todos tus diseños/.test(document.querySelector('#disenos')?.textContent ?? ''), null, { timeout: 15000 });
ok(true, 'pedido: el cliente sube la espalda desde su enlace');
const bad = '/tmp/e2e-diseno.svg'; fs.writeFileSync(bad, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
await pc.setInputFiles('[data-dfile="1:back"]', bad);
await pc.waitForSelector('#disenos .field__error', { timeout: 5000 });
ok(/Formato no admitido/.test(await pc.textContent('#disenos')), 'pedido: rechaza formatos no admitidos (SVG)');
await pc.screenshot({ path: `${SHOTS}/07-pedido-disenos.png`, fullPage: true });
const leftover = await pc.evaluate(() => new Promise((r) => { const q = indexedDB.open('kova-designs'); q.onsuccess = () => { const g = q.result.transaction('files').objectStore('files').count(); g.onsuccess = () => r(g.result); }; q.onerror = () => r(-1); }));
ok(leftover === 0, 'pedido: el diseño ya subido se borra del navegador');
ok(pc.errors.length === 0, `sin errores de JavaScript en KOVA Custom ${pc.errors.join(' | ')}`);

ok(page.errors.length === 0, `sin errores de JavaScript en móvil ${page.errors.join(' | ')}`);
ok(page2.errors.length === 0, `sin errores de JavaScript en escritorio ${page2.errors.join(' | ')}`);
await browser.close();
const failed = results.filter(([c]) => !c).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`);
process.exit(failed ? 1 : 0);
