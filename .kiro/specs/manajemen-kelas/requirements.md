# Manajemen Kelas — Requirements

**Feature**: Class Management (Petugas Dashboard)
**Date**: 2026-11-16
**Status**: Draft

## Overview

Petugas SiPresensi perlu sebuah halaman dashboard untuk mengelola data kelas secara lengkap: membuat, mengubah, menghapus kelas, serta menetapkan dan mengganti wali kelas. Halaman ini menggunakan backend API dan database Supabase yang sudah ada, dengan UI yang konsisten dengan halaman manajemen data lainnya (Manajemen Akun, Data Siswa).

## User Stories

### 1. Lihat Daftar Kelas dan Statistik
- **Sebagai** petugas
- **Ingin** melihat daftar semua kelas dalam satu halaman
- **Sehingga** saya dapat mengelola kelas secara terpusat

**Acceptance Criteria**:
- Halaman menampilkan tiga kartu statistik: total kelas, kelas dengan wali, kelas tanpa wali
- Kartu statistik mengambil data dari database secara real-time
- Tabel menampilkan kolom: No, Nama Kelas, Tingkat (X/XI/XII), Wali Kelas, Status Wali, Total Siswa, Aksi
- Tabel dapat di-scroll secara internal dan selalu menampilkan header yang tetap (sticky)
- Tabel memiliki state: loading, empty (tidak ada data), error
- Footer tabel menampilkan jumlah kelas yang ditampilkan

### 2. Cari dan Filter Kelas
- **Sebagai** petugas dengan banyak kelas
- **Ingin** mencari kelas berdasarkan nama atau mencari berdasarkan tingkat
- **Sehingga** saya dapat menemukan kelas yang spesifik dengan cepat

**Acceptance Criteria**:
- Search input untuk mencari nama kelas atau nama wali kelas (real-time, debounce 300ms)
- Filter dropdown untuk tingkat kelas: Semua Tingkat, X, XI, XII
- Tingkat ditentukan dari prefix nama kelas (regex: `\bX{1,2}\b`)
- Ketika tidak ada hasil, tampilkan pesan "Tidak ada kelas yang cocok"
- Search dan filter bekerja bersama (AND logic)

### 3. Tambah Kelas Baru
- **Sebagai** petugas
- **Ingin** membuat kelas baru dengan nama unik, tingkat (dari prefix nama), dan opsional menetapkan wali kelas
- **Sehingga** kelas dapat digunakan untuk siswa dan absensi

**Acceptance Criteria**:
- Tombol "Tambah Kelas" membuka modal dialog
- Modal memiliki form dengan field: Nama Kelas, Tingkat (auto-detect dari nama, readonly), Wali Kelas (opsional, select guru), Total Siswa (opsional, default 36), Ruangan (opsional, default "Gedung Sekolah")
- Validasi frontend: nama wajib diisi, tidak boleh duplikat dengan kelas yang sudah ada
- Tingkat harus prefix X, XI, atau XII; validasi ditampilkan real-time saat pengguna mengetik
- Saat memilih wali kelas, hanya guru yang belum menjadi wali kelas lain yang dapat dipilih
- Tombol Simpan memanggil API POST `/api/kelas`
- Jika sukses, modal tertutup, tabel di-refresh, toast "Kelas berhasil ditambahkan"
- Jika error (409 duplikat), tampilkan pesan error di modal atau toast

### 4. Edit Data Kelas
- **Sebagai** petugas
- **Ingin** mengubah nama, tingkat, wali, atau data lain dari kelas yang sudah ada
- **Sehingga** data kelas tetap akurat sesuai kebutuhan

**Acceptance Criteria**:
- Tombol "Edit" di setiap baris membuka modal edit dengan data kelas yang sudah terisi
- Field edit sama seperti tambah, tapi tombol Simpan memanggil API PUT `/api/kelas/{id}`
- Jika nama berubah, tingkat akan dihitung ulang dari prefix nama baru
- Saat memilih wali kelas baru, opsi hanya menampilkan guru yang belum menjadi wali kelas lain **atau guru saat ini**
- Jika error 409 (nama duplikat atau guru sudah jadi wali kelas lain), tampilkan pesan error
- Jika sukses, modal tertutup, tabel di-refresh, toast "Kelas berhasil diperbarui"

