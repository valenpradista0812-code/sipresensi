const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../data/db');
const { JWT_SECRET, authenticate } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email dan kata sandi wajib diisi.' });
    }

    const user = await db.findUserByEmail(email.trim());
    if (!user) {
      return res.status(401).json({ success: false, message: 'Akun dengan email/ID tersebut tidak ditemukan.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password) || user.password === password;
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Kata sandi salah. Silakan coba lagi.' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('sipresensi_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      path: '/'
    });

    const { password: pw, ...safeUser } = user;
    const redirectUrl = user.role === 'siswa' ? '/dashboardsiswa.html' : '/dashboard.html';

    res.json({ success: true, message: `Selamat datang, ${user.name}!`, user: safeUser, redirectUrl });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server saat login.' });
  }
});

// GET & POST /api/auth/logout
router.all('/logout', (req, res) => {
  res.clearCookie('sipresensi_token', { path: '/' });
  if (req.method === 'GET') return res.redirect('/login.html');
  res.json({ success: true, message: 'Berhasil keluar.' });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

// POST /api/auth/profile (Update profile)
router.post('/profile', authenticate, async (req, res) => {
  try {
    const { name, email, phone, title } = req.body;
    const payload = {};
    if (name) payload.name = name.trim();
    if (email) payload.email = email.trim();
    if (phone !== undefined) payload.phone = phone.trim();
    if (title !== undefined) payload.title = title.trim();

    const updated = await db.updateUser(req.user.id, payload);
    const { password: _, ...safeUser } = updated || {};
    res.json({ success: true, message: 'Profil berhasil disimpan.', user: safeUser });
  } catch (err) {
    console.error('update profile error:', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui profil.' });
  }
});

// POST /api/auth/change-password (Ganti kata sandi untuk semua pengguna)
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Kata sandi lama dan kata sandi baru wajib diisi.' });
    }

    if (newPassword.length < 5) {
      return res.status(400).json({ success: false, message: 'Kata sandi baru minimal 5 karakter.' });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Konfirmasi kata sandi baru tidak cocok.' });
    }

    // Ambil data user lengkap dari database (termasuk hash password)
    const user = await db.findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Akun pengguna tidak ditemukan di database.' });
    }

    // Verifikasi kata sandi lama
    const isOldValid = bcrypt.compareSync(oldPassword, user.password) || user.password === oldPassword;
    if (!isOldValid) {
      return res.status(400).json({ success: false, message: 'Kata sandi lama yang Anda masukkan salah.' });
    }

    // Hash kata sandi baru
    const salt = bcrypt.genSaltSync(10);
    const newHashed = bcrypt.hashSync(newPassword, salt);

    // Update di database
    await db.updateUserPassword(user.id, newHashed);

    res.json({
      success: true,
      message: 'Kata sandi berhasil diperbarui! Gunakan kata sandi baru saat login selanjutnya.'
    });
  } catch (err) {
    console.error('change-password error:', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui kata sandi.' });
  }
});

module.exports = router;
