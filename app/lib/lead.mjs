// Contatto del check-up: GHL (contatto + tag + campi + nota) e avviso Telegram a Marco.
const GHL = 'https://services.leadconnectorhq.com';

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
const tierOf = fatt => fatt >= 1_000_000 ? 'A' : fatt >= 400_000 ? 'B' : 'C';

export function summary(L) {
  const r = L.report || {};
  const lines = [
    `Check-up Ristorante — ${L.locale || ''} (${L.citta || ''})`,
    `Punteggio ${r.score ?? '?'}/100 · ${r.grade || ''}`,
    `Presenza online ${r.D ?? '?'}/35 · Margini ${r.A ?? '?'}/30 · Controllo ${r.B ?? '?'}/20 · Clienti ${r.C ?? '?'}/15`,
    `Fatturato netto stimato ${r.netto ? Math.round(r.netto).toLocaleString('it-IT') + ' €/anno' : '?'} · margine ${r.ebitPct ?? '?'}%`,
    `Food cost ${r.fc ?? '?'}% · personale ${r.pers ?? '?'}%`,
    `Perdita stimata ${r.lossM ? Math.round(r.lossM).toLocaleString('it-IT') + ' €/mese' : '?'}`,
    'Problemi principali:', ...(r.problemi || []).slice(0, 5).map(p => '- ' + p),
  ];
  return lines.join('\n');
}

export async function saveLead(L) {
  const out = { ghl: 'skip', telegram: 'skip' };
  const r = L.report || {};
  const tier = tierOf(r.netto || 0);
  const pit = process.env.GHL_PIT, loc = process.env.GHL_LOCATION_ID;
  if (pit && loc) {
    try {
      const body = {
        locationId: loc, ...splitName(L.nome), email: L.email || undefined, phone: normPhone(L.tel),
        companyName: L.locale || undefined, city: L.citta || undefined, source: 'Check-up Ristorante',
        tags: ['checkup-ristorante', 'checkup-tier-' + tier, L.utm?.source ? 'fonte-' + String(L.utm.source).toLowerCase().slice(0, 30) : 'fonte-diretta'],
        customFields: [
          ['checkup_punteggio', r.score], ['checkup_perdita_mese', r.lossM ? Math.round(r.lossM) : null], ['checkup_fatturato_netto', r.netto ? Math.round(r.netto) : null],
          ['checkup_tipo_locale', r.tipo], ['checkup_link_maps', r.mapsUri],
        ].filter(([, v]) => v != null && v !== '').map(([key, field_value]) => ({ key, field_value })),
      };
      const res = await fetch(GHL + '/contacts/upsert', { method: 'POST', headers: { Authorization: 'Bearer ' + pit, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      const j = await res.json().catch(() => ({}));
      const cid = j.contact?.id;
      out.ghl = res.ok ? 'ok' : 'errore ' + res.status;
      if (cid) {
        await fetch(`${GHL}/contacts/${cid}/notes`, { method: 'POST', headers: { Authorization: 'Bearer ' + pit, Version: '2021-07-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ body: summary(L) }), signal: AbortSignal.timeout(10000) }).catch(() => {});
        out.contactId = cid;
      }
    } catch (e) { out.ghl = 'errore ' + e.message; }
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
