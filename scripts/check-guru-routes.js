const assert = require('assert');
const express = require('express');
const fs = require('fs');
const { effectiveRole } = require('../middleware/role');

const router = require('../routes/guru');
const stack = router.stack.filter((layer) => layer.route);
const byMethod = (method, path) => stack.find((layer) => layer.route.path === path && layer.route.methods[method]);

const post = byMethod('post', '/');
const put = byMethod('put', '/:id');
const del = byMethod('delete', '/:id');

for (const [label, layer] of [['POST /', post], ['PUT /:id', put], ['DELETE /:id', del]]) {
  assert.ok(layer, `${label} harus terdaftar`);
  const handlers = layer.route.stack.map((s) => s.handle);
  const guard = handlers.find((h) => h.length === 3 && h.name === '');
  assert.ok(guard, `${label} harus punya guard`);
}

assert.strictEqual(effectiveRole({ role: 'admin' }), 'guru');
assert.strictEqual(effectiveRole({ role: 'petugas' }), 'petugas');

const src = fs.readFileSync(require.resolve('../routes/guru'), 'utf8');
assert.ok(!/requireRole\('admin'/.test(src), 'routes/guru.js tidak boleh menyebut admin di requireRole');
assert.ok(!/requireRole\('guru'/.test(src), 'routes/guru.js tidak boleh memberi akses guru ke write');
assert.ok((src.match(/requireRole\('petugas'\)/g) || []).length >= 3, 'POST/PUT/DELETE guru harus requireRole(petugas)');

console.log('OK: route guru hanya untuk petugas dan admin dipetakan ke guru.');