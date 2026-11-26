const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { badRequest } = require('./errors');

/**
 * Penyimpanan foto di disk server (folder UPLOAD_DIR, default ./uploads),
 * disajikan di /uploads/<nama-file>.
 *
 * Catatan: di hosting yang disk-nya tidak permanen (mis. Railway tanpa volume,
 * Render free), file bisa hilang saat redeploy. Untuk produksi, ganti fungsi
 * save() dengan upload ke S3 / Cloudinary / Cloudflare R2.
 */
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const fileFilter = (req, file, cb) => {
  if (TYPES[file.mimetype]) cb(null, true);
  else cb(badRequest('Hanya gambar JPG, PNG, atau WEBP', 'INVALID_FILE'));
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter,
}).single('file');

// Middleware: terima satu file di field "file"
function single(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('Ukuran gambar maksimal 5 MB', 'FILE_TOO_LARGE'));
    next(err);
  });
}

// Middleware: terima beberapa file di field "photos" (mis. foto verifikasi wajah)
function many(max) {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: max },
    fileFilter,
  }).array('photos', max);
  return (req, res, next) =>
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('Ukuran gambar maksimal 5 MB', 'FILE_TOO_LARGE'));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(badRequest(`Maksimal ${max} foto`, 'TOO_MANY_FILES'));
      }
      next(err);
    });
}

function publicBase(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

async function saveFile(req, file) {
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${TYPES[file.mimetype]}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), file.buffer);
  return { name, url: `${publicBase(req)}/uploads/${name}` };
}

// ---- Video efek gift (MP4, maks 15 MB) ----
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4') cb(null, true);
    else cb(badRequest('Hanya video MP4', 'INVALID_FILE'));
  },
}).single('file');

function singleVideo(req, res, next) {
  videoUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('Ukuran video maksimal 15 MB', 'FILE_TOO_LARGE'));
    next(err);
  });
}

async function saveVideo(req) {
  const file = req.file;
  if (!file) throw badRequest('File video wajib diisi', 'FILE_REQUIRED');
  // Tanda tangan MP4: kotak "ftyp" di byte 4-8 (jangan percaya tipe dari klien saja)
  if (file.buffer.length < 12 || file.buffer.subarray(4, 8).toString('latin1') !== 'ftyp') {
    throw badRequest('File bukan video MP4 yang valid', 'INVALID_FILE');
  }
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.mp4`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), file.buffer);
  return { name, url: `${publicBase(req)}/uploads/${name}` };
}

async function save(req) {
  if (!req.file) throw badRequest('File gambar wajib diisi', 'FILE_REQUIRED');
  return saveFile(req, req.file);
}

async function remove(url) {
  const name = String(url || '').split('/uploads/')[1];
  if (!name || name.includes('/') || name.includes('..')) return;
  await fs.promises.unlink(path.join(UPLOAD_DIR, name)).catch(() => {});
}

module.exports = { UPLOAD_DIR, single, many, save, saveFile, remove, singleVideo, saveVideo };
