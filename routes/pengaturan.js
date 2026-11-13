const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { timeToMinutes } = require('../utils/jam-kerja');

function validateJamKerja(body, current) {
  if (body.jamMasuk !== undefined && timeToMinutes(body.jamMasuk) === null) {
    return 'Format jam masuk harus HH:MM, contoh 07:00.';
  }
  if (body.jamPulang !== undefined && timeToMinutes(body.jamPulang) === null) {
    return 'Format jam pulang harus HH:MM, contoh 15:00.';
  }
  const jamMasuk = body.jamMasuk !== undefined ? timeToMinutes(body.jamMasuk) : timeToMinutes(current.jamMasuk);
  const jamPulang = body.jamPulang !== undefined ? timeToMinutes(body.jamPulang) : timeToMinutes(current.jamPulang);
  if (jamMasuk !== null && jamPulang !== null && jamPulang <= jamMasuk) {
    return 'Jam pulang harus lebih besar daripada jam masuk.';
  }
  return null;
}

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
router.post('/', authenticate, requireRole('guru', 'admin', 'petugas'), async (req, res) => {
  try {
    const current = await db.getPengaturan();
    const validationError = validateJamKerja(req.body, current);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
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
