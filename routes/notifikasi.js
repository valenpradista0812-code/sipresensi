const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate } = require('../middleware/auth');

// GET /api/notifikasi
router.get('/', authenticate, async (req, res) => {
  try {
    const list = await db.getNotifikasi();
    res.json({ success: true, count: list.length, data: list });
  } catch (err) {
    console.error('getNotifikasi error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat notifikasi.' });
  }
});

// POST /api/notifikasi/read-all
router.post('/read-all', authenticate, async (req, res) => {
  try {
    const { error } = await db.supabase
      .from('notifikasi')
      .update({ unread: false })
      .neq('id', '');

    if (error) throw error;
    const list = await db.getNotifikasi();
    res.json({ success: true, message: 'Semua notifikasi ditandai dibaca.', data: list });
  } catch (err) {
    console.error('notifikasi/read-all error:', err);
    res.status(500).json({ success: false, message: 'Gagal menandai notifikasi dibaca.' });
  }
});

module.exports = router;
