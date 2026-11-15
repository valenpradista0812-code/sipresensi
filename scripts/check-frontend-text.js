const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const recap = fs.readFileSync(path.join(root, 'src', 'pages', 'admin', 'rekap-bulanan.html'), 'utf8');

assert.ok(!/22 Hari/.test(recap), 'Rekap tidak boleh menampilkan 22 Hari');
assert.ok(!/Oktober 2024/.test(recap), 'Rekap tidak boleh memakai default Oktober 2024');
assert.ok(!/XII IPA 1/.test(recap), 'Rekap tidak boleh hardcode kelas');
assert.ok(recap.includes('persentaseHadirSaja') || recap.includes('persentase'), 'Rekap harus membaca data persentase');

const absensi = fs.readFileSync(path.join(root, 'src', 'pages', 'admin', 'absensi.html'), 'utf8');
assert.ok(!/XII IPA 1/.test(absensi), 'Absensi tidak boleh hardcode kelas');
assert.ok(absensi.includes('canReview'), 'Absensi harus memakai canReview');

const riwayat = fs.readFileSync(path.join(root, 'src', 'pages', 'admin', 'riwayat-absensi.html'), 'utf8');
assert.ok(!/XII IPA 1/.test(riwayat), 'Riwayat tidak boleh hardcode kelas');

const dataSiswa = fs.readFileSync(path.join(root, 'src', 'pages', 'petugas', 'data-siswa.html'), 'utf8');
assert.ok(!/XII IPA 1/.test(dataSiswa), 'Data siswa tidak boleh hardcode kelas');

console.log('OK: halaman memakai data nyata dari API.');
