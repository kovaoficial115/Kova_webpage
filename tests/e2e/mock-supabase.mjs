/**
 * Simulador mínimo de Supabase para pruebas locales (NO es para producción).
 * Traduce las llamadas REST/RPC, de sesión y de almacenamiento que hacen la tienda y el panel a SQL
 * contra el Postgres local (psql), aplicando el rol y la identidad del token: así las políticas RLS y
 * las funciones del servidor se ejecutan exactamente igual que en Supabase.
 *
 *   node tests/e2e/mock-supabase.mjs   → http://localhost:54321
 */
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 54321);
const PSQL = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', process.env.MOCK_DB || 'kova', '-tA', '-v', 'ON_ERROR_STOP=1', '-q'];
const FILES = '/tmp/mock-storage';
fs.mkdirSync(FILES, { recursive: true });

const q = (v) => { const tag = `q${crypto.randomBytes(4).toString('hex')}`; return `$${tag}$${v}$${tag}$`; };
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`identificador inválido: ${s}`); return `"${s}"`; };

function sql(statement, { role = 'anon', sub = '', headers = {} } = {}) {
  // Un solo -c = una sola transacción implícita; psql imprime solo el resultado de la última sentencia.
  const full = `set role ${role === 'authenticated' ? 'authenticated' : 'anon'};
    select set_config('request.jwt.claim.sub', ${q(sub)}, false), set_config('request.jwt.claim.role', ${q(role)}, false),
           set_config('request.headers', ${q(JSON.stringify(headers))}, false);
    ${statement}`;
  const r = spawnSync('psql', [...PSQL, '-c', full], { encoding: 'utf8' });
  if (r.status !== 0) {
    const msg = (r.stderr.match(/ERROR:\s+(.*)/) || [])[1] || r.stderr.trim();
    const err = new Error(msg); err.pg = true; throw err;
  }
  const out = r.stdout.trim().split('\n').filter(Boolean).pop() ?? '';
  return out;
}

// Tipos de argumentos de las funciones públicas (para convertir el JSON del cuerpo).
const fnTypes = {};
function loadFns() {
  const rows = spawnSync('psql', [...PSQL, '-c', `select json_agg(json_build_object('n', p.proname, 'a', p.proargnames, 't',
      (select json_agg(format_type(t, null)) from unnest(p.proargtypes) t)))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`], { encoding: 'utf8' }).stdout;
  for (const f of JSON.parse(rows)) fnTypes[f.n] = (f.a || []).map((name, i) => ({ name, type: f.t?.[i] }));
}

function claims(req) {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const p = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString());
    if (p.role === 'authenticated' && p.sub) return { role: 'authenticated', sub: p.sub, email: p.email };
  } catch { /* clave pública */ }
  return { role: 'anon', sub: '' };
}

