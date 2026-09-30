const Razorpay = require('razorpay');
const crypto = require('crypto');
const config = require('../config');
const prisma = require('../lib/prisma');
const jwt = require('jsonwebtoken');
const { buildEventData } = require('./event');
const { writeInvoicePdf, invoiceNumber } = require('../services/invoice');

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

// Razorpay states in which the money is secured for the merchant
const PAID_STATES = ['authorized', 'captured'];

const createOrder = async (req, res) => {
  const { amount, currency = 'INR' } = req.body;
  try {
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency,
      receipt: `receipt_${Date.now()}`,
    });
    res.json({ success: true, orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create Razorpay order', error: err.message });
  }
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

// Confirms the payment with Razorpay itself; the client's word is not enough.
// Returns the amount paid in rupees.
const confirmWithRazorpay = async (paymentId, orderId) => {
  let payment;
  try {
    payment = await razorpay.payments.fetch(paymentId);
  } catch (err) {
    console.error('[payment] Razorpay fetch failed:', err.statusCode || err.message);
    throw httpError(err.statusCode && err.statusCode < 500 ? 400 : 502, 'Could not confirm the payment with Razorpay');
  }
  if (payment.order_id !== orderId) throw httpError(400, 'Payment does not match this order');
  if (!PAID_STATES.includes(payment.status)) throw httpError(400, 'Payment has not been completed');
  return payment.amount / 100;
};

const findProcessed = (razorpayPaymentId) =>
  prisma.payment.findUnique({ where: { razorpayPaymentId }, include: { event: true } });

// What the app needs to show the receipt and fetch the invoice
const paymentSummary = (p) => p && ({
  id: p.id,
  razorpayPaymentId: p.razorpayPaymentId,
  amount: p.amount,
  purpose: p.purpose,
  createdAt: p.createdAt,
});

/**
 * POST /api/payments/verify
 * {
 *   razorpay_order_id, razorpay_payment_id, razorpay_signature,
 *   eventData?  — creates the event (advance / full payment)
 *   eventId?    — records a balance payment on an existing event
 *   isTest?, amount? — dev-only simulated payment (needs ALLOW_TEST_PAYMENTS)
 * }
 * Idempotent: the same payment id always returns the same event.
 */
const verifyPayment = async (req, res) => {
  const userId = req.user.sub;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, eventData, eventId, isTest } = req.body;
  const testMode = isTest === true && config.payments.allowTestPayments;

  if (!razorpay_payment_id || typeof razorpay_payment_id !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing payment id' });
  }

  // Validate the event before touching money, so a bad request fails early
  let built = null;
  if (!eventId && eventData) {
    built = buildEventData(eventData);
    if (built.error) return res.status(400).json({ success: false, message: built.error });
  }

  try {
    if (!testMode) {
      const expectedSignature = crypto
        .createHmac('sha256', config.razorpay.keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Invalid signature' });
      }
    }

    // Already processed (retry / double tap): return the original result
    const existing = await findProcessed(razorpay_payment_id);
    if (existing) {
      if (existing.userId !== userId) return res.status(409).json({ success: false, message: 'Payment already used' });
      return res.json({ success: true, message: 'Payment already processed', event: existing.event, payment: paymentSummary(existing) });
    }

    // Nothing to attach the payment to: behave as before (verification only)
    if (!eventId && !built) return res.json({ success: true, message: 'Payment verified' });

    let amount;
    if (testMode) {
      amount = Number(eventId ? req.body.amount : eventData.advancePaid);
      if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'Invalid test payment amount');
    } else {
      amount = await confirmWithRazorpay(razorpay_payment_id, razorpay_order_id);
    }

    const payment = {
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id || null,
      userId,
      amount,
      isTest: testMode,
    };

    const { event, record } = await prisma.$transaction(async (tx) => {
      if (eventId) {
        const current = await tx.event.findFirst({ where: { id: eventId, userId } });
        if (!current) throw httpError(404, 'Event not found');
        const record = await tx.payment.create({ data: { ...payment, eventId, purpose: 'BALANCE' } });
        const event = await tx.event.update({
          where: { id: eventId },
          data: { advancePaid: Math.min(current.totalCost, current.advancePaid + amount) },
        });
        return { event, record };
      }
      const created = await tx.event.create({
        data: { userId, ...built.data, advancePaid: Math.min(built.data.totalCost, amount) },
      });
      const record = await tx.payment.create({ data: { ...payment, eventId: created.id, purpose: 'ADVANCE' } });
      return { event: created, record };
    });

    res.status(eventId ? 200 : 201).json({
      success: true,
      message: eventId ? 'Payment recorded' : 'Payment verified and event created',
      event,
      payment: paymentSummary(record),
    });
  } catch (err) {
    // Lost a race with a concurrent request for the same payment
    if (err.code === 'P2002') {
      const existing = await findProcessed(razorpay_payment_id).catch(() => null);
      if (existing?.userId === userId) {
        return res.json({ success: true, message: 'Payment already processed', event: existing.event, payment: paymentSummary(existing) });
      }
    }
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[payment] verify failed:', err.message);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
};

