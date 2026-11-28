const express = require('express');
const http = require('http');
const config = require('../config');
const v = require('../lib/validate');
const live = require('../services/live');
const { wrap, forbidden } = require('../lib/errors');

/** Daftar & tonton live, obrolan live, dan kendali siaran host. Dipasang di /api/live (wajib login). */
const router = express.Router();

router.get('/', wrap(async (req, res) => {
  res.json(await live.listLive(req.user.id));
}));

// Host: siaran saya yang masih aktif (menunggu / live)
router.get('/mine', wrap(async (req, res) => {
  if (req.user.role !== 'host') throw forbidden('Hanya host');
  res.json({ current: await live.hostCurrent(req.user.id) });
}));

router.post('/start', wrap(async (req, res) => {
  if (req.user.role !== 'host') throw forbidden('Hanya host yang bisa live');
  res.status(201).json(await live.start(req.user.id, req.body && req.body.title));
}));

router.post('/:id/end', wrap(async (req, res) => {
  res.json(await live.endByHost(req.user.id, v.id(req.params.id)));
}));

router.get('/:id', wrap(async (req, res) => {
  res.json(await live.detail(v.id(req.params.id), req.user.id));
}));

router.post('/:id/chat', wrap(async (req, res) => {
  const message = await live.sendChat(req.user.id, v.id(req.params.id), req.body && req.body.body);
  res.status(201).json({ message });
}));

/**
 * Dipanggil MediaMTX (authMethod http) untuk setiap publish/read. Hanya dari localhost
 * (atau IP di LIVE_AUTH_ALLOW) dan tidak boleh lewat proxy publik.
 */
const mediaAuth = express.Router();
mediaAuth.post('/auth', wrap(async (req, res) => {
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const local = ip === '127.0.0.1' || ip === '::1' || config.liveAuthAllow.includes(ip);
  if (!local || req.headers['x-forwarded-for']) return res.status(403).json({ error: 'forbidden' });
  const ok = await live.authorize(req.body || {});
  res.status(ok ? 200 : 401).json({ ok });
}));

/**
 * Meneruskan HLS dari MediaMTX lewat alamat API yang sama, supaya penonton tidak butuh port tambahan
 * (satu terowongan/domain cukup). Hanya path siaran: /live-hls/live/<16 hex>/<file>.
 */
const hls = express.Router();
hls.get('/live/:pid/:file', (req, res) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.pid) || !/^[\w.\-]+$/.test(req.params.file)) return res.status(404).end();
  const up = new URL(config.liveHlsUpstream);
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upReq = http.request(
    { hostname: up.hostname, port: up.port || 80, path: `/live/${req.params.pid}/${req.params.file}${qs}`, method: 'GET', headers: { accept: req.headers.accept || '*/*' } },
    (upRes) => {
      res.status(upRes.statusCode || 502);
      for (const h of ['content-type', 'cache-control', 'content-length']) if (upRes.headers[h]) res.setHeader(h, upRes.headers[h]);
      upRes.pipe(res);
    }
  );
  upReq.on('error', () => (res.headersSent ? res.end() : res.status(502).json({ error: 'media server tidak tersedia' })));
  req.on('close', () => upReq.destroy());
  upReq.end();
});

module.exports = router;
module.exports.mediaAuth = mediaAuth;
module.exports.hls = hls;
