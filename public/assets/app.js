/* Dashboard OTO Klinik
 * Semua perhitungan di sisi browser dari data /api/wo. Seluruh tanggal dikonversi ke WITA.
 */
(() => {
'use strict';

/* ================= PENGATURAN (ubah di sini) ================= */
const CFG = {
  TZ_OFFSET_H: 8,          // WITA = UTC+8
  REVENUE_BASIS: 'keluar', // 'keluar' = revenue dihitung saat unit keluar, 'masuk' = saat unit masuk
  STALE_DAYS: 30,          // unit tanpa tanggal keluar lebih dari ini ditandai "perlu dicek"
  MIN_PRICE: 10000,        // harga di bawah ini (tapi > 0) ditandai tidak wajar
  MIN_UNITS_RANK: 5,       // minimal unit agar masuk peringkat "tercepat"
};

/* ================= UTIL ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const MS_H = 3600e3, MS_D = 864e5;
const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const MONTHS_LONG = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const DAYS = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const nf = new Intl.NumberFormat('id-ID');
const p2 = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const shift = (t) => new Date(t + CFG.TZ_OFFSET_H * MS_H);           // baca dengan getUTC*
const dkey = (t) => { const d = shift(t); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };
const mkey = (t) => dkey(t).slice(0, 7);
const dayOfMonth = (t) => shift(t).getUTCDate();
const prevMonth = (k) => { let [y, m] = k.split('-').map(Number); m--; if (m === 0) { m = 12; y--; } return `${y}-${p2(m)}`; };
const monthLabel = (k) => { const [y, m] = k.split('-'); return `${MONTHS[+m - 1]} ${y.slice(2)}`; };
const monthLong = (k) => { const [y, m] = k.split('-'); return `${MONTHS_LONG[+m - 1]} ${y}`; };
const fmtD = (t) => { if (t == null) return '-'; const d = shift(t); return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtDT = (t) => { if (t == null) return '-'; const d = shift(t); return `${fmtD(t)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const fmtRp = (v) => 'Rp ' + nf.format(Math.round(v || 0));
const fmtRpShort = (v) => v >= 1e9 ? (v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M' : v >= 1e6 ? (v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt' : v >= 1e3 ? Math.round(v / 1e3) + ' rb' : String(Math.round(v));
const fmtNum = (v, d = 1) => v == null ? '-' : v.toLocaleString('id-ID', { maximumFractionDigits: d });
const fmtDur = (h) => h == null ? '-' : h < 24 ? `${nf.format(Math.round(h))} jam` : `${fmtNum(h / 24)} hari`;
const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
const avg = (a, f) => a.length ? sum(a, f) / a.length : null;
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, b) => b ? (a / b) * 100 : 0;
function groupBy(arr, keyFn) { const m = new Map(); arr.forEach((x) => { const k = keyFn(x); if (k == null) return; (m.get(k) || m.set(k, []).get(k)).push(x); }); return m; }

/* ================= STATE ================= */
let ROWS = [];
let CHARTS = {};
let OPEN = new Set();
let LIST = { from: '', to: '', q: '', cat: 'all', sortKey: 'masuk', dir: -1, page: 1, size: 25 };
let loadedOnce = false;

/* ================= NORMALISASI DATA ================= */
const toTs = (v) => { if (!v) return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

function normalize(r) {
  const masuk = toTs(r.tanggal_masuk), selesai = toTs(r.tanggal_selesai), est = toTs(r.tanggal_estimasi), keluar = toTs(r.tanggal_keluar);
  const harga = Number(r.harga) || 0;
  const mekanik = Array.isArray(r.mekanik) ? r.mekanik : [];
  const flags = [];
  if (masuk == null) flags.push('Tanggal masuk kosong');
  if (masuk != null && keluar != null && keluar < masuk) flags.push('Tanggal keluar lebih awal dari masuk');
  if (masuk != null && selesai != null && selesai < masuk) flags.push('Tanggal selesai lebih awal dari masuk');
  if (masuk != null && est != null && est < masuk) flags.push('Estimasi lebih awal dari masuk');
  if (harga > 0 && harga < CFG.MIN_PRICE) flags.push('Harga tidak wajar');
  if (!mekanik.length) flags.push('Tanpa mekanik');
  const merk = (r.merk_kendaraan || '').trim(), tipe = (r.tipe_kendaraan || '').trim();
  return {
    kategori: (r.kategori_wo || '').trim() || '(Tanpa kategori)',
    grp: catGroup(r.kategori_wo || ''),
    masuk, selesai, est, keluar, harga,
    telp: r.no_telp || '', nopol: (r.no_pol || '').trim(), merk, tipe,
    kendaraan: `${merk} ${tipe}`.trim(), model: (r.model_kendaraan || '').trim(),
    keluhan: String(r.keluhan || '').replace(/[\r\n]+/g, ' / ').trim(),
    mekanik, mekStr: mekanik.join(', '), flags,
    leadH: masuk != null && keluar != null && keluar >= masuk ? (keluar - masuk) / MS_H : null,   // lead time = keluar - masuk
    workH: masuk != null && selesai != null && selesai >= masuk ? (selesai - masuk) / MS_H : null,
  };
}

const GROUPS = ['General Repair', 'Body Repair', 'Lainnya'];
const catGroup = (k) => /body/i.test(k) ? 'Body Repair' : /general/i.test(k) ? 'General Repair' : 'Lainnya';
const revDate = (r) => CFG.REVENUE_BASIS === 'keluar' ? r.keluar : r.masuk;

/* ================= AUTH & LOAD ================= */
const show = (id, on) => { $(id).hidden = !on; };
function setView(v) {
  show('#loadingView', v === 'loading');
  show('#errorView', v === 'error');
  show('#app', v === 'app');
  show('#topbar', v === 'app');
}

async function load(refresh) {
  const btn = $('#btnRefresh');
  btn.classList.add('spin');
  if (!loadedOnce) { $('#loadingText').textContent = 'Mengambil data service…'; setView('loading'); }
  try {
    const res = await fetch('/api/wo' + (refresh ? '?refresh=1' : ''), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `Server membalas HTTP ${res.status}`);

    ROWS = (json.data || []).map(normalize);
    loadedOnce = true;
    const notice = $('#notice');
    if (json.warning) { notice.textContent = json.warning; notice.hidden = false; } else notice.hidden = true;
    $('#updatedAt').textContent = `${nf.format(ROWS.length)} data · diperbarui ${fmtDT(Date.parse(json.updatedAt))} WITA`;
    setView('app');
    initControls();
    route();
  } catch (e) {
    if (loadedOnce) { const n = $('#notice'); n.textContent = 'Gagal memperbarui data: ' + e.message; n.hidden = false; setView('app'); }
    else { $('#errorText').textContent = e.message; setView('error'); }
  } finally {
    btn.classList.remove('spin');
  }
}

$('#btnRefresh').addEventListener('click', () => load(true));
$('#btnRetry').addEventListener('click', () => load(false));

/* ================= ROUTER ================= */
const PAGES = ['summary', 'next', 'daftar'];
function route() {
  if (!loadedOnce) return;
  const key = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'summary';
  $$('.page').forEach((p) => { p.hidden = p.dataset.page !== key; });
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.page === key));
  if (key === 'summary') renderSummary();
  if (key === 'next') renderNext();
  if (key === 'daftar') renderList();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ================= CONTROLS ================= */
let controlsReady = false;
function initControls() {
  // pilihan periode Next Summary (selalu diperbarui sesuai data)
  const months = [...new Set(ROWS.filter((r) => r.masuk != null).map((r) => mkey(r.masuk)))].sort().reverse();
  const cur = $('#nextPeriod').value || 'all';
  $('#nextPeriod').innerHTML = '<option value="all">Semua periode</option>' + months.map((m) => `<option value="${m}">${monthLong(m)}</option>`).join('');
  $('#nextPeriod').value = months.includes(cur) || cur === 'all' ? cur : 'all';

  if (controlsReady) return;
  controlsReady = true;
  $('#chartRange').addEventListener('change', renderSummary);
  $('#nextPeriod').addEventListener('change', renderNext);

  const apply = () => { LIST.page = 1; renderList(); };
  $('#fFrom').addEventListener('change', (e) => { LIST.from = e.target.value; apply(); });
  $('#fTo').addEventListener('change', (e) => { LIST.to = e.target.value; apply(); });
  $('#fCat').addEventListener('change', (e) => { LIST.cat = e.target.value; apply(); });
  let t; $('#fSearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { LIST.q = e.target.value.trim().toLowerCase(); apply(); }, 200); });
  $('#pageSize').addEventListener('change', (e) => { LIST.size = +e.target.value; apply(); });
  $('#pgPrev').addEventListener('click', () => { LIST.page--; renderList(); $('#grid').scrollIntoView({ block: 'nearest' }); });
  $('#pgNext').addEventListener('click', () => { LIST.page++; renderList(); $('#grid').scrollIntoView({ block: 'nearest' }); });
  $('#btnExport').addEventListener('click', exportExcel);

  // kartu Executive Summary: klik untuk membuka/menutup rincian
  const toggle = (card) => {
    const i = card.dataset.i, open = !OPEN.has(i);
    open ? OPEN.add(i) : OPEN.delete(i);
    card.classList.toggle('open', open); card.setAttribute('aria-expanded', open);
    $('.detail', card).hidden = !open;
  };
  $('#cards').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) toggle(c); });
  $('#cards').addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const c = e.target.closest('.card'); if (c) { e.preventDefault(); toggle(c); } });
}

