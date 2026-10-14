# SiPresensi - Sistem Presensi Digital Sekolah (Supabase Cloud Database)

Backend terpadu berbasis **Node.js + Express** dengan database **Supabase Cloud (PostgreSQL)**, sistem autentikasi Multi-Role (**Guru/Admin** dan **Siswa/User**), REST API lengkap, dan proteksi rute halaman.

---

## 🚀 Fitur Utama Backend

1. **Database Supabase Cloud (PostgreSQL)**:
   - Terhubung langsung ke Supabase (`https://rxcagbqeoevmfcbncmfd.supabase.co`).
   - Tidak lagi memerlukan XAMPP, MySQL lokal, atau phpMyAdmin!
   - Dilengkapi SDK `@supabase/supabase-js`.

2. **Autentikasi & Multi-Role Guard**:
   - **Guru / Admin**: Dapat mengakses halaman dashboard guru, manajemen data siswa, data guru, data kelas, input absensi harian, riwayat absensi, rekap bulanan, laporan, profil sekolah, dan pengaturan sistem.
   - **Siswa / User**: Memiliki tampilan dashboard siswa khusus, Live Time Tracker (pencatat durasi belajar), tombol Check-in / Check-out (absen pulang), ringkasan absensi pribadi, dan detail log presensi harian.
   - **Proteksi Rute**: Pengguna yang belum login otomatis diarahkan ke `login.html`. Siswa dicegah mengakses halaman administratif guru dan otomatis diarahkan ke `dashboard-siswa.html`.

3. **REST API SiPresensi**:
   - `POST /api/auth/login`: Autentikasi dengan Email / NIS / NIP dan Password, pembuatan cookie JWT session.
   - `GET /api/auth/me`: Informasi profil pengguna yang sedang login.
   - `ALL /api/auth/logout`: Menghapus sesi login.
   - `GET /api/stats/overview`: Statistik ringkasan (total siswa, total guru, tingkat kehadiran, alfa).
   - `GET /api/stats/siswa`: Statistik personal siswa (jam masuk, target pulang, jam belajar, kehadiran).
   - `CRUD /api/siswa`: Pengelolaan data siswa (Tambah, Lihat, Ubah, Hapus).
   - `CRUD /api/guru`: Pengelolaan data guru & staf pengajar.
   - `CRUD /api/kelas`: Pengelolaan data kelas sekolah.
   - `GET & POST /api/absensi`: Input presensi harian per kelas, riwayat, dan rekap bulanan.
   - `POST /api/siswa/absen-masuk` & `/api/siswa/absen-keluar`: Presensi mandiri siswa.
   - `GET & POST /api/pengaturan`: Pengaturan sistem dan profil sekolah.

---

## ⚡ Langkah Setup Database Supabase

1. Buka Supabase SQL Editor:
   [Supabase SQL Editor](https://supabase.com/dashboard/project/rxcagbqeoevmfcbncmfd/sql/new)
2. Buka berkas `supabase-setup.sql` di proyek ini, salin seluruh kodenya, tempel di SQL Editor Supabase, lalu klik **RUN**.
   *(Script ini akan menonaktifkan RLS dan mengisi seluruh data awal: akun guru, akun siswa, kelas, jadwal, dan pengaturan).*
3. Jalankan verifikasi di terminal:
   ```powershell
   npm run db:init
   ```

---

## 🔑 Akun Default (Setelah Menjalankan `supabase-setup.sql`)

| Peran | Email / Identitas | Kata Sandi | Halaman Tujuan |
|---|---|---|---|
| **Guru / Admin** | `admin.endang@sman1jkt.sch.id` | `password123` | `dashboard.html` |
| **Guru Mata Pelajaran** | `guru@sman1jkt.sch.id` | `password123` | `dashboard.html` |
| **Siswa / Murid** | `siswa@sman1jkt.sch.id` | `password123` | `dashboard-siswa.html` |
| **Siswa 2** | `budi@sman1jkt.sch.id` | `password123` | `dashboard-siswa.html` |

---

## 💻 Cara Menjalankan Server

1. Pastikan dependensi sudah terpasang:
   ```powershell
   npm install
   ```

2. Jalankan backend server:
   ```powershell
   npm start
   # atau mode auto-reload dev:
   npm run dev
   ```

3. Buka browser di alamat:
   ```
   http://localhost:3000
   ```
