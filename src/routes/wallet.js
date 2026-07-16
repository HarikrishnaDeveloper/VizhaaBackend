const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/wallet');
const authenticate = require('../middleware/authenticate');

router.use(authenticate);

router.get('/', ctrl.getWallet);
router.post('/withdraw', ctrl.requestWithdrawal);
router.get('/notifications', ctrl.getNotifications);
router.patch('/notifications/:id/read', ctrl.markNotificationRead);

module.exports = router;
