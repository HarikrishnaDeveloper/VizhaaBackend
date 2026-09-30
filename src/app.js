const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');

const authRoutes = require('./routes/auth');
const organizerRoutes = require('./routes/organizer');
const eventRoutes = require('./routes/event');
const paymentRoutes = require('./routes/payment');
const { handleWebhook } = require('./controllers/payment');
const supplierRoutes = require('./routes/supplier');
const eventPostRoutes = require('./routes/eventPost');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const placesRoutes = require('./routes/places');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());

// Razorpay webhook: the signature is computed over the exact raw bytes,
// so this must be registered before express.json() parses the body
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json());

// Serve uploaded KYC files as static assets
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Profile photos (stored under PROFILE_UPLOAD_DIR; unguessable file names)
app.use(config.upload.profilePhotoRoute, express.static(config.upload.profilePhotoDir, {
  index: false,
  dotfiles: 'deny',
  maxAge: '7d',
}));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'vizhaa-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/organizer', organizerRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/supplier', supplierRoutes);
app.use('/api/posts', eventPostRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/places', placesRoutes);

module.exports = app;