/* ================= EXECUTIVE SUMMARY ================= */
function deltaChip(cur, prev, lowerIsBetter) {
  if (!prev) return '<span class="chip-delta flat">–</span>';
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 0.5) return '<span class="chip-delta flat">0%</span>';
  const up = p > 0, good = lowerIsBetter ? !up : up;
  return `<span class="chip-delta ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${fmtNum(Math.abs(p), 0)}%</span>`;
}

function renderSummary() {
  const now = Date.now(), today = dkey(now), cm = mkey(now), pm = prevMonth(cm), dom = dayOfMonth(now);
  const lbl = CFG.REVENUE_BASIS === 'keluar' ? 'tanggal keluar' : 'tanggal masuk';

  $('#summaryDate').textContent = `${DAYS[shift(now).getUTCDay()]}, ${fmtD(now)} (WITA)`;
  $('#revHint').textContent = `Total harga service per bulan, berdasarkan ${lbl}`;

  const masukHari = ROWS.filter((r) => r.masuk != null && dkey(r.masuk) === today);
  const masukBulan = ROWS.filter((r) => r.masuk != null && mkey(r.masuk) === cm);
  const masukBulanLalu = ROWS.filter((r) => r.masuk != null && mkey(r.masuk) === pm && dayOfMonth(r.masuk) <= dom);
  const revRows = ROWS.filter((r) => revDate(r) != null);
  const revHari = sum(revRows.filter((r) => dkey(revDate(r)) === today), (r) => r.harga);
  const revMtd = sum(revRows.filter((r) => mkey(revDate(r)) === cm), (r) => r.harga);
  const revMtdLalu = sum(revRows.filter((r) => mkey(revDate(r)) === pm && dayOfMonth(revDate(r)) <= dom), (r) => r.harga);
  const leadNow = ROWS.filter((r) => r.leadH != null && mkey(r.keluar) === cm);
  const leadPrev = ROWS.filter((r) => r.leadH != null && mkey(r.keluar) === pm);
  const leadAvg = avg(leadNow, (r) => r.leadH), leadPrevAvg = avg(leadPrev, (r) => r.leadH);

  const byGrp = (arr, fmt) => GROUPS.map((g) => ({ g, a: arr.filter((r) => r.grp === g) }))
    .filter((x) => x.g !== 'Lainnya' || x.a.length)
    .map((x) => `<div class="d-row"><span>${x.g}</span><b>${fmt(x.a)}</b></div>`).join('');
  const fUnit = (a) => `${nf.format(a.length)} unit`;
  const fRev = (a) => fmtRp(sum(a, (r) => r.harga));
  const fLead = (a) => a.length ? `${fmtDur(avg(a, (r) => r.leadH))} · ${nf.format(a.length)} unit` : '-';

  const cards = [
    { l: 'Unit masuk hari ini', v: nf.format(masukHari.length), s: `Rata-rata harian bulan ini: ${fmtNum(masukBulan.length / dom)}`, d: byGrp(masukHari, fUnit) },
    { l: 'Lead time bulan ini', v: leadAvg == null ? '-' : fmtDur(leadAvg), s: `${deltaChip(leadAvg, leadPrevAvg, true)}vs bulan lalu · ${nf.format(leadNow.length)} unit selesai`, d: byGrp(leadNow, fLead) },
    { l: 'Unit masuk bulan ini', v: nf.format(masukBulan.length), s: `${deltaChip(masukBulan.length, masukBulanLalu.length, false)}vs periode sama bulan lalu (${nf.format(masukBulanLalu.length)})`, d: byGrp(masukBulan, fUnit) },
    { l: 'Revenue hari ini', v: fmtRp(revHari), s: `Berdasarkan ${lbl}`, d: byGrp(revRows.filter((r) => dkey(revDate(r)) === today), fRev) },
    { l: 'Revenue MTD', v: fmtRp(revMtd), s: `${deltaChip(revMtd, revMtdLalu, false)}vs periode sama bulan lalu`, d: byGrp(revRows.filter((r) => mkey(revDate(r)) === cm), fRev) },
  ];
  $('#cards').innerHTML = cards.map((c, i) => {
    const open = OPEN.has(String(i));
    return `<div class="card clickable${open ? ' open' : ''}" role="button" tabindex="0" aria-expanded="${open}" data-i="${i}"><span class="label">${c.l}</span><span class="value">${c.v}</span><span class="sub">${c.s}</span><span class="more">Rincian</span><div class="detail"${open ? '' : ' hidden'}>${c.d}</div></div>`;
  }).join('');

  // analisa singkat
  const pp = (a, b) => b ? `${a >= b ? 'naik' : 'turun'} ${fmtNum(Math.abs(pct(a - b, b)), 0)}%` : 'belum ada pembanding';
  const out = [];
  out.push(`Hingga tanggal ${dom}, ${nf.format(masukBulan.length)} unit masuk bulan ini, ${pp(masukBulan.length, masukBulanLalu.length)} dibanding periode yang sama bulan lalu (${nf.format(masukBulanLalu.length)} unit).`);
  if (leadAvg != null) out.push(`Lead time rata-rata bulan ini ${fmtDur(leadAvg)}${leadPrevAvg != null ? `, ${leadAvg <= leadPrevAvg ? 'lebih cepat' : 'lebih lambat'} dari bulan lalu (${fmtDur(leadPrevAvg)})` : ''}.`);
  else out.push('Belum ada unit yang selesai (punya tanggal keluar) bulan ini, jadi lead time belum bisa dihitung.');
  out.push(`Revenue MTD ${fmtRp(revMtd)}, ${pp(revMtd, revMtdLalu)} dibanding periode sama bulan lalu.`);
  const cat = [...groupBy(masukBulan, (r) => r.kategori)].sort((a, b) => b[1].length - a[1].length)[0];
  if (cat) out.push(`Jenis service terbanyak bulan ini: ${cat[0]} (${nf.format(cat[1].length)} unit, ${fmtNum(pct(cat[1].length, masukBulan.length), 0)}% dari unit masuk).`);
  const open = ROWS.filter((r) => r.keluar == null && r.masuk != null && now - r.masuk <= CFG.STALE_DAYS * MS_D).length;
  out.push(`Saat ini ada ${nf.format(open)} unit yang masuk ${CFG.STALE_DAYS} hari terakhir dan belum keluar dari bengkel.`);
  const latest = Math.max(...ROWS.map((r) => r.masuk ?? 0));
  if (latest && now - latest > 3 * MS_D) out.push(`Perhatian: unit terakhir tercatat masuk pada ${fmtD(latest)}. Cek apakah data dari LATTO sudah terbarui.`);
  $('#analysis').innerHTML = out.map((t) => `<li>${esc(t)}</li>`).join('');

  renderCharts(cm);
}

