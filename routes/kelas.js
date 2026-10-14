const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/kelas
router.get('/', authenticate, async (req, res) => {
  try {
    const list = await db.getKelas();
    // Map DB column names ke camelCase
    const data = list.map(k => ({
      id:         k.id,
      name:       k.name,
      totalSiswa: k.total_siswa,
      waliKelas:  k.wali_kelas,
      ruangan:    k.ruangan
    }));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('getKelas error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data kelas.' });
  }
});

// POST /api/kelas
router.post('/', authenticate, requireRole('guru', 'admin'), async (req, res) => {
  try {
    const { name, totalSiswa, waliKelas, ruangan } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Nama kelas wajib diisi.' });

    const existing = await db.findKelasByName(name.trim());
    if (existing) {
      return res.status(400).json({ success: false, message: 'Kelas dengan nama tersebut sudah ada.' });
    }

    const newClass = await db.addKelas({
      id: 'kls-' + Date.now(),
      name: name.trim(),
      totalSiswa: parseInt(totalSiswa, 10) || 36,
      waliKelas: waliKelas || 'Belum Ditentukan',
      ruangan:   ruangan   || 'Gedung Sekolah'
    });

    res.status(201).json({ success: true, message: 'Data kelas berhasil ditambahkan.', data: newClass });
  } catch (err) {
    console.error('addKelas error:', err);
    res.status(500).json({ success: false, message: 'Gagal menambahkan kelas.' });
  }
});

// PUT /api/kelas/:id
router.put('/:id', authenticate, requireRole('guru', 'admin'), async (req, res) => {
  try {
    const updated = await db.updateKelas(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, message: 'Data kelas tidak ditemukan.' });
    res.json({ success: true, message: 'Data kelas berhasil diperbarui.', data: updated });
  } catch (err) {
    console.error('updateKelas error:', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui kelas.' });
  }
});

// DELETE /api/kelas/:id
router.delete('/:id', authenticate, requireRole('guru', 'admin'), async (req, res) => {
  try {
    const removed = await db.deleteKelas(req.params.id);
    if (!removed) return res.status(404).json({ success: false, message: 'Data kelas tidak ditemukan.' });
    res.json({ success: true, message: 'Data kelas berhasil dihapus.', data: removed });
  } catch (err) {
    console.error('deleteKelas error:', err);
    res.status(500).json({ success: false, message: 'Gagal menghapus kelas.' });
  }
});

module.exports = router;
