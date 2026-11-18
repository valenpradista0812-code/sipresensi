const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(require.resolve('../routes/kelas'), 'utf8');
const db = fs.readFileSync(require.resolve('../data/db'), 'utf8');
const migration = fs.readFileSync(require.resolve('../supabase-migrations/2026111801_kelas_referential_integrity.sql'), 'utf8');
const server = fs.readFileSync(require.resolve('../server'), 'utf8');
const page = fs.readFileSync(require.resolve('../src/pages/petugas/manajemen-kelas.html'), 'utf8');
const sidebar = fs.readFileSync(require.resolve('../public/components/petugas/sidebar-content.html'), 'utf8');
const dashboard = fs.readFileSync(require.resolve('../src/pages/petugas/dashboard.html'), 'utf8');
const akunRoute = fs.readFileSync(require.resolve('../routes/akun'), 'utf8');
const siswaRoute = fs.readFileSync(require.resolve('../routes/siswa'), 'utf8');
const akunValidation = fs.readFileSync(require.resolve('../utils/akun-validation'), 'utf8');

assert.ok(!src.includes("requireRole('guru', 'admin')"), 'Kelas write tidak boleh membuka guru/admin');
assert.ok((src.match(/requireRole\('petugas'\)/g) || []).length >= 3, 'POST/PUT/DELETE kelas harus requireRole(petugas)');
assert.ok(src.includes('KELAS_MASIH_DIPAKAI'), 'Delete harus menangani kelas yang masih dipakai');
assert.ok(src.includes('waliKelasId'), 'Payload harus memakai waliKelasId');
assert.ok(src.includes('validateKelasPayload'), 'Payload kelas harus divalidasi');
assert.ok(src.includes("err.code === '23505'"), 'Nama kelas duplikat harus menghasilkan konflik');
assert.ok(db.includes("ON UPDATE CASCADE") || migration.includes('ON UPDATE CASCADE'), 'Rename kelas harus tersinkron di database');
assert.ok(migration.includes('ON DELETE RESTRICT'), 'Foreign key harus mencegah data yatim');
assert.ok(migration.includes("'kls-migrasi-' || md5(v_class.canonical_name)"), 'Referensi kelas lama harus dipulihkan sebelum foreign key dipasang');
assert.ok(migration.includes('BOOL_OR(k.id IS NOT NULL)'), 'Referensi kelas dengan perbedaan kapital/spasi harus dipetakan ke kelas yang ada');
assert.ok(migration.includes('lower(btrim(name))'), 'Nama kelas harus unik tanpa membedakan kapital/spasi tepi');
assert.ok(migration.includes('LENGTH(NEW.name) > 50'), 'Guard rename harus sesuai panjang kolom kelas');
for (const table of ['users', 'siswa', 'absensi', 'jadwal_mapel', 'pengajuan_izin']) {
  assert.ok(migration.includes(`public.${table}`), `Relasi kelas ${table} harus dimigrasikan`);
}
assert.ok(server.includes("'/src/pages/petugas/manajemen-kelas.html'"), 'Halaman harus dijaga autentikasi petugas');
assert.ok(page.includes("fetch('/api/kelas'"), 'Halaman harus membaca data dari API kelas');
assert.ok(page.includes("method: isEdit ? 'PUT' : 'POST'"), 'Halaman harus mendukung create dan update');
assert.ok(page.includes("method: 'DELETE'"), 'Halaman harus mendukung delete');
assert.ok(sidebar.includes('manajemen-kelas.html'), 'Navigasi petugas harus memuat Manajemen Kelas');
assert.ok(dashboard.includes('Manajemen Kelas'), 'Dashboard petugas harus menampilkan modul Manajemen Kelas');
assert.ok(akunRoute.includes("message: 'Kelas tidak ditemukan.'"), 'Akun siswa harus memvalidasi kelas sebelum disimpan');
assert.ok(siswaRoute.includes('db.findKelasByName(requestedKelas)'), 'Data siswa harus terhubung ke kelas yang valid');
assert.ok(akunValidation.includes('data.kelas.length > 50'), 'Validasi akun harus mendukung nama kelas hingga 50 karakter');

console.log('OK: route kelas petugas-only dan menjaga referensi.');