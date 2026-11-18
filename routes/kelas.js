const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { effectiveRole } = require('../middleware/role');
const { resolveTeacher, getAccessibleClasses } = require('../utils/teacher-access');

function mapKelas(k) {
  return {
    id:          k.id,
    name:        k.name,
    totalSiswa:  k.total_siswa,
    waliKelas:   k.wali_kelas,
    waliKelasId: k.wali_kelas_id || null,
    ruangan:     k.ruangan
  };
}

function validateKelasPayload(body, { requireName = false } = {}) {
  const payload = {};
  if (requireName || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return { error: 'Nama kelas wajib diisi.' };
    }
    if (body.name.trim().length > 50) {
      return { error: 'Nama kelas maksimal 50 karakter.' };
    }
    payload.name = body.name.trim();
  }

  for (const [field, label, maxLength] of [
    ['waliKelas', 'Nama wali kelas', 100],
    ['ruangan', 'Ruangan', 100]
  ]) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string' || body[field].trim().length > maxLength) {
        return { error: `${label} maksimal ${maxLength} karakter.` };
      }
      payload[field] = body[field].trim();
    }
  }

  return { payload };
}

function validateStudentIds(studentIds) {
  if (!Array.isArray(studentIds)) return { error: 'Daftar siswa tidak valid.' };
  if (studentIds.length > 10000) return { error: 'Jumlah siswa pilihan melebihi batas.' };
  const normalized = [];
  const seen = new Set();
  for (const id of studentIds) {
    if (typeof id !== 'string' || !id.trim() || id.trim().length > 50) {
      return { error: 'ID siswa tidak valid.' };
    }
    if (seen.has(id.trim())) return { error: 'Siswa yang sama tidak boleh dipilih lebih dari sekali.' };
    normalized.push(id.trim());
    seen.add(id.trim());
  }
  return { studentIds: normalized };
}

function writeConflict(err) {
  if (err?.code === 'PGRST202' && /save_kelas_roster/i.test(err.message || '')) {
    return { status: 503, message: 'Migrasi roster kelas belum diterapkan pada database.' };
  }
  if (/kelas_wali_kelas_id_unique/i.test(`${err?.constraint || ''} ${err?.message || ''}`)) {
    return { status: 409, message: 'Guru sudah menjadi wali kelas di kelas lain.' };
  }
  if (err?.code === '23505') {
    return { status: 409, message: 'Nama kelas sudah dipakai oleh kelas lain.' };
  }
  if (err?.code === '23514' && /WALI_KELAS_SUDAH_DIPAKAI/.test(err.message || '')) {
    return { status: 409, message: 'Guru sudah menjadi wali kelas di kelas lain.' };
  }
  if (/SISWA_TIDAK_DITEMUKAN/.test(err?.message || '')) {
    return { status: 400, message: 'Satu atau lebih siswa tidak ditemukan.' };
  }
  if (/GURU_WALI_TIDAK_DITEMUKAN/.test(err?.message || '')) {
    return { status: 400, message: 'Guru wali kelas tidak ditemukan.' };
  }
  if (err?.code === '23503') {
    return { status: 400, message: 'Relasi guru atau siswa tidak ditemukan.' };
  }
  if (err?.code === '22023') {
    return { status: 400, message: 'Data kelas atau pilihan siswa tidak valid.' };
  }
  return null;
}

async function resolveWali(waliKelasId) {
  if (!waliKelasId) return { waliKelasId: null, waliKelas: undefined };
  const teacher = await db.findGuruByIdOrNip(waliKelasId);
  if (!teacher) return { waliKelasId: null, waliKelas: undefined };
  return { waliKelasId: teacher.id, waliKelas: teacher.name };
}

// GET /api/kelas
router.get('/', authenticate, async (req, res) => {
  try {
    const role = effectiveRole(req.user);

    if (role === 'siswa') {
      return res.status(403).json({ success: false, message: 'Akses data kelas tidak tersedia untuk siswa.' });
    }

    let list = await db.getKelas();

    if (role === 'guru') {
      const teacher = await resolveTeacher(req.user);
      const { all } = teacher ? await getAccessibleClasses(teacher.id) : { all: [] };
      list = list.filter((k) => all.includes(k.name));
    }

    const data = list.map(mapKelas);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('getKelas error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data kelas.' });
  }
});

