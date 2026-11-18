const assert = require('assert');
const { parseWaliAssignment } = require('../utils/akun-wali');

// bukan guru → skip
assert.deepStrictEqual(parseWaliAssignment('siswa', { isWaliKelas: true, waliKelasId: 'kls-1' }), { skip: true });

// guru, isWaliKelas tidak dikirim → skip
assert.deepStrictEqual(parseWaliAssignment('guru', {}), { skip: true });

// guru, isWaliKelas: true tanpa kelasId → error
const e = parseWaliAssignment('guru', { isWaliKelas: true });
assert.ok(e.error, 'harus error jika tanpa kelasId');

// guru, isWaliKelas: true dengan kelasId → assign
assert.deepStrictEqual(parseWaliAssignment('guru', { isWaliKelas: true, waliKelasId: 'kls-1' }), { assign: true, kelasId: 'kls-1' });

// guru, isWaliKelas: false → clear
assert.deepStrictEqual(parseWaliAssignment('guru', { isWaliKelas: false }), { clear: true });

console.log('OK: parseWaliAssignment semua kasus lulus.');
