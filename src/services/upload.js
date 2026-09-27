const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

// ─── Profile photos ───────────────────────────────────────────
const PHOTO_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

fs.mkdirSync(config.upload.profilePhotoDir, { recursive: true });

const profilePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(config.upload.profilePhotoDir, req.user.sub);
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  // Random, unguessable name; extension from the checked MIME type
  filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}${PHOTO_TYPES[file.mimetype]}`),
});

const uploadProfilePhotoMiddleware = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (PHOTO_TYPES[file.mimetype]) cb(null, true);
    else cb(Object.assign(new Error('Only JPG, PNG or WebP photos are allowed'), { status: 400 }));
  },
}).single('photo');

// Wraps multer so size/type problems come back as clean 400s
const uploadProfilePhoto = (req, res, next) =>
  uploadProfilePhotoMiddleware(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be 5 MB or smaller' : err.message || 'Upload failed';
    res.status(400).json({ success: false, message });
  });

// Checks the file's leading bytes: JPEG, PNG or WebP
const isRealImage = async (filePath) => {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const { buffer } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
    return jpeg || png || webp;
  } finally {
    await handle.close();
  }
};

const fileUrl = (req, filePath) => {
  const config = require('../config');
  const relative = path.relative(path.join(__dirname, '../../'), filePath).replace(/\\/g, '/');
  return `${config.backendUrl}/${relative}`;
};

module.exports = { uploadKyc, fileUrl, uploadProfilePhoto, isRealImage };
