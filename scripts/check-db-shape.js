const assert = require('assert');
const db = require('../data/db');

for (const name of ['findGuruByUserId', 'listTaughtClasses', 'isWaliKelas', 'getKelasWaliId']) {
  assert.strictEqual(typeof db[name], 'function', `${name} harus diekspor`);
}

assert.strictEqual(db.reviewIzinApplication.length, 5, 'reviewIzinApplication harus menerima reviewerId');

console.log('OK: bentuk API db.js sesuai.');