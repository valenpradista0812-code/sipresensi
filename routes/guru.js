const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/guru
router.get('/', authenticate, async (req, res) => {
  try {
    const list = await db.getGuru(req.query);
    res.json({ success: true, count: list.length, data: list });
  } catch (err) {
    console.error('getGuru error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data guru.' });
  }
});

// POST /api/guru
router.post('/', authenticate, requireRole('guru', 'admin', 'petugas'), async (req, res) => {
  try {
    const { nip, name, mapel, phone, email } = req.body;
    if (!nip || !name || !mapel) {
      return res.status(400).json({ success: false, message: 'NIP, Nama Lengkap, dan Mata Pelajaran wajib diisi.' });
    }

    const existing = await db.findGuruByNip(nip);
    if (existing) {
      return res.status(400).json({ success: false, message: 'NIP sudah terdaftar.' });
    }

    const newTeacher = await db.addGuru({
      id: 'gur-' + Date.now(),
      nip: String(nip).trim(),
      name: name.trim(),
      mapel: mapel.trim(),
      phone, email: email || `${nip}@sman1jkt.sch.id`
    });

    res.status(201).json({ success: true, message: 'Data guru berhasil ditambahkan.', data: newTeacher });
  } catch (err) {
    console.error('addGuru error:', err);
    res.status(500).json({ success: false, message: 'Gagal menambahkan data guru.' });
  }
});

// PUT /api/guru/:id
router.put('/:id', authenticate, requireRole('guru', 'admin', 'petugas'), async (req, res) => {
  try {
    const updated = await db.updateGuru(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan.' });
    res.json({ success: true, message: 'Data guru berhasil diperbarui.', data: updated });
  } catch (err) {
    console.error('updateGuru error:', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui data guru.' });
  }
});

// DELETE /api/guru/:id
router.delete('/:id', authenticate, requireRole('guru', 'admin', 'petugas'), async (req, res) => {
  try {
    const removed = await db.deleteGuru(req.params.id);
    if (!removed) return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan.' });
    res.json({ success: true, message: 'Data guru berhasil dihapus.', data: removed });
  } catch (err) {
    console.error('deleteGuru error:', err);
    res.status(500).json({ success: false, message: 'Gagal menghapus data guru.' });
  }
});

module.exports = router;
