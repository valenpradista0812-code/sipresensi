const assert = require('assert');
const fs = require('fs');

const akunRoute = fs.readFileSync(require.resolve('../routes/akun'), 'utf8');
const akunValidation = fs.readFileSync(require.resolve('../utils/akun-validation'), 'utf8');
assert.ok(akunRoute.includes("requireRole('petugas')"), 'API akun harus petugas-only');
assert.ok(!/requireRole\('admin'/.test(akunRoute), 'API akun tidak boleh menyebut admin di requireRole');
assert.ok(akunRoute.includes("bcrypt.hashSync"), 'Akun harus memakai bcrypt yang sudah ada');
assert.ok(akunValidation.includes('ROLES.includes'), 'Role harus divalidasi');
assert.ok(akunRoute.includes('NIP sudah digunakan'), 'Validasi NIP duplikat harus ada');
assert.ok(akunRoute.includes('NIS/NISN sudah digunakan') || akunRoute.includes('NIS sudah terdaftar'), 'Validasi NIS duplikat harus ada');
assert.ok(akunRoute.includes('Email/username sudah digunakan'), 'Validasi email duplikat harus ada');

const siswaRoute = fs.readFileSync(require.resolve('../routes/siswa'), 'utf8');
assert.ok(siswaRoute.includes("router.post('/bulk'"), 'Bulk siswa endpoint harus ada');
assert.ok(siswaRoute.includes('createStudentAccount'), 'Logika create siswa harus di-share, bukan duplikat');
assert.ok((siswaRoute.match(/createStudentAccount\(/g) || []).length >= 2, 'createStudentAccount harus dipakai oleh POST / dan POST /bulk');
assert.ok(siswaRoute.includes('Maksimal 100 siswa'), 'Bulk harus ada batas jumlah');

const server = fs.readFileSync(require.resolve('../server'), 'utf8');
assert.ok(server.includes("require('./routes/akun')"), 'Route akun harus terdaftar di server');
assert.ok(server.includes("app.use('/api/akun', akunRoutes)"), 'Route akun harus dipasang di /api/akun');
assert.ok(server.includes("'/src/pages/petugas/data-akun.html'"), 'Halaman data-akun harus terdaftar');

const page = fs.readFileSync(require.resolve('../src/pages/petugas/data-akun.html'), 'utf8');
assert.ok(page.includes('filter-akun-role'), 'Filter role harus ada');
assert.ok(page.includes('toggleRoleFields'), 'Field dinamis per role harus ada');
assert.ok(page.includes('/api/akun'), 'Halaman harus memakai API akun');
assert.ok(page.includes('escapeHtml'), 'Data akun yang dirender harus di-escape');
assert.ok(page.includes('escapeHtml(u.name)') && page.includes('escapeHtml(u.email)'), 'Nama dan email harus di-escape saat dirender');

const jadwalRoute = fs.readFileSync(require.resolve('../routes/jadwal'), 'utf8');
const jadwalPage = fs.readFileSync(require.resolve('../src/pages/petugas/jadwal.html'), 'utf8');
assert.ok(!jadwalPage.includes('schedule-student-search'), 'Kolom pilih siswa manual pada modal jadwal harus dihilangkan');
assert.ok(!jadwalPage.includes('schedule-student-list'), 'Daftar pilih siswa manual pada modal jadwal harus dihilangkan');
assert.ok(jadwalPage.includes('syncClassStudents'), 'Siswa harus otomatis dipilih berdasarkan kelas');
assert.ok(jadwalPage.includes('siswaIds'), 'Daftar siswa otomatis harus dikirim saat menyimpan jadwal');
assert.ok(jadwalRoute.includes('resolveClassStudentIds'), 'Backend harus menghubungkan seluruh siswa kelas secara otomatis');
assert.ok(jadwalPage.includes('schedule-filler-row'), 'Tabel jadwal harus mengisi sisa baris kosong agar tinggi konsisten');
assert.ok(jadwalPage.includes('SiPresensi.confirm'), 'Hapus jadwal dan simpan jam kerja harus memakai konfirmasi bersama');
assert.ok(jadwalPage.includes('worktime-save'), 'Tombol simpan jam kerja harus punya gaya tinggi yang sejajar dengan input');

for (const [label, file] of [
  ['Data Siswa', '../src/pages/petugas/data-siswa.html'],
  ['Data Guru', '../src/pages/petugas/data-guru.html'],
  ['Manajemen Akun', '../src/pages/petugas/data-akun.html'],
  ['Data Kelas', '../src/pages/admin/data-kelas.html']
]) {
  const content = fs.readFileSync(require.resolve(file), 'utf8');
  assert.ok(content.includes('SiPresensi.confirm'), `Tombol hapus ${label} harus memakai popup konfirmasi bersama`);
  assert.ok(!/window\.confirm|!confirm\(/.test(content), `Tombol hapus ${label} tidak boleh memakai confirm bawaan browser`);
}

const perangkatPage = fs.readFileSync(require.resolve('../src/pages/petugas/perangkat-rfid.html'), 'utf8');
assert.ok(perangkatPage.includes('SiPresensi.confirm'), 'Restart ESP32 harus memakai popup konfirmasi bersama');
assert.ok(perangkatPage.includes("confirmText: 'Ya, Restart'"), 'Tombol konfirmasi restart harus berlabel Ya, Restart');
assert.ok(perangkatPage.includes('Merestart...'), 'Tombol restart harus menampilkan status proses');

const sharedCss = fs.readFileSync(require.resolve('../public/styles/shared.css'), 'utf8');
assert.ok(sharedCss.includes('.confirm-overlay'), 'Gaya popup konfirmasi bersama harus tersedia');
assert.ok(sharedCss.includes('scrollbar-width: none !important'), 'Scrollbar harus disembunyikan secara global tanpa mematikan fungsi scroll');

const dataSiswa = fs.readFileSync(require.resolve('../src/pages/petugas/data-siswa.html'), 'utf8');
assert.ok(!/id="btn-add-siswa"/.test(dataSiswa), 'Tombol tambah siswa harus dihapus dari Data Siswa');
assert.ok(dataSiswa.includes('id="filter-siswa-kelas"'), 'Filter kelas Data Siswa harus ada');
assert.ok(dataSiswa.includes('id="search-siswa-input"'), 'Pencarian Data Siswa harus ada');
assert.ok(dataSiswa.includes('fitTableHeight'), 'Tabel Data Siswa harus memakai scroll internal');
assert.ok(dataSiswa.includes('student-filler-row'), 'Tabel Data Siswa harus mengisi sisa baris kosong');
assert.ok(dataSiswa.includes('height: 100dvh'), 'Tabel Data Siswa harus mengisi tinggi layar');
assert.ok(dataSiswa.includes('scrollbar-width: none'), 'Scrollbar tabel Data Siswa harus disembunyikan');
assert.ok(!dataSiswa.includes('VISIBLE_ROW_LIMIT'), 'Tabel Data Siswa tidak boleh dibatasi 10 baris tetap');
assert.ok(dataSiswa.includes("method: 'PUT'"), 'Data Siswa hanya boleh mengubah, bukan menambah akun');
assert.ok(dataSiswa.includes('escapeHtml'), 'Data siswa yang dirender harus di-escape');

const dataGuru = fs.readFileSync(require.resolve('../src/pages/petugas/data-guru.html'), 'utf8');
assert.ok(!/id="btn-add-guru"/.test(dataGuru), 'Tombol tambah guru harus dihapus dari Data Guru');
assert.ok(dataGuru.includes('id="filter-guru-mapel"'), 'Filter mata pelajaran Data Guru harus ada');
assert.ok(dataGuru.includes('id="search-guru-input"'), 'Pencarian Data Guru harus ada');
assert.ok(dataGuru.includes('fitTableHeight'), 'Tabel Data Guru harus memakai scroll internal');
assert.ok(dataGuru.includes('teacher-filler-row'), 'Tabel Data Guru harus mengisi sisa baris kosong');
assert.ok(dataGuru.includes('height: 100dvh'), 'Tabel Data Guru harus mengisi tinggi layar');
assert.ok(dataGuru.includes('scrollbar-width: none'), 'Scrollbar tabel Data Guru harus disembunyikan');
assert.ok(dataGuru.includes("method: 'PUT'"), 'Data Guru hanya boleh mengubah, bukan menambah guru');
assert.ok(!dataGuru.includes("method: 'POST'"), 'Data Guru tidak boleh membuat guru baru');
assert.ok(dataGuru.includes('escapeHtml'), 'Data guru yang dirender harus di-escape');

const dataAkun = fs.readFileSync(require.resolve('../src/pages/petugas/data-akun.html'), 'utf8');
assert.ok(dataAkun.includes('id="btn-add-akun"'), 'Tombol tambah akun harus tetap ada di Manajemen Akun');
assert.ok(dataAkun.includes('openAddModal'), 'Alur tambah akun harus tetap berfungsi');
assert.ok(dataAkun.includes('id="filter-akun-role"'), 'Filter peran Manajemen Akun harus ada');
assert.ok(dataAkun.includes('id="search-akun-input"'), 'Pencarian Manajemen Akun harus ada');
assert.ok(dataAkun.includes('fitTableHeight'), 'Tabel Manajemen Akun harus memakai scroll internal');
assert.ok(dataAkun.includes('account-filler-row'), 'Tabel Manajemen Akun harus mengisi sisa baris kosong');
assert.ok(dataAkun.includes('height: 100dvh'), 'Tabel Manajemen Akun harus mengisi tinggi layar');
assert.ok(dataAkun.includes('scrollbar-width: none'), 'Scrollbar tabel Manajemen Akun harus disembunyikan');
assert.ok(dataAkun.includes("method = isEdit ? 'PUT' : 'POST'"), 'Manajemen Akun harus mendukung tambah dan ubah');
assert.ok(dataAkun.includes('escapeHtml'), 'Data akun yang dirender harus di-escape');

const seed = fs.readFileSync(require.resolve('../scripts/seed-dummy'), 'utf8');
assert.ok(seed.includes('dev.sipresensi.test'), 'Seed harus memakai domain penanda dummy');
assert.ok(seed.includes('findSiswaByNis') || seed.includes('findGuruByNip'), 'Seed harus idempoten (cek existing)');
assert.ok(!/DELETE FROM/i.test(seed), 'Seed tidak boleh menghapus data');

const sidebar = fs.readFileSync(require.resolve('../public/components/petugas/sidebar-content.html'), 'utf8');
assert.ok(sidebar.includes('data-akun.html'), 'Sidebar petugas harus memuat link Manajemen Akun');

console.log('OK: fitur akun, multi-select siswa, dan seed dummy terpasang dengan benar.');