### 5. Hapus Kelas
- **Sebagai** petugas
- **Ingin** menghapus kelas yang sudah tidak dipakai
- **Sehingga** data kelas tetap bersih dan terorganisir

**Acceptance Criteria**:
- Tombol "Hapus" di setiap baris membuka dialog konfirmasi
- Dialog konfirmasi menampilkan: nama kelas, pesan "Kelas akan dihapus secara permanen"
- Jika user klik "Ya, Hapus", API DELETE `/api/kelas/{id}` dipanggil
- Jika error 409 (kelas masih dipakai oleh siswa, absensi, jadwal, atau izin), tampilkan pesan error berisi relasi yang menghalangi
- Jika sukses, tombol hapus di-disable sementara, tabel di-refresh, toast "Kelas berhasil dihapus"

### 6. Kelola Wali Kelas
- **Sebagai** petugas
- **Ingin** menetapkan, melihat, atau mengganti wali kelas
- **Sehingga** setiap kelas memiliki wali yang jelas atau dapat ditandai "Belum ada wali"

**Acceptance Criteria**:
- Kolom "Wali Kelas" menampilkan nama guru atau "Belum Ditentukan"
- Kolom "Status Wali" menampilkan badge: "Ada wali" (hijau) atau "Belum ada wali" (abu-abu)
- Dalam modal edit, field "Wali Kelas" adalah select dropdown
- Dropdown menampilkan "Tanpa wali" + daftar guru yang belum menjadi wali kelas lain (atau guru saat ini)
- Jika dipilih "Tanpa wali", `wali_kelas` di-set ke "Belum Ditentukan" dan `wali_kelas_id` di-set ke null
- Jika user mencoba mengubah wali ke guru yang sudah menjadi wali kelas lain, backend akan return 409 dengan pesan berisi nama kelas yang sudah pakai guru tersebut
- Perubahan wali disimpan via API dan di-sync ke dropdown di halaman siswa, absensi, akun

## Integration Points

### Related Pages & Features
- **data-siswa.html**: Dropdown kelas harus ter-update real-time saat kelas ditambah/ubah/hapus
- **absensi.html**: Filter kelas harus ter-update
- **akun.html**: Dropdown kelas untuk siswa harus ter-update
- **jadwal.html**: Kelas yang direferensikan harus konsisten
- **izin.html**: Filter kelas harus ter-update

### Backend Endpoints
- `GET /api/kelas?q=&tingkat=` — Ambil daftar kelas dengan filter dan stats
- `POST /api/kelas` — Tambah kelas baru
- `PUT /api/kelas/{id}` — Update kelas
- `DELETE /api/kelas/{id}` — Hapus kelas
- `GET /api/guru` — Ambil daftar guru untuk dropdown wali

### Database Tables
- `kelas`: id, name, total_siswa, wali_kelas, wali_kelas_id (FK to users), ruangan
- `siswa`: kelas (text, referensi ke kelas.name)
- `absensi`: kelas (text)
- `jadwal_mapel`: kelas (text)
- `pengajuan_izin`: kelas (text)
- `users`: id, name (guru)

## Validation Rules

### Frontend
1. **Nama Kelas**
   - Wajib diisi
   - Minimal 2 karakter, maksimal 50 karakter
   - Tidak boleh duplikat (check via API atau list yang sudah dimuat)

2. **Tingkat**
   - Auto-detect dari prefix nama: X, XI, XII
   - Jika tidak ada prefix valid, tingkat = null (tampilkan warning)
   - Readonly di modal (tidak dapat di-edit manual)

3. **Wali Kelas**
   - Opsional
   - Hanya guru yang belum menjadi wali kelas lain dapat dipilih
   - Jika dipilih guru, `wali_kelas` ditampilkan (readonly)