function renderCharts(cm) {
  if (typeof Chart === 'undefined') return;
  const range = +$('#chartRange').value;
  const valid = ROWS.filter((r) => r.masuk != null);
  const first = valid.length ? mkey(Math.min(...valid.map((r) => r.masuk))) : cm;
  let months = [], k = cm;
  while (k >= first && (range === 0 || months.length < range)) { months.unshift(k); k = prevMonth(k); }

  const count = months.map((m) => ROWS.filter((r) => r.masuk != null && mkey(r.masuk) === m).length);
  const leadN = months.map((m) => ROWS.filter((r) => r.leadH != null && mkey(r.keluar) === m));
  const lead = leadN.map((a) => a.length ? +(avg(a, (r) => r.leadH) / 24).toFixed(2) : null);
  const rev = months.map((m) => sum(ROWS.filter((r) => revDate(r) != null && mkey(revDate(r)) === m), (r) => r.harga));
  const labels = months.map(monthLabel);
  const last = months.length - 1;

  const NAVY = '#204685', RED = '#D9252A';
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = '#667489';
  const base = (yFmt) => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#eef1f6' }, ticks: { callback: yFmt } } },
  });
  const draw = (id, cfg) => { if (CHARTS[id]) CHARTS[id].destroy(); CHARTS[id] = new Chart($('#' + id), cfg); };
  const colors = (n) => Array.from({ length: n }, (_, i) => i === last ? RED : NAVY);

  draw('chartLead', {
    type: 'line',
    data: { labels, datasets: [{ data: lead, borderColor: NAVY, backgroundColor: NAVY, tension: .25, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: colors(months.length), pointBorderColor: colors(months.length), spanGaps: true }] },
    options: { ...base((v) => v + ' hr'), plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmtNum(c.parsed.y)} hari (${nf.format(leadN[c.dataIndex].length)} unit)` } } } },
  });
  draw('chartCount', {
    type: 'bar',
    data: { labels, datasets: [{ data: count, backgroundColor: colors(months.length), borderRadius: 4 }] },
    options: { ...base((v) => nf.format(v)), plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${nf.format(c.parsed.y)} unit` } } } },
  });
  draw('chartRevenue', {
    type: 'bar',
    data: { labels, datasets: [{ data: rev, backgroundColor: colors(months.length), borderRadius: 4 }] },
    options: { ...base((v) => fmtRpShort(v)), plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtRp(c.parsed.y) } } } },
  });
}

