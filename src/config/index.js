const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT, 10) || 5000,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: '15m',
  refreshTokenExpiryDays: 30,
  backendUrl: process.env.BACKEND_URL || 'http://localhost:5000',
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
  },
  mail: {
    host: process.env.BREVO_SMTP_HOST,
    port: parseInt(process.env.BREVO_SMTP_PORT, 10) || 587,
    user: process.env.BREVO_SMTP_USER,
    password: process.env.BREVO_SMTP_PASSWORD,
    // Must be a sender verified in the Brevo account
    from: process.env.EMAIL_FROM,
  },
  geoapify: {
    // Server-side only: place search, geocoding and reverse geocoding
    apiKey: process.env.GEOAPIFY_API_KEY,
  },
  payments: {
    // Lets the app's "[DEV] Simulate Success" create events without Razorpay.
    // Never honoured in production.
    allowTestPayments: process.env.ALLOW_TEST_PAYMENTS === 'true' && process.env.NODE_ENV !== 'production',
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    // Razorpay Dashboard → Webhooks; verifies POST /api/payments/webhook
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
  firebase: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
      : path.join(__dirname, '../../firebase-service-account.json'),
  },
  upload: {
    dir: path.join(__dirname, '../../uploads'),
    kycDir: path.join(__dirname, '../../uploads/kyc'),
    // Profile photos live in <PROFILE_UPLOAD_DIR>/profile-photos/<userId>/
    profilePhotoDir: path.join(
      process.env.PROFILE_UPLOAD_DIR
        ? path.resolve(process.env.PROFILE_UPLOAD_DIR)
        : path.join(__dirname, '../../uploads'),
      'profile-photos',
    ),
    profilePhotoRoute: '/media/profile-photos',
  },
};
