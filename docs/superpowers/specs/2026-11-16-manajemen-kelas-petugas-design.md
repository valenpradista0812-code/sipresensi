# Manajemen Kelas (Petugas) — Design

Tanggal: 2026-11-16
Status: disetujui

## Intent

Petugas perlu satu halaman untuk mengelola kelas, menetapkan/mengganti wali kelas, dan
melihat kelas mana yang belum punya wali. Semua operasi memakai backend + Supabase yang
sudah ada, dengan tampilan identik dengan halaman petugas lain (Data Guru, Manajemen Akun).

## Goals

- Halaman `src/pages/petugas/manajemen-kelas.html`, hanya untuk role `petugas`.
- Tiga kartu statistik dari data DB aktual: total kelas, kelas punya wali, kelas tanpa wali.
- Tabel kelas: nama, tingkat, wali, status penugasan, aksi edit/hapus.
- Search nama kelas/wali + filter tingkat X/XI/XII, loading/empty/error state.
- Tambah/edit/hapus kelas; penugasan & pergantian wali kelas.
- Menu sidebar petugas + guard halaman.

## Non-goals

- Tidak menambah kolom/tabel baru (tidak ada kolom `tingkat`, tidak ada tabel tahun ajaran).
- Tidak mengubah halaman petugas/admin lain selain menambah item sidebar.
- Tidak menghapus data historis (absensi/izin) saat kelas dihapus.

## Constraints & findings

- `kelas` = `id, name, total_siswa, wali_kelas, wali_kelas_id, ruangan`. `wali_kelas_id` FK ke
  `guru(id) ON DELETE SET NULL`; trigger menyinkronkan `kelas.wali_kelas` dari nama guru.
- Siswa, jadwal, absensi, dan pengajuan izin mereferensikan kelas **lewat nama** (`kelas` teks),
  bukan id. Karena itu hapus kelas harus diblokir bila nama masih dipakai.
- `routes/kelas.js` memanggil `db.countKelasReferences` yang belum ada → hapus kelas selalu 500.
- `db.addKelas`/`updateKelas` belum menyimpan `wali_kelas_id`, sehingga penugasan wali tidak
  pernah tersimpan.

## Approaches

1. **Tingkat dari prefix nama + validasi backend (dipilih).** Nol perubahan skema; regex
   `XII` → `XI` → `X` dengan lookahead non-huruf agar `XI`/`XII` tidak terbaca `X`.
2. Kolom `tingkat` baru. Lebih eksplisit, tapi mengubah skema dan butuh backfill; ditolak.
3. Tabel penugasan wali per tahun ajaran. Kebutuhan tahun ajaran belum ada di sistem; ditolak.

## Design

### Backend

- `utils/kelas-tingkat.js`: `parseTingkat(name)` → `'X' | 'XI' | 'XII' | null`;
  `isValidTingkatPrefix(name)` → boolean.
- `data/db.js`:
  - `countKelasReferences(name)` → `{ siswa, jadwal, absensi, izin, akun }` (count exact).
  - `findKelasByWaliId(guruId, excludeId)` → kelas yang sudah memakai guru tsb.
  - `addKelas`/`updateKelas` menyimpan `wali_kelas_id` (null = tanpa wali); `wali_kelas`
    diisi `'Belum Ditentukan'` saat kosong.
- `routes/kelas.js` (GET tetap untuk guru/petugas; write `requireRole('petugas')`):
  - `GET /api/kelas?q=&tingkat=` → `data` (dengan `tingkat`, `waliKelasId`) + `stats`
    `{ total, withWali, withoutWali }` dihitung dari seluruh kelas yang boleh dilihat.
  - `POST`/`PUT`: nama wajib & unik; prefix X/XI/XII (pada update hanya bila nama berubah);
    `waliKelasId` opsional, harus guru valid; satu guru hanya satu kelas aktif (409 +
    nama kelas pemakai); kosongkan wali dengan `waliKelasId: null`.
  - `DELETE`: blokir jika `countKelasReferences` > 0, pesan menyebut relasi yang menghalangi;
    tetap tangani FK `23503` dan penanda `KELAS_MASIH_DIPAKAI`.

### Frontend

- `manajemen-kelas.html` meniru `data-akun.html`: `body.petugas.admin`, `app` tinggi 100dvh,
  `.content` flex dengan toolbar (filter tingkat, search, tombol Tambah Kelas), kartu
  `.stats.stats-3`, tabel `.card.table-card` dengan scroll internal + filler row, footer count.
- Modal inline bergaya sama (putih, radius 12px): Nama Kelas, Tingkat (select X/XI/XII),
  Wali Kelas (select dari `/api/guru`, guru yang sudah jadi wali kelas lain tidak ditampilkan).
- Tingkat terisi otomatis dari nama saat mengetik; validasi prefix tampil di form.
- Hapus memakai `SiPresensi.confirm`; error 409 dari backend ditampilkan via toast.
- `server.js`: daftarkan halaman di `petugasPages` (guard `petugas`).
- Sidebar + mobile menu petugas: item "Manajemen Kelas", aktif via `data-page`.

### Verification

- `node scripts/check-kelas-routes.js` (+ assertion baru untuk parser & countKelasReferences).
- Uji helper DB nyata (count referensi, validasi wali ganda) lewat skrip sementara.
- Uji endpoint dengan token petugas: CRUD, wali ganda, hapus kelas terpakai, akses non-petugas.
