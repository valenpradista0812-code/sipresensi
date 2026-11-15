const assert = require('assert');
const { effectiveRole } = require('../middleware/role');

assert.strictEqual(effectiveRole({ role: 'admin' }), 'guru');
assert.strictEqual(effectiveRole({ role: 'guru' }), 'guru');
assert.strictEqual(effectiveRole({ role: 'petugas' }), 'petugas');
assert.strictEqual(effectiveRole({ role: 'siswa' }), 'siswa');
assert.strictEqual(effectiveRole({ role: '  ADMIN  ' }), 'guru');
assert.strictEqual(effectiveRole({}), '');
assert.strictEqual(effectiveRole(null), '');
assert.strictEqual(effectiveRole(undefined), '');

console.log('OK: pemetaan peran efektif (admin -> guru) sesuai.');