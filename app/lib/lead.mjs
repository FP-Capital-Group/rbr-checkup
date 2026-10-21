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
      const F = fieldIds();
      const today = new Date().toISOString().slice(0, 10);
      const cf = [
        [F.nome_locale, L.locale], [F.tipologia_locale, r.tipo], [F.indirizzo_locale, r.address],
        [F.fatturato_lordo_annuo, r.lordo ? Math.round(r.lordo) : null], [F.scontrino_medio, r.scontrino],
        [F.incidenza_food, r.fc != null ? r.fc + '%' : null], [F.incidenza_personale, r.pers != null ? r.pers + '%' : null],
        [F.problema_principale, (r.problemi || [])[0]], [F.ha_crm, r.crm], [F.origine_contatto, 'Check-up Ristorante'],
        [F.guadagno_potenziale, r.lossM ? `≈ ${Math.round(r.lossM * 12).toLocaleString('it-IT')} €/anno recuperabili (stima check-up)` : null],
        [F.attribution_origin, L.utm?.source], [F.attribution_campaign, L.utm?.campaign], [F.attribution_ad_name, L.utm?.content],
        [F.data_ricezione, today],
        [F.checkup_punteggio, r.score], [F.checkup_perdita, r.lossM ? Math.round(r.lossM) : null], [F.checkup_margine, r.ebitPct != null ? String(r.ebitPct).replace('.', ',') + '%' : null],
      ].filter(([id, v]) => id && v != null && v !== '').map(([id, field_value]) => ({ id, field_value }));
      const body = {
        locationId: loc, ...splitName(L.nome), email: L.email || undefined, phone: normPhone(L.tel),
        companyName: L.locale || undefined, city: L.citta || undefined, source: 'Check-up Ristorante',
        tags: ['checkup-ristorante', 'checkup-tier-' + tier, L.utm?.source ? 'fonte-' + String(L.utm.source).toLowerCase().slice(0, 30) : 'fonte-diretta'],
        customFields: cf,
      };
      const res = await fetch(GHL + '/contacts/upsert', { method: 'POST', headers: H(pit), body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      const j = await res.json().catch(() => ({}));
      const cid = j.contact?.id;
      out.ghl = res.ok ? 'ok' : 'errore ' + res.status;
      if (cid) {
        await fetch(`${GHL}/contacts/${cid}/notes`, { method: 'POST', headers: H(pit), body: JSON.stringify({ body: summary(L) }), signal: AbortSignal.timeout(10000) }).catch(() => {});
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
