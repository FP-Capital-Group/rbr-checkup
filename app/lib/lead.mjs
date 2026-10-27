// Contatto del check-up: GHL (contatto + tag + campi + nota) e avviso Telegram a Marco.
import crypto from 'node:crypto';
import { appendLeadRow } from './sheet.mjs';
const GHL = 'https://services.leadconnectorhq.com';
const sha = v => v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined;
const dotIt = n => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const eurIt = n => dotIt(n) + ' €';
const escH = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Evento Lead a Meta dal server (Conversions API), deduplicato con il Pixel tramite event_id.
// Parte solo se il visitatore ha accettato i cookie di misurazione.
async function metaCapi(L, ctx) {
  const pixels = (process.env.META_PIXEL_ID || '').split(',').map(x => x.trim()).filter(Boolean), tok = process.env.META_CAPI_TOKEN || process.env.META_TOKEN;
  if (!pixels.length || !tok || !L.consenso) return 'skip';
  const ph = (normPhone(L.tel) || '').replace(/\D/g, '');
  const ev = {
    event_name: 'Lead', event_time: Math.floor(Date.now() / 1000), action_source: 'website', event_id: L.eventId,
    event_source_url: L.pagina || undefined,
    user_data: { em: L.email ? [sha(L.email)] : undefined, ph: ph ? [sha(ph)] : undefined, fn: [sha((L.nome || '').split(/\s+/)[0])],
      ct: L.citta ? [sha(L.citta.replace(/\s+/g, ''))] : undefined, country: [sha('it')],
      client_ip_address: ctx?.ip || undefined, client_user_agent: ctx?.ua || undefined, fbp: L.fbp || undefined, fbc: L.fbc || undefined },
    custom_data: { content_name: 'checkup-ristorante', value: L.report?.score ?? undefined },
  };
  const body = { data: [ev] };
  if (process.env.CAPI_TEST_CODE) body.test_event_code = process.env.CAPI_TEST_CODE;
  const res = await Promise.all(pixels.map(async pixel => {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${pixel}/events?access_token=${encodeURIComponent(tok)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      const j = await r.json().catch(() => ({}));
      return r.ok ? 'ok' : 'errore ' + (j.error?.error_user_title || j.error?.message || r.status).toString().slice(0, 80);
    } catch (e) { return 'errore'; }
  }));
  return res.every(x => x === 'ok') ? 'ok' : res.join(' | ');
}

