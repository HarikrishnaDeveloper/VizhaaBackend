const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/admin');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');

router.use(authenticate, requireRole('ADMIN'));

// Dashboard
router.get('/dashboard', ctrl.getDashboard);
router.get('/reports', ctrl.getReports);

// Event Requests
router.get('/events', ctrl.listEventRequests);
router.get('/events/:id', ctrl.getEventRequest);
router.put('/events/:id/approve', ctrl.approveEventRequest);
router.put('/events/:id/reject', ctrl.rejectEventRequest);
router.put('/events/:id/team', ctrl.updateEventTeam);
router.put('/events/:id/progress', ctrl.updateEventProgress);

// Event Posts
router.post('/posts', ctrl.createEventPost);
router.get('/posts', ctrl.listEventPosts);
router.put('/posts/:id', ctrl.updateEventPost);
router.post('/posts/:id/publish', ctrl.publishEventPost);

// KYC
router.get('/kyc', ctrl.listPendingKyc);
router.put('/kyc/:supplierId/approve', ctrl.approveKyc);
router.put('/kyc/:supplierId/reject', ctrl.rejectKyc);

// Suppliers
router.get('/suppliers', ctrl.listSuppliers);
router.get('/suppliers/:id', ctrl.getSupplierDetail);

// Organizers
router.get('/organizers', ctrl.listOrganizers);
router.get('/organizers/:id', ctrl.getOrganizerDetail);

// Enrollments
router.get('/posts/:eventPostId/enrollments', ctrl.listEnrollments);
router.put('/enrollments/:enrollmentId/attendance', ctrl.markAttendance);

// Backup
router.post('/backup', ctrl.assignBackup);
router.get('/backup', ctrl.listBackupAssignments);

// Wallet / Transactions
router.get('/transactions', ctrl.listTransactions);
router.put('/transactions/:transactionId/approve-withdrawal', ctrl.approveWithdrawal);

module.exports = router;
