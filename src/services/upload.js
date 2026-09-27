const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Ensure upload directories exist
if (!fs.existsSync(config.upload.kycDir)) {
  fs.mkdirSync(config.upload.kycDir, { recursive: true });
}

const kycStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(config.upload.kycDir, req.user.sub);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}_${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|pdf/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.test(ext)) cb(null, true);
  else cb(new Error('Only images (jpg, png) and PDFs are allowed'));
};

const uploadKyc = multer({
  storage: kycStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per file
}).fields([
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
]);

const fileUrl = (req, filePath) => {
  const config = require('../config');
  const relative = path.relative(path.join(__dirname, '../../'), filePath).replace(/\\/g, '/');
  return `${config.backendUrl}/${relative}`;
};

module.exports = { uploadKyc, fileUrl };
