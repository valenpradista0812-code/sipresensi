const assert = require('assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const {
  normalizeSiswaIds,
  validateStudentSelection,
  groupSiswaIdsByJadwal,
  isScheduleVisibleToStudent
} = require('../utils/jadwal-siswa');

async function main() {
  // ── Pure helper checks ──────────────────────────────────────────
  assert.deepStrictEqual(normalizeSiswaIds(undefined), { provided: false, ids: [] });
  assert.deepStrictEqual(normalizeSiswaIds([' a ', 'a', 'b']), { provided: true, ids: ['a', 'b'] });
  assert.ok(normalizeSiswaIds('a').error, 'String bukan array harus ditolak');

  const students = [
    { id: 'sis-1', nis: 'NIS-1', name: 'Siswa Satu', kelas: 'X-1' },
    { id: 'sis-2', nis: 'NIS-2', name: 'Siswa Dua', kelas: 'X-1' },
    { id: 'sis-9', nis: 'NIS-9', name: 'Siswa Lain', kelas: 'X-2' }
  ];
  assert.ok(validateStudentSelection(students, ['sis-9'], 'X-1').error, 'Siswa beda kelas harus ditolak');
  assert.strictEqual(validateStudentSelection(students, ['sis-1'], 'X-1').students[0].name, 'Siswa Satu');

  const grouped = groupSiswaIdsByJadwal([
    { jadwal_id: 'j1', siswa_id: 'sis-1' },
    { jadwal_id: 'j1', siswa_id: 'sis-2' }
  ]);
  assert.deepStrictEqual(grouped.get('j1'), ['sis-1', 'sis-2']);
  assert.strictEqual(isScheduleVisibleToStudent('legacy', grouped, 'sis-9'), true, 'Jadwal tanpa link berlaku untuk kelas');
  assert.strictEqual(isScheduleVisibleToStudent('j1', grouped, 'sis-2'), true);
  assert.strictEqual(isScheduleVisibleToStudent('j1', grouped, 'sis-9'), false);

  // ── Route integration with an in-memory database ────────────────
  const db = require('../data/db');
  const users = [
    { id: 'usr-petugas', email: 'petugas@test.local', name: 'Petugas', role: 'petugas' },
    { id: 'usr-guru', email: 'guru@test.local', name: 'Guru Satu', role: 'guru', nip: 'NIP-1' },
    { id: 'usr-s1', email: 's1@test.local', name: 'Siswa Satu', role: 'siswa', nis: 'NIS-1' },
    { id: 'usr-s2', email: 's2@test.local', name: 'Siswa Dua', role: 'siswa', nis: 'NIS-2' }
  ];
  const teachers = [{ id: 'guru-1', user_id: 'usr-guru', nip: 'NIP-1', name: 'Guru Satu', mapel: 'Matematika, Fisika' }];
  const classes = [{ id: 'kls-1', name: 'X-1' }, { id: 'kls-2', name: 'X-2' }];
  const studentRows = students;
  const schedules = [];
  const links = [];
  let conflictOnCreate = false;
  let scheduleSeq = 0;

  db.findUserById = async (id) => users.find((user) => user.id === id) || null;
  db.getGuru = async () => teachers;
  db.getKelas = async () => classes;
  db.getSiswaForScheduleOptions = async () => studentRows;
  db.findGuruByIdOrNip = async (value) => teachers.find((teacher) => teacher.id === value || teacher.nip === value) || null;
  db.findGuruByUserId = async (userId) => teachers.find((teacher) => teacher.user_id === userId) || null;
  db.findGuruByNip = async (nip) => teachers.find((teacher) => teacher.nip === nip) || null;
  db.findKelasByName = async (name) => classes.find((kelas) => kelas.name.toLowerCase() === String(name).toLowerCase()) || null;
  db.findSiswaByNis = async (nis) => studentRows.find((student) => student.nis === nis) || null;

  db.createJadwal = async (record) => {
    if (conflictOnCreate) {
      const error = new Error('JADWAL_GURU_CONFLICT: bentrok');
      error.code = 'P0001';
      throw error;
    }
    const row = { ...record, id: record.id || `jadwal-${++scheduleSeq}` };
    schedules.push(row);
    return row;
  };
  db.findJadwalById = async (id) => schedules.find((row) => row.id === id) || null;
  db.updateJadwal = async (id, record) => {
    const row = schedules.find((item) => item.id === id);
    if (!row) return null;
    Object.assign(row, record);
    return row;
  };
  db.deleteJadwal = async (id) => {
    const index = schedules.findIndex((row) => row.id === id);
    if (index < 0) return null;
    for (let i = links.length - 1; i >= 0; i--) if (links[i].jadwal_id === id) links.splice(i, 1);
    return schedules.splice(index, 1)[0];
  };
  db.getJadwal = async ({ hari, kelas, guruId, mapel, activeOnly } = {}) => schedules.filter((row) => {
    if (hari && row.hari !== hari) return false;
    if (kelas && row.kelas !== kelas) return false;
    if (guruId && row.guru_id !== guruId) return false;
    if (mapel && row.mapel !== mapel) return false;
    if (activeOnly && Number(row.aktif) !== 1) return false;
    return true;
  });
  db.getJadwalSiswaLinks = async (ids) => links.filter((link) => ids.includes(link.jadwal_id));
  db.replaceJadwalSiswaLinks = async (jadwalId, ids) => {
    for (let i = links.length - 1; i >= 0; i--) if (links[i].jadwal_id === jadwalId) links.splice(i, 1);
    for (const siswaId of ids) links.push({ jadwal_id: jadwalId, siswa_id: siswaId });
    return ids.map((siswaId) => ({ jadwal_id: jadwalId, siswa_id: siswaId }));
  };

  const { JWT_SECRET } = require('../middleware/auth');
  const jadwalRouter = require('../routes/jadwal');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/jadwal', jadwalRouter);

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

  const baseSchedule = {
    hari: 'Senin',
    kelas: 'X-1',
    guruId: 'guru-1',
    mapel: 'Matematika',
    jamMulai: '07:00',
    jamSelesai: '08:00'
  };

  try {
    const options = await request('/api/jadwal/options');
    assert.strictEqual(options.status, 200);
    assert.strictEqual(options.json.data.teachers.length, 1);
    assert.strictEqual(options.json.data.classes.length, 2);
    assert.strictEqual(options.json.data.students.length, 3);
    assert.strictEqual(options.json.data.students[0].nis, 'NIS-1');

    const created = await request('/api/jadwal', {
      method: 'POST',
      body: { ...baseSchedule, siswaIds: ['sis-1', 'sis-2'] }
    });
    assert.strictEqual(created.status, 201, created.json.message);
    assert.deepStrictEqual(created.json.data.siswa_ids, ['sis-1', 'sis-2']);
    assert.strictEqual(links.filter((link) => link.jadwal_id === created.json.data.id).length, 2);

    // Tanpa daftar siswa manual, backend otomatis menghubungkan seluruh siswa kelas.
    const autoCreated = await request('/api/jadwal', {
      method: 'POST',
      body: { ...baseSchedule, jamMulai: '08:00', jamSelesai: '09:00' }
    });
    assert.strictEqual(autoCreated.status, 201, autoCreated.json.message);
    assert.deepStrictEqual(autoCreated.json.data.siswa_ids, ['sis-1', 'sis-2']);
    assert.strictEqual(
      links.filter((link) => link.jadwal_id === autoCreated.json.data.id).length,
      2,
      'Seluruh siswa kelas harus terhubung otomatis'
    );
    const autoRemoved = await request(`/api/jadwal/${autoCreated.json.data.id}`, { method: 'DELETE' });
    assert.strictEqual(autoRemoved.status, 200);

    const crossClass = await request('/api/jadwal', {
      method: 'POST',
      body: { ...baseSchedule, siswaIds: ['sis-9'] }
    });
    assert.strictEqual(crossClass.status, 400);
    assert.match(crossClass.json.message, /bukan anggota kelas X-1/);

    const invalidShape = await request('/api/jadwal', {
      method: 'POST',
      body: { ...baseSchedule, siswaIds: 'sis-1' }
    });
    assert.strictEqual(invalidShape.status, 400);

    const petugasList = await request('/api/jadwal');
    assert.strictEqual(petugasList.status, 200);
    assert.deepStrictEqual(petugasList.json.data[0].siswa_ids, ['sis-1', 'sis-2']);
    assert.strictEqual(petugasList.json.data[0].siswa_count, 2);

    const updated = await request(`/api/jadwal/${created.json.data.id}`, {
      method: 'PUT',
      body: { ...baseSchedule, mapel: 'Fisika', siswaIds: ['sis-2'] }
    });
    assert.strictEqual(updated.status, 200, updated.json.message);
    assert.deepStrictEqual(updated.json.data.siswa_ids, ['sis-2']);
    assert.deepStrictEqual(links.filter((link) => link.jadwal_id === created.json.data.id).map((link) => link.siswa_id), ['sis-2']);

    // Add a legacy class-wide schedule without links.
    const legacy = await db.createJadwal({
      id: 'jadwal-legacy',
      hari: baseSchedule.hari,
      kelas: baseSchedule.kelas,
      guru_id: 'guru-1',
      nip: 'NIP-1',
      name_guru: 'Guru Satu',
      mapel: 'Fisika',
      jam_mulai: '09:00',
      jam_selesai: '10:00',
      aktif: 1
    });

    const s1List = await request('/api/jadwal', { user: 'usr-s1' });
    assert.strictEqual(s1List.status, 200);
    assert.deepStrictEqual(s1List.json.data.map((row) => row.id), [legacy.id], 'Siswa 1 hanya boleh melihat jadwal kelas tanpa link');

    const s2List = await request('/api/jadwal', { user: 'usr-s2' });
    assert.strictEqual(s2List.status, 200);
    assert.deepStrictEqual(s2List.json.data.map((row) => row.id).sort(), [created.json.data.id, legacy.id].sort());

    const guruList = await request('/api/jadwal', { user: 'usr-guru' });
    assert.strictEqual(guruList.status, 200);
    assert.strictEqual(guruList.json.data.length, 2);

    conflictOnCreate = true;
    const conflict = await request('/api/jadwal', {
      method: 'POST',
      body: { ...baseSchedule, jamMulai: '07:30', jamSelesai: '08:30' }
    });
    assert.strictEqual(conflict.status, 409, 'Bentrok jadwal harus tetap 409');
    conflictOnCreate = false;

    const removed = await request(`/api/jadwal/${created.json.data.id}`, { method: 'DELETE' });
    assert.strictEqual(removed.status, 200);
    assert.strictEqual(links.filter((link) => link.jadwal_id === created.json.data.id).length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('OK: multi-select siswa jadwal, validasi kelas, visibilitas siswa, dan bentrok jadwal berfungsi.');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('FAIL:', error);
  process.exit(1);
});
