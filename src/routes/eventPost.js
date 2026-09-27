const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/eventPost');
const authenticate = require('../middleware/authenticate');

router.use(authenticate);

router.get('/', ctrl.listAvailable);
router.get('/my', ctrl.getMyEnrollments);
router.get('/:id', ctrl.getPostById);
router.post('/:id/enroll', ctrl.enroll);
router.delete('/:id/enroll', ctrl.cancelEnrollment);

module.exports = router;
