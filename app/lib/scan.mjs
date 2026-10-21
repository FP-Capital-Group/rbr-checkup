// Scansione a pezzi, come Owner: parte appena il ristoratore sceglie il locale,
// gira mentre risponde alle domande, la pagina legge lo stato ogni 2 secondi.
import crypto from 'node:crypto';
import { details, findPlaceId, rankSearch, hasGoogle } from './google.mjs';
import { analyzeSite, pageSpeed, instagram, metaAds } from './sources.mjs';

const SCANS = new Map();           // id -> scansione (tenuta 3 ore, poi cancellata)
const TTL = 3 * 3600e3;
setInterval(() => { const now = Date.now(); for (const [k, v] of SCANS) if (now - v.created > TTL) SCANS.delete(k); }, 600e3).unref();

const TYPE_WORD = {
  pizza_restaurant: 'pizzeria', italian_restaurant: 'ristorante', seafood_restaurant: 'ristorante di pesce', sushi_restaurant: 'sushi',
  japanese_restaurant: 'ristorante giapponese', chinese_restaurant: 'ristorante cinese', hamburger_restaurant: 'hamburger',
  steak_house: 'steakhouse', bar: 'bar', cafe: 'bar', coffee_shop: 'bar', bakery: 'pasticceria', meal_takeaway: 'cibo da asporto',
  wine_bar: 'wine bar', pub: 'pub', fast_food_restaurant: 'fast food', vegetarian_restaurant: 'ristorante vegetariano',
};

function cityOf(p) {
  const c = p.addressComponents || [];
  const pick = t => c.find(x => x.types?.includes(t))?.longText;
  return pick('locality') || pick('administrative_area_level_3') || pick('postal_town') || pick('administrative_area_level_2') || '';
}
function hoodOf(p) {
  const c = p.addressComponents || [];
  return c.find(x => x.types?.includes('sublocality') || x.types?.includes('neighborhood'))?.longText || '';
}
const firstName = s => (s || '').trim().split(/\s+/)[0] || 'Cliente';

export function getScan(id) { return SCANS.get(id) || null; }

export function startScan({ placeId, nome, citta, session }) {
  const id = crypto.randomBytes(9).toString('base64url');
  const s = { id, created: Date.now(), status: 'running', live: hasGoogle(), parts: {}, done: [] };
  SCANS.set(id, s);
  run(s, { placeId, nome, citta, session }).catch(e => { s.error = String(e.message || e); }).finally(() => { s.status = 'done'; s.ms = Date.now() - s.created; });
  return s;
}

const mark = (s, k, v) => { s.parts[k] = v; s.done.push(k); };

async function run(s, inp) {
  if (!hasGoogle()) { s.error = 'google_non_configurato'; return; }
  let pid = inp.placeId;
  if (!pid && inp.nome) pid = await findPlaceId(`${inp.nome} ${inp.citta || ''}`.trim());
  if (!pid) { s.error = 'locale_non_trovato'; return; }
  const p = await details(pid, inp.session);
  const city = cityOf(p), hood = hoodOf(p);
  const typeWord = TYPE_WORD[p.primaryType] || (p.primaryTypeDisplayName?.text || 'ristorante').toLowerCase();
  const photos = p.photos || [];
  const name = p.displayName?.text || inp.nome || '';
  const reviews = (p.reviews || []).map(r => ({
    a: (firstName(r.authorAttribution?.displayName)[0] || '?').toUpperCase(),
    autore: firstName(r.authorAttribution?.displayName), st: r.rating || 0,
    d: r.relativePublishTimeDescription || '', t: r.originalText?.text || r.text?.text || '',
  }));
  mark(s, 'google', {
    placeId: pid, name, address: p.formattedAddress, city, hood, typeWord,
    center: p.location || null, mapsUri: p.googleMapsUri || null, open: p.businessStatus !== 'CLOSED_PERMANENTLY',
    rating: p.rating ?? null, reviews: p.userRatingCount ?? 0,
    completo: {
      orari: !!p.regularOpeningHours?.weekdayDescriptions?.length, telefono: !!p.nationalPhoneNumber,
      descrizione: !!p.editorialSummary?.text, sito: !!p.websiteUri, prenota: p.reservable === true,
    },
    website: p.websiteUri || null,
    foto: photos.length, fotoLocale: photos.filter(ph => (ph.authorAttributions || []).some(a => (a.displayName || '').toLowerCase().includes(name.toLowerCase().slice(0, 6)))).length,
    deliveryGoogle: p.delivery ?? null,
    reviewsSample: reviews,
    risposte: null, ultime: null,       // risposte del titolare: servono DataForSEO (fase 2)
  });

  const site = analyzeSite(p.websiteUri).then(v => (mark(s, 'sito', v), v));
  const speed = pageSpeed(p.websiteUri).then(v => mark(s, 'velocita', v));
  const ads = metaAds(name).then(v => mark(s, 'meta', v));
  const queries = [`${typeWord} ${city}`, hood ? `${typeWord} ${hood}` : `dove mangiare ${city}`, `ristorante ${city}`]
    .filter((q, i, a) => q.trim() && a.indexOf(q) === i).slice(0, 2);
  const rank = Promise.all(queries.map(q => rankSearch(q, p.location).then(list => ({ q, list })).catch(() => ({ q, list: null }))))
    .then(res => {
      const main = res[0];
      const pos = l => { const i = (l || []).findIndex(x => x.id === pid); return i >= 0 ? i + 1 : null; };
      const list = (main.list || []).slice(0, 7).map(x => ({ ...x, me: x.id === pid }));
      const mePos = pos(main.list);
      if (mePos && mePos > 7) list.push({ id: pid, n: name, r: p.rating, v: p.userRatingCount, me: true, lat: p.location?.latitude, lng: p.location?.longitude });
      mark(s, 'ranking', {
        query: main.q, pos: mePos, total: main.list?.length || 0, list,
        queries: res.map(r => ({ q: r.q, map: pos(r.list), org: null })),
      });
    });
  const ig = site.then(v => instagram(v?.instagram)).then(v => mark(s, 'instagram', v));
  await Promise.allSettled([site, speed, ads, rank, ig]);
}