4. **Total Siswa**
   - Opsional, default 36
   - Harus angka > 0

5. **Ruangan**
   - Opsional, default "Gedung Sekolah"

### Backend
1. **POST /api/kelas** (requireRole: 'petugas')
   - Nama wajib diisi dan unik
   - Validasi prefix X/XI/XII
   - Jika waliKelasId disediakan, guru harus valid dan belum jadi wali kelas lain
   - Return 400 jika validasi gagal
   - Return 409 jika nama duplikat atau guru sudah jadi wali

2. **PUT /api/kelas/{id}** (requireRole: 'petugas')
   - Hanya petugas yang dapat edit
   - Nama harus unik (kecuali nama tidak berubah)
   - Jika waliKelasId berubah, check guru belum menjadi wali kelas lain
   - Return 404 jika kelas tidak ditemukan
   - Return 409 jika validasi gagal

3. **DELETE /api/kelas/{id}** (requireRole: 'petugas')
   - Check referensi di siswa, absensi, jadwal, izin
   - Jika ada referensi, return 409 dengan pesan relasi yang menghalangi
   - Hapus hanya jika no referensi

## Error Handling

| Error | HTTP | Message |
|-------|------|---------|
| Nama kelas wajib diisi | 400 | "Nama kelas wajib diisi." |
| Kelas duplikat | 409 | "Kelas dengan nama tersebut sudah ada." |
| Guru sudah jadi wali | 409 | "Guru {nama} sudah menjadi wali kelas {nama_kelas}." |
| Prefix tidak valid | 400 | "Nama kelas harus dimulai dengan X, XI, atau XII." |
| Kelas tidak ditemukan | 404 | "Data kelas tidak ditemukan." |
| Kelas masih dipakai | 409 | "Kelas masih dipakai oleh: siswa, jadwal, ..." |
| Akses ditolak (bukan petugas) | 403 | "Anda tidak memiliki akses ke halaman ini." |

## UI/UX Requirements

### Layout & Components
- Halaman mengikuti pola `data-akun.html`: `<body class="petugas admin">`, layout full-height, sidebar + topbar
- Toolbar dengan: filter tingkat, search nama/wali, tombol "Tambah Kelas"
- Kartu statistik (3 kolom): Total Kelas, Kelas dengan Wali, Kelas Tanpa Wali
- Tabel scroll internal, header sticky, footer count
- Modal inline untuk tambah/edit (putih, border-radius 12px, shadow)
- Buttons: primary (hijau), secondary (border), cancel
- Responsive: toolbar single-column di mobile, modal full-width dengan padding

### Styling
- Font: Plus Jakarta Sans (existing)
- Color palette: Supabase green (#10b981), muted (#64748b), error (#ef4444)
- Tabel: baris alternating shade, hover effect
- Badge: "Ada wali" = hijau, "Belum ada wali" = abu-abu
- Search/filter: fokus border hijau, shadow subtle

### Accessibility
- ARIA labels: filter, search, table, modal
- Focus ring pada buttons dan inputs
- Error messages linked ke form fields
- Toast notifications untuk feedback (success/error/info)
- Keyboard: Escape to close modal, Tab to navigate, Enter to submit

## Non-Functional Requirements

1. **Performance**
   - Search debounce 300ms
   - Tabel render <= 200ms untuk 100 baris
   - API response <= 500ms

2. **Security**
   - requireRole('petugas') untuk semua write endpoints
   - SQL injection: gunakan parameterized queries (Supabase)
   - CSRF: form token jika ada

3. **Consistency**
   - UI styling identik dengan data-akun.html
   - API response format sama: `{ success, message, data, count }`
   - Kolom tabel sama naming dengan backend

4. **Maintainability**
   - Code modular: helper functions untuk API calls, form handling
   - Comments untuk logic kompleks (filter tingkat, wali ganda check)
   - Test coverage untuk validasi tingkat, duplikat, referensi
