const express = require('express');
const ctrl = require('../controllers/organizer');
const authenticate = require('../middleware/authenticate');
const { uploadProfilePhoto } = require('../services/upload');

const router = express.Router();

router.get('/profile', authenticate, ctrl.getProfile);
router.post('/profile', authenticate, ctrl.updateProfile);
router.post('/profile/photo', authenticate, uploadProfilePhoto, ctrl.uploadPhoto);
router.delete('/profile/photo', authenticate, ctrl.deletePhoto);
router.post('/profile/email/send-code', authenticate, ctrl.sendEmailCode);
router.post('/profile/email/verify', authenticate, ctrl.verifyEmailCode);

module.exports = router;
