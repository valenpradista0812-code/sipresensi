# Izin oleh Guru Pengajar + Penugasan Wali dari Manajemen Akun — Design

Tanggal: 2026-11-18
Status: menunggu persetujuan

## Intent

Saat ini pengajuan izin siswa hanya bisa disetujui wali kelas. Guru mapel yang sedang
mengajar di kelas siswa tidak mendapat tombol Setujui/Tolak, padahal dialah yang
menghadapi siswa tersebut di kelas. Selain itu, wali kelas yang tidak mengajar kelas
tersebut masih tidak melihat kelasnya di dashboard, absensi, riwayat, dan rekap karena
semua scoping guru hanya memakai `jadwal_mapel`.

Perubahan ini membuat:

- wali kelas selalu bisa melihat dan menyetujui pengajuan izin kelasnya;
- guru mapel yang **sedang mengajar** di kelas itu saat pengajuan dikirim juga bisa
  menyetujui;
- hasil persetujuan muncul di log kehadiran siswa, guru mapel, dan wali kelas;
- petugas bisa menetapkan guru sebagai wali kelas langsung dari halaman Manajemen Akun.

## Goals

- Guru yang menjadi wali kelas melihat kelasnya di semua halaman guru: dashboard,
  absensi, riwayat absensi, rekap bulanan, data siswa, dan daftar kelas.
- Pengajuan izin bisa disetujui/ditolak oleh wali kelas **atau** guru mapel yang jam
  pelajarannya sedang berlangsung saat pengajuan dibuat.
- Tombol Setujui/Tolak hanya muncul untuk guru yang berhak.
- Persetujuan tetap memakai alur yang sudah ada (`review_pengajuan_izin`) sehingga
  absensi siswa ikut tersinkron dan muncul di log siswa/guru/wali.
- Form Manajemen Akun menampilkan checkbox **Jadikan Wali Kelas** untuk role guru;
  saat dicentang muncul dropdown kelas.
- Penetapan wali menggantikan wali lama pada kelas tersebut setelah konfirmasi, dan
  memindahkan guru dari kelas wali lamanya (satu guru satu kelas wali).
- Melepas centang menghapus status wali guru tersebut.

## Non-goals

- Tidak menambah tabel, kolom, atau migrasi database baru.
- Tidak mengubah alur RFID, dispensasi, atau RPC `review_pengajuan_izin`.
- Tidak membuat halaman Manajemen Kelas baru; halaman itu punya desain terpisah.
- Tidak mengubah halaman siswa, kecuali data yang sudah ada otomatis ikut tampil.
- Tidak menambahkan notifikasi push/email; “menerima” berarti pengajuan terlihat di
  daftar izin guru yang berhak.

## Constraints & Findings

- `kelas.wali_kelas_id` sudah ada dan FK ke `guru(id) ON DELETE SET NULL`. Trigger
  `guru_name_sync_trigger` menyinkronkan `kelas.wali_kelas` dari nama guru.
- `data/db.js` `updateKelas()` belum menyimpan `wali_kelas_id`; ini harus diperbaiki
  agar penugasan wali benar-benar tersimpan.
- `data/db.js` sudah punya `findKelasByWaliId()` (belum diekspor) dan
  `listTaughtClasses()` sudah memakai `.eq('aktif', 1)`.
- Scoping guru saat ini hanya memakai kelas yang diajar. Wali yang tidak mengajar
  kelasnya mendapat `taught.length === 0` dan endpoint mengembalikan data kosong.
- `pengajuan_izin.created_at` adalah timestamp; jadwal memakai hari dan jam lokal
  (`Asia/Jakarta`).
- `routes/izin.js` sudah menggabungkan pengajuan ke daftar absensi lewat
  `getIzinApplicationsForAttendanceDate`, jadi begitu wali bisa mengakses kelasnya,
  pengajuan langsung terlihat di tabel absensi.
- Approve non-dispensasi menulis baris `absensi` lewat RPC. Dispensasi same-day
  berstatus `Disetujui - Menunggu Tap` sampai siswa melakukan tap RFID; selama itu
  pengajuan tetap terlihat sebagai baris izin di tabel absensi.

## Approaches

1. **Satu sumber aturan akses guru (dipilih).** Tambah `getAccessibleClasses()` di
   `utils/teacher-access.js` yang menggabungkan kelas yang diajar dan kelas yang
   diwali. Semua route guru memakai helper ini. Aturan “sedang mengajar” ditaruh di
   util murni `utils/izin-approval.js`.
   - Kelebihan: konsisten di semua endpoint, mudah diuji, tidak ada lagi halaman guru
     yang kosong karena guru hanya wali.
   - Kekurangan: menyentuh beberapa route sekaligus.

