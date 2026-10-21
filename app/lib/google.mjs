// Google Places API (New) + Static Maps. La chiave resta sul server (GOOGLE_MAPS_KEY).
const KEY = () => process.env.GOOGLE_MAPS_KEY || '';
export const hasGoogle = () => !!KEY();

const TYPES = ['restaurant', 'bar', 'cafe', 'meal_takeaway', 'bakery'];

async function places(path, { body, mask, method = 'POST', timeout = 8000 } = {}) {
  const r = await fetch('https://places.googleapis.com/v1/' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': mask },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('places ' + r.status + ' ' + (j.error?.message || '').slice(0, 160));
  return j;
}

export async function autocomplete(input, sessionToken) {
  const j = await places('places:autocomplete', {
    body: { input, sessionToken, languageCode: 'it', includedRegionCodes: ['it'], includedPrimaryTypes: TYPES },
    mask: 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
  });
  return (j.suggestions || []).filter(s => s.placePrediction).slice(0, 5).map(s => ({
    id: s.placePrediction.placeId,
    main: s.placePrediction.structuredFormat?.mainText?.text || '',
    sec: s.placePrediction.structuredFormat?.secondaryText?.text || '',
  }));
}

const DETAIL_MASK = [
  'id', 'displayName', 'formattedAddress', 'addressComponents', 'location', 'rating', 'userRatingCount',
  'regularOpeningHours.weekdayDescriptions', 'nationalPhoneNumber', 'websiteUri', 'editorialSummary',
  'reviews', 'photos', 'reservable', 'delivery', 'takeout', 'primaryType', 'primaryTypeDisplayName', 'googleMapsUri', 'businessStatus',
].join(',');

export async function details(placeId, sessionToken) {
  const qs = new URLSearchParams({ languageCode: 'it', regionCode: 'IT' });
  if (sessionToken) qs.set('sessionToken', sessionToken);
  return places('places/' + encodeURIComponent(placeId) + '?' + qs, { method: 'GET', mask: DETAIL_MASK });
}

export async function findPlaceId(text) {
  const j = await places('places:searchText', {
    body: { textQuery: text, languageCode: 'it', regionCode: 'IT', pageSize: 1 },
    mask: 'places.id',
  });
  return j.places?.[0]?.id || null;
}

// Ricerca come su Maps, centrata sul locale: posizione e concorrenti
export async function rankSearch(query, center) {
  const j = await places('places:searchText', {
    body: {
      textQuery: query, languageCode: 'it', regionCode: 'IT', pageSize: 20,
      locationBias: center ? { circle: { center: { latitude: center.latitude, longitude: center.longitude }, radius: 5000 } } : undefined,
    },
    mask: 'places.id,places.displayName,places.rating,places.userRatingCount,places.location',
  });
  return (j.places || []).map(p => ({
    id: p.id, n: p.displayName?.text || '', r: p.rating ?? null, v: p.userRatingCount ?? 0,
    lat: p.location?.latitude, lng: p.location?.longitude,
  }));
}

export async function staticMap(center, pins) {
  const qs = new URLSearchParams({ size: '640x400', scale: '2', maptype: 'roadmap', key: KEY(), language: 'it' });
  const style = ['feature:poi|visibility:off', 'feature:transit|visibility:off', 'element:labels.icon|visibility:off'];
  const parts = [...qs.entries()].map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  style.forEach(s => parts.push('style=' + encodeURIComponent(s)));
  const others = pins.filter(p => !p.me && p.lat).slice(0, 8).map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`);
  if (others.length) parts.push('markers=' + encodeURIComponent('size:mid|color:0x8a8085|' + others.join('|')));
  if (center) parts.push('markers=' + encodeURIComponent(`color:0xD90A0F|${center.latitude.toFixed(5)},${center.longitude.toFixed(5)}`));
  const r = await fetch('https://maps.googleapis.com/maps/api/staticmap?' + parts.join('&'), { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('staticmap ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
