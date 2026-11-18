const assert = require('assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { normalizeRfidUid, isRfidUniqueViolation } = require('../utils/rfid-uid');

const {
  prepareCreateAccount,
  prepareEditAccount,
  findDuplicateNip,
  findDuplicateNis,
  sanitizeSearchTerm
} = require('../utils/akun-validation');

async function main() {
  // ── Pure helper checks ──────────────────────────────────────────
  assert.ok(prepareCreateAccount({ role: 'admin', name: 'A', email: 'a@b.co', password: '1234' }).error);
  assert.ok(prepareCreateAccount({ role: 'guru', name: 'Guru', email: 'guru@test.local', password: '1234' }).error, 'Guru wajib NIP+mapel');
  assert.ok(prepareCreateAccount({ role: 'siswa', name: 'Siswa', email: 'siswa@test.local', password: '1234' }).error, 'Siswa wajib NIS+kelas');
  assert.ok(prepareCreateAccount({ role: 'petugas', name: 'Petugas', email: 'bukan-email', password: '1234' }).error);

  const guruPayload = prepareCreateAccount({
    role: 'guru', name: 'Guru Baru', email: '  GURU.BARU@test.local ', password: 'rahasia',
    nip: ' NIP-9 ', mapel: ' Matematika '
  }).data;
  assert.strictEqual(guruPayload.email, 'guru.baru@test.local');
  assert.strictEqual(guruPayload.nip, 'NIP-9');
  assert.strictEqual(guruPayload.title, 'Guru Matematika');

  const siswaPayload = prepareCreateAccount({
    role: 'siswa', name: 'Siswa Baru', email: 'siswa.baru@test.local', password: 'rahasia',
    nis: 'NIS-9', kelas: 'X-1'
  }).data;
  assert.strictEqual(siswaPayload.title, 'Siswa - X-1');
  assert.strictEqual(siswaPayload.nip, null);

  assert.strictEqual(prepareEditAccount({ role: 'guru', mapel: 'Fisika' }, {}).data.title, 'Guru Fisika');
  assert.ok(prepareEditAccount({ role: 'guru' }, { email: '' }).error);
  assert.ok(prepareEditAccount({ role: 'guru' }, { nip: '' }).error);
  assert.ok(prepareEditAccount({ role: 'siswa' }, { nis: '' }).error);
  assert.ok(prepareEditAccount({ role: 'admin' }, { name: 'X' }).error, 'Role lama tidak boleh diedit lewat endpoint ini');

  assert.ok(findDuplicateNip({ users: [{ id: 'u1', nip: 'NIP-1' }], nip: 'NIP-1' }));
  assert.strictEqual(findDuplicateNip({ users: [{ id: 'u1', nip: 'NIP-1' }], nip: 'NIP-1', accountId: 'u1' }), null);
  assert.ok(findDuplicateNis({ siswaProfiles: [{ id: 's1', nis: 'NIS-1' }], nis: 'NIS-1' }));
  assert.strictEqual(findDuplicateNis({ siswaProfiles: [{ id: 's1', nis: 'NIS-1' }], nis: 'NIS-1', siswaProfileId: 's1' }), null);
  assert.strictEqual(sanitizeSearchTerm('  budi, (santoso)  '), 'budi santoso');
  assert.strictEqual(normalizeRfidUid('aa:bb:cc:dd'), 'AA-BB-CC-DD');
  assert.ok(isRfidUniqueViolation({ code: '23505', constraint: 'siswa_rfid_uid_normalized_unique' }));

  // ── Route integration with an in-memory database ────────────────
  const db = require('../data/db');
  const users = [
    { id: 'usr-petugas', email: 'petugas@test.local', name: 'Petugas', role: 'petugas', title: 'Petugas', password: bcrypt.hashSync('password123', 10) },
    { id: 'usr-guru', email: 'guru@test.local', name: 'Guru Lama', role: 'guru', title: 'Guru Biologi', password: bcrypt.hashSync('password123', 10), nip: 'NIP-1' },
    { id: 'usr-siswa', email: 'siswa@test.local', name: 'Siswa Lama', role: 'siswa', title: 'Siswa - X-2', password: bcrypt.hashSync('password123', 10), nis: 'NIS-1', kelas: 'X-2' }
  ];
  const guruProfiles = [
    { id: 'guru-1', nip: 'NIP-1', name: 'Guru Lama', mapel: 'Biologi', email: 'guru@test.local', user_id: 'usr-guru' }
  ];
  const siswaProfiles = [
    { id: 'sis-1', nis: 'NIS-1', name: 'Siswa Lama', kelas: 'X-2', email: 'siswa@test.local', rfid_uid: 'A1-B2-C3-D4' }
  ];
  const classes = ['X-1', 'X-2', 'XI-1'].map((name, index) => ({ id: `kls-${index + 1}`, name }));
  let sequence = 0;

  const clone = (value) => (value ? { ...value } : value);

  db.findUserById = async (id) => clone(users.find((user) => user.id === id)) || null;
  db.findUserByEmail = async (email) => clone(users.find((user) => user.email === String(email).toLowerCase())) || null;
  db.getUsers = async ({ role, q } = {}) => users
    .filter((user) => !role || user.role === role)
    .filter((user) => !q || [user.name, user.email, user.nip, user.nis].some((value) => String(value || '').toLowerCase().includes(String(q).toLowerCase())))
    .map((user) => clone(user));
  db.createUser = async (record) => {
    const user = { ...record, email: String(record.email).toLowerCase() };
    users.push(user);
    return clone(user);
  };
  db.updateUser = async (id, record) => {
    const user = users.find((item) => item.id === id);
    if (!user) return null;
    Object.assign(user, record);
    return clone(user);
  };
  db.deleteUserById = async (id) => {
    const index = users.findIndex((user) => user.id === id);
    if (index < 0) return null;
    return users.splice(index, 1)[0];
  };
  db.getGuru = async () => guruProfiles.map(clone);
  db.getSiswa = async () => siswaProfiles.map(clone);
  db.getKelas = async () => classes.map(clone);
  db.findKelasByName = async (name) =>
    clone(classes.find((item) => item.name.toLowerCase() === String(name).trim().toLowerCase())) || null;
  db.findGuruByUserId = async (userId) => clone(guruProfiles.find((guru) => guru.user_id === userId)) || null;
  db.findGuruByNip = async (nip) => clone(guruProfiles.find((guru) => guru.nip === nip)) || null;
  db.findSiswaByNis = async (nis) => clone(siswaProfiles.find((siswa) => siswa.nis === nis)) || null;
  db.findSiswaByRfidUid = async (uid) => clone(siswaProfiles.find((siswa) => siswa.rfid_uid === uid)) || null;
  db.addGuru = async (record) => {
    const guru = { ...record };
    guruProfiles.push(guru);
    return clone(guru);
  };
  db.updateGuru = async (id, record) => {
    const guru = guruProfiles.find((item) => item.id === id);
    if (!guru) return null;
    Object.assign(guru, record);
    return clone(guru);
  };
  db.deleteGuru = async (id) => {
    const index = guruProfiles.findIndex((guru) => guru.id === id);
    if (index < 0) return null;
    return guruProfiles.splice(index, 1)[0];
  };
  db.addSiswa = async (record) => {
    if (record.rfid_uid === 'DE-AD-BE-EF') {
      const error = new Error('duplicate key value violates unique constraint "siswa_rfid_uid_normalized_unique"');
      error.code = '23505';
      error.constraint = 'siswa_rfid_uid_normalized_unique';
      throw error;
    }
    const siswa = { ...record };
    siswaProfiles.push(siswa);
    return clone(siswa);
  };
  db.updateSiswa = async (id, record) => {
    const siswa = siswaProfiles.find((item) => item.id === id);
    if (!siswa) return null;
    Object.assign(siswa, record);
    return clone(siswa);
  };
  db.deleteSiswa = async (id) => {
    const index = siswaProfiles.findIndex((siswa) => siswa.id === id);
    if (index < 0) return null;
    return siswaProfiles.splice(index, 1)[0];
  };

  const { JWT_SECRET } = require('../middleware/auth');
  const akunRouter = require('../routes/akun');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/akun', akunRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '1h' });

  async function request(path, { method = 'GET', user = 'usr-petugas', body } = {}) {
    const headers = {};
    if (user) headers.Cookie = `sipresensi_token=${token(user)}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, json: await response.json() };
  }

  try {
    const unauthenticated = await request('/api/akun', { user: null });
    assert.strictEqual(unauthenticated.status, 401);
    const asGuru = await request('/api/akun', { user: 'usr-guru' });
    assert.strictEqual(asGuru.status, 403, 'Guru tidak boleh mengelola akun');

    const list = await request('/api/akun');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.json.data.length, 3);
    assert.strictEqual(list.json.data.find((row) => row.role === 'guru').mapel, 'Biologi');
    assert.strictEqual(list.json.data.find((row) => row.role === 'guru').hasGuruProfile, true);
    assert.strictEqual(list.json.data.find((row) => row.role === 'siswa').hasSiswaProfile, true);
    assert.ok(!('password' in list.json.data[0]), 'Hash password tidak boleh keluar API');

    const filtered = await request('/api/akun?role=guru&q=lama');
    assert.strictEqual(filtered.status, 200);
    assert.strictEqual(filtered.json.data.length, 1);

    const invalid = await request('/api/akun', {
      method: 'POST',
      body: { role: 'guru', name: 'Tanpa Mapel', email: 'x@test.local', password: '1234', nip: 'NIP-X' }
    });
    assert.strictEqual(invalid.status, 400);

    const createdGuru = await request('/api/akun', {
      method: 'POST',
      body: { role: 'guru', name: 'Guru Baru', email: 'guru.baru@test.local', password: 'rahasia1', nip: 'NIP-2', mapel: 'Matematika', phone: '0812' }
    });
    assert.strictEqual(createdGuru.status, 201, createdGuru.json.message);
    const guruAccount = users.find((user) => user.email === 'guru.baru@test.local');
    const guruProfile = guruProfiles.find((guru) => guru.nip === 'NIP-2');
    assert.ok(guruAccount && guruProfile, 'Akun dan profil guru harus dibuat');
    assert.strictEqual(guruProfile.user_id, guruAccount.id);
    assert.strictEqual(guruAccount.role, 'guru');
    assert.strictEqual(guruAccount.title, 'Guru Matematika');
    assert.notStrictEqual(guruAccount.password, 'rahasia1', 'Password harus di-hash');
    assert.ok(bcrypt.compareSync('rahasia1', guruAccount.password));

    const duplicateEmail = await request('/api/akun', {
      method: 'POST',
      body: { role: 'petugas', name: 'Duplikat', email: 'GURU.BARU@test.local', password: '1234' }
    });
    assert.strictEqual(duplicateEmail.status, 409);

    const duplicateNip = await request('/api/akun', {
      method: 'POST',
      body: { role: 'guru', name: 'Duplikat NIP', email: 'nip@test.local', password: '1234', nip: 'NIP-2', mapel: 'Fisika' }
    });
    assert.strictEqual(duplicateNip.status, 409);

    const createdSiswa = await request('/api/akun', {
      method: 'POST',
      body: { role: 'siswa', name: 'Siswa Baru', email: 'siswa.baru@test.local', password: 'rahasia2', nis: 'NIS-2', kelas: 'X-1', gender: 'Perempuan', rfid_uid: 'aa:bb:cc:dd' }
    });
    assert.strictEqual(createdSiswa.status, 201, createdSiswa.json.message);
    const siswaAccount = users.find((user) => user.email === 'siswa.baru@test.local');
    const siswaProfile = siswaProfiles.find((siswa) => siswa.nis === 'NIS-2');
    assert.ok(siswaAccount && siswaProfile, 'Akun dan profil siswa harus dibuat');
    assert.strictEqual(siswaAccount.title, 'Siswa - X-1');
    assert.strictEqual(siswaProfile.gender, 'Perempuan');
    assert.strictEqual(siswaProfile.rfid_uid, 'AA-BB-CC-DD', 'UID harus dinormalisasi dan disimpan pada profil siswa');

    const duplicateRfid = await request('/api/akun', {
      method: 'POST',
      body: { role: 'siswa', name: 'UID Duplikat', email: 'rfid-duplikat@test.local', password: 'rahasia2', nis: 'NIS-3', kelas: 'X-1', rfid_uid: 'A1-B2-C3-D4' }
    });
    assert.strictEqual(duplicateRfid.status, 409);

    const userCountBeforeRfidConflict = users.length;
    const racedRfid = await request('/api/akun', {
      method: 'POST',
      body: { role: 'siswa', name: 'RFID Race', email: 'rfid-race@test.local', password: 'rahasia2', nis: 'NIS-RACE', kelas: 'X-1', rfid_uid: 'DE-AD-BE-EF' }
    });
    assert.strictEqual(racedRfid.status, 409);
    assert.strictEqual(users.length, userCountBeforeRfidConflict, 'Akun harus dibersihkan jika constraint unik RFID menangani race');

    const updatedSiswaRfid = await request(`/api/akun/${siswaAccount.id}`, {
      method: 'PUT',
      body: { rfid_uid: '11:22:33:44' }
    });
    assert.strictEqual(updatedSiswaRfid.status, 200, updatedSiswaRfid.json.message);
    assert.strictEqual(siswaProfiles.find((siswa) => siswa.id === siswaProfile.id).rfid_uid, '11-22-33-44');
    assert.strictEqual(siswaProfiles.find((siswa) => siswa.id === 'sis-1').rfid_uid, 'A1-B2-C3-D4', 'Mengganti UID tidak boleh mengubah profil siswa lain');

    const duplicateRfidEdit = await request(`/api/akun/${siswaAccount.id}`, {
      method: 'PUT',
      body: { rfid_uid: 'A1-B2-C3-D4' }
    });
    assert.strictEqual(duplicateRfidEdit.status, 409);
    assert.strictEqual(siswaProfiles.find((siswa) => siswa.id === siswaProfile.id).rfid_uid, '11-22-33-44');

    const releasedRfid = await request(`/api/akun/${siswaAccount.id}`, {
      method: 'PUT',
      body: { rfid_uid: '' }
    });
    assert.strictEqual(releasedRfid.status, 200, releasedRfid.json.message);
    assert.strictEqual(siswaProfiles.find((siswa) => siswa.id === siswaProfile.id).rfid_uid, null, 'Lepas kartu hanya mengosongkan profil akun yang diedit');

    const duplicateNis = await request('/api/akun', {
      method: 'POST',
      body: { role: 'siswa', name: 'Duplikat NIS', email: 'nis@test.local', password: '1234', nis: 'NIS-2', kelas: 'X-1' }
    });
    assert.strictEqual(duplicateNis.status, 409);

    const createdPetugas = await request('/api/akun', {
      method: 'POST',
      body: { role: 'petugas', name: 'Petugas Baru', email: 'petugas.baru@test.local', password: 'rahasia3' }
    });
    assert.strictEqual(createdPetugas.status, 201, createdPetugas.json.message);
    assert.strictEqual(createdPetugas.json.data.hasGuruProfile, false);
    assert.strictEqual(createdPetugas.json.data.hasSiswaProfile, false);
    assert.strictEqual(guruProfiles.length, 2, 'Akun petugas tidak membuat profil');
    assert.strictEqual(siswaProfiles.length, 2, 'Akun petugas tidak membuat profil');

    const updatedGuru = await request(`/api/akun/${guruAccount.id}`, {
      method: 'PUT',
      body: { name: 'Guru Diubah', mapel: 'Fisika', password: 'baru1234' }
    });
    assert.strictEqual(updatedGuru.status, 200, updatedGuru.json.message);
    assert.strictEqual(guruProfiles.find((guru) => guru.id === guruProfile.id).mapel, 'Fisika');
    assert.strictEqual(guruProfiles.find((guru) => guru.id === guruProfile.id).name, 'Guru Diubah');
    assert.strictEqual(users.find((user) => user.id === guruAccount.id).title, 'Guru Fisika');
    assert.ok(bcrypt.compareSync('baru1234', users.find((user) => user.id === guruAccount.id).password));

    const duplicateEditEmail = await request(`/api/akun/${guruAccount.id}`, {
      method: 'PUT',
      body: { email: 'siswa@test.local' }
    });
    assert.strictEqual(duplicateEditEmail.status, 409);

    const emptyEdit = await request(`/api/akun/${guruAccount.id}`, { method: 'PUT', body: {} });
    assert.strictEqual(emptyEdit.status, 400);

    const updatedSiswa = await request(`/api/akun/${siswaAccount.id}`, {
      method: 'PUT',
      body: { kelas: 'XI-1', nama: 'diabaikan' }
    });
    assert.strictEqual(updatedSiswa.status, 200, updatedSiswa.json.message);
    assert.strictEqual(siswaProfiles.find((siswa) => siswa.id === siswaProfile.id).kelas, 'XI-1', 'Kelas profil harus tersinkron');
    assert.strictEqual(users.find((user) => user.id === siswaAccount.id).title, 'Siswa - XI-1');

    await db.updateSiswa(siswaProfile.id, { kelas: null });
    await db.updateUser(siswaAccount.id, { kelas: null, title: 'Siswa' });
    const editedUnassignedStudent = await request(`/api/akun/${siswaAccount.id}`, {
      method: 'PUT',
      body: { name: 'Siswa Belum Ditugaskan' }
    });
    assert.strictEqual(editedUnassignedStudent.status, 200, editedUnassignedStudent.json.message);
    assert.strictEqual(users.find((user) => user.id === siswaAccount.id).kelas, null);
    assert.strictEqual(users.find((user) => user.id === siswaAccount.id).title, 'Siswa');

    const selfDelete = await request('/api/akun/usr-petugas', { method: 'DELETE' });
    assert.strictEqual(selfDelete.status, 409, 'Petugas tidak boleh menghapus akun sendiri');

    const deleteSiswa = await request(`/api/akun/${siswaAccount.id}`, { method: 'DELETE' });
    assert.strictEqual(deleteSiswa.status, 200);
    assert.ok(!users.some((user) => user.id === siswaAccount.id));
    assert.ok(!siswaProfiles.some((siswa) => siswa.id === siswaProfile.id), 'Profil siswa harus ikut terhapus');

    const deleteGuru = await request(`/api/akun/${guruAccount.id}`, { method: 'DELETE' });
    assert.strictEqual(deleteGuru.status, 200);
    assert.ok(!users.some((user) => user.id === guruAccount.id));
    assert.ok(!guruProfiles.some((guru) => guru.id === guruProfile.id), 'Profil guru harus ikut terhapus');

    const deleteMissing = await request('/api/akun/tidak-ada', { method: 'DELETE' });
    assert.strictEqual(deleteMissing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('OK: manajemen akun Guru/Siswa/Petugas, validasi duplikat, sinkron profil, dan proteksi hapus berfungsi.');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('FAIL:', error);
  process.exit(1);
});