// ---------- Traducción mínima de PostgREST a SQL (con relaciones simples) ----------
const colCache = {};
function columnsOf(table) {
  if (!colCache[table]) {
    const out = spawnSync('psql', [...PSQL, '-c', `select coalesce(json_agg(column_name), '[]') from information_schema.columns where table_schema = 'public' and table_name = '${table}'`], { encoding: 'utf8' }).stdout;
    colCache[table] = JSON.parse(out);
  }
  return colCache[table];
}
const singular = (t) => t.replace(/s$/, '');
/** Relación entre base y rel: a-uno (base.rel_id) o a-muchos (rel.base_id). */
function relation(base, rel, alias) {
  if (columnsOf(base).includes(`${singular(rel)}_id`)) return { one: true, on: `r.id = ${alias}.${ident(`${singular(rel)}_id`)}` };
  return { one: false, on: `r.${ident(`${singular(base)}_id`)} = ${alias}.id` };
}
function splitTop(str) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of str) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; }
  if (cur) out.push(cur); return out.map((x) => x.trim()).filter(Boolean);
}
function selectList(base, sel, alias = 'b') {
  if (!sel || sel === '*') return { cols: `${alias}.*`, inner: [] };
  const cols = []; const inner = [];
  for (const part of splitTop(sel)) {
    const m = part.match(/^([a-z_]+)(!inner)?\((.*)\)$/);
    if (!m) { cols.push(part === '*' ? `${alias}.*` : `${alias}.${ident(part)}`); continue; }
    const [, rel, inn, sub] = m; const r = relation(base, rel, alias);
    const subCols = splitTop(sub).map((c) => (c === '*' ? 'r.*' : `r.${ident(c)}`)).join(', ');
    cols.push(r.one
      ? `(select to_jsonb(x) from (select ${subCols} from public.${ident(rel)} r where ${r.on}) x) as ${ident(rel)}`
      : `(select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select ${subCols} from public.${ident(rel)} r where ${r.on}) x) as ${ident(rel)}`);
    if (inn) inner.push({ rel, on: r.on });
  }
  return { cols: cols.join(', '), inner };
}
function cond(colSql, opval) {
  let [op, ...rest] = opval.split('.'); let val = rest.join('.'); let neg = false;
  if (op === 'not') { neg = true; [op, ...rest] = val.split('.'); val = rest.join('.'); }
  let c;
  if (op === 'eq') c = `${colSql}::text = ${q(val)}`;
  else if (op === 'neq') c = `${colSql}::text <> ${q(val)}`;
  else if (op === 'gte') c = `${colSql} >= ${q(val)}`;
  else if (op === 'lte') c = `${colSql} <= ${q(val)}`;
  else if (op === 'lt') c = `${colSql} < ${q(val)}`;
  else if (op === 'gt') c = `${colSql} > ${q(val)}`;
  else if (op === 'is') c = `${colSql} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
  else if (op === 'ilike' || op === 'like') c = `${colSql}::text ${op} ${q(val.replace(/\*/g, '%'))}`;
  else if (op === 'in') c = `${colSql}::text = any(${q(`{${val.replace(/^\(|\)$/g, '')}}`)}::text[])`;
  else throw new Error(`filtro no soportado: ${op}`);
  return neg ? `not (${c})` : c;
}
function filters(params, base = null, alias = 'b') {
  const where = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') {
      where.push(`(${splitTop(v.replace(/^\(|\)$/g, '')).map((x) => { const [c, ...r] = x.split('.'); return cond(`${alias}.${ident(c)}`, r.join('.')); }).join(' or ')})`);
      continue;
    }
    if (k.includes('.')) {   // filtro sobre una relación a-uno: orders.fulfillment_status
      const [rel, col] = k.split('.'); const r = relation(base, rel, alias);
      where.push(`exists (select 1 from public.${ident(rel)} r where ${r.on} and ${cond(`r.${ident(col)}`, v)})`);
      continue;
    }
    where.push(cond(`${alias}.${ident(k)}`, v));
  }
  return where;
}
const orderBy = (o) => (o ? ` order by ${o.split(',').map((p) => { const [c, dir, nulls] = p.split('.'); return `${ident(c)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : ''}`; }).join(', ')}` : '');
const cols = (s) => (!s || s === '*' ? '*' : s.split(',').map((c) => ident(c.trim())).join(', '));

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...headers });
  res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
}
const cors = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,PUT,OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range',
};
const pgError = (res, err) => {
  const code = /permission denied|row-level security/.test(err.message) ? 403 : /duplicate key/.test(err.message) ? 409 : 400;
  send(res, code, { code: code === 409 ? '23505' : code === 403 ? '42501' : 'P0001', message: err.message, details: null, hint: null });
};

function fakeJwt(user) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}
function session(user) {
  return { access_token: fakeJwt(user), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `r-${user.id}`, user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } };
}
const findUser = (where) => JSON.parse(spawnSync('psql', [...PSQL, '-c', `select coalesce(json_agg(u), '[]') from auth.users u where ${where}`], { encoding: 'utf8' }).stdout)[0];

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const body = () => (raw.length ? JSON.parse(raw.toString()) : {});
  const who = claims(req);
  const headers = { 'x-forwarded-for': req.headers['x-test-ip'] || '127.0.0.1' };
  try {
    // ---------- Sesión ----------
    if (url.pathname === '/auth/v1/token') {
      const b = body();
      const user = url.searchParams.get('grant_type') === 'refresh_token'
        ? findUser(`'r-' || id::text = ${q(b.refresh_token || '')}`)
        : (b.password === 'kova-test' ? findUser(`email = ${q(b.email || '')}`) : null);
      if (!user) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      return send(res, 200, session(user));
    }
    if (url.pathname === '/auth/v1/user') {
      if (who.role !== 'authenticated') return send(res, 401, { msg: 'JWT expired' });
      return send(res, 200, { id: who.sub, email: who.email, aud: 'authenticated', role: 'authenticated' });
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname.startsWith('/auth/v1/')) return send(res, 200, {});

    // ---------- Almacenamiento ----------
    let m = url.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
    if (m && req.method === 'POST') {
      const [, bucket, p] = m; const name = decodeURIComponent(p);
      const n = sql(`select count(*) from storage.objects where bucket_id = ${q(bucket)} and name = ${q(name)}`, { ...who, headers });
      if (n !== '1') return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      return send(res, 200, { signedURL: `/object/sign/${bucket}/${p}?token=test` });
    }
    if (m && req.method === 'GET') {
      const file = path.join(FILES, m[1], decodeURIComponent(m[2]));
      if (!fs.existsSync(file)) return send(res, 404, {});
      const type = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' }[file.split('.').pop()] ?? 'application/octet-stream';
      res.writeHead(200, { ...cors, 'Content-Type': type }); return res.end(fs.readFileSync(file));
    }
    m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (m && (req.method === 'POST' || req.method === 'PUT')) {
      const [, bucket, p] = m; const name = decodeURIComponent(p);
      const limit = Number(sql(`select coalesce(file_size_limit, 0) from storage.buckets where id = ${q(bucket)}`, { role: 'anon' }) || 0);
      if (limit && raw.length > limit) return send(res, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      try { sql(`insert into storage.objects (bucket_id, name, metadata) values (${q(bucket)}, ${q(name)}, ${q(JSON.stringify({ size: raw.length, mimetype: req.headers['content-type'] || null }))}::jsonb)`, { ...who, headers }); } catch (err) {
        return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      }
      const file = path.join(FILES, bucket, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, raw);
      return send(res, 200, { Key: `${bucket}/${name}` });
    }
    if (url.pathname.startsWith('/storage/v1/object/public/')) { res.writeHead(404, cors); return res.end(); }

    // ---------- RPC ----------
    m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
    if (m) {
      const fn = m[1]; const args = body();
      if (!fnTypes[fn]) loadFns();
      const sig = fnTypes[fn];
      if (!sig) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
      const parts = sig.filter((a) => a.name in args).map((a) => {
        const v = args[a.name];
        if (v === null) return `${ident(a.name)} => null`;
        if (a.type === 'jsonb') return `${ident(a.name)} => ${q(JSON.stringify(v))}::jsonb`;
        if (a.type.endsWith('[]')) return `${ident(a.name)} => ${q(`{${v.join(',')}}`)}::${a.type}`;
        return `${ident(a.name)} => ${q(String(v))}::${a.type}`;
      });
      const out = sql(`select to_jsonb(public.${ident(fn)}(${parts.join(', ')}))`, { ...who, headers });
      return send(res, 200, out || 'null');
    }

    // ---------- Tablas ----------
    m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (m) {
      const name = m[1]; const t = `public.${ident(name)}`; const p = url.searchParams;
      const single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
      const prefer = req.headers.prefer || '';
      const ret = (out, total = null) => {
        const rows = JSON.parse(out || '[]');
        if (single) return rows.length === 1 ? send(res, 200, rows[0]) : send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        const off = Number(p.get('offset') || 0);
        const range = { 'Content-Range': `${rows.length ? `${off}-${off + rows.length - 1}` : '*'}/${total ?? '*'}` };
        if (req.method === 'HEAD') { res.writeHead(200, { ...cors, ...range }); return res.end(); }
        return send(res, 200, /return=minimal/.test(prefer) ? '' : rows, range);
      };
      if (req.method === 'GET' || req.method === 'HEAD') {
        const { cols: sel, inner } = selectList(name, p.get('select'));
        const where = [...filters(p, name), ...inner.map((i) => `exists (select 1 from public.${ident(i.rel)} r where ${i.on})`)];
        const w = where.length ? ` where ${where.join(' and ')}` : '';
        const lim = p.get('limit') ? ` limit ${Number(p.get('limit'))}` : '';
        const off = p.get('offset') ? ` offset ${Number(p.get('offset'))}` : '';
        const total = /count=exact/.test(prefer) ? Number(sql(`select count(*) from ${t} b${w}`, { ...who, headers })) : null;
        if (req.method === 'HEAD') return ret('[]', total);
        return ret(sql(`select coalesce(jsonb_agg(x), '[]') from (select ${sel} from ${t} b${w}${orderBy(p.get('order'))}${lim}${off}) x`, { ...who, headers }), total);
      }
      const where = filters(p, name); const w = where.length ? ` where ${where.join(' and ')}` : '';
      const { cols: retSel } = selectList(name, p.get('select'), name);
      const returning = retSel.replaceAll(`${name}.`, '');
      if (req.method === 'POST') {
        const b = body(); const list = Array.isArray(b) ? b : [b];
        const keys = [...new Set(list.flatMap((o) => Object.keys(o)))].map(ident);
        let conflict = '';
        if (/resolution=merge-duplicates/.test(prefer)) conflict = ` on conflict (${p.get('on_conflict').split(',').map(ident).join(', ')}) do update set ${keys.map((k) => `${k} = excluded.${k}`).join(', ')}`;
        if (/resolution=ignore-duplicates/.test(prefer)) conflict = ' on conflict do nothing';
        return ret(sql(`with ins as (insert into ${t} (${keys.join(', ')}) select ${keys.join(', ')} from jsonb_populate_recordset(null::${t}, ${q(JSON.stringify(list))}::jsonb)${conflict} returning ${returning === '*' ? '*' : returning})
          select coalesce(jsonb_agg(ins), '[]') from ins`, { ...who, headers }));
      }
      if (req.method === 'PATCH') {
        const b = body(); const keys = Object.keys(b).map(ident);
        const set = keys.map((k) => `${k} = src.${k}`).join(', ');
        return ret(sql(`with up as (update ${t} b set ${set} from (select * from jsonb_populate_record(null::${t}, ${q(JSON.stringify(b))}::jsonb)) src${w} returning b.*)
          select coalesce(jsonb_agg(up), '[]') from up`, { ...who, headers }));
      }
      if (req.method === 'DELETE') {
        return ret(sql(`with d as (delete from ${t} b${w} returning b.*) select coalesce(jsonb_agg(d), '[]') from d`, { ...who, headers }));
      }
    }
    send(res, 404, { message: `no simulado: ${req.method} ${url.pathname}` });
  } catch (err) {
    if (err.pg) return pgError(res, err);
    console.error(err);
    send(res, 500, { message: String(err.message) });
  }
});
loadFns();
server.listen(PORT, () => console.log(`mock supabase en http://localhost:${PORT}`));
