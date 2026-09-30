const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/auth');

const router = express.Router();

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { message: 'Too many OTP requests. Try again in 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { message: 'Too many attempts. Try again in 10 minutes.' },
});

router.post('/send-otp', otpLimiter, ctrl.sendOtp);
router.post('/verify-otp', verifyLimiter, ctrl.verifyOtp);
router.post('/resend-otp', otpLimiter, ctrl.resendOtp);
router.post('/admin-login', verifyLimiter, ctrl.adminLogin);
router.post('/refresh', ctrl.refresh);
router.post('/logout', ctrl.logout);

module.exports = router;
