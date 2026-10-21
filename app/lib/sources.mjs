// Fonti oltre a Google: sito, velocità (PageSpeed), Instagram, campagne Meta.
// Ogni funzione restituisce dati oppure {na:true, why} quando non si può verificare:
// un controllo non verificato si esclude dal punteggio, non si conta come errore.

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const BOOKING = [
  ['resmio', /resmio\./i], ['TheFork', /thefork\.|lafourchette\./i], ['Quandoo', /quandoo\./i], ['OpenTable', /opentable\./i],
  ['Plateform', /plateform\./i], ['CoverManager', /covermanager\./i], ['SevenRooms', /sevenrooms\./i], ['Zenchef', /zenchef\./i],
  ['GoHighLevel', /leadconnectorhq\.com\/widget\/booking|msgsndr\.com/i], ['Tableo', /tableo\./i], ['Cassa in Cloud', /cassanova|cassaincloud/i],
];
const DELIVERY = [['Deliveroo', /deliveroo\.it/i], ['Glovo', /glovoapp\.com/i], ['Just Eat', /justeat\.it/i], ['Uber Eats', /ubereats\.com/i]];
const SOCIAL_SKIP = /^(p|reel|reels|explore|stories|accounts|share|tv|direct)$/i;

export async function analyzeSite(url) {
  if (!url) return { na: true, why: 'nessun sito sulla scheda Google' };
  let res, html = '';
  try {
    res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9' }, signal: AbortSignal.timeout(9000) });
    const buf = await res.arrayBuffer();
    html = new TextDecoder().decode(buf.slice(0, 2_000_000));
  } catch (e) {
    return { url, reachable: false, https: url.startsWith('https'), why: 'il sito non risponde' };
  }
  const finalUrl = res.url || url;
  const blocked = res.status === 403 || res.status === 429 || /cf-chl|captcha|attention required/i.test(html.slice(0, 5000));
  if (blocked) return { url: finalUrl, reachable: true, blocked: true, https: finalUrl.startsWith('https'), na: true, why: 'il sito blocca i controlli automatici' };
  const has = re => re.test(html);
  const fbDirect = has(/connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init/i);
  const gtm = has(/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/);
  const ga4 = has(/gtag\/js\?id=G-|gtag\(\s*['"]config['"]\s*,\s*['"]G-/);
  const booking = BOOKING.find(([, re]) => has(re))?.[0] || (has(/prenota(zion[ei])?|book a table|reserve/i) && has(/<form|widget/i) ? 'modulo sul sito' : null);
  const ig = [...html.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,30})/g)].map(m => m[1].replace(/\.$/, '')).find(h => !SOCIAL_SKIP.test(h)) || null;
  const fb = html.match(/facebook\.com\/(?!sharer|share|tr\b|plugins|dialog)([A-Za-z0-9_.-]{3,80})/)?.[1] || null;
  return {
    url: finalUrl, reachable: res.ok, status: res.status, https: finalUrl.startsWith('https'),
    pixelMeta: fbDirect ? true : gtm ? null : false,   // null = forse via Google Tag Manager, non verificabile senza browser
    ga4: ga4 ? true : gtm ? null : false,
    gtm, booking, prenotazione: !!booking,
    phone: has(/href=["']tel:/i), menu: has(/menu|carta|listino/i),
    whatsapp: has(/wa\.me\/|api\.whatsapp\.com/i),
    instagram: ig, facebook: fb,
    delivery: DELIVERY.filter(([, re]) => has(re)).map(([p]) => p),
    thefork: has(/thefork\.|lafourchette\./i),
  };
}

export async function pageSpeed(url) {
  const key = process.env.PAGESPEED_KEY;
  if (!url) return { na: true, why: 'nessun sito' };
  const qs = new URLSearchParams({ url, strategy: 'mobile', category: 'performance' });
  if (key) qs.set('key', key);
  try {
    const r = await fetch('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' + qs, { signal: AbortSignal.timeout(55000) });
    const j = await r.json();
    if (!r.ok) return { na: true, why: 'PageSpeed non disponibile' };
    const lh = j.lighthouseResult;
    const lcpMs = lh.audits['largest-contentful-paint']?.numericValue;
    return { score: Math.round((lh.categories.performance.score || 0) * 100), lcp: lcpMs ? Math.round(lcpMs / 100) / 10 : null };
  } catch { return { na: true, why: 'PageSpeed troppo lento' }; }
}

export async function instagram(handle) {
  const tok = process.env.META_TOKEN, igId = process.env.IG_USER_ID;
  if (!handle) return { na: true, why: 'nessun profilo Instagram trovato sul sito' };
  if (!tok || !igId) return { na: true, why: 'collegamento Instagram non configurato' };
  const fields = `business_discovery.username(${handle}){username,followers_count,media_count,media.limit(30){timestamp}}`;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${igId}?` + new URLSearchParams({ fields, access_token: tok }), { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j.error) return { handle: '@' + handle, na: true, why: 'profilo personale o non trovato' };
    const b = j.business_discovery, ts = (b.media?.data || []).map(m => Date.parse(m.timestamp)).filter(Boolean);
    const now = Date.now();
    return {
      handle: '@' + b.username, follower: b.followers_count ?? 0, post: b.media_count ?? 0,
      ultimoPost: ts.length ? Math.floor((now - Math.max(...ts)) / 864e5) : null,
      post30: ts.filter(t => now - t < 30 * 864e5).length,
    };
  } catch { return { handle: '@' + handle, na: true, why: 'Instagram non risponde' }; }
}

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
export async function metaAds(name) {
  const tok = process.env.META_ADLIB_TOKEN;
  if (!tok) return { na: true, why: 'Libreria inserzioni non ancora collegata' };
  try {
    const qs = new URLSearchParams({ access_token: tok, search_terms: name, ad_reached_countries: "['IT']", ad_active_status: 'ACTIVE', fields: 'page_name,ad_delivery_start_time', limit: '50' });
    const r = await fetch('https://graph.facebook.com/v21.0/ads_archive?' + qs, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j.error) return { na: true, why: 'Libreria inserzioni non disponibile' };
    const n = norm(name);
    const mine = (j.data || []).filter(a => { const p = norm(a.page_name); return p && (p.includes(n) || n.includes(p)); });
    return { attive: mine.length };
  } catch { return { na: true, why: 'Libreria inserzioni non risponde' }; }
}
