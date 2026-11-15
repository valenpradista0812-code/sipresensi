const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const absensi = read('routes/absensi.js');
assert.ok(!absensi.includes("'07:15:00'"), 'Absensi manual tidak boleh menulis jam masuk palsu');
assert.ok(!absensi.includes("'15:30:00'"), 'Absensi manual tidak boleh menulis jam pulang palsu');
assert.ok(!/totalHari\s*=\s*22/.test(absensi), 'totalHari=22 harus dihapus');
assert.ok(absensi.includes('studentDays'), 'Rekap harus memakai student-day');
assert.ok(absensi.includes('persentaseSekolah'), 'Rekap harus menyertakan persentase sekolah');

const siswa = read('routes/siswa.js');
assert.ok((siswa.match(/requireRole\('petugas'\)/g) || []).length >= 3, 'Tulis siswa harus petugas-only');

const izin = read('routes/izin.js');
assert.ok(izin.includes("router.post('/:id/review'"), 'Review izin ada di routes/izin.js');
assert.ok(izin.includes('canReview'), 'Daftar izin harus menyertakan canReview');

const guru = read('routes/guru.js');
assert.ok(!guru.includes("router.post('/:id/review'"), 'routes/guru.js tidak boleh memuat route review izin');

console.log('OK: scoping, rekap student-day, dan lokasi review izin sesuai.');
