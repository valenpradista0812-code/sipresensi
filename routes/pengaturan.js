const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/pengaturan
router.get('/', authenticate, async (req, res) => {
  try {
    const data = await db.getPengaturan();
    res.json({ success: true, data });
  } catch (err) {
    console.error('getPengaturan error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat pengaturan.' });
  }
});

// POST /api/pengaturan
router.post('/', authenticate, requireRole('guru', 'admin'), async (req, res) => {
  try {
    const data = await db.savePengaturan(req.body);
    res.json({ success: true, message: 'Pengaturan berhasil disimpan.', data });
  } catch (err) {
    console.error('savePengaturan error:', err);
    res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan.' });
  }
});

// GET /api/pengaturan/profil-sekolah
router.get('/profil-sekolah', authenticate, async (req, res) => {
  try {
    const data = await db.getProfilSekolah();
    res.json({ success: true, data });
  } catch (err) {
    console.error('getProfilSekolah error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat profil sekolah.' });
  }
});

// POST /api/pengaturan/profil-sekolah
router.post('/profil-sekolah', authenticate, requireRole('guru', 'admin'), async (req, res) => {
  try {
    const data = await db.saveProfilSekolah(req.body);
    res.json({ success: true, message: 'Profil sekolah berhasil diperbarui.', data });
  } catch (err) {
    console.error('saveProfilSekolah error:', err);
    res.status(500).json({ success: false, message: 'Gagal menyimpan profil sekolah.' });
  }
});

module.exports = router;
