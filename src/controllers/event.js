const prisma = require('../lib/prisma');

const optionalText = (v, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const optionalCoord = (v, limit) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined; // undefined = invalid
};

// Map-confirmed venue details; returns { error } if the coordinates are unusable
const readLocation = (body) => {
  const latitude = optionalCoord(body.latitude, 90);
  const longitude = optionalCoord(body.longitude, 180);
  if (latitude === undefined || longitude === undefined || (latitude === null) !== (longitude === null)) {
    return { error: 'latitude and longitude must both be valid numbers' };
  }
  return {
    data: {
      locationName: optionalText(body.locationName, 200),
      formattedAddress: optionalText(body.formattedAddress),
      city: optionalText(body.city, 100),
      state: optionalText(body.state, 100),
      pincode: optionalText(body.pincode, 10),
      latitude,
      longitude,
      placeId: optionalText(body.placeId, 300),
    },
  };
};

const requiredText = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// Validates an event request and maps it to Event columns. Money is derived
// on the server; `advancePaid` is supplied by the caller (0 or a verified
// payment amount), never taken from the request body.
// Returns { data } or { error }.
const buildEventData = (body = {}) => {
  const name = requiredText(body.name);
  const type = requiredText(body.type, 60);
  // The schema stores a single event date; older app builds send inDate
  const date = requiredText(body.date || body.inDate, 40);
  const inTime = requiredText(body.inTime, 20);
  const outTime = requiredText(body.outTime, 20);
  const dressCode = requiredText(body.dressCode, 60);
  const suppliers = parseInt(body.suppliers, 10);
  const costPerHead = Number(body.costPerHead);

  const missing = Object.entries({ name, type, date, inTime, outTime, dressCode })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { error: `Missing event details: ${missing.join(', ')}` };
  if (!Number.isInteger(suppliers) || suppliers < 1) return { error: 'suppliers must be at least 1' };
  if (!Number.isFinite(costPerHead) || costPerHead <= 0) return { error: 'costPerHead must be a positive number' };

  const place = readLocation(body);
  if (place.error) return { error: place.error };

  const services = Array.isArray(body.services)
    ? body.services.filter((x) => typeof x === 'string').map((x) => x.slice(0, 40)).slice(0, 20)
    : [];

  return {
    data: {
      name, type, date, inTime, outTime, dressCode, suppliers, costPerHead, services,
      // Short label kept for lists; falls back to the venue name
      location: requiredText(body.location, 300) || place.data.locationName || '',
      ...place.data,
      menCount: parseInt(body.menCount, 10) || 0,
      womenCount: parseInt(body.womenCount, 10) || 0,
      totalCost: Math.round(costPerHead * suppliers * 100) / 100,
      status: 'PENDING',
      progress: 0,
    },
  };
};

const createEvent = async (req, res) => {
  const userId = req.user.sub;
  const built = buildEventData(req.body);
  if (built.error) return res.status(400).json({ success: false, message: built.error });
  try {
    const event = await prisma.event.create({
      data: { userId, ...built.data, advancePaid: 0 },
    });
    res.status(201).json({ success: true, message: 'Event request submitted', event });
  } catch (err) {
    console.error('[event] create failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to create event' });
  }
};

const getEvents = async (req, res) => {
  const userId = req.user.sub;
  try {
    const events = await prisma.event.findMany({
      where: { userId },
      include: { eventPost: { select: { id: true, status: true, isPublished: true, enrolledMen: true, enrolledWomen: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch events', error: err.message });
  }
};

const getEventById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.sub;
  try {
    const event = await prisma.event.findFirst({
      where: { id, userId },
      include: { eventPost: true },
    });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch event' });
  }
};

module.exports = { createEvent, getEvents, getEventById, buildEventData };