/* ================= NEXT SUMMARY ================= */
const mini = (heads, rows, numCols = []) => rows.length
  ? `<div class="scroll-x"><table class="mini"><thead><tr>${heads.map((h, i) => `<th class="${numCols.includes(i) ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numCols.includes(i) ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : '<p class="empty">Belum ada data untuk periode ini.</p>';
const bar = (p, hot) => `<div class="bar ${hot ? 'hot' : ''}"><span style="width:${Math.max(2, Math.min(100, p))}%"></span></div>`;
const insight = (title, headline, body, note, wide) => `<article class="panel insight ${wide ? 'wide' : ''}"><h3>${title}</h3><p class="headline">${headline}</p>${body}${note ? `<p class="note">${note}</p>` : ''}</article>`;
const unitName = (r) => `<strong>${esc(r.nopol || '-')}</strong><br><span class="muted">${esc(r.kendaraan || '-')}</span>`;

function renderNext() {
  const sel = $('#nextPeriod').value || 'all';
  const rows = sel === 'all' ? ROWS : ROWS.filter((r) => r.masuk != null && mkey(r.masuk) === sel);
  const now = Date.now();
  $('#nextCount').textContent = `${nf.format(rows.length)} unit dianalisa`;
  const cards = [];

  const done = rows.filter((r) => r.leadH != null);
  const open = rows.filter((r) => r.keluar == null && r.masuk != null).map((r) => ({ r, ageH: (now - r.masuk) / MS_H })).sort((a, b) => b.ageH - a.ageH);

  // 1. Service paling lama (selesai)
  const longest = [...done].sort((a, b) => b.leadH - a.leadH).slice(0, 5);
  cards.push(insight('Unit dengan service paling lama',
    longest.length ? `${esc(longest[0].nopol)} (${esc(longest[0].kendaraan)}) memakan ${fmtDur(longest[0].leadH)} dari masuk sampai keluar, kategori ${esc(longest[0].kategori)}.` : 'Belum ada unit yang selesai pada periode ini.',
    mini(['Unit', 'Kategori', 'Masuk', 'Keluar', 'Lead time'], longest.map((r) => [unitName(r), esc(r.kategori), fmtD(r.masuk), fmtD(r.keluar), `<strong>${fmtDur(r.leadH)}</strong>`]), [4]),
    'Dihitung dari tanggal masuk sampai tanggal keluar. Hanya unit yang sudah keluar.'));

  // 2. Belum keluar
  const stale = open.filter((o) => o.ageH > CFG.STALE_DAYS * 24).length;
  cards.push(insight('Unit yang belum keluar dari bengkel',
    open.length ? `${nf.format(open.length)} unit belum punya tanggal keluar. Terlama ${esc(open[0].r.nopol)}, sudah ${fmtDur(open[0].ageH)} sejak masuk.` : 'Semua unit pada periode ini sudah keluar.',
    mini(['Unit', 'Masuk', 'Status', 'Sudah di bengkel'], open.slice(0, 5).map(({ r, ageH }) => [unitName(r), fmtD(r.masuk), (r.selesai ? 'Selesai, belum keluar' : 'Dalam pengerjaan') + (ageH > CFG.STALE_DAYS * 24 ? ' <span class="tag warn">Perlu dicek</span>' : ''), `<strong>${fmtDur(ageH)}</strong>`]), [3]),
    `Dihitung dari tanggal masuk sampai sekarang, dan tidak masuk hitungan lead time. ${stale ? `${nf.format(stale)} unit lebih dari ${CFG.STALE_DAYS} hari, kemungkinan belum ditutup di LATTO.` : ''}`));

  // 3. Jenis service
  const byCat = [...groupBy(rows, (r) => r.kategori)].map(([k, a]) => ({ k, a, n: a.length, lead: avg(a.filter((r) => r.leadH != null), (r) => r.leadH), rev: sum(a, (r) => r.harga) })).sort((x, y) => y.n - x.n);
  const slowCat = byCat.filter((c) => c.lead != null && c.a.filter((r) => r.leadH != null).length >= CFG.MIN_UNITS_RANK).sort((x, y) => y.lead - x.lead)[0];
  cards.push(insight('Jenis service paling banyak',
    byCat.length ? `${esc(byCat[0].k)} paling banyak: ${nf.format(byCat[0].n)} unit (${fmtNum(pct(byCat[0].n, rows.length), 0)}%).${slowCat ? ` Paling lama dikerjakan: ${esc(slowCat.k)}, rata-rata ${fmtDur(slowCat.lead)}.` : ''}` : 'Belum ada data.',
    mini(['Kategori', 'Unit', 'Porsi', 'Lead time', 'Revenue'], byCat.slice(0, 8).map((c) => [esc(c.k), nf.format(c.n), bar(pct(c.n, byCat[0].n)), fmtDur(c.lead), fmtRp(c.rev)]), [1, 3, 4]),
    `Peringkat "paling lama" hanya memakai kategori dengan minimal ${CFG.MIN_UNITS_RANK} unit selesai.`));

  // 4. Kendaraan
  const topBy = (fn) => [...groupBy(rows, fn)].map(([k, a]) => [k, a.length]).sort((x, y) => y[1] - x[1]).slice(0, 5);
  const merk = topBy((r) => r.merk || null), tipe = topBy((r) => r.kendaraan || null);
  const vList = (list) => mini(['Nama', 'Unit', 'Porsi'], list.map(([k, n]) => [esc(k), nf.format(n), bar(pct(n, list[0][1]))]), [1]);
  cards.push(insight('Kendaraan yang paling sering masuk',
    merk.length ? `Merk terbanyak ${esc(merk[0][0])} (${fmtNum(pct(merk[0][1], rows.length), 0)}%), tipe terbanyak ${esc(tipe[0][0])} (${nf.format(tipe[0][1])} unit).` : 'Belum ada data.',
    merk.length ? `<div class="stats" style="grid-template-columns:1fr 1fr;align-items:start"><div><p class="note"><b>Merk</b></p>${vList(merk)}</div><div><p class="note"><b>Tipe</b></p>${vList(tipe)}</div></div>` : '', ''));

  // 5. Mekanik
  const mekMap = new Map();
  rows.forEach((r) => r.mekanik.forEach((m) => { (mekMap.get(m) || mekMap.set(m, []).get(m)).push(r); }));
  const mek = [...mekMap].map(([k, a]) => { const d = a.filter((r) => r.leadH != null); return { k, n: a.length, nd: d.length, lead: avg(d, (r) => r.leadH) }; }).sort((x, y) => y.n - x.n);
  const fastest = mek.filter((m) => m.nd >= CFG.MIN_UNITS_RANK).sort((x, y) => x.lead - y.lead)[0];
  cards.push(insight('Beban kerja mekanik',
    mek.length ? `${esc(mek[0].k)} menangani unit terbanyak (${nf.format(mek[0].n)} unit).${fastest ? ` Lead time rata-rata tercepat: ${esc(fastest.k)} (${fmtDur(fastest.lead)}).` : ''}` : 'Belum ada data mekanik.',
    mini(['Mekanik', 'Unit', 'Beban', 'Lead time rata-rata'], mek.slice(0, 8).map((m) => [esc(m.k), nf.format(m.n), bar(pct(m.n, mek[0].n)), fmtDur(m.lead)]), [1, 3]),
    `Unit dengan lebih dari satu mekanik dihitung untuk tiap mekanik. Lead time memakai unit yang sudah keluar. Peringkat tercepat minimal ${CFG.MIN_UNITS_RANK} unit.`));

  // 6. Ketepatan estimasi (selesai vs estimasi)
  const est = rows.filter((r) => r.est != null && r.selesai != null && r.masuk != null && r.est >= r.masuk && r.selesai >= r.masuk);
  const onTime = est.filter((r) => r.selesai <= r.est), late = est.filter((r) => r.selesai > r.est);
  const lateAvg = avg(late, (r) => (r.selesai - r.est) / MS_H);
  cards.push(insight('Ketepatan estimasi pengerjaan',
    est.length ? `${fmtNum(pct(onTime.length, est.length), 0)}% unit selesai sesuai estimasi. ${late.length ? `Yang terlambat rata-rata lewat ${fmtDur(lateAvg)}.` : ''}` : 'Belum ada data estimasi yang bisa dibandingkan.',
    est.length ? `<div class="stats"><div class="stat"><b>${nf.format(onTime.length)}</b><span>Tepat waktu</span></div><div class="stat"><b>${nf.format(late.length)}</b><span>Terlambat</span></div><div class="stat"><b>${fmtDur(avg(est.filter((r) => r.workH != null), (r) => r.workH))}</b><span>Rata-rata masuk ke selesai</span></div></div>` : '',
    `Membandingkan tanggal selesai dengan tanggal estimasi. ${nf.format(rows.length - est.length)} unit tidak dihitung karena data estimasi/selesai kosong atau janggal.`));

  // 7. Menunggu diambil
  const gap = rows.filter((r) => r.selesai != null && r.keluar != null && r.keluar >= r.selesai && r.leadH != null);
  const gapH = gap.map((r) => (r.keluar - r.selesai) / MS_H);
  cards.push(insight('Selesai dikerjakan tapi belum diambil',
    gap.length ? `Setelah pekerjaan selesai, unit rata-rata baru keluar ${fmtDur(avg(gapH))} kemudian, sekitar ${fmtNum(pct(sum(gapH), sum(gap, (r) => r.leadH)), 0)}% dari total lead time.` : 'Belum ada data untuk dihitung.',
    gap.length ? `<div class="stats"><div class="stat"><b>${fmtDur(avg(gapH))}</b><span>Rata-rata jeda</span></div><div class="stat"><b>${fmtDur(median(gapH))}</b><span>Median jeda</span></div><div class="stat"><b>${nf.format(gapH.filter((h) => h > 72).length)}</b><span>Unit jeda > 3 hari</span></div></div>` : '',
    'Lead time (masuk ke keluar) ikut memuat waktu unit menunggu pelanggan datang. Jeda yang panjang berarti sebagian lead time bukan karena lama dikerjakan.'));

  // 8. Pola kedatangan
  const withMasuk = rows.filter((r) => r.masuk != null);
  const dow = Array(7).fill(0), hour = Array(24).fill(0);
  withMasuk.forEach((r) => { const d = shift(r.masuk); dow[d.getUTCDay()]++; hour[d.getUTCHours()]++; });
  const peakD = dow.indexOf(Math.max(...dow)), peakH = hour.indexOf(Math.max(...hour));
  const order = [1, 2, 3, 4, 5, 6, 0];
  cards.push(insight('Pola kedatangan unit',
    withMasuk.length ? `Hari tersibuk ${DAYS[peakD]} (${fmtNum(pct(dow[peakD], withMasuk.length), 0)}% unit). Jam masuk tersibuk ${p2(peakH)}.00 sampai ${p2((peakH + 1) % 24)}.00 WITA.` : 'Belum ada data.',
    withMasuk.length ? mini(['Hari', 'Unit', 'Porsi'], order.map((d) => [DAYS[d], nf.format(dow[d]), bar(pct(dow[d], dow[peakD]), d === peakD)]), [1]) : '',
    'Berdasarkan tanggal dan jam masuk dalam WITA.'));

  // 9. Unit berulang
  const norm = (s) => s.toUpperCase().replace(/\s+/g, '');
  const rep = [...groupBy(rows.filter((r) => r.nopol), (r) => norm(r.nopol))].filter(([, a]) => a.length > 1).map(([k, a]) => ({ k, a, n: a.length })).sort((x, y) => y.n - x.n);
  cards.push(insight('Unit yang datang berulang',
    rep.length ? `${nf.format(rep.length)} unit datang lebih dari sekali. Terbanyak ${esc(rep[0].a[0].nopol)} (${esc(rep[0].a[0].kendaraan)}) dengan ${nf.format(rep[0].n)} kunjungan.` : 'Tidak ada unit yang datang lebih dari sekali pada periode ini.',
    mini(['Unit', 'Kunjungan', 'Total revenue'], rep.slice(0, 5).map((x) => [unitName(x.a[0]), nf.format(x.n), fmtRp(sum(x.a, (r) => r.harga))]), [1, 2]),
    'Dikenali dari nomor polisi. Pilih "Semua periode" untuk melihat pelanggan setia secara keseluruhan.'));

  // 10. Kualitas data
  const flagMap = new Map();
  rows.forEach((r) => r.flags.forEach((f) => flagMap.set(f, (flagMap.get(f) || 0) + 1)));
  const flagged = rows.filter((r) => r.flags.length).length;
  cards.push(insight('Kualitas data',
    rows.length ? `${nf.format(flagged)} dari ${nf.format(rows.length)} data (${fmtNum(pct(flagged, rows.length), 1)}%) punya catatan yang perlu dicek.` : 'Belum ada data.',
    mini(['Catatan', 'Jumlah data'], [...flagMap].sort((a, b) => b[1] - a[1]).map(([f, n]) => [esc(f), nf.format(n)]), [1]),
    'Unit dengan tanggal keluar lebih awal dari tanggal masuk tidak dihitung dalam lead time. Data ini ditandai tanda seru merah di halaman Daftar Service.', true));

  $('#insights').innerHTML = cards.join('');
}