// Prima mail al ristoratore, mandata da GHL subito dopo il check-up: riepilogo + una sola azione (prenotare la call)
function leadEmail(L) {
  const r = L.report || {}, nome = (L.nome || '').split(/\s+/)[0] || '';
  const book = process.env.BOOKING_URL;
  const pts = (r.problemi || []).slice(0, 3).map(p => `<li style="margin:0 0 6px">${escH(p)}</li>`).join('');
  const subject = `Il check-up di ${L.locale || 'tuo locale'}: ${r.score ?? '?'}/100`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#141112;max-width:560px">
<p>Ciao ${escH(nome)},</p>
<p>ecco il riepilogo del check-up di <b>${escH(L.locale || 'del tuo locale')}</b>.</p>
<p style="font-size:18px;margin:18px 0"><b>Punteggio ${r.score ?? '?'}/100</b>${r.grade ? ' · ' + escH(r.grade) : ''}<br>
${r.lossM ? `Stai lasciando sul tavolo circa <b style="color:#C3221B">${eurIt(r.lossM)} al mese</b>.` : ''}</p>
${pts ? `<p>I punti da cui partirei:</p><ul style="padding-left:18px">${pts}</ul>` : ''}
<p>Sono stime fatte sulle tue risposte. In 30 minuti le guardiamo con i tuoi numeri veri e ti dico da dove partire, senza impegno.</p>
${book ? `<p style="margin:22px 0"><a href="${book}" style="background:#D90A0F;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:bold;display:inline-block">Prenota la tua analisi gratuita</a></p>` : '<p>Rispondi a questa mail e ti chiamo io.</p>'}
<p>A presto,<br><b>Marco Cuccaro</b><br>Restaurant Business Revolution</p></div>`;
  return { subject, html };
}


function splitName(full) {
  const p = (full || '').trim().split(/\s+/);
  return { firstName: p[0] || '', lastName: p.slice(1).join(' ') };
}
function normPhone(t) {
  let d = (t || '').replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (!d.startsWith('+')) d = '+39' + d.replace(/^0+(?=3)/, '');
  return d;
}
// GHL dietro Cloudflare rifiuta le richieste senza User-Agent (errore 1010)
const H = tok => ({ Authorization: 'Bearer ' + tok, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'rbr-checkup/1.0' });
// Campi del sub-account FP CAPITAL GROUP SRL (KAODAZKquYEJ0rGDANB0). Per un altro sub-account: GHL_FIELDS='{"nome_locale":"id",...}'
const FP_FIELDS = {
  nome_locale: 'UxtmmoUNjYZW28CQkSmU', tipologia_locale: 'emFasQcPSLFBkzjnSEYL', indirizzo_locale: '5bEcFq98nmP96aPc6PyS',
  fatturato_lordo_annuo: 'AqGKPHUMarJHWjhhbaSU', scontrino_medio: 'kyy1kAdI2vzas770Rcwq', incidenza_food: 'pFEKzZEUHs4dRgWaYUd2',
  incidenza_personale: '2H3YsNZp1GTwZ707cErV', problema_principale: 'tOwgQ7CfLalHIRSj0FC0', ha_crm: '6ofxy0XcgW5gZQuT8VDy',
  origine_contatto: 'eTIIfX7zZPjr5KgrmieW', guadagno_potenziale: '9VMA0dD2HAIjOw8rnQcB', attribution_origin: 'xSZaR4UovRlzfhPMdg6g',
  attribution_campaign: '3mFK1VvUGEbqC6IInExv', attribution_ad_name: 'dLrtejBUHT7Ohj1OKpOs', data_ricezione: 'V9oa64sK6DHa1wNnm0V2',
  checkup_punteggio: 'UfqC4KGnGOE5ECKsJIqR', checkup_perdita: 'u59zV8YBwPk0mqkG3dJG', checkup_margine: 'AXfWhRkuYnXPd7NvBypu',
};
const fieldIds = () => { try { return process.env.GHL_FIELDS ? JSON.parse(process.env.GHL_FIELDS) : FP_FIELDS; } catch { return FP_FIELDS; } };
const tierOf = fatt => fatt >= 1_000_000 ? 'A' : fatt >= 400_000 ? 'B' : 'C';

export function summary(L) {
  const r = L.report || {};
  const v = r.versione || 'completo';
  const aree = v === 'marketing' ? `Presenza online ${r.D ?? '?'}/35 · Clienti ${r.C ?? '?'}/15`
    : v === 'numeri' ? `Margini ${r.A ?? '?'}/30 · Controllo ${r.B ?? '?'}/20 · Clienti ${r.C ?? '?'}/15`
    : `Presenza online ${r.D ?? '?'}/35 · Margini ${r.A ?? '?'}/30 · Controllo ${r.B ?? '?'}/20 · Clienti ${r.C ?? '?'}/15`;
  const lines = [
    `Check-up ${v === 'marketing' ? 'Marketing' : v === 'numeri' ? 'Numeri' : 'Ristorante'} — ${L.locale || ''} (${L.citta || ''})`,
    `Link ${L.utm?.codice || '-'} · fonte ${L.utm?.source || 'diretta'}${L.utm?.campaign ? ' · ' + L.utm.campaign : ''}`,
    `Punteggio ${r.score ?? '?'}/100 · ${r.grade || ''}`,
    aree,
    `Fatturato netto stimato ${r.netto ? dotIt(r.netto) + ' €/anno' : '?'}${v === 'marketing' ? '' : ` · margine ${r.ebitPct ?? '?'}%`}`,
    ...(v === 'marketing' ? [] : [`Food cost ${r.fc ?? '?'}% · personale ${r.pers ?? '?'}%`]),
    ...(r.nonSo?.length ? [`«Non lo so» su: ${r.nonSo.join(', ')}`] : []),
    `Perdita stimata ${r.lossM ? dotIt(r.lossM) + ' €/mese' : '?'}`,
    'Problemi principali:', ...(r.problemi || []).slice(0, 5).map(p => '- ' + p),
  ];
  return lines.join('\n');
}

export async function saveLead(L, ctx = {}) {
  const out = { ghl: 'skip', telegram: 'skip' };
  out.meta = await metaCapi(L, ctx);
  const r = L.report || {};
  const tier = tierOf(r.netto || 0);
  const pit = process.env.GHL_PIT, loc = process.env.GHL_LOCATION_ID;
  if (pit && loc) {
    try {
      const F = fieldIds();
      const today = new Date().toISOString().slice(0, 10);
      const cf = [
        [F.nome_locale, L.locale], [F.tipologia_locale, r.tipo], [F.indirizzo_locale, r.address],
        [F.fatturato_lordo_annuo, r.lordo ? Math.round(r.lordo) : null], [F.scontrino_medio, r.scontrino],
        [F.incidenza_food, r.fc != null ? r.fc + '%' : null], [F.incidenza_personale, r.pers != null ? r.pers + '%' : null],
        [F.problema_principale, (r.problemi || [])[0]], [F.ha_crm, r.crm], [F.origine_contatto, r.versione === 'marketing' ? 'Check-up Marketing' : r.versione === 'numeri' ? 'Check-up Numeri' : 'Check-up Ristorante'],
        [F.guadagno_potenziale, r.lossM ? `≈ ${dotIt(r.lossM * 12)} €/anno recuperabili (stima check-up)` : null],
        [F.attribution_origin, L.utm?.source], [F.attribution_campaign, L.utm?.campaign], [F.attribution_ad_name, L.utm?.content || (L.utm?.codice ? 'link ' + L.utm.codice : null)],
        [F.data_ricezione, today],
        [F.checkup_punteggio, r.score], [F.checkup_perdita, r.lossM ? Math.round(r.lossM) : null], [F.checkup_margine, r.ebitPct != null ? String(r.ebitPct).replace('.', ',') + '%' : null],
      ].filter(([id, v]) => id && v != null && v !== '').map(([id, field_value]) => ({ id, field_value }));
      const body = {
        locationId: loc, ...splitName(L.nome), email: L.email || undefined, phone: normPhone(L.tel),
        companyName: L.locale || undefined, city: L.citta || undefined, source: 'Check-up Ristorante',
        tags: ['checkup-ristorante', 'checkup-tier-' + tier, L.utm?.source ? 'fonte-' + String(L.utm.source).toLowerCase().slice(0, 30) : 'fonte-diretta',
          'checkup-' + (['numeri', 'marketing'].includes(r.versione) ? r.versione : 'completo'),
          ...(L.utm?.codice ? ['checkup-link-' + String(L.utm.codice).toLowerCase().replace(/[^\w-]/g, '').slice(0, 20)] : [])],
        customFields: cf,
      };
      const res = await fetch(GHL + '/contacts/upsert', { method: 'POST', headers: H(pit), body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      const j = await res.json().catch(() => ({}));
      const cid = j.contact?.id;
      out.ghl = res.ok ? 'ok' : 'errore ' + res.status;
      if (cid) {
        await fetch(`${GHL}/contacts/${cid}/notes`, { method: 'POST', headers: H(pit), body: JSON.stringify({ body: summary(L) }), signal: AbortSignal.timeout(10000) }).catch(() => {});
        out.contactId = cid;
        if (L.email && process.env.LEAD_EMAIL !== 'off') {
          const m = leadEmail(L);
          const er = await fetch(`${GHL}/conversations/messages`, { method: 'POST', headers: H(pit), body: JSON.stringify({ type: 'Email', contactId: cid, subject: m.subject, html: m.html, emailFrom: process.env.EMAIL_FROM || undefined }), signal: AbortSignal.timeout(10000) }).catch(() => null);
          out.email = er ? (er.ok ? 'ok' : 'errore ' + er.status + ' ' + (await er.text().catch(() => '')).slice(0, 120)) : 'errore';
        }
      }
    } catch (e) { out.ghl = 'errore ' + e.message; }
  }
  // copia nel foglio lead del team (non per il collaudo automatico)
  if (L.utm?.source !== 'collaudo') {
    try { out.sheet = await appendLeadRow(L, { phone: normPhone(L.tel), contactId: out.contactId }); } catch (e) { out.sheet = 'errore ' + e.message.slice(0, 80); }
  }
  const tg = process.env.TG_TOKEN, chat = process.env.TG_CHAT;
  if (tg && chat) {
    try {
      const text = `🔥 Nuovo lead Check-up (tier ${tier})\n${L.nome || ''} · ${normPhone(L.tel)}${L.email ? ' · ' + L.email : ''}\n\n${summary(L)}`;
      const res = await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }), signal: AbortSignal.timeout(8000) });
      out.telegram = res.ok ? 'ok' : 'errore ' + res.status;
    } catch (e) { out.telegram = 'errore'; }
  }
  return out;
}
