const assert = require('assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

async function main() {
  const db = require('../data/db');
  const classes = [
    { id: 'kls-1', name: 'X-1', total_siswa: 1, wali_kelas: 'Belum Ditentukan', wali_kelas_id: null, ruangan: 'R1' },
    { id: 'kls-2', name: 'X-2', total_siswa: 1, wali_kelas: 'Belum Ditentukan', wali_kelas_id: null, ruangan: 'R2' }
  ];
  const teachers = [{ id: 'guru-1', nip: 'NIP-1', name: 'Guru Satu' }];
  const students = [
    { id: 'sis-1', nis: 'NIS-1', name: 'Siswa Satu', kelas: 'X-1' },
    { id: 'sis-2', nis: 'NIS-2', name: 'Siswa Dua', kelas: 'X-2' }
  ];
  const clone = (value) => value ? { ...value } : null;

  db.findUserById = async (id) => id === 'usr-petugas'
    ? { id, email: 'petugas@test.local', name: 'Petugas', role: 'petugas' }
    : null;
  db.findKelasByName = async (name) => clone(classes.find((item) => item.name.toLowerCase() === String(name).toLowerCase()));
  db.findKelasByIdOrName = async (key) => clone(classes.find((item) => item.id === key || item.name === key));
  db.findGuruByIdOrNip = async (key) => clone(teachers.find((item) => item.id === key || item.nip === key));
  db.findKelasByWaliId = async (teacherId, excludeId) => clone(
    classes.find((item) => item.wali_kelas_id === teacherId && item.id !== excludeId)
  );
  db.saveKelasRoster = async ({ id, name, waliKelasId, ruangan, studentIds, create }) => {
    let target = create ? null : classes.find((item) => item.id === id);
    if (create) {
      target = { id, name, total_siswa: 0 };
      classes.push(target);
    }
    const previousName = target.name;
    target.name = name;
    target.wali_kelas_id = waliKelasId || null;
    target.wali_kelas = teachers.find((teacher) => teacher.id === waliKelasId)?.name || 'Belum Ditentukan';
    target.ruangan = ruangan;
    students.forEach((student) => {
      if (student.kelas === previousName && !studentIds.includes(student.id)) student.kelas = null;
      if (studentIds.includes(student.id)) student.kelas = name;
    });
    target.total_siswa = students.filter((student) => student.kelas === name).length;
    return clone(target);
  };

  const { JWT_SECRET } = require('../middleware/auth');
  const router = require('../routes/kelas');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/kelas', router);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const token = jwt.sign({ id: 'usr-petugas', role: 'petugas' }, JWT_SECRET, { expiresIn: '1h' });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, method, body) {
    const response = await fetch(base + path, {
      method,
      headers: { Cookie: `sipresensi_token=${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, json: await response.json() };
  }

  try {
    const created = await request('/api/kelas', 'POST', {
      name: 'XI-1', waliKelasId: 'guru-1', ruangan: 'R3', studentIds: ['sis-1']
    });
    assert.strictEqual(created.status, 201, created.json.message);
    assert.strictEqual(created.json.data.waliKelasId, 'guru-1');
    assert.strictEqual(created.json.data.totalSiswa, 1);
    assert.strictEqual(students.find((student) => student.id === 'sis-1').kelas, 'XI-1');

    const duplicateTeacher = await request('/api/kelas', 'POST', {
      name: 'XI-2', waliKelasId: 'guru-1', studentIds: []
    });
    assert.strictEqual(duplicateTeacher.status, 409);

    const invalidRoster = await request('/api/kelas', 'POST', {
      name: 'XI-2', studentIds: 'sis-2'
    });
    assert.strictEqual(invalidRoster.status, 400);
    const duplicateStudent = await request('/api/kelas', 'POST', {
      name: 'XI-2', studentIds: ['sis-2', 'sis-2']
    });
    assert.strictEqual(duplicateStudent.status, 400);

    const updated = await request(`/api/kelas/${encodeURIComponent(created.json.data.id)}`, 'PUT', {
      name: 'XI-1', waliKelasId: 'guru-1', ruangan: 'R4', studentIds: ['sis-2']
    });
    assert.strictEqual(updated.status, 200, updated.json.message);
    assert.strictEqual(updated.json.data.totalSiswa, 1);
    assert.strictEqual(students.find((student) => student.id === 'sis-1').kelas, null, 'Siswa yang dilepas harus menjadi belum ditugaskan');
    assert.strictEqual(students.find((student) => student.id === 'sis-2').kelas, 'XI-1', 'Siswa pilihan harus dipindahkan ke kelas tujuan');

    const migration = require('fs').readFileSync(require.resolve('../supabase-migrations/2026111901_kelas_roster_management.sql'), 'utf8');
    assert.ok(migration.includes('ALTER COLUMN kelas DROP NOT NULL'));
    assert.ok(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS kelas_wali_kelas_id_unique'));
    assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.save_kelas_roster'));
    assert.ok(migration.includes('UPDATE public.users u'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('OK: API roster kelas menyimpan wali berbasis ID, memindahkan dan melepas siswa, serta menolak wali duplikat.');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('FAIL:', error);
  process.exit(1);
});