2. **Tambal hanya route izin dan absensi.** Lebih kecil, tetapi dashboard, riwayat,
   rekap, data siswa, dan dropdown kelas wali tetap kosong. Tidak memenuhi kebutuhan
   “muncul di guru wali kelas”. Ditolak.

3. **View/RPC baru di database untuk akses guru dan kelayakan approve.** Paling
   terpusat, tetapi membutuhkan migrasi baru yang harus dijalankan manual dan lebih
   sulit diuji. Ditolak karena skema yang ada sudah cukup.

## Design

### 1. Akses kelas guru

`data/db.js`:

- `listWaliClasses(guruId)` → daftar `{ id, name }` dari `kelas` dengan
  `wali_kelas_id = guruId`.
- Ekspor `listWaliClasses`, `assignWaliKelas`, `clearWaliKelas`, dan
  `findKelasByWaliId`.

`utils/teacher-access.js`:

- `getWaliClasses(guruId)` → array nama kelas wali.
- `getAccessibleClasses(guruId)` → `{ taught, wali, all }`; `all` adalah gabungan
  unik dari `taught` dan `wali`.
- `canAccessClass()` tetap ada untuk kompatibilitas, tetapi route baru memakai
  `getAccessibleClasses()`.
- Data lama yang membuat satu guru menjadi wali di beberapa kelas **tetap dihormati
  untuk akses**: `listWaliClasses()` mengembalikan semuanya dan `all` memuat semua
  kelas itu. Aturan satu guru satu kelas wali hanya ditegakkan saat penugasan baru
  disimpan. Form Manajemen Akun menampilkan kelas pertama (urut nama) dan
  menyimpan ulang akan merapikannya menjadi satu kelas.

Route yang memakai `all`:

| Route | Perubahan |
|---|---|
| `GET /api/kelas` | Guru melihat kelas yang diajar + kelas yang diwali. |
| `GET /api/absensi` | Default kelas: kelas yang diajar dulu, lalu kelas wali. Kelas di luar `all` → 403. Tidak ada `all` → daftar kosong. |
| `GET /api/absensi/riwayat` | Semua kelas `all`; filter kelas di luar `all` → 403. |
| `GET /api/absensi/rekap-bulanan` | Siswa dari kelas `all`; filter kelas di luar `all` → 403. Jika `kelas` dipilih, hanya kelas itu. |
| `GET /api/stats/overview` | Statistik, grafik mingguan, dan absensi terbaru memakai `all`. |
| `GET /api/siswa` | Guru melihat siswa dari kelas `all`; filter kelas di luar `all` → 403. |
| `GET /api/izin` | Pengajuan dari kelas `all`. |

### 2. Kelayakan menyetujui izin

Aturan final (sesuai keputusan pengguna):

- **Wali kelas** dari `pengajuan_izin.kelas` selalu boleh menyetujui/menolak.
- **Guru mapel** boleh menyetujui/menolak hanya jika seluruh syarat berikut terpenuhi:
  1. guru punya jadwal aktif (`jadwal_mapel.aktif = 1`) untuk kelas tersebut;
  2. hari jadwal sama dengan hari `created_at` pengajuan dalam zona `Asia/Jakarta`;
  3. jam `created_at` berada di antara `jam_mulai` (inklusif) dan `jam_selesai`
     (eksklusif);
  4. tanggal `created_at` berada di dalam rentang `start_date`–`end_date`
     pengajuan. Dengan begitu, pengajuan untuk hari lain hanya bisa disetujui wali.

Util murni baru `utils/izin-approval.js`:

- `submissionMoment(application)` → `{ date, dayName, minutes }` dari `created_at`
  memakai `jakartaNow()`; `null` jika timestamp tidak valid.
- `scheduleCoversSubmission(schedule, moment)` → boolean.
- `isTeacherTeachingAtSubmission(application, schedules)` → boolean.
- `canReviewIzin({ isWali, application, schedules })` → boolean.
- `applicationIncludesDate(application, date)` → boolean.

`routes/izin.js`:

- `GET /`: ambil `access = getAccessibleClasses(teacher.id)` dan jadwal aktif guru
  sekali (`db.getJadwal({ guruId, activeOnly: true })`). Kelompokkan jadwal per kelas.
  Untuk setiap pengajuan:
  - `isWali = access.wali.includes(app.kelas)`;
  - `canReview = isWali || isTeacherTeachingAtSubmission(app, schedulesByClass[app.kelas])`;
  - tampilkan jika `access.all.includes(app.kelas)`.
- `GET /:id`: siswa hanya pengajuannya sendiri; guru hanya jika `access.all` memuat
  kelas pengajuan.
- `POST /:id/review`: izinkan jika wali **atau** `isTeacherTeachingAtSubmission`.
  Jika tidak, 403 dengan pesan:
  “Hanya wali kelas atau guru yang sedang mengajar di kelas ini saat pengajuan dibuat
  yang dapat mengonfirmasi.”
