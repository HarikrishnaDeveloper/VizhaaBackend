const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const twilio = require('../services/twilio');
const tokens = require('../services/tokens');
const { nextStep, publicProfile } = require('../services/supplierOnboarding');

const phoneRegex = /^[6-9]\d{9}$/;

const sendOtp = async (req, res) => {
  const mobile = req.body.mobile?.trim();
  if (!mobile || !phoneRegex.test(mobile)) {
    return res.status(400).json({ success: false, message: 'Enter valid mobile number' });
  }
  
  try {
    await twilio.sendOtp(mobile);
    return res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to send OTP', error: err.message });
  }
};

// Which account type each app signs people up as. Apps that send nothing
// (the organizer app) keep the default ORGANIZER behaviour.
const APP_ROLES = { supplier: 'SUPPLIER' };
const ROLE_LABELS = { ORGANIZER: 'an organizer', SUPPLIER: 'a supplier', ADMIN: 'an admin' };

const verifyOtp = async (req, res) => {
  const { mobile, otp, app } = req.body;
  const appRole = APP_ROLES[app];

  if (!mobile || !phoneRegex.test(mobile)) {
    return res.status(400).json({ success: false, message: 'Invalid mobile number' });
  }

  if (!otp) {
    return res.status(400).json({ success: false, message: 'OTP is required' });
  }

  try {
    const isVerified = await twilio.verifyOtp(mobile, otp);
    
    if (!isVerified.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
        status: isVerified.status,
      });
    }

    const existingUser = await prisma.user.findUnique({ where: { mobile } });

    // One mobile number is one account; the supplier app can't sign in to an organizer/admin account
    if (appRole && existingUser && existingUser.role !== appRole) {
      return res.status(403).json({
        success: false,
        code: 'ROLE_MISMATCH',
        message: `This number is already registered as ${ROLE_LABELS[existingUser.role] || 'another'} account. Please use a different mobile number.`,
      });
    }

    const user = existingUser || await prisma.user.create({
      data: {
        mobile,
        ...(appRole && { role: appRole }),
        ...(appRole === 'SUPPLIER' && { supplierProfile: { create: { phone: mobile } } }),
      },
    });

    const accessToken = tokens.generateAccessToken(user.id);
    const refreshToken = await tokens.generateRefreshToken(user.id);

    const supplierProfile = user.role === 'SUPPLIER'
      ? await prisma.supplierProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, phone: mobile } })
      : null;

    return res.json({
      success: true,
      message: "OTP Verified",
      isNewUser: !existingUser,
      accessToken,
      refreshToken,
      user: { id: user.id, mobile: user.mobile, role: user.role },
      ...(supplierProfile && { supplier: publicProfile(supplierProfile), nextStep: nextStep(supplierProfile) }),
    });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    return res.status(500).json({
      success: false,
      message: 'OTP verification failed',
      error: error.message,
    });
  }
};

const resendOtp = async (req, res) => {
  const mobile = req.body.mobile?.trim();
  if (!mobile || !phoneRegex.test(mobile)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid mobile number',
    });
  }
  try {
    await twilio.sendOtp(mobile);
    res.json({ success: true, message: 'OTP resent successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to resend OTP', error: err.message });
  }
};

const refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken)
    return res.status(400).json({ message: 'Refresh token required' });
  try {
    const result = await tokens.rotateRefreshToken(refreshToken);
    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: { id: result.user.id, mobile: result.user.mobile, role: result.user.role },
    });
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
};

// Current account; for suppliers also the profile and the onboarding screen to show next
const me = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { supplierProfile: true },
    });
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });

    const body = {
      success: true,
      user: { id: user.id, mobile: user.mobile, role: user.role, name: user.name, email: user.email },
    };
    if (user.role === 'SUPPLIER') {
      body.supplier = publicProfile(user.supplierProfile);
      body.nextStep = nextStep(user.supplierProfile);
    }
    res.json(body);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load account' });
  }
};

// Email/password login for the super-admin dashboard (ADMIN accounts only)
const adminLogin = async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const { password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findFirst({ where: { email, role: 'ADMIN' } });
    const valid = user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const accessToken = tokens.generateAccessToken(user.id);
    const refreshToken = await tokens.generateRefreshToken(user.id);

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('Admin Login Error:', error);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
};

const logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) await tokens.revokeRefreshToken(refreshToken).catch(() => {});
  res.json({ success: true });
};

module.exports = { sendOtp, verifyOtp, resendOtp, refresh, logout, adminLogin, me };
