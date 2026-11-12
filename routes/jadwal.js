const express = require('express');
const crypto = require('crypto');
const db = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isMissingScheduleSchema(error) {
  return ['42P01', 'PGRST205', 'PGRST204'].includes(error.code) ||
    /jadwal_mapel|jam_pelajaran/i.test(error.message || '');
}

function sendScheduleError(res, error, fallback) {
  if (isMissingScheduleSchema(error)) {
    return res.status(503).json({
      success: false,
      message: 'Skema jadwal belum tersedia. Admin database perlu meninjau dan menerapkan 2026110709_jadwal_mapel_schema_final_rev3.sql.'
    });
  }
  if (/JADWAL_(GURU|KELAS)_CONFLICT|JADWAL_KELAS_INVALID/.test(error.message || '') ||
      error.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'Jadwal bertabrakan atau melanggar aturan. Periksa kembali guru, kelas, hari, dan jam.'
    });
  }
  if (/JADWAL_GURU_NOT_FOUND|JADWAL_JAM_INVALID|JADWAL_HARI_INVALID/.test(error.message || '') ||
      ['23503', '23514'].includes(error.code)) {
    return res.status(400).json({ success: false, message: 'Data guru, kelas, hari, atau waktu jadwal tidak valid.' });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
}

function subjectsForTeacher(teacher) {
  return String(teacher.mapel || '')
    .split(/[,;/]/)
    .map(subject => subject.trim())
    .filter(Boolean);
}

async function buildScheduleRecord(body, userId) {
  const { guruId, mapel, kelas, hari, jamMulai, jamSelesai, ruangan, catatan } = body || {};
  if (typeof guruId !== 'string' || !guruId.trim()) {
    return { error: 'Pilih guru pengajar.' };
  }
  if (typeof kelas !== 'string' || !kelas.trim()) {
    return { error: 'Pilih kelas.' };
  }
  if (!DAYS.includes(hari)) return { error: 'Pilih hari yang valid.' };
  if (typeof mapel !== 'string' || !mapel.trim() || mapel.trim().length > 80) {
    return { error: 'Mata pelajaran wajib dipilih (maksimal 80 karakter).' };
  }
  if (!TIME_PATTERN.test(jamMulai) || !TIME_PATTERN.test(jamSelesai) || jamSelesai <= jamMulai) {
    return { error: 'Jam selesai harus lebih besar daripada jam mulai.' };
  }
  if (ruangan !== undefined && (typeof ruangan !== 'string' || ruangan.trim().length > 100)) {
    return { error: 'Nama ruang maksimal 100 karakter.' };
  }
  if (catatan !== undefined && (typeof catatan !== 'string' || catatan.trim().length > 200)) {
    return { error: 'Catatan maksimal 200 karakter.' };
  }

  const [teacher, classRecord] = await Promise.all([
    db.findGuruByIdOrNip(guruId.trim()),
    db.findKelasByName(kelas.trim())
  ]);
  if (!teacher) return { error: 'Guru tidak ditemukan.' };
  if (!classRecord) return { error: 'Kelas tidak ditemukan.' };
  if (!subjectsForTeacher(teacher).some(subject => subject.toLowerCase() === mapel.trim().toLowerCase())) {
    return { error: 'Mata pelajaran tidak sesuai dengan data guru yang dipilih.' };
  }

  return {
    record: {
      guru_id: teacher.id,
      nip: teacher.nip,
      name_guru: teacher.name,
      mapel: mapel.trim(),
      kelas: classRecord.name,
      hari,
      jam_mulai: jamMulai,
      jam_selesai: jamSelesai,
      ruangan: ruangan?.trim() || null,
      catatan: catatan?.trim() || null,
      aktif: 1,
      created_by: userId
    }
  };
}

router.get('/options', authenticate, requireRole('admin', 'petugas'), async (req, res) => {
  try {
    const [teachers, classes] = await Promise.all([
      db.getGuru(),
      db.getKelas()
    ]);
    const subjects = [...new Set(teachers.flatMap(subjectsForTeacher))].sort((a, b) => a.localeCompare(b, 'id'));
    return res.json({ success: true, data: { teachers, classes, subjects } });
  } catch (error) {
    return sendScheduleError(res, error, 'Gagal memuat pilihan jadwal.');
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const filters = {
      hari: DAYS.includes(req.query.hari) ? req.query.hari : undefined,
      kelas: typeof req.query.kelas === 'string' ? req.query.kelas : undefined,
      mapel: typeof req.query.mapel === 'string' ? req.query.mapel : undefined,
      guruId: (req.user.role === 'admin' || req.user.role === 'petugas') && typeof req.query.guruId === 'string' ? req.query.guruId : undefined
    };
    let activeOnly = false;

    if (req.user.role === 'guru') {
      if (!req.user.nip) {
        return res.status(403).json({ success: false, message: 'Akun guru belum memiliki NIP untuk menghubungkan jadwal.' });
      }
      const teacher = await db.findGuruByNip(req.user.nip);
      if (!teacher) {
        return res.status(403).json({ success: false, message: 'Akun guru tidak terhubung dengan data guru.' });
      }
      filters.guruId = teacher.id;
      activeOnly = true;
    } else if (req.user.role === 'siswa') {
      if (!req.user.nis) {
        return res.status(403).json({ success: false, message: 'Akun siswa belum memiliki NIS.' });
      }
      const student = await db.findSiswaByNis(req.user.nis);
      if (!student?.kelas) {
        return res.status(403).json({ success: false, message: 'Akun siswa belum terhubung dengan data kelas.' });
      }
      filters.kelas = student.kelas;
      activeOnly = true;
    } else if (req.user.role !== 'admin' && req.user.role !== 'petugas') {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke jadwal.' });
    }

    const data = await db.getJadwal({ ...filters, activeOnly });
    return res.json({ success: true, count: data.length, data });
  } catch (error) {
    return sendScheduleError(res, error, 'Gagal memuat jadwal.');
  }
});

router.post('/', authenticate, requireRole('admin', 'petugas'), async (req, res) => {
  try {
    const result = await buildScheduleRecord(req.body, req.user.id);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    const data = await db.createJadwal({ id: `jadwal-${crypto.randomUUID()}`, ...result.record });
    return res.status(201).json({ success: true, message: 'Jadwal berhasil ditambahkan.', data });
  } catch (error) {
    return sendScheduleError(res, error, 'Gagal menambahkan jadwal.');
  }
});

router.put('/:id', authenticate, requireRole('admin', 'petugas'), async (req, res) => {
  try {
    const result = await buildScheduleRecord(req.body, req.user.id);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    const data = await db.updateJadwal(req.params.id, result.record);
    if (!data) return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan.' });
    return res.json({ success: true, message: 'Jadwal berhasil diperbarui.', data });
  } catch (error) {
    return sendScheduleError(res, error, 'Gagal memperbarui jadwal.');
  }
});

router.delete('/:id', authenticate, requireRole('admin', 'petugas'), async (req, res) => {
  try {
    const deleted = await db.deleteJadwal(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan.' });
    return res.json({ success: true, message: 'Jadwal berhasil dihapus.' });
  } catch (error) {
    return sendScheduleError(res, error, 'Gagal menghapus jadwal.');
  }
});

module.exports = router;