- Jika skema jadwal tidak tersedia, jangan gagalkan seluruh daftar izin: anggap
  jadwal kosong (guru mapel tidak bisa approve, wali tetap bisa), dan catat error.
- Race condition antar-reviewer tetap ditangani RPC (`status = 'Menunggu'` → 409).

`src/pages/admin/absensi.html`:

- Teks untuk pengajuan yang tidak bisa direview guru diganti dari
  “Hanya wali kelas” menjadi “Menunggu guru pengajar atau wali”.

### 3. Log kehadiran

Tidak ada perubahan alur tulis absensi. Setelah approve:

- RPC menulis/menyelaraskan baris `absensi` untuk izin non-dispensasi.
- Dispensasi menunggu tap RFID; selama menunggu, baris pengajuan tetap tampil di
  tabel absensi sebagai `Disetujui - Menunggu Tap`.
- Karena wali sekarang ada di `getAccessibleClasses()`, wali melihat baris tersebut
  di `/api/absensi`, riwayat, rekap, dan dashboard.
- Guru mapel sudah melihat kelas yang diajar; tidak ada perubahan pada data absensi.

### 4. Penugasan wali dari Manajemen Akun

`data/db.js`:

- `updateKelas()` menyimpan `wali_kelas_id` (string atau `null`) selain
  `wali_kelas`, dengan aturan konsisten:
  - `waliKelasId` berisi ID guru → cari nama guru lewat `findGuruByIdOrNip`, lalu
    set `wali_kelas_id` dan `wali_kelas` dari nama tersebut;
  - `waliKelasId = null` → set `wali_kelas_id = null` dan
    `wali_kelas = 'Belum Ditentukan'`;
  - key `waliKelasId` tidak dikirim → perilaku lama (hanya `wali_kelas`) tetap
    berlaku untuk kompatibilitas.
  Dengan begitu halaman `data-kelas.html` yang sudah mengirim `waliKelasId` ikut
  tersimpan benar tanpa perubahan UI, dan kolom teks tidak pernah tertinggal dari ID.
- `assignWaliKelas(kelasId, guru)`:
  1. validasi kelas ada;
  2. catat kondisi sebelumnya (wali target dan kelas wali lama guru) untuk kompensasi;
  3. set `wali_kelas_id = guru.id`, `wali_kelas = guru.name` pada kelas target;
  4. kosongkan `wali_kelas_id`/`wali_kelas` pada kelas lain yang masih memakai guru
     yang sama (satu guru satu kelas wali);
  5. jika langkah 3 atau 4 gagal, kembalikan kondisi yang tercatat di langkah 2 lalu
     lempar error. Tidak ada API transaksi di Supabase, jadi kompensasi ini yang
     menjaga invariant “satu kelas satu wali, satu guru satu kelas wali”.
- `clearWaliKelas(guruId)` → set `wali_kelas_id = null`,
  `wali_kelas = 'Belum Ditentukan'` untuk semua kelas guru tersebut.

`routes/akun.js`:

- `GET /api/akun`: untuk akun guru, tambahkan `waliKelas` dan `waliKelasId` dari
  data `kelas`. Jika data lama punya lebih dari satu, tampilkan yang pertama
  (diurutkan nama); penyimpanan berikutnya akan merapikan ke satu kelas.
- `EDITABLE_FIELDS` di `routes/akun.js` ditambah `isWaliKelas` dan `waliKelasId`
  agar request yang hanya mengubah status wali tidak ditolak dengan
  “Tidak ada perubahan yang dikirim”.
- `POST /api/akun`: terima `isWaliKelas` (boolean) dan `waliKelasId`.
  - Hanya berlaku untuk role guru.
  - Jika `true`, `waliKelasId` wajib dan kelas harus ada; setelah profil guru dibuat,
    panggil `assignWaliKelas`.
  - Jika `false`/tidak dikirim, tidak ada penugasan.
- `PUT /api/akun/:id`: terima field yang sama.
  - `isWaliKelas: true` → assign ke kelas terpilih (pindah dari kelas lama bila ada).
  - `isWaliKelas: false` → `clearWaliKelas`.
  - Field tidak dikirim → status wali tidak berubah (kompatibilitas).
- `DELETE /api/akun/:id`: tidak perlu memanggil `clearWaliKelas` lebih dulu.
  Penghapusan profil guru sudah aman: FK `wali_kelas_id ON DELETE SET NULL`
  mengosongkan ID, dan trigger `guru_name_sync_trigger` mengubah teks
  `wali_kelas` menjadi `'Belum Ditentukan'`. Jika penghapusan gagal karena guru
  masih punya jadwal aktif (409), tidak ada data wali yang berubah, jadi tidak ada
  yang perlu dipulihkan.
