const admin = require('../lib/firebase');
const prisma = require('../lib/prisma');

const sendPush = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken || !admin.enabled) return;
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: { priority: 'high' },
    });
  } catch (err) {
    console.error('FCM push error:', err.message);
  }
};

const saveNotification = async (userId, title, body, type, extra = {}) => {
  await prisma.notification.create({
    data: { userId, title, body, type, ...extra },
  });
};

const notify = async (userId, title, body, type, extra = {}) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } });
  await Promise.all([
    saveNotification(userId, title, body, type, extra),
    sendPush(user?.fcmToken, title, body, extra.data || {}),
  ]);
};

// Notify all KYC-approved suppliers about a new event post
const notifyAllSuppliers = async (title, body, eventPostId) => {
  const profiles = await prisma.supplierProfile.findMany({
    where: { kycStatus: 'APPROVED' },
    include: { user: { select: { id: true, fcmToken: true } } },
  });
  await Promise.all(
    profiles.map((p) =>
      Promise.all([
        saveNotification(p.user.id, title, body, 'EVENT_POSTED', { eventPostId }),
        sendPush(p.user.fcmToken, title, body, { eventPostId }),
      ])
    )
  );
};

module.exports = { notify, notifyAllSuppliers, sendPush, saveNotification };
