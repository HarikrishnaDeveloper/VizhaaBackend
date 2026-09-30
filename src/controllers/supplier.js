const prisma = require('../lib/prisma');
const { fileUrl } = require('../services/upload');
const { notify } = require('../services/notification');
const { BUSINESS_TYPES, GENDERS, isProfileComplete, nextStep, publicProfile } = require('../services/supplierOnboarding');

const TRANSPORT_MODES = ['bike', 'bus', 'auto'];
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ageOn = (dob, today = new Date()) => {
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
};

// Validates whichever profile fields were sent (all optional, so the app can
// save basic details and the address in separate steps). Returns { data } or { error }.
const parseProfileInput = (body) => {
  const data = {};
  const text = (key, { min = 1, max = 200 } = {}) => {
    if (body[key] === undefined) return;
    const v = typeof body[key] === 'string' ? body[key].trim() : '';
    if (v.length < min || v.length > max) throw new Error(`Enter a valid ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
    data[key] = v;
  };
  const oneOf = (key, allowed) => {
    if (body[key] === undefined) return;
    if (!allowed.includes(body[key])) throw new Error(`${key} must be one of: ${allowed.join(', ')}`);
    data[key] = body[key];
  };
  const coord = (key, limit) => {
    if (body[key] === undefined) return;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || Math.abs(n) > limit) throw new Error(`Invalid ${key}`);
    data[key] = n;
  };

  try {
    text('ownerName', { min: 2, max: 100 });
    text('businessName', { max: 150 });
    oneOf('businessType', BUSINESS_TYPES);
    oneOf('gender', GENDERS);
    text('address', { min: 5, max: 500 });
    text('city', { max: 100 });
    text('state', { max: 100 });
    coord('latitude', 90);
    coord('longitude', 180);
    oneOf('transportMode', TRANSPORT_MODES);

    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!emailRegex.test(email)) throw new Error('Enter a valid email address');
      data.email = email;
    }
    if (body.pincode !== undefined) {
      const pincode = String(body.pincode).trim();
      if (!/^\d{6}$/.test(pincode)) throw new Error('Pincode must be 6 digits');
      data.pincode = pincode;
    }
    if (body.dob !== undefined) {
      const dob = new Date(body.dob);
      if (Number.isNaN(dob.getTime())) throw new Error('Enter a valid date of birth');
      const age = ageOn(dob);
      if (age < 18 || age > 55) throw new Error('Suppliers must be between 18 and 55 years old');
      data.dob = dob.toISOString().slice(0, 10);
    }
  } catch (err) {
    return { error: err.message };
  }
  return { data };
};

const getProfile = async (req, res) => {
  try {
    const profile = await prisma.supplierProfile.findUnique({ where: { userId: req.user.sub } });
    if (!profile) return res.status(404).json({ success: false, message: 'Supplier profile not found' });
    res.json({ success: true, supplier: publicProfile(profile), nextStep: nextStep(profile) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load profile' });
  }
};

// POST/PUT /supplier/profile — save basic details and/or address
const updateProfile = async (req, res) => {
  const userId = req.user.sub;
  const { data, error } = parseProfileInput(req.body);
  if (error) return res.status(400).json({ success: false, message: error });
  if (!Object.keys(data).length) return res.status(400).json({ success: false, message: 'Nothing to update' });

  try {
    const current = await prisma.supplierProfile.findUnique({ where: { userId }, include: { user: { select: { mobile: true } } } });
    if (!current) return res.status(404).json({ success: false, message: 'Supplier profile not found' });
    if (current.status === 'SUSPENDED') {
      return res.status(403).json({ success: false, message: 'Your account is suspended. Please contact Vizhaa support.' });
    }

    const merged = { ...current, ...data };
    // A draft becomes ready for KYC once every basic detail and the address are in
    const status = current.status === 'DRAFT' && isProfileComplete(merged) ? 'KYC_PENDING' : current.status;

    const [profile] = await prisma.$transaction([
      prisma.supplierProfile.update({
        where: { userId },
        data: { ...data, status, phone: current.user.mobile },
      }),
      // Mirror identity fields onto User, which the admin lists and other services read
      prisma.user.update({
        where: { id: userId },
        data: {
          ...(data.ownerName && { name: data.ownerName }),
          ...(data.email && { email: data.email }),
          ...(data.gender && { gender: data.gender }),
          ...(data.dob && { dob: data.dob }),
          ...(data.businessName && { businessName: data.businessName }),
          ...(data.businessType && { businessType: data.businessType }),
          ...(data.city && { city: data.city }),
          ...(data.address && { address: data.address }),
        },
      }),
    ]);

    res.json({ success: true, message: 'Profile saved', supplier: publicProfile(profile), nextStep: nextStep(profile) });
  } catch (err) {
    console.error('Supplier profile update error:', err);
    res.status(500).json({ success: false, message: 'Failed to save profile' });
  }
};

const submitKyc = async (req, res) => {
  const userId = req.user.sub;
  try {
    const current = await prisma.supplierProfile.findUnique({ where: { userId } });
    if (!current || !isProfileComplete(current)) {
      return res.status(400).json({ success: false, message: 'Complete your profile and address before submitting KYC' });
    }
    if (['UNDER_REVIEW', 'APPROVED', 'SUSPENDED'].includes(current.status)) {
      return res.status(409).json({ success: false, message: `KYC can't be submitted while your account is ${current.status.replace('_', ' ').toLowerCase()}` });
    }

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

    const profile = await prisma.supplierProfile.update({
      where: { userId },
      data: {
        aadhaarFrontUrl,
        aadhaarBackUrl,
        panCardUrl,
        selfieUrl,
        kycStatus: 'PENDING',
        kycSubmittedAt: new Date(),
        kycRejectionReason: null,
        status: 'UNDER_REVIEW',
        statusReason: null,
      },
    });

    res.json({
      success: true,
      message: 'KYC documents submitted, pending admin approval',
      kycStatus: profile.kycStatus,
      supplier: publicProfile(profile),
      nextStep: nextStep(profile),
    });
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
      select: {
        id: true, mobile: true, role: true, name: true, email: true, gender: true, dob: true,
        supplierProfile: { select: { status: true, kycStatus: true, walletBalance: true } },
      },
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

module.exports = { getProfile, updateProfile, submitKyc, getKycStatus, getMe, updateFcmToken };
