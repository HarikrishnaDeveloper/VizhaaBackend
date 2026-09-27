const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/supplier');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const { uploadKyc } = require('../services/upload');

router.use(authenticate);

router.post('/profile', ctrl.setupProfile);
router.get('/me', ctrl.getMe);
router.get('/kyc-status', ctrl.getKycStatus);
router.post('/kyc', (req, res, next) => {
  uploadKyc(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, ctrl.submitKyc);
router.post('/fcm-token', ctrl.updateFcmToken);

module.exports = router;