// ─── Webhook ────────────────────────────────────────────────────────────────

// Razorpay payment/refund state → our Payment.status
const WEBHOOK_STATUS = {
  'payment.authorized': 'authorized',
  'payment.captured': 'captured',
  'refund.processed': 'refunded',
};

/**
 * POST /api/payments/webhook  (Razorpay → us; mounted with a raw body parser)
 * Verifies X-Razorpay-Signature, then keeps Payment.status in sync.
 * Always answers 2xx once the signature is valid so Razorpay stops retrying.
 */
const handleWebhook = async (req, res) => {
  const secret = config.razorpay.webhookSecret;
  const signature = req.get('x-razorpay-signature');
  if (!secret || !signature || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ success: false, message: 'Invalid webhook' });
  }

  const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  const valid = expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!valid) return res.status(400).json({ success: false, message: 'Invalid signature' });

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON' });
  }

  const { event: type } = payload;
  const entity = payload.payload?.payment?.entity;
  const status = WEBHOOK_STATUS[type];
  console.log(`[payment] webhook ${type} ${entity?.id || ''}`);

  try {
    if (status && entity?.id) {
      // Only payments the app has already verified exist here; others are ignored
      const { count } = await prisma.payment.updateMany({
        where: { razorpayPaymentId: entity.id },
        data: { status },
      });
      if (!count) console.log(`[payment] webhook: no local record yet for ${entity.id}`);
    } else if (type === 'payment.failed') {
      console.warn(`[payment] failed ${entity?.id}: ${entity?.error_description || 'unknown reason'}`);
    }
  } catch (err) {
    // 500 makes Razorpay retry later
    console.error('[payment] webhook processing failed:', err.message);
    return res.status(500).json({ success: false });
  }
  res.json({ success: true });
};

// ─── Invoice ────────────────────────────────────────────────────────────────

// Separate key so an invoice link can never be used as an access token
const invoiceKey = () => crypto.createHmac('sha256', config.jwtSecret).update('invoice-link').digest();
const INVOICE_LINK_TTL = '15m';

/**
 * GET /api/payments/:id/invoice-link  (authenticated)
 * Returns a short-lived path the app can open in the browser to view,
 * download or print the PDF — the browser has no access token.
 */
const getInvoiceLink = async (req, res) => {
  const payment = await prisma.payment.findFirst({
    where: { id: req.params.id, userId: req.user.sub },
    select: { id: true },
  });
  if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

  const token = jwt.sign({ pid: payment.id }, invoiceKey(), { expiresIn: INVOICE_LINK_TTL });
  res.json({ success: true, path: `/api/payments/invoice/${token}` });
};

/** GET /api/payments/invoice/:token  (public, token-gated) → application/pdf */
const downloadInvoice = async (req, res) => {
  let pid;
  try {
    ({ pid } = jwt.verify(req.params.token, invoiceKey()));
  } catch {
    return res.status(401).send('This invoice link has expired. Open it again from the Vizhaa app.');
  }

  const payment = await prisma.payment.findUnique({
    where: { id: pid },
    include: { event: { include: { user: true, payments: true } } },
  });
  if (!payment) return res.status(404).send('Invoice not found');

  res.setHeader('Content-Type', 'application/pdf');
  // inline: opens in the browser viewer, which offers download and print
  res.setHeader('Content-Disposition', `inline; filename="${invoiceNumber(payment)}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  writeInvoicePdf(payment, res);
};

module.exports = { createOrder, verifyPayment, handleWebhook, getInvoiceLink, downloadInvoice };
