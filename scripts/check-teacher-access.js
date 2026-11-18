const assert = require('assert');
const { createTeacherAccess } = require('../utils/teacher-access');

const fakeDb = {
  findGuruByUserId: async (id) => (id === 'u1' ? { id: 'g1', user_id: 'u1', nip: '111' } : null),
  findGuruByNip: async (nip) => (nip === '111' ? { id: 'g1', user_id: 'u1', nip: '111' } : null),
  listTaughtClasses: async (guruId) => (guruId === 'g1' ? ['XII IPA 1'] : []),
  isWaliKelas: async (guruId, name) => guruId === 'g1' && name === 'XII IPA 1',
  listWaliClasses: async (guruId) => guruId === 'g1' ? [{ id: 'kls-1', name: 'XII IPS 1' }] : []
};

(async () => {
  const access = createTeacherAccess(fakeDb);

  assert.deepStrictEqual(await access.resolveTeacher({ id: 'u1' }), { id: 'g1', user_id: 'u1', nip: '111' });
  assert.deepStrictEqual(await access.resolveTeacher({ id: 'u2', nip: '111' }), { id: 'g1', user_id: 'u1', nip: '111' });
  assert.strictEqual(await access.resolveTeacher({ id: 'u2' }), null);

  assert.deepStrictEqual(await access.getTaughtClasses('g1'), ['XII IPA 1']);
  assert.strictEqual(await access.isWaliOf('g1', 'XII IPA 1'), true);
  assert.strictEqual(await access.isWaliOf('g1', 'XII IPS 1'), false);

  assert.strictEqual(await access.canAccessClass({ role: 'petugas' }, null, 'XII IPS 1'), true);
  assert.strictEqual(await access.canAccessClass({ role: 'admin' }, 'g1', 'XII IPA 1'), true);
  assert.strictEqual(await access.canAccessClass({ role: 'guru' }, 'g1', 'XII IPS 1'), false);
  assert.strictEqual(await access.canAccessClass({ role: 'guru' }, 'g1', 'XII IPS 1', { allowWali: true }), false);

  // getWaliClasses
  assert.deepStrictEqual(await access.getWaliClasses('g1'), ['XII IPS 1']);
  assert.deepStrictEqual(await access.getWaliClasses('g99'), []);

  // getAccessibleClasses — g1 mengajar XII IPA 1, wali XII IPS 1
  const cls = await access.getAccessibleClasses('g1');
  assert.deepStrictEqual(cls.taught, ['XII IPA 1']);
  assert.deepStrictEqual(cls.wali,   ['XII IPS 1']);
  assert.ok(cls.all.includes('XII IPA 1') && cls.all.includes('XII IPS 1'), 'all harus gabungan');
  assert.strictEqual(cls.all.length, 2, 'tidak ada duplikat di all');

  // guru tanpa kelas ajar maupun wali
  const empty = await access.getAccessibleClasses('g99');
  assert.deepStrictEqual(empty.all, []);

  console.log('OK: teacher-access resolve, scoping, wali, dan getAccessibleClasses sesuai.');
})();