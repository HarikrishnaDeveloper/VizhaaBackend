const Razorpay = require('razorpay');
const crypto = require('crypto');
const config = require('../config');

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

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

const verifyPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  try {
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }
    res.json({ success: true, message: 'Payment verified' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Verification failed', error: err.message });
  }
};

module.exports = { createOrder, verifyPayment };