/* ================= DAFTAR SERVICE ================= */
const COLS = [
  { k: 'masuk', t: 'Tgl Masuk', f: (r) => fmtDT(r.masuk) },
  { k: 'nopol', t: 'No. Polisi', f: (r) => esc(r.nopol) + (r.flags.length ? `<span class="warn-dot" title="${esc(r.flags.join('; '))}">!</span>` : '') },
  { k: 'kendaraan', t: 'Kendaraan', f: (r) => esc(r.kendaraan) },
  { k: 'model', t: 'Model', f: (r) => esc(r.model) },
  { k: 'kategori', t: 'Kategori', f: (r) => esc(r.kategori) },
  { k: 'keluhan', t: 'Keluhan', f: (r) => esc(r.keluhan), cls: 'wrap' },
  { k: 'mekStr', t: 'Mekanik', f: (r) => esc(r.mekStr) },
  { k: 'est', t: 'Estimasi', f: (r) => fmtDT(r.est) },
  { k: 'selesai', t: 'Tgl Selesai', f: (r) => fmtDT(r.selesai) },
  { k: 'keluar', t: 'Tgl Keluar', f: (r) => fmtDT(r.keluar) },
  { k: 'leadH', t: 'Lead Time', f: (r) => r.leadH == null ? '-' : fmtDur(r.leadH), cls: 'num' },
  { k: 'harga', t: 'Harga', f: (r) => fmtRp(r.harga), cls: 'num' },
  { k: 'telp', t: 'No. Telp', f: (r) => esc(r.telp) },
];

