const express = require('express');
const router = express.Router();
const { createOrder, verifyPayment, getInvoiceLink, downloadInvoice } = require('../controllers/payment');
const authenticate = require('../middleware/authenticate');

// Public: the short-lived token in the URL is the authorisation.
// (The Razorpay webhook is mounted in app.js because it needs the raw body.)
router.get('/invoice/:token', downloadInvoice);

// Apply authentication middleware to secure payment routes
router.use(authenticate);

router.post('/order', createOrder);
router.post('/verify', verifyPayment);
router.get('/:id/invoice-link', getInvoiceLink);

module.exports = router;
