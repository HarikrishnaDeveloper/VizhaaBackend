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
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
  },
  firebase: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
      : path.join(__dirname, '../../firebase-service-account.json'),
  },
  upload: {
    dir: path.join(__dirname, '../../uploads'),
    kycDir: path.join(__dirname, '../../uploads/kyc'),
  },
};
