const prisma = require('../lib/prisma');
const { notify, notifyAllSuppliers } = require('../services/notification');
const { STATUS, ACCEPTED, TRACKING_STEPS, statusForSteps, progressFor } = require('../services/eventLifecycle');

// ─── Dashboard ───────────────────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const [totalEvents, pendingEvents, totalOrganizers, totalSuppliers, pendingKyc, openPosts, totalEnrollments] = await Promise.all([
      prisma.event.count(),
      prisma.event.count({ where: { status: 'PENDING' } }),
      prisma.user.count({ where: { role: 'ORGANIZER' } }),
      prisma.user.count({ where: { role: 'SUPPLIER' } }),
      prisma.supplierProfile.count({ where: { kycStatus: 'PENDING', kycSubmittedAt: { not: null } } }),
      prisma.eventPost.count({ where: { status: 'OPEN', isPublished: true } }),
      prisma.enrollment.count({ where: { status: 'ENROLLED' } }),
    ]);
    res.json({ success: true, stats: { totalEvents, pendingEvents, totalOrganizers, totalSuppliers, pendingKyc, openPosts, totalEnrollments } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get dashboard', details: err.message });
  }
};

// ─── Event Requests ──────────────────────────────────────────────────────────

const notesFrom = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 1000) : null);

const listEventRequests = async (req, res) => {
  const { status } = req.query;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  try {
    const events = await prisma.event.findMany({
      where: {
        ...(status && { status }),
        ...(q && {
          OR: [
            ...['name', 'type', 'location', 'locationName', 'city'].map((field) => ({ [field]: { contains: q, mode: 'insensitive' } })),
            { user: userSearch(q) },
          ],
        }),
      },
      include: {
        user: { select: { id: true, name: true, mobile: true, companyName: true } },
        eventPost: { select: { id: true, status: true, isPublished: true, _count: { select: { enrollments: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list events' });
  }
};

// Everything the admin event page needs: organizer, payments, post, enrolments
const getEventRequest = async (req, res) => {
  const { id } = req.params;
  try {
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, mobile: true, email: true, companyName: true, businessName: true } },
        payments: { orderBy: { createdAt: 'asc' } },
        eventPost: {
          include: {
            enrollments: {
              include: { supplier: { include: { user: { select: { id: true, name: true, mobile: true, gender: true } } } } },
              orderBy: { enrolledAt: 'asc' },
            },
          },
        },
      },
    });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    res.json({ success: true, event, steps: TRACKING_STEPS });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get event' });
  }
};

const approveEventRequest = async (req, res) => {
  const { id } = req.params;
  try {
    const current = await prisma.event.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: 'Event not found' });
    if (![STATUS.PENDING, STATUS.REJECTED].includes(current.status)) {
      return res.status(400).json({ success: false, message: 'This event has already been approved' });
    }
    const event = await prisma.event.update({
      where: { id },
      data: { status: STATUS.APPROVED, approvedAt: new Date(), adminNotes: notesFrom(req.body.adminNotes) },
    });
    await notify(event.userId, 'Event Request Approved', `Your event "${event.name}" has been approved by Vizhaa.`, 'REQUEST_APPROVED');
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to approve event' });
  }
};

const rejectEventRequest = async (req, res) => {
  const { id } = req.params;
  const adminNotes = notesFrom(req.body.adminNotes);
  try {
    const current = await prisma.event.findUnique({ where: { id }, include: { eventPost: { select: { isPublished: true, status: true } } } });
    if (!current) return res.status(404).json({ success: false, message: 'Event not found' });
    if ([STATUS.IN_PROGRESS, STATUS.COMPLETED].includes(current.status)) {
      return res.status(400).json({ success: false, message: 'An event that has started cannot be rejected' });
    }
    if (current.eventPost?.isPublished && current.eventPost.status !== 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Cancel the published supplier post before rejecting this event' });
    }
    const event = await prisma.event.update({
      where: { id },
      data: { status: STATUS.REJECTED, adminNotes },
    });
    await notify(event.userId, 'Event Request Rejected', `Your event "${event.name}" was not approved. Reason: ${adminNotes || 'N/A'}`, 'REQUEST_REJECTED');
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reject event' });
  }
};

