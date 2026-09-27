const axios = require('axios');
const config = require('../config');

// Server-side proxy for Geoapify (OpenStreetMap data) so the API key never
// ships inside the mobile app. Responses are normalised to the shape the app
// stores on an Event, independent of the provider.

const GEOAPIFY_URL = 'https://api.geoapify.com';
const TIMEOUT_MS = 8000;
const MAX_SUGGESTIONS = 6;

const isLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const isLng = (v) => Number.isFinite(v) && v >= -180 && v <= 180;
// Geoapify place ids are long hex strings
const isPlaceId = (v) => typeof v === 'string' && /^[0-9a-f]{20,600}$/i.test(v);

const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message });

const notConfigured = (res) =>
  fail(res, 503, 'PLACES_NOT_CONFIGURED', 'Location search is not configured');

// Map provider failures to clean app errors; never log the key or raw URL
const providerError = (res, err, action) => {
  const status = err.response?.status;
  if (err.code === 'ECONNABORTED') {
    console.error(`[places] ${action}: Geoapify timed out`);
    return fail(res, 504, 'PLACES_TIMEOUT', 'Location service took too long. Please try again.');
  }
  if (status === 401 || status === 403) {
    console.error(`[places] ${action}: Geoapify rejected the API key (${status})`);
    return fail(res, 502, 'PLACES_UNAVAILABLE', 'Location service is unavailable right now.');
  }
  if (status === 429) {
    console.error(`[places] ${action}: Geoapify rate limit reached`);
    return fail(res, 503, 'PLACES_RATE_LIMITED', 'Location service is busy. Please try again shortly.');
  }
  console.error(`[places] ${action}: Geoapify request failed`, status || err.code || err.message);
  return fail(res, 502, 'PLACES_UNAVAILABLE', 'Location service is unavailable right now.');
};

const geoapify = (path, params) =>
  axios.get(`${GEOAPIFY_URL}${path}`, {
    timeout: TIMEOUT_MS,
    params: { ...params, apiKey: config.geoapify.apiKey },
  });

// Geoapify result properties → app place shape
const toPlace = (p, coords) => {
  const name = p.name || p.address_line1 || p.suburb || p.city || '';
  return {
    placeId: p.place_id || null,
    name,
    locationName: name,
    formattedAddress: p.formatted || [p.address_line1, p.address_line2].filter(Boolean).join(', '),
    city: p.city || p.town || p.village || p.county || p.state_district || '',
    state: p.state || '',
    pincode: p.postcode || '',
    latitude: coords ? coords.latitude : p.lat,
    longitude: coords ? coords.longitude : p.lon,
  };
};

// Centre of a GeoJSON geometry, for details results that are areas, not points
const geometryCentre = (geometry) => {
  if (!geometry) return null;
  if (geometry.type === 'Point') return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] };
  const ring = geometry.type === 'Polygon' ? geometry.coordinates?.[0]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates?.[0]?.[0] : null;
  if (!ring?.length) return null;
  const sum = ring.reduce((a, [lon, lat]) => ({ lon: a.lon + lon, lat: a.lat + lat }), { lon: 0, lat: 0 });
  return { lon: sum.lon / ring.length, lat: sum.lat / ring.length };
};

// POST /api/places/autocomplete { input, latitude?, longitude? }
// (`sessionToken` from older app builds is accepted and ignored)
const autocomplete = async (req, res) => {
  if (!config.geoapify.apiKey) return notConfigured(res);
  const input = String(req.body?.input || '').trim().slice(0, 120);
  if (input.length < 2) return res.json({ success: true, suggestions: [] });

  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const params = {
    text: input,
    filter: 'countrycode:in',
    lang: 'en',
    limit: MAX_SUGGESTIONS,
    format: 'json',
  };
  // Prefer places near the user without excluding other cities
  if (isLat(latitude) && isLng(longitude)) params.bias = `proximity:${longitude},${latitude}`;

  try {
    const { data } = await geoapify('/v1/geocode/autocomplete', params);
    const suggestions = (data.results || [])
      .filter((r) => r.country_code === 'in' && isLat(r.lat) && isLng(r.lon))
      .map((r) => {
        const place = toPlace(r);
        return {
          ...place,
          // Display lines for the suggestion list
          mainText: place.name,
          secondaryText: r.address_line2 || [place.city, place.state].filter(Boolean).join(', '),
        };
      });
    res.json({ success: true, suggestions });
  } catch (err) {
    providerError(res, err, 'autocomplete');
  }
};

// GET /api/places/details/:placeId
const details = async (req, res) => {
  if (!config.geoapify.apiKey) return notConfigured(res);
  const { placeId } = req.params;
  if (!isPlaceId(placeId)) return fail(res, 400, 'INVALID_PLACE_ID', 'Invalid place id');

  try {
    const { data } = await geoapify('/v2/place-details', { id: placeId, lang: 'en' });
    const feature = data.features?.[0];
    if (!feature) return fail(res, 404, 'PLACE_NOT_FOUND', 'Place not found');
    const p = feature.properties || {};
    const centre = isLat(p.lat) && isLng(p.lon) ? { lat: p.lat, lon: p.lon } : geometryCentre(feature.geometry);
    if (!centre) return fail(res, 404, 'PLACE_NOT_FOUND', 'Place not found');
    res.json({
      success: true,
      place: toPlace({ ...p, place_id: p.place_id || placeId }, { latitude: centre.lat, longitude: centre.lon }),
    });
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 400) {
      return fail(res, 404, 'PLACE_NOT_FOUND', 'Place not found');
    }
    providerError(res, err, 'details');
  }
};

// GET /api/places/reverse-geocode?latitude=&longitude=
const reverseGeocode = async (req, res) => {
  if (!config.geoapify.apiKey) return notConfigured(res);
  if (req.query.latitude === undefined || req.query.longitude === undefined) {
    return fail(res, 400, 'INVALID_COORDINATES', 'latitude and longitude are required');
  }
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  if (!isLat(latitude) || !isLng(longitude)) {
    return fail(res, 400, 'INVALID_COORDINATES', 'Invalid coordinates');
  }

  try {
    const { data } = await geoapify('/v1/geocode/reverse', { lat: latitude, lon: longitude, lang: 'en', format: 'json' });
    const top = data.results?.[0];
    // The pin, not the geocoder's snapped result, is the saved coordinate
    const place = top
      ? toPlace(top, { latitude, longitude })
      : { placeId: null, name: '', locationName: '', formattedAddress: '', city: '', state: '', pincode: '', latitude, longitude };
    res.json({ success: true, place });
  } catch (err) {
    providerError(res, err, 'reverse geocode');
  }
};

module.exports = { autocomplete, details, reverseGeocode };
