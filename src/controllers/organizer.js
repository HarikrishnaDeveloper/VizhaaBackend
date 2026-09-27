const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const config = require('../config');
const { isRealImage } = require('../services/upload');
const { isMailConfigured, sendEmailVerificationCode } = require('../services/mailer');

// Email verification rules
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normaliseEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

// Only a keyed hash of the code is stored, bound to the user and address
const hashCode = (userId, email, code) =>
  crypto.createHmac('sha256', config.jwtSecret).update(`${userId}:${normaliseEmail(email)}:${code}`).digest('hex');

// Public URL of a stored profile photo. Built from the request's host so the
// phone gets an address it can actually reach (e.g. the LAN IP it called).
const photoUrl = (req, stored) =>
  stored ? `${req.protocol}://${req.get('host')}${config.upload.profilePhotoRoute}/${stored}` : null;

const toProfile = (req, user) => ({
  id: user.id,
  mobile: user.mobile,
  name: user.name,
  email: user.email,
  role: user.role,
  gender: user.gender,
  dob: user.dob,
  city: user.city,
  businessName: user.businessName,
  companyName: user.companyName,
  businessType: user.businessType,
  profilePhotoUrl: photoUrl(req, user.profilePhoto),
  emailVerified: Boolean(user.email && user.emailVerified),
});

// Deletes a stored photo, refusing anything that resolves outside the photo folder
const removeStoredPhoto = (stored) => {
  if (!stored) return;
  const file = path.resolve(config.upload.profilePhotoDir, stored);
  if (!file.startsWith(config.upload.profilePhotoDir + path.sep)) return;
  fs.promises.unlink(file).catch(() => {});
};

const updateProfile = async (req, res) => {
  const userId = req.user.sub;
  // `role` is the account type (ADMIN | SUPPLIER | ORGANIZER) and is never
  // taken from the client; any value sent is ignored
  const { name, email, dob, gender, companyName, businessType, businessName, city, address, gst } = req.body;

  // User.dob is a text column: store the date as an ISO string (the app sends
  // an ISO timestamp; keeping the time preserves the user's local day)
  let dobValue;
  if (dob) {
    const parsed = new Date(dob);
    if (Number.isNaN(parsed.getTime()) || parsed > new Date()) {
      return res.status(400).json({ success: false, message: 'Enter a valid date of birth' });
    }
    dobValue = parsed.toISOString();
  }

  try {
    // A different email address must be verified again
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const emailChanged = email !== undefined && normaliseEmail(email) !== normaliseEmail(current?.email);
    if (emailChanged) await prisma.emailVerification.deleteMany({ where: { userId } });

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(emailChanged ? { emailVerified: false, emailVerifiedAt: null } : {}),
        name,
        email,
        gender,
        dob: dobValue,
        companyName,
        businessType,
        businessName,
        city,
        address,
        gst,
      },
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: toProfile(req, user),
    });
  } catch (err) {
    console.error('Profile Update Error:', err);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};

// GET /api/organizer/profile
const getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user: toProfile(req, user) });
  } catch (err) {
    console.error('[profile] get failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load profile' });
  }
};

// POST /api/organizer/profile/photo  (multipart field "photo")
const uploadPhoto = async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, message: 'Choose a photo to upload' });

  // Don't trust the declared type: the bytes must really be an image
  if (!(await isRealImage(file.path))) {
    fs.promises.unlink(file.path).catch(() => {});
    return res.status(400).json({ success: false, message: 'That file is not a valid JPG, PNG or WebP image' });
  }

  const stored = `${req.user.sub}/${file.filename}`;
  try {
    const previous = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { profilePhoto: true } });
    const user = await prisma.user.update({ where: { id: req.user.sub }, data: { profilePhoto: stored } });
    if (previous?.profilePhoto && previous.profilePhoto !== stored) removeStoredPhoto(previous.profilePhoto);
    res.json({ success: true, message: 'Profile photo updated', user: toProfile(req, user) });
  } catch (err) {
    fs.promises.unlink(file.path).catch(() => {});
    console.error('[profile] photo upload failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save profile photo' });
  }
};

// DELETE /api/organizer/profile/photo
const deletePhoto = async (req, res) => {
  try {
    const previous = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { profilePhoto: true } });
    const user = await prisma.user.update({ where: { id: req.user.sub }, data: { profilePhoto: null } });
    removeStoredPhoto(previous?.profilePhoto);
    res.json({ success: true, message: 'Profile photo removed', user: toProfile(req, user) });
  } catch (err) {
    console.error('[profile] photo delete failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to remove profile photo' });
  }
};

