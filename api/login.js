'use strict';
const { createToken, safeEqual, sessionCookie } = require('./_lib/auth');

// Pembatas percobaan login sederhana (per instance function, cukup untuk dashboard internal)
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ message: 'Metode tidak diizinkan.' });

  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || !process.env.SESSION_SECRET) {
    return res.status(500).json({ message: 'Server belum dikonfigurasi (DASHBOARD_PASSWORD / SESSION_SECRET).' });
  }

  const ip = clientIp(req);
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && now - rec.first < WINDOW_MS && rec.count >= MAX_FAILS) {
    return res.status(429).json({ message: 'Terlalu banyak percobaan. Coba lagi dalam beberapa menit.' });
  }

  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!safeEqual(password, expected)) {
    const fresh = !rec || now - rec.first >= WINDOW_MS;
    attempts.set(ip, { first: fresh ? now : rec.first, count: fresh ? 1 : rec.count + 1 });
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ message: 'Password salah.' });
  }

  attempts.delete(ip);
  res.setHeader('Set-Cookie', sessionCookie(createToken()));
  return res.status(200).json({ ok: true });
};
