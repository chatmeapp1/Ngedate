const express = require('express');
const cors = require('cors');
const { ApiError } = require('./lib/errors');
const { authenticate, requireRole } = require('./middleware/auth');
const storage = require('./lib/storage');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/uploads', express.static(storage.UPLOAD_DIR, { maxAge: '30d', immutable: true }));
  // Panel admin web (halaman statis; semua data lewat /api/admin dengan login admin)
  app.use(
    '/admin',
    express.static(require('path').join(__dirname, '..', 'public', 'admin'), {
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
    })
  );

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/me', authenticate, require('./routes/me'));
  app.use('/api/onboarding', authenticate, require('./routes/onboarding'));
  app.use('/api/hosts', authenticate, require('./routes/hosts'));
  app.use('/api/members', authenticate, requireRole('host'), require('./routes/members'));
  app.use('/api/users', authenticate, require('./routes/social'));
  app.use('/api/host/settings', authenticate, requireRole('host'), require('./routes/hostSettings'));
  app.use('/api/wallet', authenticate, require('./routes/wallet'));
  app.use('/api/gifts', authenticate, require('./routes/gifts'));
  app.use('/api/conversations', authenticate, require('./routes/conversations'));
  app.use('/api/admin', authenticate, requireRole('admin'), require('./routes/admin'));

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' } }));

  // Format error seragam: { error: { code, message } }
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra || {}) } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Format JSON tidak valid' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Terjadi kesalahan di server' } });
  });

  return app;
}

module.exports = { createApp };
