const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { effectiveRole } = require('../middleware/role');
const { resolveTeacher, getTaughtClasses } = require('../utils/teacher-access');

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
      const taught = teacher ? await getTaughtClasses(teacher.id) : [];
      list = list.filter((k) => taught.includes(k.name));
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
    const { name, totalSiswa, waliKelas, waliKelasId, ruangan } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Nama kelas wajib diisi.' });

    const cleanName = name.trim();
    const existing = await db.findKelasByName(cleanName);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Kelas dengan nama tersebut sudah ada.' });
    }

    const wali = await resolveWali(waliKelasId);
    const payload = {
      id: 'kls-' + Date.now(),
      name: cleanName,
      totalSiswa: parseInt(totalSiswa, 10) || 36,
      waliKelas: wali.waliKelas !== undefined ? wali.waliKelas : (waliKelas || 'Belum Ditentukan'),
      ruangan: ruangan || 'Gedung Sekolah'
    };
    if (waliKelasId !== undefined) payload.waliKelasId = wali.waliKelasId;

    const newClass = await db.addKelas(payload);

    res.status(201).json({ success: true, message: 'Data kelas berhasil ditambahkan.', data: mapKelas(newClass) });
  } catch (err) {
    console.error('addKelas error:', err);
    res.status(500).json({ success: false, message: 'Gagal menambahkan kelas.' });
  }
});

// PUT /api/kelas/:id
router.put('/:id', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const existing = await db.findKelasByIdOrName(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Data kelas tidak ditemukan.' });

    const { waliKelasId, ...rest } = req.body;
    const payload = { ...rest };

    if (waliKelasId !== undefined) {
      const wali = await resolveWali(waliKelasId);
      payload.waliKelasId = wali.waliKelasId;
      if (wali.waliKelas !== undefined) payload.waliKelas = wali.waliKelas;
    }

    const updated = await db.updateKelas(existing.id, payload);
    if (!updated) return res.status(404).json({ success: false, message: 'Data kelas tidak ditemukan.' });

    res.json({ success: true, message: 'Data kelas berhasil diperbarui.', data: mapKelas(updated) });
  } catch (err) {
    console.error('updateKelas error:', err);
    if (err && err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Nama kelas sudah dipakai oleh kelas lain.' });
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