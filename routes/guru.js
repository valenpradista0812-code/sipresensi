const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { effectiveRole } = require('../middleware/role');
const { resolveTeacher } = require('../utils/teacher-access');

// Endpoint review izin ada di routes/izin.js (POST /api/izin/:id/review).

// GET /api/guru
router.get('/', authenticate, async (req, res) => {
  try {
    const role = effectiveRole(req.user);

    if (role === 'siswa') {
      return res.status(403).json({ success: false, message: 'Akses data guru tidak tersedia untuk siswa.' });
    }

    if (role === 'guru') {
      const teacher = await resolveTeacher(req.user);
      const data = teacher ? [{ ...teacher, hasAccount: Boolean(teacher.user_id) }] : [];
      return res.json({ success: true, count: data.length, data });
    }

    const list = await db.getGuru(req.query);
    const data = list.map((row) => ({ ...row, hasAccount: Boolean(row.user_id) }));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('getGuru error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data guru.' });
  }
});

// POST /api/guru
router.post('/', authenticate, requireRole('petugas'), async (req, res) => {
  let createdTeacher = null;
  try {
    const { nip, name, mapel, phone, email, password } = req.body;
    if (!nip || !name || !mapel) {
      return res.status(400).json({ success: false, message: 'NIP, Nama Lengkap, dan Mata Pelajaran wajib diisi.' });
    }
    if (!password || String(password).trim().length < 4) {
      return res.status(400).json({ success: false, message: 'Kata sandi akun guru wajib ditentukan (minimal 4 karakter).' });
    }

    const cleanNip = String(nip).trim();
    const cleanName = name.trim();
    const cleanMapel = mapel.trim();
    const teacherEmail = (email && String(email).trim()) ? String(email).trim() : `${cleanNip}@sman1jkt.sch.id`;

    const existing = await db.findGuruByNip(cleanNip);
    if (existing) {
      return res.status(409).json({ success: false, message: 'NIP sudah terdaftar.' });
    }

    const existingUser = await db.findUserByEmailOrNis(teacherEmail, null);
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email sudah digunakan oleh akun lain.' });
    }

    const teacherId = 'guru-' + Date.now();
    createdTeacher = await db.addGuru({
      id: teacherId,
      nip: cleanNip,
      name: cleanName,
      mapel: cleanMapel,
      phone: phone ? String(phone).trim() : '-',
      email: teacherEmail
    });

    const initials = cleanName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'G';
    let account;
    try {
      account = await db.createUser({
        id: 'usr-guru-' + Date.now(),
        email: teacherEmail,
        password: bcrypt.hashSync(String(password).trim(), 10),
        name: cleanName,
        role: 'guru',
        title: `Guru ${cleanMapel}`,
        nip: cleanNip,
        phone: phone ? String(phone).trim() : '-',
        avatar: initials
      });
    } catch (accountErr) {
      console.error('createUser(guru) error:', accountErr);
      try { await db.deleteGuru(teacherId); } catch (cleanupErr) { console.error('rollback guru error:', cleanupErr); }
      return res.status(500).json({ success: false, message: 'Gagal membuat akun guru.' });
    }

    if (account && account.id) {
      try {
        const linked = await db.updateGuru(teacherId, { user_id: account.id });
        if (linked) createdTeacher = linked;
      } catch (linkErr) {
        console.error('link guru user_id error:', linkErr);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Data guru dan akun login berhasil ditambahkan.',
      data: { ...createdTeacher, hasAccount: Boolean(account && account.id) }
    });
  } catch (err) {
    console.error('addGuru error:', err);
    res.status(500).json({ success: false, message: 'Gagal menambahkan data guru.' });
  }
});

// PUT /api/guru/:id
router.put('/:id', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const current = await db.findGuruByIdOrNip(req.params.id);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan.' });
    }

    const { password, ...fields } = req.body;
    const payload = {};
    for (const key of ['nip', 'name', 'mapel', 'phone', 'email']) {
      if (fields[key] !== undefined) payload[key] = fields[key];
    }

    let updated = current;
    if (Object.keys(payload).length > 0) {
      updated = await db.updateGuru(current.id, payload);
      if (!updated) return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan.' });
    }

    let linkedUserId = current.user_id || null;
    if (password && String(password).trim().length >= 4) {
      if (!linkedUserId) {
        const byEmail = updated.email ? await db.findUserByEmailOrNis(updated.email, null) : null;
        const byNip = updated.nip ? await db.findUserByEmailOrNis(null, null) : null;
        linkedUserId = (byEmail && byEmail.id) || (byNip && byNip.id) || null;
        if (linkedUserId) {
          try { await db.updateGuru(updated.id, { user_id: linkedUserId }); } catch (linkErr) { console.error('link guru user_id error:', linkErr); }
        }
      }
      if (!linkedUserId) {
        return res.status(409).json({ success: false, message: 'Guru ini belum memiliki akun pengguna untuk diperbarui.' });
      }
      await db.updateUserPassword(linkedUserId, bcrypt.hashSync(String(password).trim(), 10));
    }

    res.json({
      success: true,
      message: 'Data guru berhasil diperbarui.',
      data: { ...updated, hasAccount: Boolean(linkedUserId || updated.user_id) }
    });
  } catch (err) {
    console.error('updateGuru error:', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui data guru.' });
  }
});

// DELETE /api/guru/:id
router.delete('/:id', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const current = await db.findGuruByIdOrNip(req.params.id);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan.' });
    }

    let removed;
    try {
      removed = await db.deleteGuru(current.id);
    } catch (err) {
      if (err && err.code === '23503') {
        return res.status(409).json({ success: false, message: 'Guru masih memiliki jadwal aktif dan tidak dapat dihapus.' });
      }
      throw err;
    }

    if (!removed) return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan.' });

    let warning;
    if (current.user_id) {
      try {
        await db.supabase.from('users').delete().eq('id', current.user_id);
      } catch (accountErr) {
        console.error('deleteUser(guru) error:', accountErr);
        warning = 'Data guru dihapus, tetapi akun pengguna gagal dihapus.';
      }
    }

    res.json({ success: true, message: 'Data guru berhasil dihapus.', data: removed, ...(warning ? { warning } : {}) });
  } catch (err) {
    console.error('deleteGuru error:', err);
    res.status(500).json({ success: false, message: 'Gagal menghapus data guru.' });
  }
});

module.exports = router;