- Validasi input wali ditaruh di util murni `utils/akun-wali.js`
  (`parseWaliAssignment(role, body)`), supaya bisa diuji tanpa database.
- Rollback yang sudah ada tetap dipakai: jika pembuatan profil/penugasan gagal,
  akun dan profil yang baru dibuat dihapus. Karena `assignWaliKelas` sudah
  mengompensasi kegagalannya sendiri, rollback akun tidak perlu memulihkan wali
  kelas target secara terpisah. FK `ON DELETE SET NULL` dan trigger nama guru
  membersihkan sisa penugasan bila profil dihapus.

`src/pages/petugas/data-akun.html`:

- Di modal, khusus role guru, tampil:
  - checkbox **Jadikan Wali Kelas**;
  - dropdown **Kelas Wali** yang muncul hanya saat checkbox dicentang.
- Dropdown berisi semua kelas; label opsi menyebut wali saat ini, misalnya
  `X-Dev A — wali: Endang Kusuma` atau `X-Dev A — belum ada wali`.
- Saat membuka edit akun guru, checkbox dan kelas terisi dari `waliKelasId`.
- Saat menyimpan dan kelas yang dipilih sudah punya wali lain, tampilkan
  `SiPresensi.confirm`:
  “Kelas X-Dev A saat ini diwali A. Ganti wali ke B?”
- Payload guru mengirim `isWaliKelas` dan `waliKelasId` (null saat tidak dicentang).
- Kolom Kelas pada tabel akun menampilkan `Wali <nama kelas>` untuk guru yang menjadi
  wali, dan `-` untuk guru yang bukan wali.

### 5. Teks UI / alur singkat

Form akun guru:

```text
Peran Akun       [Guru v]
Nama Lengkap     [................]
Email            [................]
NIP              [................]
Mata Pelajaran   [................]
[ ] Jadikan Wali Kelas
    Kelas Wali   [X-Dev A — belum ada wali v]
No. Telepon      [................]
Kata Sandi       [................]
```

## Error Handling

- Approve oleh guru yang tidak berhak → 403 dengan pesan yang menyebut wali atau guru
  yang sedang mengajar.
- Approve pengajuan yang sudah diproses → 409 (dari RPC, tidak berubah).
- Kelas wali tidak ditemukan → 400 “Kelas wali tidak ditemukan.”
- Checkbox wali dicentang tanpa kelas → 400 “Pilih kelas wali terlebih dahulu.”
- Gagal menyimpan penugasan wali → 500; akun/profil baru di-rollback.
- Jadwal tidak tersedia → daftar izin tetap tampil; hanya tombol guru mapel yang
  tidak muncul.

## Verification

- `node scripts/check-izin-approval.js` — util waktu/hari/jam, izin hari lain hanya
  wali, wali selalu boleh.
- `node scripts/check-teacher-access.js` — `getAccessibleClasses()` menggabungkan
  kelas ajar dan kelas wali.
- `node scripts/check-wali-akun.js` — parsing input wali + assertion teks/route/UI.
- `node scripts/check-db-shape.js` — ekspor fungsi DB baru.
- Uji manual dengan akun guru:
  - guru yang hanya wali melihat kelas, siswa, absensi, riwayat, rekap, dan dashboard;
  - pengajuan izin yang dikirim saat jam pelajaran guru mapel menampilkan tombol di
    akun guru mapel dan wali;
  - pengajuan untuk hari lain hanya menampilkan tombol di wali;
  - setelah approve, baris izin/absensi terlihat di siswa, guru mapel, dan wali.
- Uji manual halaman Manajemen Akun:
  - tambah guru + wali kelas → tersimpan;
  - edit guru → checkbox dan kelas terisi;
  - ganti wali kelas yang sudah terisi → konfirmasi lalu wali lama lepas;
  - pindah guru ke kelas lain → kelas lama lepas;
  - uncheck → status wali hilang;
  - hapus akun guru wali → kelas kembali “Belum Ditentukan”;
  - hapus akun guru wali yang masih punya jadwal → 409 dan wali tidak berubah;
  - ganti wali lewat halaman Data Kelas → `wali_kelas_id` ikut tersimpan.

## Catatan Implementasi

- Tidak ada migrasi baru. Semua memakai kolom/tabel yang sudah ada.
- `findKelasByWaliId()` sudah ada di `data/db.js` tetapi belum diekspor; akan
  diekspor dan dipakai bila diperlukan untuk validasi/pengecekan.
- Desain halaman Manajemen Kelas (`2026-11-16-manajemen-kelas-petugas-design.md`)
  tetap berlaku terpisah. Form akun memakai aturan “pindah kelas” (bukan 409) sesuai
  keputusan pengguna.