// On-site manager & supervisor shown on the organizer's live tracking
const updateEventTeam = async (req, res) => {
  const { id } = req.params;
  const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const data = {
    managerName: text(req.body.managerName, 100),
    managerPhone: text(req.body.managerPhone, 20),
    supervisorName: text(req.body.supervisorName, 100),
    supervisorPhone: text(req.body.supervisorPhone, 20),
  };
  try {
    const current = await prisma.event.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: 'Event not found' });
    if (!ACCEPTED.includes(current.status)) {
      return res.status(400).json({ success: false, message: 'Approve the event before assigning its team' });
    }
    const event = await prisma.event.update({ where: { id }, data });
    const newlyAssigned = [
      !current.managerName && data.managerName && `Manager: ${data.managerName}`,
      !current.supervisorName && data.supervisorName && `Supervisor: ${data.supervisorName}`,
    ].filter(Boolean);
    if (newlyAssigned.length) {
      await notify(event.userId, 'On-site team assigned', `${event.name} — ${newlyAssigned.join(', ')}`, 'EVENT_TEAM');
    }
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update team' });
  }
};

// Marks a fixed tracking step reached (done: true) or undoes it (done: false).
// Reaching a step also fills earlier ones; undoing clears later ones. Status
// and progress follow the steps.
const updateEventProgress = async (req, res) => {
  const { id } = req.params;
  const { step, done = true } = req.body;
  const idx = TRACKING_STEPS.findIndex((s) => s.key === step);
  if (idx === -1) return res.status(400).json({ success: false, message: 'Unknown tracking step' });
  try {
    const current = await prisma.event.findUnique({ where: { id }, include: { eventPost: { select: { id: true } } } });
    if (!current) return res.status(404).json({ success: false, message: 'Event not found' });
    if (!ACCEPTED.includes(current.status)) {
      return res.status(400).json({ success: false, message: 'Approve the event before tracking it' });
    }

    const now = new Date();
    const data = {};
    TRACKING_STEPS.forEach((s, i) => {
      if (done && i <= idx && !current[s.field]) data[s.field] = now;
      if (!done && i >= idx) data[s.field] = null;
    });
    const next = { ...current, ...data };
    data.status = statusForSteps(next);
    data.progress = progressFor(next);

    const event = await prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({ where: { id }, data });
      // The supplier post follows the event's completion
      const completedNow = data.status === STATUS.COMPLETED && current.status !== STATUS.COMPLETED;
      const reopened = current.status === STATUS.COMPLETED && data.status !== STATUS.COMPLETED;
      if (current.eventPost && (completedNow || reopened)) {
        await tx.eventPost.update({
          where: { id: current.eventPost.id },
          data: completedNow ? { status: 'COMPLETED', completedAt: now } : { status: 'FILLED', completedAt: null },
        });
      }
      return updated;
    });

    if (done && data[TRACKING_STEPS[idx].field]) {
      const { label } = TRACKING_STEPS[idx];
      await notify(event.userId, label, `${event.name}: ${label.toLowerCase()}.`, 'EVENT_PROGRESS', { data: { eventId: event.id, step } });
    }
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update progress' });
  }
};

// ─── Event Posts ─────────────────────────────────────────────────────────────

const createEventPost = async (req, res) => {
  const { eventId, menRequired, womenRequired, payPerPerson, reportingTime, uniformRequirements, cancellationHours, penaltyPercent } = req.body;
  try {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (![STATUS.APPROVED, STATUS.IN_PROGRESS].includes(event.status)) {
      return res.status(400).json({ success: false, message: 'Event must be approved first' });
    }
    if (await prisma.eventPost.findUnique({ where: { eventId } })) {
      return res.status(409).json({ success: false, message: 'This event already has a supplier post' });
    }

    const post = await prisma.eventPost.create({
      data: {
        eventId,
        menRequired: parseInt(menRequired),
        womenRequired: parseInt(womenRequired),
        payPerPerson: parseFloat(payPerPerson),
        reportingTime,
        uniformRequirements,
        cancellationHours: parseInt(cancellationHours) || 48,
        penaltyPercent: parseInt(penaltyPercent) || 50,
      },
    });
    res.status(201).json({ success: true, post });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create event post', details: err.message });
  }
};

const publishEventPost = async (req, res) => {
  const { id } = req.params;
  try {
    const post = await prisma.eventPost.update({
      where: { id },
      data: { isPublished: true, publishedAt: new Date() },
      include: { event: { select: { name: true, type: true, location: true, date: true } } },
    });
    await notifyAllSuppliers(
      'New Event Available',
      `${post.event.name} on ${post.event.date} at ${post.event.location}. ₹${post.payPerPerson}/person`,
      post.id
    );
    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to publish event post', details: err.message });
  }
};