// POST /api/kelas
router.post('/', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const { waliKelasId } = req.body;
    const hasRoster = Object.prototype.hasOwnProperty.call(req.body, 'studentIds');
    const validated = validateKelasPayload(req.body, { requireName: true });
    if (validated.error) return res.status(400).json({ success: false, message: validated.error });
    const { name, waliKelas, ruangan } = validated.payload;
    const roster = hasRoster ? validateStudentIds(req.body.studentIds) : null;
    if (roster?.error) return res.status(400).json({ success: false, message: roster.error });

    const existing = await db.findKelasByName(name);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Kelas dengan nama tersebut sudah ada.' });
    }

    const wali = await resolveWali(waliKelasId);
    if (waliKelasId && !wali.waliKelasId) {
      return res.status(400).json({ success: false, message: 'Guru wali kelas tidak ditemukan.' });
    }
    if (wali.waliKelasId && await db.findKelasByWaliId(wali.waliKelasId)) {
      return res.status(409).json({ success: false, message: 'Guru sudah menjadi wali kelas di kelas lain.' });
    }
    const payload = {
      id: 'kls-' + Date.now(),
      name,
      waliKelas: wali.waliKelas !== undefined ? wali.waliKelas : (waliKelas || 'Belum Ditentukan'),
      ruangan: ruangan || 'Gedung Sekolah'
    };
    if (waliKelasId !== undefined) payload.waliKelasId = wali.waliKelasId;

    const newClass = hasRoster
      ? await db.saveKelasRoster({
        id: payload.id,
        name,
        waliKelasId: payload.waliKelasId,
        ruangan: payload.ruangan,
        studentIds: roster.studentIds,
        create: true
      })
      : await db.addKelas(payload);

    res.status(201).json({ success: true, message: 'Data kelas berhasil ditambahkan.', data: mapKelas(newClass) });
  } catch (err) {
    console.error('addKelas error:', err);
    const conflict = writeConflict(err);
    if (conflict) return res.status(conflict.status).json({ success: false, message: conflict.message });
    res.status(500).json({ success: false, message: 'Gagal menambahkan kelas.' });
  }
});

// PUT /api/kelas/:id
router.put('/:id', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const existing = await db.findKelasByIdOrName(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Data kelas tidak ditemukan.' });

    const { waliKelasId } = req.body;
    const hasRoster = Object.prototype.hasOwnProperty.call(req.body, 'studentIds');
    const validated = validateKelasPayload(req.body);
    if (validated.error) return res.status(400).json({ success: false, message: validated.error });
    const payload = validated.payload;
    const roster = hasRoster ? validateStudentIds(req.body.studentIds) : null;
    if (roster?.error) return res.status(400).json({ success: false, message: roster.error });
    if (Object.keys(payload).length === 0 && waliKelasId === undefined && !hasRoster) {
      return res.status(400).json({ success: false, message: 'Tidak ada perubahan data kelas.' });
    }

    if (waliKelasId !== undefined) {
      const wali = await resolveWali(waliKelasId);
      if (waliKelasId && !wali.waliKelasId) {
        return res.status(400).json({ success: false, message: 'Guru wali kelas tidak ditemukan.' });
      }
      if (wali.waliKelasId && await db.findKelasByWaliId(wali.waliKelasId, existing.id)) {
        return res.status(409).json({ success: false, message: 'Guru sudah menjadi wali kelas di kelas lain.' });
      }
      payload.waliKelasId = wali.waliKelasId;
      if (wali.waliKelas !== undefined) payload.waliKelas = wali.waliKelas;
    }

    const updated = hasRoster
      ? await db.saveKelasRoster({
        id: existing.id,
        name: payload.name === undefined ? existing.name : payload.name,
        waliKelasId: payload.waliKelasId === undefined ? existing.wali_kelas_id : payload.waliKelasId,
        ruangan: payload.ruangan === undefined ? existing.ruangan : payload.ruangan,
        studentIds: roster.studentIds,
        create: false
      })
      : await db.updateKelas(existing.id, payload);
    if (!updated) return res.status(404).json({ success: false, message: 'Data kelas tidak ditemukan.' });

    res.json({ success: true, message: 'Data kelas berhasil diperbarui.', data: mapKelas(updated) });
  } catch (err) {
    console.error('updateKelas error:', err);
    const conflict = writeConflict(err);
    if (conflict) return res.status(conflict.status).json({ success: false, message: conflict.message });
    if (err?.code === 'P0002' || /KELAS_TIDAK_DITEMUKAN/.test(err?.message || '')) {
      return res.status(404).json({ success: false, message: 'Data kelas tidak ditemukan.' });
    }
    res.status(500).json({ success: false, message: 'Gagal memperbarui kelas.' });
  }
});

// DELETE /api/kelas/:id
router.delete('/:id', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const existing = await db.findKelasByIdOrName(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Data kelas tidak ditemukan.' });

    const counts = await db.countKelasReferences(existing.name);
    const blockers = Object.entries(counts).filter(([, n]) => n > 0).map(([key]) => key);
    if (blockers.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Kelas masih dipakai oleh: ' + blockers.join(', ')
      });
    }

    let removed;
    try {
      removed = await db.deleteKelas(existing.id);
    } catch (err) {
      const msg = (err && err.message) || '';
      if (msg.includes('KELAS_MASIH_DIPAKAI') || (err && err.code === '23503')) {
        return res.status(409).json({
          success: false,
          message: 'Kelas masih dipakai dan tidak dapat dihapus.'
        });
      }
      if (err && err.code === '23505') {
        return res.status(409).json({ success: false, message: 'Kelas tidak dapat dihapus karena konflik data.' });
      }
      throw err;
    }

    if (!removed) return res.status(404).json({ success: false, message: 'Data kelas tidak ditemukan.' });

    res.json({ success: true, message: 'Data kelas berhasil dihapus.', data: mapKelas(removed) });
  } catch (err) {
    console.error('deleteKelas error:', err);
    res.status(500).json({ success: false, message: 'Gagal menghapus kelas.' });
  }
});

module.exports = router;