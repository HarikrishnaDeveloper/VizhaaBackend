const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const config = require('../config');

let app;
if (!getApps().length) {
  const serviceAccount = require(config.firebase.serviceAccountPath);
  app = initializeApp({
    credential: cert(serviceAccount),
  });
} else {
  app = getApps()[0];
}

module.exports = {
  messaging: () => getMessaging(app),
};