const listEventPosts = async (req, res) => {
  const { status } = req.query;
  try {
    const posts = await prisma.eventPost.findMany({
      where: status ? { status } : {},
      include: {
        event: { select: { name: true, type: true, location: true, date: true, user: { select: { name: true, companyName: true } } } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list event posts' });
  }
};

const updateEventPost = async (req, res) => {
  const { id } = req.params;
  const { status, payPerPerson, uniformRequirements, cancellationHours, penaltyPercent, completedAt } = req.body;
  try {
    const post = await prisma.eventPost.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(payPerPerson && { payPerPerson: parseFloat(payPerPerson) }),
        ...(uniformRequirements && { uniformRequirements }),
        ...(cancellationHours && { cancellationHours: parseInt(cancellationHours) }),
        ...(penaltyPercent && { penaltyPercent: parseInt(penaltyPercent) }),
        ...(completedAt && { completedAt: new Date(completedAt) }),
      },
    });
    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update event post' });
  }
};

// ─── KYC ─────────────────────────────────────────────────────────────────────

const listPendingKyc = async (req, res) => {
  const { status = 'PENDING' } = req.query;
  try {
    const profiles = await prisma.supplierProfile.findMany({
      where: status === 'ALL' ? { kycSubmittedAt: { not: null } } : { kycStatus: status, kycSubmittedAt: { not: null } },
      include: { user: { select: { id: true, name: true, mobile: true, gender: true, dob: true } } },
      orderBy: { kycSubmittedAt: 'desc' },
    });
    res.json({ success: true, profiles });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list KYC submissions' });
  }
};

const approveKyc = async (req, res) => {
  const { supplierId } = req.params;
  try {
    const profile = await prisma.supplierProfile.update({
      where: { id: supplierId },
      data: { kycStatus: 'APPROVED', kycApprovedAt: new Date(), kycRejectionReason: null },
      include: { user: true },
    });
    await notify(profile.userId, 'KYC Approved!', 'Your documents have been verified. You can now enroll in events.', 'KYC_APPROVED');
    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to approve KYC' });
  }
};

const rejectKyc = async (req, res) => {
  const { supplierId } = req.params;
  const { reason } = req.body;
  try {
    const profile = await prisma.supplierProfile.update({
      where: { id: supplierId },
      data: { kycStatus: 'REJECTED', kycRejectionReason: reason || 'Documents unclear or invalid' },
      include: { user: true },
    });
    await notify(profile.userId, 'KYC Rejected', `Reason: ${reason || 'Documents unclear or invalid'}. Please resubmit.`, 'KYC_REJECTED');
    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reject KYC' });
  }
};

// ─── Suppliers ───────────────────────────────────────────────────────────────

// Case-insensitive match on the common identity fields
const userSearch = (q) =>
  q
    ? {
        OR: ['name', 'mobile', 'email', 'companyName', 'businessName', 'city'].map((field) => ({
          [field]: { contains: q, mode: 'insensitive' },
        })),
      }
    : {};

const listSuppliers = async (req, res) => {
  const { kycStatus, q } = req.query;
  try {
    const users = await prisma.user.findMany({
      where: {
        role: 'SUPPLIER',
        ...(kycStatus && { supplierProfile: { kycStatus } }),
        ...userSearch(q?.trim()),
      },
      include: {
        supplierProfile: {
          select: { id: true, kycStatus: true, walletBalance: true, kycSubmittedAt: true, _count: { select: { enrollments: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, suppliers: users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list suppliers' });
  }
};

const getSupplierDetail = async (req, res) => {
  const { id } = req.params;
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        supplierProfile: {
          include: {
            enrollments: { include: { eventPost: { include: { event: { select: { name: true, date: true } } } } }, orderBy: { enrolledAt: 'desc' } },
            transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
          },
        },
      },
    });
    if (!user || user.role !== 'SUPPLIER') return res.status(404).json({ success: false, message: 'Supplier not found' });
    const { passwordHash, fcmToken, ...supplier } = user;
    res.json({ success: true, supplier });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get supplier detail' });
  }
};

// ─── Organizers ──────────────────────────────────────────────────────────────

const organizerSelect = {
  id: true, name: true, mobile: true, email: true, emailVerified: true, companyName: true,
  businessName: true, businessType: true, city: true, address: true, gst: true, createdAt: true,
};

const listOrganizers = async (req, res) => {
  const { q } = req.query;
  try {
    const users = await prisma.user.findMany({
      where: { role: 'ORGANIZER', ...userSearch(q?.trim()) },
      select: { ...organizerSelect, _count: { select: { events: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const spend = await prisma.event.groupBy({
      by: ['userId'],
      where: { userId: { in: users.map((u) => u.id) } },
      _sum: { totalCost: true },
    });
    const spendByUser = Object.fromEntries(spend.map((s) => [s.userId, s._sum.totalCost || 0]));
    res.json({
      success: true,
      organizers: users.map((u) => ({ ...u, totalSpend: spendByUser[u.id] || 0 })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list organizers' });
  }
};

const getOrganizerDetail = async (req, res) => {
  const { id } = req.params;
  try {
    const organizer = await prisma.user.findFirst({
      where: { id, role: 'ORGANIZER' },
      select: {
        ...organizerSelect,
        events: {
          orderBy: { createdAt: 'desc' },
          include: {
            eventPost: { select: { id: true, status: true, isPublished: true, _count: { select: { enrollments: true } } } },
            payments: { select: { id: true, amount: true, purpose: true, status: true, isTest: true, createdAt: true } },
          },
        },
      },
    });
    if (!organizer) return res.status(404).json({ success: false, message: 'Organizer not found' });
    res.json({ success: true, organizer });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get organizer detail' });
  }
};

// ─── Enrollments ─────────────────────────────────────────────────────────────

const listEnrollments = async (req, res) => {
  const { eventPostId } = req.params;
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { eventPostId },
      include: { supplier: { include: { user: { select: { name: true, mobile: true, gender: true } } } } },
      orderBy: { enrolledAt: 'asc' },
    });
    res.json({ success: true, enrollments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list enrollments' });
  }
};

const markAttendance = async (req, res) => {
  const { enrollmentId } = req.params;
  const { attended } = req.body;
  try {
    // Attendance credits or penalises the wallet, so it can only be marked once
    const existing = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { status: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Enrollment not found' });
    if (existing.status !== 'ENROLLED') {
      return res.status(400).json({ success: false, message: `Attendance already recorded (${existing.status.toLowerCase().replace('_', ' ')})` });
    }

    const enrollment = await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { attended, status: attended ? 'ATTENDED' : 'NO_SHOW' },
      include: { supplier: true, eventPost: { include: { event: { select: { name: true } } } } },
    });

    if (attended) {
      // Credit payment to wallet
      const payAmount = enrollment.eventPost.payPerPerson;
      await prisma.$transaction([
        prisma.supplierProfile.update({
          where: { id: enrollment.supplierId },
          data: { walletBalance: { increment: payAmount } },
        }),
        prisma.walletTransaction.create({
          data: {
            supplierId: enrollment.supplierId,
            amount: payAmount,
            type: 'CREDIT',
            reason: 'EVENT_PAYMENT',
            enrollmentId,
            note: `Payment for ${enrollment.eventPost.event.name}`,
          },
        }),
      ]);
      await notify(enrollment.supplier.userId, 'Payment Credited!', `₹${payAmount} credited for attending ${enrollment.eventPost.event.name}`, 'PAYMENT', { enrollmentId });
    } else {
      // Apply no-show penalty
      const penaltyAmount = (enrollment.eventPost.payPerPerson * enrollment.eventPost.penaltyPercent) / 100;
      await prisma.$transaction([
        prisma.enrollment.update({ where: { id: enrollmentId }, data: { penaltyApplied: true, penaltyAmount } }),
        prisma.supplierProfile.update({ where: { id: enrollment.supplierId }, data: { walletBalance: { decrement: penaltyAmount } } }),
        prisma.walletTransaction.create({
          data: { supplierId: enrollment.supplierId, amount: penaltyAmount, type: 'DEBIT', reason: 'PENALTY', enrollmentId, note: 'No-show penalty' },
        }),
      ]);
      await notify(enrollment.supplier.userId, 'No-Show Penalty', `₹${penaltyAmount} deducted for not attending ${enrollment.eventPost.event.name}`, 'PENALTY');
    }

    res.json({ success: true, enrollment });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to mark attendance', details: err.message });
  }
};

// ─── Backup Staff ─────────────────────────────────────────────────────────────

const assignBackup = async (req, res) => {
  const adminId = req.user.sub;
  const { supplierId, eventPostId, enrollmentId, note } = req.body;
  try {
    const assignment = await prisma.backupAssignment.create({
      data: { supplierId, eventPostId, enrollmentId: enrollmentId || null, assignedByAdmin: adminId, note },
      include: { supplier: { select: { userId: true } } },
    });
    await notify(assignment.supplier.userId, 'Backup Assignment', 'You have been assigned as backup for an event. Please report on time.', 'ENROLLED', { eventPostId });
    res.status(201).json({ success: true, assignment });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to assign backup', details: err.message });
  }
};

const listBackupAssignments = async (req, res) => {
  const { eventPostId } = req.query;
  try {
    const assignments = await prisma.backupAssignment.findMany({
      where: eventPostId ? { eventPostId } : {},
      include: {
        supplier: { include: { user: { select: { name: true, mobile: true } } } },
        eventPost: { include: { event: { select: { name: true, date: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list backup assignments' });
  }
};

// ─── Wallet / Transactions ────────────────────────────────────────────────────

const listTransactions = async (req, res) => {
  try {
    const transactions = await prisma.walletTransaction.findMany({
      include: { supplier: { include: { user: { select: { name: true, mobile: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, transactions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list transactions' });
  }
};

const approveWithdrawal = async (req, res) => {
  const { transactionId } = req.params;
  try {
    const tx = await prisma.walletTransaction.update({
      where: { id: transactionId },
      data: { status: 'COMPLETED' },
      include: { supplier: true },
    });
    await notify(tx.supplier.userId, 'Withdrawal Approved', `Your withdrawal of ₹${tx.amount} has been processed.`, 'PAYMENT');
    res.json({ success: true, transaction: tx });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to approve withdrawal' });
  }
};

// ─── Reports ──────────────────────────────────────────────────────────────────

const getReports = async (req, res) => {
  try {
    const [
      totalEvents, approvedEvents, completedEvents,
      totalSuppliers, approvedSuppliers,
      totalEnrollments, attendedEnrollments, cancelledEnrollments, noShowEnrollments,
      totalCredits, totalPenalties,
    ] = await Promise.all([
      prisma.event.count(),
      prisma.event.count({ where: { status: { in: ACCEPTED } } }),
      prisma.eventPost.count({ where: { status: 'COMPLETED' } }),
      prisma.user.count({ where: { role: 'SUPPLIER' } }),
      prisma.supplierProfile.count({ where: { kycStatus: 'APPROVED' } }),
      prisma.enrollment.count(),
      prisma.enrollment.count({ where: { status: 'ATTENDED' } }),
      prisma.enrollment.count({ where: { status: 'CANCELLED' } }),
      prisma.enrollment.count({ where: { status: 'NO_SHOW' } }),
      prisma.walletTransaction.aggregate({ where: { type: 'CREDIT', reason: 'EVENT_PAYMENT' }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { type: 'DEBIT', reason: 'PENALTY' }, _sum: { amount: true } }),
    ]);

    res.json({
      success: true,
      reports: {
        events: { total: totalEvents, approved: approvedEvents, completed: completedEvents },
        suppliers: { total: totalSuppliers, approved: approvedSuppliers },
        enrollments: { total: totalEnrollments, attended: attendedEnrollments, cancelled: cancelledEnrollments, noShow: noShowEnrollments },
        financials: { totalPayouts: totalCredits._sum.amount || 0, totalPenalties: totalPenalties._sum.amount || 0 },
        fulfillmentRate: totalEnrollments > 0 ? ((attendedEnrollments / totalEnrollments) * 100).toFixed(1) : '0',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get reports', details: err.message });
  }
};

module.exports = {
  getDashboard, listEventRequests, getEventRequest, approveEventRequest, rejectEventRequest,
  updateEventTeam, updateEventProgress,
  createEventPost, publishEventPost, listEventPosts, updateEventPost,
  listPendingKyc, approveKyc, rejectKyc,
  listSuppliers, getSupplierDetail,
  listOrganizers, getOrganizerDetail,
  listEnrollments, markAttendance,
  assignBackup, listBackupAssignments,
  listTransactions, approveWithdrawal,
  getReports,
};
