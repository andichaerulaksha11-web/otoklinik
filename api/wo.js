'use strict';
const { isAuthed } = require('./_lib/auth');

const GATEWAY_URL = process.env.GATEWAY_URL || 'https://gatewayototrek.bosowatransportation.id/api/proxy.php';
const PAGE_LIMIT = Math.max(10, Number(process.env.PAGE_LIMIT) || 100); // 100 sudah terbukti diterima gateway
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 6);
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_MINUTES) || 10) * 60 * 1000;
const MASK_PHONE = String(process.env.MASK_PHONE || '').toLowerCase() === 'true';

let cache = null;     // { ts, payload }
let inflight = null;  // promise yang sedang berjalan, supaya request bersamaan tidak menembak gateway berulang

async function fetchPage(page) {
  const url = new URL(GATEWAY_URL);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(PAGE_LIMIT));

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(url, {
        headers: { 'X-Gateway-Key': process.env.GATEWAY_KEY, Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error('Gateway membalas HTTP ' + r.status);
      const json = await r.json();
      if (json.error || !json.result) throw new Error(json.message || 'Respons gateway tidak valid');
      return json.result;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await worker(items[k]);
      }
    })
  );
  return out;
}

// Hanya field yang dipakai dashboard. Bagian "links" dari gateway (berisi URL + token LATTO) sengaja dibuang.
function slim(r) {
  const phone = r.no_telp == null ? '' : String(r.no_telp);
  return {
    kategori_wo: r.kategori_wo ?? '',
    tanggal_masuk: r.tanggal_masuk ?? null,
    tanggal_selesai: r.tanggal_selesai ?? null,
    tanggal_estimasi: r.tanggal_estimasi ?? null,
    tanggal_keluar: r.tanggal_keluar ?? null,
    harga: r.harga ?? 0,
    no_telp: MASK_PHONE && phone.length > 6 ? phone.slice(0, 4) + '****' + phone.slice(-3) : phone,
    no_pol: r.no_pol ?? '',
    merk_kendaraan: r.merk_kendaraan ?? '',
    tipe_kendaraan: r.tipe_kendaraan ?? '',
    model_kendaraan: r.model_kendaraan ?? '',
    keluhan: r.keluhan ?? '',
    mekanik: Array.isArray(r.mekanik) ? r.mekanik.map((m) => m && m.nama_mekanik).filter(Boolean) : [],
  };
}

async function build() {
  const first = await fetchPage(1);
  const totalPages = Math.max(1, Number(first.meta && first.meta.totalPages) || 1);
  const expected = Number(first.meta && first.meta.totalItems) || null;

  const rest = [];
  for (let p = 2; p <= totalPages; p++) rest.push(p);
  const results = await pool(rest, CONCURRENCY, fetchPage);

  const rows = [first, ...results].flatMap((r) => r.data || []).map(slim);
  const payload = {
    updatedAt: new Date().toISOString(),
    meta: { expected, received: rows.length, pages: totalPages },
    warning: expected != null && expected !== rows.length
      ? `Jumlah data tidak sama dengan total di gateway (${rows.length} dari ${expected}).`
      : null,
    data: rows,
  };
  return { ts: Date.now(), payload };
}

async function getData(force) {
  const fresh = cache && Date.now() - cache.ts < CACHE_TTL_MS;
  const forceAllowed = force && (!cache || Date.now() - cache.ts > 30000); // tombol refresh dibatasi 1x / 30 detik
  if (fresh && !forceAllowed) return cache;
  if (inflight) return inflight;

  inflight = build()
    .then((c) => { cache = c; return c; })
    .catch((e) => {
      if (cache) return { ...cache, stale: true }; // gateway gagal -> pakai data terakhir yang berhasil
      throw e;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (req.method !== 'GET') return res.status(405).json({ message: 'Metode tidak diizinkan.' });

  try {
    if (!isAuthed(req)) return res.status(401).json({ message: 'Belum login.' });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }

  if (!process.env.GATEWAY_KEY) {
    return res.status(500).json({ message: 'GATEWAY_KEY belum diatur di Environment Variables Vercel.' });
  }

  try {
    const c = await getData(req.query && req.query.refresh === '1');
    const payload = c.stale
      ? { ...c.payload, warning: 'Gateway sedang tidak bisa dihubungi. Menampilkan data terakhir yang berhasil diambil.' }
      : c.payload;
    return res.status(200).json(payload);
  } catch (e) {
    // Pesan error sengaja tidak memuat URL/key agar tidak bocor ke browser.
    console.error('Gagal mengambil data gateway:', e && e.message);
    return res.status(502).json({ message: 'Gagal mengambil data dari gateway. Coba lagi beberapa saat.' });
  }
};
