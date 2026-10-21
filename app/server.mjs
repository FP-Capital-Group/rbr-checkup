// Check-up Ristorante RBR — server unico: pagina + API di scansione + contatti.
// Nessuna dipendenza: Node 20+. Avvio: node server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autocomplete, staticMap, hasGoogle } from './lib/google.mjs';
import { startScan, getScan } from './lib/scan.mjs';
import { saveLead } from './lib/lead.mjs';

const PORT = process.env.PORT || 8080;
const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.json': 'application/json', '.txt': 'text/plain' };
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// limite semplice per indirizzo: N richieste per finestra
const hits = new Map();
function limited(ip, key, max, winMs) {
  const k = ip + '|' + key, now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < winMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}
setInterval(() => hits.clear(), 3600e3).unref();

function send(res, code, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}
async function readJson(req, max = 64_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) { const e = new Error('richiesta troppo grande'); e.code = 413; throw e; } chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { const e = new Error('richiesta non valida'); e.code = 400; throw e; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); }
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    if (url.pathname === '/healthz') return send(res, 200, { ok: true, google: hasGoogle() });
    if (url.pathname === '/api/config') return send(res, 200, {
      live: hasGoogle(), pixel: process.env.META_PIXEL_ID || null, ga4: process.env.GA4_ID || null, booking: process.env.BOOKING_URL || null,
      privacy: process.env.PRIVACY_URL || 'https://www.iubenda.com/privacy-policy/57175682/legal',
    });
    if (url.pathname === '/api/places') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      if (q.length < 3 || !hasGoogle()) return send(res, 200, { items: [] });
      if (limited(ip, 'ac', 120, 600e3)) return send(res, 429, { error: 'troppe ricerche, riprova tra poco' });
      return send(res, 200, { items: await autocomplete(q, url.searchParams.get('s') || undefined) });
    }
    if (url.pathname === '/api/scan' && req.method === 'POST') {
      if (limited(ip, 'scan', 30, 3600e3)) return send(res, 429, { error: 'troppe analisi da questa connessione, riprova più tardi' });
      const b = await readJson(req);
      const s = startScan({ placeId: b.placeId, nome: String(b.nome || '').slice(0, 100), citta: String(b.citta || '').slice(0, 60), session: b.session });
      return send(res, 200, { id: s.id, live: s.live });
    }
    const m = url.pathname.match(/^\/api\/scan\/([\w-]{8,20})$/);
    if (m) {
      const s = getScan(m[1]);
      if (!s) return send(res, 404, { error: 'analisi scaduta' });
      return send(res, 200, { id: s.id, status: s.status, error: s.error || null, done: s.done, parts: s.parts, ms: s.ms || null });
    }
    const mm = url.pathname.match(/^\/api\/map\/([\w-]{8,20})\.png$/);
    if (mm) {
      const s = getScan(mm[1]);
      if (!s?.parts.google) return send(res, 404, { error: 'mappa non pronta' });
      const png = await staticMap(s.parts.google.center, s.parts.ranking?.list || []);
      return send(res, 200, png, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
    }
    if (url.pathname === '/api/lead' && req.method === 'POST') {
      if (limited(ip, 'lead', 8, 3600e3)) return send(res, 429, { error: 'troppi invii, riprova più tardi' });
      const b = await readJson(req);
      if (b.website) return send(res, 200, { ok: true });              // campo trappola compilato: è un bot
      if (b.t && Date.now() - Number(b.t) < 2500) return send(res, 200, { ok: true });
      if (!b.nome || String(b.tel || '').replace(/\D/g, '').length < 9) return send(res, 400, { error: 'nome e cellulare servono' });
      const out = await saveLead(b);
      console.log('lead', new Date().toISOString(), b.locale, out);
      return send(res, 200, { ok: true, ...out });
    }
    // file statici
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p === '/' || !extname(p)) p = '/index.html';
    const file = join(PUBLIC, p);
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'no' });
    const data = await readFile(file).catch(() => null);
    if (!data) return send(res, 404, { error: 'non trovato' });
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': p === '/index.html' ? 'no-cache' : 'public, max-age=86400' });
    res.end(data);
  } catch (e) {
    if (e.code === 400 || e.code === 413) return send(res, e.code, { error: e.message });
    console.error('errore', url.pathname, e.message);
    send(res, 500, { error: 'errore interno' });
  }
});
server.listen(PORT, () => console.log('check-up in ascolto su', PORT, '| google', hasGoogle()));
