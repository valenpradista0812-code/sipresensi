# SiPresensi - Sistem Presensi Digital Sekolah (Supabase Cloud Database)

Backend terpadu berbasis **Node.js + Express** dengan database **Supabase Cloud (PostgreSQL)**, sistem autentikasi Multi-Role (**Guru/Admin** dan **Siswa/User**), REST API lengkap, dan proteksi rute halaman.

---

## 🚀 Fitur Utama Backend

1. **Database Supabase Cloud (PostgreSQL)**:
   - URL dan kredensial Supabase dibaca dari environment server.
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
   - `POST /api/iot/rfid`: Memproses tap RFID perangkat; `event_id` opsional membantu mencegah event dispensasi yang dikirim ulang agar tidak diproses dua kali.
   - `GET /api/izin`: Daftar pengajuan milik siswa atau seluruh pengajuan untuk guru/admin.
   - `POST /api/izin`: Siswa mengajukan izin dengan rentang maksimal 90 hari dan bukti foto opsional.
   - `POST /api/izin/:id/review`: Guru/admin menyetujui atau menolak pengajuan.
   - `GET & POST /api/pengaturan`: Pengaturan sistem dan profil sekolah.

---

## ⚡ Setup Database Supabase

- Untuk database pengembangan baru, tinjau `supabase-setup.sql` sebelum dijalankan. Script setup berisi data contoh dan pengaturan RLS yang tidak sesuai untuk database produksi. Setelah setup, jalankan migrasi `2026110702_leave_applications.sql` hingga `2026110708_rfid_dispensasi_workflow.sql` secara berurutan.
- Untuk database yang sudah berisi data, buat backup terlebih dahulu lalu tinjau dan jalankan migrasi berurutan: `2026110701_fix_rfid_and_absensi_constraints.sql`, lalu `2026110702_leave_applications.sql` hingga `2026110708_rfid_dispensasi_workflow.sql`. Migrasi yang membuat indeks berhenti jika menemukan duplikasi; selesaikan duplikasi secara manual sebelum mencoba kembali.
- Persetujuan mencatat status izin/sakit pada setiap tanggal kalender pengajuan di `absensi`, dengan jenis, rentang tanggal, durasi, dan keterangan pengajuan. Migrasi 0706 juga mengisi riwayat untuk pengajuan yang sebelumnya telah disetujui; prosesnya idempoten dan tidak menimpa absensi berstatus hadir. Pengajuan yang disetujui tetap disimpan sebagai jejak database dan tetap terlihat oleh siswa, tetapi dikeluarkan dari antrean konfirmasi Admin; pengajuan ditolak tetap tampil di antrean.
- Tabel pengajuan izin memakai RLS dan hanya dapat diakses melalui server. Set `SUPABASE_SERVICE_ROLE_KEY` pada environment backend; jangan gunakan atau publikasikan service-role key di browser/client.
- Dispensasi RFID same-day baru dimulai pada tap pertama setelah persetujuan; tap berikutnya menyelesaikan sesi. Server memakai waktu database, mengunci data siswa saat memproses tap, dan menolak scan berulang dalam 10 detik. Jika perangkat mendukung antrean offline, kirim `event_id` unik per tap dan putar ulang antrean secara berurutan; firmware/perangkat RFID tidak termasuk dalam repository ini, sehingga antrean offline perangkat perlu diterapkan pada firmware.
- Jangan jalankan setup atau migrasi terhadap database produksi tanpa review dan backup. Perubahan skema tidak dijalankan otomatis oleh aplikasi.
- `npm run db:init` tidak tersedia sebagai script package; jangan mengandalkan perintah tersebut.

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

3. Untuk production, set `JWT_SECRET` sebagai environment variable berisi secret acak yang kuat (minimal 32 byte). Server menolak berjalan di production jika secret ini tidak disetel. Mode development memakai secret sementara yang berubah saat server dimulai ulang.

4. Buka browser di alamat:
   ```
   http://localhost:3000
   ```

## 🚀 Deployment Vercel

- Entry point `api/index.js` mengekspor Express app. Vercel mengarahkan seluruh URL ke handler tersebut, sehingga URL halaman dan `/api/...` yang sudah ada tetap digunakan.
- Tambahkan `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, dan `JWT_SECRET` pada **Project Settings → Environment Variables** Vercel. `SUPABASE_KEY` dapat dipakai sebagai pengganti service-role key hanya jika fitur server tidak memerlukan hak akses service role. Tambahkan `IOT_DEVICE_TOKEN` untuk autentikasi perangkat RFID/IoT dan `IOT_DEVICE_ID` bila ID perangkat bukan nilai default.
- Jangan commit file `.env` atau menaruh nilai secret di `vercel.json`. Atur environment variables untuk Production (serta Preview/Development bila diperlukan) lalu redeploy setelah perubahan.
- Pengujian lokal: jalankan `npm install`, atur variabel di `.env`, lalu `npm run dev`. Untuk menguji routing lokal Vercel, jalankan `vercel dev` setelah menghubungkan proyek dengan `vercel link`.
- Deployment: impor repository melalui Vercel atau jalankan `vercel`, periksa project settings/environment variables, lalu deploy dengan `vercel --prod`. Uji `/login.html`, aset di `/public` dan `/src`, serta endpoint `/api/auth/me` setelah deploy.
- UDP Discovery hanya aktif pada server lokal; fungsi serverless tidak membuka listener UDP. Endpoint HTTP perangkat tetap tersedia. Vercel Functions juga tidak menjamin state lokal `/tmp` atau memori bersama antarpanggilan, sehingga alur pendaftaran RFID yang bergantung pada state scan lokal perlu diuji dengan pola instance Vercel yang digunakan.
