const prisma = require('../lib/prisma');
const twilio = require('../services/twilio');
const tokens = require('../services/tokens');

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

const verifyOtp = async (req, res) => {
  const { mobile, otp } = req.body;

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

    const user = await prisma.user.upsert({
      where: { mobile },
      update: {},
      create: { mobile },
    });

    const accessToken = tokens.generateAccessToken(user.id);
    const refreshToken = await tokens.generateRefreshToken(user.id);

    return res.json({
      success: true,
      message: "OTP Verified",
      isNewUser: !existingUser,
      accessToken,
      refreshToken,
      user: { id: user.id, mobile: user.mobile, role: user.role },
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
      user: { id: result.user.id, mobile: result.user.mobile },
    });
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
};

const logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) await tokens.revokeRefreshToken(refreshToken).catch(() => {});
  res.json({ success: true });
};

module.exports = { sendOtp, verifyOtp, resendOtp, refresh, logout };
