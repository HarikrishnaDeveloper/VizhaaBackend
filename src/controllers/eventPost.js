const prisma = require('../lib/prisma');
const { notify } = require('../services/notification');

const listAvailable = async (req, res) => {
  const userId = req.user.sub;
  try {
    const profile = await prisma.supplierProfile.findUnique({ where: { userId } });
    if (!profile || profile.kycStatus !== 'APPROVED') {
      return res.status(403).json({ success: false, message: 'KYC approval required to view events' });
    }

    const posts = await prisma.eventPost.findMany({
      where: { isPublished: true, status: 'OPEN' },
      include: {
        event: { select: { name: true, type: true, location: true, date: true } },
        enrollments: { where: { supplierId: profile.id }, select: { id: true, status: true } },
      },
      orderBy: { publishedAt: 'desc' },
    });

    const result = posts.map((p) => ({
      ...p,
      isEnrolled: p.enrollments.length > 0 && p.enrollments[0].status === 'ENROLLED',
      enrollment: p.enrollments[0] || null,
      remainingMen: p.menRequired - p.enrolledMen,
      remainingWomen: p.womenRequired - p.enrolledWomen,
    }));

    res.json({ success: true, posts: result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch events', details: err.message });
  }
};

const getPostById = async (req, res) => {
  const userId = req.user.sub;
  const { id } = req.params;
  try {
    const profile = await prisma.supplierProfile.findUnique({ where: { userId } });
    if (!profile || profile.kycStatus !== 'APPROVED') {
      return res.status(403).json({ success: false, message: 'KYC approval required' });
    }

    const post = await prisma.eventPost.findUnique({
      where: { id },
      include: {
        event: true,
        enrollments: { where: { supplierId: profile.id }, select: { id: true, status: true, enrolledAt: true } },
      },
    });
    if (!post || !post.isPublished) return res.status(404).json({ success: false, message: 'Event not found' });

    res.json({
      success: true,
      post: {
        ...post,
        remainingMen: post.menRequired - post.enrolledMen,
        remainingWomen: post.womenRequired - post.enrolledWomen,
        isEnrolled: post.enrollments.length > 0 && post.enrollments[0].status === 'ENROLLED',
        enrollment: post.enrollments[0] || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch event', details: err.message });
  }
};

const enroll = async (req, res) => {
  const userId = req.user.sub;
  const { id: eventPostId } = req.params;
  try {
    const profile = await prisma.supplierProfile.findUnique({ where: { userId }, include: { user: true } });
    if (!profile || profile.kycStatus !== 'APPROVED') {
      return res.status(403).json({ success: false, message: 'KYC approval required to enroll' });
    }

    const post = await prisma.eventPost.findUnique({ where: { id: eventPostId } });
    if (!post || !post.isPublished || post.status !== 'OPEN') {
      return res.status(400).json({ success: false, message: 'Event is not available for enrollment' });
    }

    // Check gender quota
    const gender = profile.user.gender;
    const isMale = gender === 'Male';
    const isFemale = gender === 'Female';

    if (isMale && post.enrolledMen >= post.menRequired) {
      return res.status(400).json({ success: false, message: 'No male slots available' });
    }
    if (isFemale && post.enrolledWomen >= post.womenRequired) {
      return res.status(400).json({ success: false, message: 'No female slots available' });
    }

    // Check for existing enrollment
    const existing = await prisma.enrollment.findUnique({
      where: { supplierId_eventPostId: { supplierId: profile.id, eventPostId } },
    });
    if (existing && existing.status === 'ENROLLED') {
      return res.status(400).json({ success: false, message: 'Already enrolled in this event' });
    }

    // Enroll inside a transaction
    const [enrollment] = await prisma.$transaction([
      existing
        ? prisma.enrollment.update({ where: { id: existing.id }, data: { status: 'ENROLLED', cancelledAt: null } })
        : prisma.enrollment.create({ data: { supplierId: profile.id, eventPostId } }),
      isMale
        ? prisma.eventPost.update({ where: { id: eventPostId }, data: { enrolledMen: { increment: 1 } } })
        : prisma.eventPost.update({ where: { id: eventPostId }, data: { enrolledWomen: { increment: 1 } } }),
    ]);

    // Auto-close if filled
    const updated = await prisma.eventPost.findUnique({ where: { id: eventPostId } });
    if (updated.enrolledMen >= updated.menRequired && updated.enrolledWomen >= updated.womenRequired) {
      await prisma.eventPost.update({ where: { id: eventPostId }, data: { status: 'FILLED' } });
    }

    await notify(userId, 'Enrollment Confirmed', `You are enrolled for ${post.event?.name || 'the event'}. Report on time!`, 'ENROLLED', { eventPostId });

    res.json({ success: true, message: 'Enrolled successfully', enrollment });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Enrollment failed', details: err.message });
  }
};

const cancelEnrollment = async (req, res) => {
  const userId = req.user.sub;
  const { id: eventPostId } = req.params;
  try {
    const profile = await prisma.supplierProfile.findUnique({ where: { userId }, include: { user: true } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });

    const enrollment = await prisma.enrollment.findUnique({
      where: { supplierId_eventPostId: { supplierId: profile.id, eventPostId } },
      include: { eventPost: { include: { event: true } } },
    });
    if (!enrollment || enrollment.status !== 'ENROLLED') {
      return res.status(400).json({ success: false, message: 'No active enrollment found' });
    }

    const post = enrollment.eventPost;
    const eventDate = new Date(`${post.event.date} ${post.reportingTime}`);
    const hoursUntilEvent = (eventDate - new Date()) / (1000 * 60 * 60);
    const isPenalty = hoursUntilEvent < post.cancellationHours;
    const penaltyAmount = isPenalty ? (post.payPerPerson * post.penaltyPercent) / 100 : 0;

    const gender = profile.user.gender;
    const isMale = gender === 'Male';

    await prisma.$transaction([
      prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), penaltyApplied: isPenalty, penaltyAmount },
      }),
      isMale
        ? prisma.eventPost.update({ where: { id: eventPostId }, data: { enrolledMen: { decrement: 1 }, status: 'OPEN' } })
        : prisma.eventPost.update({ where: { id: eventPostId }, data: { enrolledWomen: { decrement: 1 }, status: 'OPEN' } }),
      ...(isPenalty
        ? [
            prisma.supplierProfile.update({
              where: { id: profile.id },
              data: { walletBalance: { decrement: penaltyAmount } },
            }),
            prisma.walletTransaction.create({
              data: {
                supplierId: profile.id,
                amount: penaltyAmount,
                type: 'DEBIT',
                reason: 'PENALTY',
                enrollmentId: enrollment.id,
                note: `Late cancellation penalty (${post.penaltyPercent}%)`,
              },
            }),
          ]
        : []),
    ]);

    if (isPenalty) {
      await notify(userId, 'Cancellation Penalty Applied', `₹${penaltyAmount} deducted for late cancellation`, 'PENALTY', { eventPostId });
    }

    res.json({ success: true, message: isPenalty ? `Cancelled with ₹${penaltyAmount} penalty` : 'Cancelled successfully', penaltyApplied: isPenalty, penaltyAmount });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Cancellation failed', details: err.message });
  }
};

const getMyEnrollments = async (req, res) => {
  const userId = req.user.sub;
  try {
    const profile = await prisma.supplierProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });

    const enrollments = await prisma.enrollment.findMany({
      where: { supplierId: profile.id },
      include: { eventPost: { include: { event: { select: { name: true, type: true, location: true, date: true } } } } },
      orderBy: { enrolledAt: 'desc' },
    });

    res.json({ success: true, enrollments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch enrollments' });
  }
};

module.exports = { listAvailable, getPostById, enroll, cancelEnrollment, getMyEnrollments };
