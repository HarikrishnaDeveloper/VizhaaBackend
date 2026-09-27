const fs = require('fs');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const config = require('../config');

// Firebase is optional: without the service account file the server still
// runs, and push notifications are skipped (in-app notifications still save).
let app = null;
if (getApps().length) {
  app = getApps()[0];
} else if (fs.existsSync(config.firebase.serviceAccountPath)) {
  app = initializeApp({
    credential: cert(require(config.firebase.serviceAccountPath)),
  });
} else {
  console.warn(
    `Firebase service account not found at ${config.firebase.serviceAccountPath} - push notifications disabled`
  );
}

module.exports = {
  enabled: !!app,
  messaging: () => getMessaging(app),
};
