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

// ---- Foto / video di chat (VIP): gambar maks 5 MB, video MP4/MOV maks 15 MB ----
const CHAT_MIME = { ...TYPES, 'video/mp4': '.mp4', 'video/quicktime': '.mov' };
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (CHAT_MIME[file.mimetype]) cb(null, true);
    else cb(badRequest('Hanya foto (JPG, PNG, WEBP) atau video MP4', 'INVALID_FILE'));
  },
}).single('file');

function chatMedia(req, res, next) {
  chatUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('Ukuran file maksimal 15 MB (foto 5 MB)', 'FILE_TOO_LARGE'));
    next(err);
  });
}

// Periksa isi file (jangan percaya tipe dari klien saja), lalu simpan. Mengembalikan { url, kind }
async function saveChatMedia(req) {
  const file = req.file;
  if (!file) throw badRequest('File wajib diisi', 'FILE_REQUIRED');
  const b = file.buffer;
  const isVideo = file.mimetype.startsWith('video/');
  let ok;
  if (isVideo) ok = b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp';
  else if (file.mimetype === 'image/jpeg') ok = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  else if (file.mimetype === 'image/png') ok = b.length > 8 && b.subarray(1, 4).toString('latin1') === 'PNG';
  else ok = b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!ok) throw badRequest('File rusak atau bukan foto/video yang valid', 'INVALID_FILE');
  if (!isVideo && b.length > 5 * 1024 * 1024) throw badRequest('Ukuran foto maksimal 5 MB', 'FILE_TOO_LARGE');
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${CHAT_MIME[file.mimetype]}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), b);
  return { name, url: `${publicBase(req)}/uploads/${name}`, kind: isVideo ? 'video' : 'image' };
}

// ---- Suara gift (MP3 / M4A / AAC / OGG / WAV, maks 2 MB) ----
const AUDIO = { 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav' };
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (AUDIO[file.mimetype]) cb(null, true);
    else cb(badRequest('Hanya audio MP3, M4A, AAC, OGG, atau WAV', 'INVALID_FILE'));
  },
}).single('file');

function singleAudio(req, res, next) {
  audioUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('Ukuran suara maksimal 2 MB', 'FILE_TOO_LARGE'));
    next(err);
  });
}

async function saveAudio(req) {
  const file = req.file;
  if (!file) throw badRequest('File suara wajib diisi', 'FILE_REQUIRED');
  const b = file.buffer;
  const head4 = b.subarray(0, 4).toString('latin1');
  const ok =
    b.length > 12 &&
    (head4.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || // MP3 / AAC (ADTS)
      b.subarray(4, 8).toString('latin1') === 'ftyp' || // M4A
      head4 === 'OggS' ||
      head4 === 'RIFF');
  if (!ok) throw badRequest('File bukan audio yang valid', 'INVALID_FILE');
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${AUDIO[file.mimetype]}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), b);
  return { name, url: `${publicBase(req)}/uploads/${name}` };
}

// ---- Media PRIVAT host (foto 8 MB, video 80 MB): disimpan di luar /uploads, hanya bisa dibuka lewat API terproteksi ----
const PRIVATE_DIR = path.resolve(process.env.PRIVATE_DIR || path.join(UPLOAD_DIR, '..', 'private-media'));
fs.mkdirSync(PRIVATE_DIR, { recursive: true });
const PRIVATE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov' };
const privateUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PRIVATE_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${PRIVATE_EXT[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 80 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (PRIVATE_EXT[file.mimetype]) cb(null, true);
    else cb(badRequest('Hanya foto (JPG, PNG, WEBP) atau video MP4', 'INVALID_FILE'));
  },
}).single('file');

function privateMedia(req, res, next) {
  privateUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('Ukuran file maksimal 80 MB (foto 8 MB)', 'FILE_TOO_LARGE'));
    next(err);
  });
}

// Durasi MP4/MOV dalam detik dari kotak "mvhd" (null jika tidak terbaca)
async function mp4Seconds(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    let pos = 0;
    const head = Buffer.alloc(16);
    while (pos + 8 <= size) {
      await fh.read(head, 0, 16, pos);
      let boxSize = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      let headerLen = 8;
      if (boxSize === 1) { boxSize = Number(head.readBigUInt64BE(8)); headerLen = 16; }
      else if (boxSize === 0) boxSize = size - pos;
      if (boxSize < headerLen) return null;
      if (type === 'moov') {
        const len = Math.min(boxSize - headerLen, 8 * 1024 * 1024);
        const moov = Buffer.alloc(len);
        await fh.read(moov, 0, len, pos + headerLen);
        const i = moov.indexOf('mvhd', 0, 'latin1');
        if (i < 0) return null;
        const v = moov[i + 4];
        const timescale = v === 1 ? moov.readUInt32BE(i + 4 + 4 + 16) : moov.readUInt32BE(i + 4 + 4 + 8);
        const dur = v === 1 ? Number(moov.readBigUInt64BE(i + 4 + 4 + 20)) : moov.readUInt32BE(i + 4 + 4 + 12);
        return timescale > 0 && dur > 0 ? dur / timescale : null;
      }
      pos += boxSize;
    }
    return null;
  } finally {
    await fh.close();
  }
}

// Periksa isi file yang sudah disimpan; hapus file jika tidak valid. Mengembalikan { kind, seconds }
async function checkPrivateMedia(file, { maxVideoSeconds }) {
  const remove = () => fs.promises.unlink(file.path).catch(() => {});
  try {
    const head = Buffer.alloc(16);
    const fh = await fs.promises.open(file.path, 'r');
    const { size } = await fh.stat();
    await fh.read(head, 0, 16, 0);
    await fh.close();
    const isVideo = file.mimetype.startsWith('video/');
    let ok;
    if (isVideo) ok = size > 12 && head.toString('latin1', 4, 8) === 'ftyp';
    else if (file.mimetype === 'image/jpeg') ok = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    else if (file.mimetype === 'image/png') ok = head.toString('latin1', 1, 4) === 'PNG';
    else ok = head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
    if (!ok) throw badRequest('File rusak atau bukan foto/video yang valid', 'INVALID_FILE');
    if (!isVideo && size > 8 * 1024 * 1024) throw badRequest('Ukuran foto maksimal 8 MB', 'FILE_TOO_LARGE');
    let seconds = null;
    if (isVideo) {
      seconds = await mp4Seconds(file.path);
      if (seconds === null) throw badRequest('Durasi video tidak terbaca. Gunakan video MP4 biasa.', 'INVALID_FILE');
      if (seconds > maxVideoSeconds) {
        throw badRequest(`Video terlalu panjang (${Math.ceil(seconds / 60)} menit). Maksimal ${Math.floor(maxVideoSeconds / 60)} menit.`, 'VIDEO_TOO_LONG');
      }
    }
    return { kind: isVideo ? 'video' : 'image', seconds };
  } catch (e) {
    await remove();
    throw e;
  }
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

module.exports = { PRIVATE_DIR, privateMedia, checkPrivateMedia, singleAudio, saveAudio, UPLOAD_DIR, chatMedia, saveChatMedia, single, many, save, saveFile, remove, singleVideo, saveVideo };
