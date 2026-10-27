// Copia del lead nel foglio «KPI Marketing & Sales RBR», scheda «Lead Check-up» (la legge l'app di Yuri).
// Le prime 15 colonne sono le stesse di «Leads Meta». Service account in GOOGLE_SA_JSON (il JSON intero),
// foglio in LEADS_SHEET_ID, scheda in LEADS_SHEET_TAB. Senza queste variabili non fa niente.
import crypto from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');
let cache = { token: null, exp: 0 };

async function accessToken(sa) {
  if (cache.token && Date.now() < cache.exp - 60e3) return cache.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token ' + (j.error || r.status));
  cache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cache.token;
}

const eurIt = n => '€ ' + Math.round(n).toLocaleString('it-IT') + ',00';

export async function appendLeadRow(L, extra = {}) {
  const raw = process.env.GOOGLE_SA_JSON, id = process.env.LEADS_SHEET_ID, tab = process.env.LEADS_SHEET_TAB || 'Lead Check-up';
  if (!raw || !id) return 'skip';
  const r = L.report || {}, v = r.versione || 'completo';
  const p = (L.nome || '').trim().split(/\s+/);
  const oggi = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });
  const row = [
    oggi, '', '', p[0] || '', p.slice(1).join(' '), L.locale || '', L.citta || '', extra.phone || L.tel || '',
    r.lordo ? eurIt(r.lordo) : '', (r.problemi || [])[0] || '', '', (r.problemi || []).slice(1, 4).join(' · '),
    L.utm?.content || (L.utm?.codice ? 'link ' + L.utm.codice : ''), L.email || '',
    v === 'marketing' ? 'Check-up Marketing' : v === 'numeri' ? 'Check-up Numeri' : 'Check-up Ristorante',
    v, L.utm?.codice || '', r.score ?? '', r.lossM ? Math.round(r.lossM) : '', r.ebitPct ?? '', r.fc ?? '', r.pers ?? '',
    r.scontrino ?? '', r.tipo || '', r.address || '', (r.nonSo || []).join(', '), L.utm?.source || '', L.utm?.campaign || '', extra.contactId || '',
  ].map(x => typeof x === 'string' ? x.slice(0, 500) : x);
  const tok = await accessToken(JSON.parse(raw));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${tab}'!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [row] }), signal: AbortSignal.timeout(10000) });
  return res.ok ? 'ok' : 'errore ' + res.status;
}
