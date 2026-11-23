# Dashboard OTO Klinik

Dashboard web untuk data service bengkel OTO Klinik. Data diambil dari gateway LATTO lewat Vercel Serverless Function, jadi **X-Gateway-Key tidak pernah sampai ke browser**.

```
Browser -> public/ (dashboard) -> /api/wo (Vercel Function) -> Gateway -> LATTO
                                    ^ GATEWAY_KEY disimpan di Environment Variables
```

## Isi repo

| Path | Fungsi |
|---|---|
| `public/index.html`, `public/assets/` | Tampilan dashboard (3 halaman), logo, CSS, logika perhitungan |
| `api/wo.js` | Mengambil semua halaman data dari gateway, cache 10 menit, membuang field `links` |
| `vercel.json` | Konfigurasi deploy dan header keamanan |

## Deploy

1. Buat repo **private** di GitHub, lalu upload seluruh isi folder ini.
2. Di Vercel: **Add New > Project**, pilih repo tersebut. Framework: *Other*, tanpa build command.
3. Sebelum deploy, isi **Settings > Environment Variables**:

| Nama | Isi |
|---|---|
| `GATEWAY_KEY` | Nilai `X-Gateway-Key` dari gateway |

Dashboard **tidak memakai login**: siapa pun yang tahu URL-nya bisa melihat data. Opsional: `PAGE_LIMIT` (default 100), `CONCURRENCY` (default 6), `CACHE_TTL_MINUTES` (default 10), `MASK_PHONE=true` untuk menyamarkan nomor telepon, `GATEWAY_URL`.

4. Deploy. Setiap `git push` akan otomatis ter-deploy ulang.

Jangan pernah commit key ke GitHub. File `.env*` sudah diabaikan lewat `.gitignore`.

## Aturan perhitungan

Semua tanggal dikonversi dari UTC ke **WITA (UTC+8)**. Ubah di bagian `CFG` pada `public/assets/app.js`.

- **Lead time** = tanggal keluar dikurangi tanggal masuk. Unit tanpa tanggal keluar tidak dihitung. Dikelompokkan per bulan **tanggal keluar**.
- **Unit masuk** dihitung dari tanggal masuk.
- **Revenue** dihitung per **tanggal keluar** (`REVENUE_BASIS: 'keluar'`). Ganti ke `'masuk'` kalau manajemen ingin berdasarkan tanggal masuk.
- **Perbandingan "vs bulan lalu"** memakai rentang tanggal yang sama (misalnya tgl 1-23 dibanding tgl 1-23 bulan lalu).
- **Data janggal** (keluar lebih awal dari masuk, estimasi lebih awal dari masuk, harga di bawah Rp 10.000, tanpa mekanik) tetap tampil di tabel dengan tanda `!`, tetapi data dengan tanggal tidak valid tidak ikut hitungan durasi.

## Catatan

- Fitur Export mengunduh **semua baris hasil filter** (bukan hanya halaman yang tampil) ke file `.xlsx`.
- Tombol refresh di header memaksa ambil data baru dari gateway (maksimal 1x per 30 detik). Tanpa itu, data di-cache 10 menit.
- Vercel Hobby dimaksudkan untuk penggunaan non-komersial. Cek syarat terbaru Vercel; alternatif gratis dengan struktur serupa: Cloudflare Pages + Workers.
- Gateway saat ini membocorkan token LATTO di field `links` pada responsnya. Dashboard ini membuangnya, tetapi sebaiknya perbaiki di gateway-nya juga.