function filtered() {
  const { from, to, q, cat } = LIST;
  let a = ROWS.filter((r) => {
    if (cat !== 'all' && r.grp !== cat) return false;
    if (from || to) {
      if (r.masuk == null) return false;
      const d = dkey(r.masuk);
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
    if (q) {
      const hay = `${r.nopol} ${r.kendaraan} ${r.model} ${r.kategori} ${r.keluhan} ${r.mekStr} ${r.telp}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const { sortKey, dir } = LIST;
  a = a.slice().sort((x, y) => {
    const u = x[sortKey], v = y[sortKey];
    if (u == null || u === '') return 1;
    if (v == null || v === '') return -1;
    return (typeof u === 'string' ? u.localeCompare(v, 'id') : u - v) * dir;
  });
  return a;
}

function renderList() {
  const a = filtered();
  const pages = Math.max(1, Math.ceil(a.length / LIST.size));
  LIST.page = Math.min(Math.max(1, LIST.page), pages);
  const start = (LIST.page - 1) * LIST.size;
  const slice = a.slice(start, start + LIST.size);

  $('#gridHead').innerHTML = '<tr>' + COLS.map((c) => `<th data-k="${c.k}" title="Urutkan">${c.t}<span class="arr">${LIST.sortKey === c.k ? (LIST.dir === 1 ? '▲' : '▼') : ''}</span></th>`).join('') + '</tr>';
  $$('#gridHead th').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (LIST.sortKey === k) LIST.dir *= -1; else { LIST.sortKey = k; LIST.dir = k === 'masuk' || k === 'harga' || k === 'leadH' ? -1 : 1; }
    renderList();
  }));
  $('#gridBody').innerHTML = slice.length
    ? slice.map((r) => '<tr>' + COLS.map((c) => `<td class="${c.cls || ''}"${c.k === 'keluhan' ? ` title="${esc(r.keluhan)}"` : ''}>${c.f(r)}</td>`).join('') + '</tr>').join('')
    : `<tr><td colspan="${COLS.length}" class="empty" style="text-align:center;padding:28px">Tidak ada data pada filter ini. Ubah rentang tanggal atau kata kunci.</td></tr>`;

  const rangeTxt = LIST.from || LIST.to ? ` · ${LIST.from ? fmtD(Date.parse(LIST.from + 'T00:00:00+08:00')) : 'awal'} sampai ${LIST.to ? fmtD(Date.parse(LIST.to + 'T00:00:00+08:00')) : 'sekarang'}` : '';
  $('#tableCount').textContent = `${nf.format(a.length)} unit${LIST.cat !== 'all' ? ' · ' + LIST.cat : ''}${rangeTxt} · total ${fmtRp(sum(a, (r) => r.harga))}`;
  $('#pgInfo').textContent = `Halaman ${nf.format(LIST.page)} dari ${nf.format(pages)}`;
  $('#pgPrev').disabled = LIST.page <= 1;
  $('#pgNext').disabled = LIST.page >= pages;
  $('#btnExport').disabled = !a.length;
}

function exportExcel() {
  if (typeof XLSX === 'undefined') { alert('Library Excel belum termuat. Periksa koneksi internet lalu muat ulang halaman.'); return; }
  const a = filtered();
  const rows = a.map((r, i) => ({
    'No': i + 1,
    'Tanggal Masuk': fmtDT(r.masuk),
    'No. Polisi': r.nopol,
    'Merk': r.merk,
    'Tipe': r.tipe,
    'Model': r.model,
    'Kategori WO': r.kategori,
    'Keluhan': r.keluhan,
    'Mekanik': r.mekStr,
    'Tanggal Estimasi': fmtDT(r.est),
    'Tanggal Selesai': fmtDT(r.selesai),
    'Tanggal Keluar': fmtDT(r.keluar),
    'Lead Time (hari)': r.leadH == null ? '' : +(r.leadH / 24).toFixed(2),
    'Harga (Rp)': r.harga,
    'No. Telp': r.telp,
    'Catatan Data': r.flags.join('; '),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [6, 20, 14, 14, 14, 26, 18, 36, 22, 20, 20, 20, 14, 14, 16, 30].map((w) => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data Service');
  const tag = (LIST.cat === 'all' ? 'semua' : LIST.cat.replace(/\s+/g, '-')) + (LIST.from || LIST.to ? `_${LIST.from || 'awal'}_${LIST.to || 'sekarang'}` : '');
  XLSX.writeFile(wb, `OTO-Klinik_Data-Service_${tag}.xlsx`);
}

/* ================= START ================= */
load(false);
})();