// POST /api/organizer/profile/email/send-code — emails a code to the saved address
const sendEmailCode = async (req, res) => {
  const userId = req.user.sub;
  if (!isMailConfigured()) {
    return res.status(503).json({ success: false, code: 'EMAIL_NOT_CONFIGURED', message: 'Email verification is not available right now' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.email || !EMAIL_RE.test(user.email.trim())) {
      return res.status(400).json({ success: false, message: 'Add a valid email address to your profile first' });
    }
    if (user.emailVerified) {
      return res.status(409).json({ success: false, code: 'ALREADY_VERIFIED', message: 'Your email is already verified', user: toProfile(req, user) });
    }

    const now = Date.now();
    const pending = await prisma.emailVerification.findUnique({ where: { userId } });
    if (pending) {
      const wait = RESEND_COOLDOWN_SECONDS - Math.floor((now - pending.lastSentAt.getTime()) / 1000);
      if (wait > 0) {
        return res.status(429).json({ success: false, code: 'RESEND_COOLDOWN', retryAfter: wait, message: `Please wait ${wait}s before requesting another code` });
      }
      const inWindow = now - pending.windowStart.getTime() < 60 * 60 * 1000;
      if (inWindow && pending.sendCount >= MAX_SENDS_PER_HOUR) {
        return res.status(429).json({ success: false, code: 'TOO_MANY_CODES', message: 'Too many codes requested. Please try again later.' });
      }
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const inWindow = pending && now - pending.windowStart.getTime() < 60 * 60 * 1000;
    const data = {
      email: user.email.trim(),
      codeHash: hashCode(userId, user.email, code),
      expiresAt: new Date(now + CODE_TTL_MINUTES * 60 * 1000),
      attempts: 0,
      lastSentAt: new Date(now),
      sendCount: inWindow ? pending.sendCount + 1 : 1,
      windowStart: inWindow ? pending.windowStart : new Date(now),
    };
    await prisma.emailVerification.upsert({ where: { userId }, create: { userId, ...data }, update: data });

    try {
      const info = await sendEmailVerificationCode({ to: data.email, name: user.name, code, minutes: CODE_TTL_MINUTES });
      // Accepted by Brevo ≠ delivered: search this id in Brevo → Transactional → Logs
      console.log(`[email] accepted by Brevo for user ${userId}: ${info?.messageId || ''} ${info?.response || ''}`);
    } catch (err) {
      // Don't leave a code the user never received, or block an immediate retry
      await prisma.emailVerification.update({
        where: { userId },
        data: { expiresAt: new Date(0), lastSentAt: new Date(0), sendCount: Math.max(0, data.sendCount - 1) },
      }).catch(() => {});
      console.error('[email] send failed:', err.code || '', err.responseCode || '', err.message);
      return res.status(502).json({ success: false, code: 'EMAIL_SEND_FAILED', message: 'We couldn’t send the email. Please try again.' });
    }

    res.json({ success: true, message: `Code sent to ${data.email}`, expiresInMinutes: CODE_TTL_MINUTES, resendAfter: RESEND_COOLDOWN_SECONDS });
  } catch (err) {
    console.error('[email] send-code failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to send verification code' });
  }
};

// POST /api/organizer/profile/email/verify { code }
const verifyEmailCode = async (req, res) => {
  const userId = req.user.sub;
  const code = String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: 'Enter the 6-digit code' });

  try {
    const [user, pending] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.emailVerification.findUnique({ where: { userId } }),
    ]);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!pending || pending.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ success: false, code: 'CODE_EXPIRED', message: 'This code has expired. Request a new one.' });
    }
    if (normaliseEmail(pending.email) !== normaliseEmail(user.email)) {
      return res.status(400).json({ success: false, code: 'EMAIL_CHANGED', message: 'Your email changed. Request a new code.' });
    }
    if (pending.attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, code: 'TOO_MANY_ATTEMPTS', message: 'Too many wrong attempts. Request a new code.' });
    }

    const expected = Buffer.from(pending.codeHash, 'hex');
    const actual = Buffer.from(hashCode(userId, user.email, code), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      const updated = await prisma.emailVerification.update({ where: { userId }, data: { attempts: { increment: 1 } } });
      const left = MAX_ATTEMPTS - updated.attempts;
      return res.status(400).json({
        success: false,
        code: 'INVALID_CODE',
        message: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong attempts. Request a new code.',
      });
    }

    const [verified] = await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { emailVerified: true, emailVerifiedAt: new Date() } }),
      prisma.emailVerification.delete({ where: { userId } }),
    ]);
    res.json({ success: true, message: 'Email verified', user: toProfile(req, verified) });
  } catch (err) {
    console.error('[email] verify failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to verify code' });
  }
};

module.exports = { updateProfile, getProfile, uploadPhoto, deletePhoto, sendEmailCode, verifyEmailCode };
