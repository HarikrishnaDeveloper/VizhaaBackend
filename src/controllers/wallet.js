const prisma = require('../lib/prisma');

const getWallet = async (req, res) => {
  const userId = req.user.sub;
  try {
    const profile = await prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true, walletBalance: true },
    });
    if (!profile) return res.status(404).json({ success: false, message: 'Wallet not found' });

    const transactions = await prisma.walletTransaction.findMany({
      where: { supplierId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ success: true, walletBalance: profile.walletBalance, transactions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch wallet' });
  }
};

const requestWithdrawal = async (req, res) => {
  const userId = req.user.sub;
  const { amount } = req.body;
  try {
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });

    const profile = await prisma.supplierProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });
    if (profile.walletBalance < amount) return res.status(400).json({ success: false, message: 'Insufficient balance' });

    const [transaction] = await prisma.$transaction([
      prisma.walletTransaction.create({
        data: {
          supplierId: profile.id,
          amount,
          type: 'DEBIT',
          reason: 'WITHDRAWAL',
          status: 'PENDING',
          note: 'Withdrawal request',
        },
      }),
      prisma.supplierProfile.update({
        where: { id: profile.id },
        data: { walletBalance: { decrement: amount } },
      }),
    ]);

    res.json({ success: true, message: 'Withdrawal request submitted', transaction });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Withdrawal failed', details: err.message });
  }
};

const getNotifications = async (req, res) => {
  const userId = req.user.sub;
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
};

const markNotificationRead = async (req, res) => {
  const userId = req.user.sub;
  const { id } = req.params;
  try {
    await prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to mark notification' });
  }
};

module.exports = { getWallet, requestWithdrawal, getNotifications, markNotificationRead };
