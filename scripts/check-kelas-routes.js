const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(require.resolve('../routes/kelas'), 'utf8');

assert.ok(!src.includes("requireRole('guru', 'admin')"), 'Kelas write tidak boleh membuka guru/admin');
assert.ok((src.match(/requireRole\('petugas'\)/g) || []).length >= 3, 'POST/PUT/DELETE kelas harus requireRole(petugas)');
assert.ok(src.includes('KELAS_MASIH_DIPAKAI'), 'Delete harus menangani kelas yang masih dipakai');
assert.ok(src.includes('waliKelasId'), 'Payload harus memakai waliKelasId');

console.log('OK: route kelas petugas-only dan menjaga referensi.');