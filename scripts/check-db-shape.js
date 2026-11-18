const assert = require('assert');
const db = require('../data/db');

assert.strictEqual(typeof db.listWaliClasses,   'function', 'listWaliClasses harus diekspor');
assert.strictEqual(typeof db.assignWaliKelas,   'function', 'assignWaliKelas harus diekspor');
assert.strictEqual(typeof db.clearWaliKelas,    'function', 'clearWaliKelas harus diekspor');
assert.strictEqual(typeof db.findKelasByWaliId, 'function', 'findKelasByWaliId harus diekspor');

console.log('OK: semua fungsi DB baru diekspor.');
