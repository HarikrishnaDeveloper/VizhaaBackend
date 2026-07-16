const prisma = require('../lib/prisma');
const { fileUrl } = require('../services/upload');
const { notify } = require('../services/notification');

const setupProfile = async (req, res) => {
  const userId = req.user.sub;
  const { name, email, gender, dob } = req.body;
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { name, email, gender, dob, role: 'SUPPLIER' },
    });
    // Create supplier profile if not exists
    await prisma.supplierProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    res.json({ success: true, message: 'Profile saved', user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save profile', details: err.message });
  }
};

const submitKyc = async (req, res) => {
  const userId = req.user.sub;
  try {
    const files = req.files || {};
    const getUrl = (field) =>
      files[field]?.[0] ? fileUrl(req, files[field][0].path) : undefined;

    const aadhaarFrontUrl = getUrl('aadhaarFront');
    const aadhaarBackUrl = getUrl('aadhaarBack');
    const panCardUrl = getUrl('panCard');
    const selfieUrl = getUrl('selfie');

    if (!aadhaarFrontUrl || !aadhaarBackUrl || !panCardUrl || !selfieUrl) {
      return res.status(400).json({ success: false, message: 'All 4 documents are required' });
    }

    const profile = await prisma.supplierProfile.upsert({
      where: { userId },
      update: {
        aadhaarFrontUrl,
        aadhaarBackUrl,
        panCardUrl,
        selfieUrl,
        kycStatus: 'PENDING',
        kycSubmittedAt: new Date(),
        kycRejectionReason: null,
      },
      create: {
        userId,
        aadhaarFrontUrl,
        aadhaarBackUrl,
        panCardUrl,
        selfieUrl,
        kycStatus: 'PENDING',
        kycSubmittedAt: new Date(),
      },
    });

    res.json({ success: true, message: 'KYC documents submitted, pending admin approval', kycStatus: profile.kycStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: 'KYC submission failed', details: err.message });
  }
};

const getKycStatus = async (req, res) => {
  const userId = req.user.sub;
  try {
    const profile = await prisma.supplierProfile.findUnique({
      where: { userId },
      select: { kycStatus: true, kycRejectionReason: true, kycSubmittedAt: true, kycApprovedAt: true },
    });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });
    res.json({ success: true, ...profile });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get KYC status' });
  }
};

const getMe = async (req, res) => {
  const userId = req.user.sub;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { supplierProfile: { select: { kycStatus: true, walletBalance: true } } },
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
};

const updateFcmToken = async (req, res) => {
  const userId = req.user.sub;
  const { fcmToken } = req.body;
  try {
    await prisma.user.update({ where: { id: userId }, data: { fcmToken } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update FCM token' });
  }
};

module.exports = { setupProfile, submitKyc, getKycStatus, getMe, updateFcmToken };
