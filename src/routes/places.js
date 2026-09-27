const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/places');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

// Autocomplete fires as the user types; cap it per user so a client bug can't
// burn through the Geoapify quota
const placesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  keyGenerator: (req) => req.user.sub,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many location requests. Please wait a moment.' },
});

router.use(authenticate, placesLimiter);

router.post('/autocomplete', ctrl.autocomplete);
router.get('/details/:placeId', ctrl.details);
router.get('/reverse-geocode', ctrl.reverseGeocode);

module.exports = router;
