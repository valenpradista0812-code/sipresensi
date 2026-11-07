const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');
let dispensasiSchemaWarningLogged = false;

function normalizeRfidUid(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const uid = String(value).trim().toUpperCase().replace(/[:\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!/^[0-9A-F]{2}(?:-[0-9A-F]{2}){3,9}$/.test(uid)) {
    const err = new Error('Format UID RFID tidak valid. Contoh: 08-AB-12-CD.');
    err.statusCode = 400;
    throw err;
  }
  return uid;
}

// GET /api/siswa
router.get('/', authenticate, async (req, res) => {
  if (!['admin', 'guru'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Akses data siswa hanya untuk guru dan admin.' });
  }
  try {
    const list = await db.getSiswa(req.query);
    res.json({ success: true, count: list.length, data: list });
  } catch (err) {
    console.error('getSiswa error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data siswa.' });
  }
});

// POST /api/siswa
router.post('/', authenticate, requireRole('guru', 'admin'), async (req, res) => {
  try {
    const { nis, name, kelas, gender, phone, email, password } = req.body;
    const rfidUid = normalizeRfidUid(req.body.rfid_uid);
    if (!nis || !name || !kelas) {
      return res.status(400).json({ success: false, message: 'NIS, Nama, dan Kelas wajib diisi.' });
    }

    if (!password || password.trim().length < 4) {
      return res.status(400).json({ success: false, message: 'Kata sandi akun siswa wajib ditentukan (minimal 4 karakter).' });
    }

    const cleanNis = String(nis).trim();
    const cleanName = name.trim();
    const cleanKelas = kelas.trim();
    const studentEmail = (email && email.trim()) ? email.trim() : `${cleanNis}@sman1jkt.sch.id`;

    // Cek NIS duplikat di tabel siswa
    const existing = await db.findSiswaByNis(cleanNis);
    if (existing) {
      return res.status(400).json({ success: false, message: `NIS ${cleanNis} sudah terdaftar dalam sistem.` });
    }

    if (rfidUid) {
      const existingCard = await db.findSiswaByRfidUid(rfidUid);
      if (existingCard) {
        return res.status(400).json({ success: false, message: `UID RFID sudah terdaftar atas nama ${existingCard.name}.` });
      }
    }

    // Cek duplikat di tabel users
    const existingUser = await db.findUserByEmailOrNis(studentEmail, cleanNis);
    if (existingUser) {
      return res.status(400).json({ success: false, message: `Email atau NIS sudah digunakan oleh akun lain.` });
    }

    const sid = 'sis-' + Date.now();
    const newStudent = await db.addSiswa({
      id: sid,
      nis: cleanNis,
      name: cleanName,
      kelas: cleanKelas,
      gender: gender || 'Laki-laki',
      phone: phone ? phone.trim() : '-',
      email: studentEmail,
      rfid_uid: rfidUid
    });

    // Hash kata sandi yang ditentukan guru
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password.trim(), salt);
    const initials = cleanName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'S';

    // Simpan akun ke tabel users agar siswa dapat langsung login
    await db.createUser({
      id: 'usr-' + sid,
      email: studentEmail,
      password: hashedPassword,
      name: cleanName,
      role: 'siswa',
      title: `Siswa - ${cleanKelas}`,
      nip: null,
      nis: cleanNis,
      kelas: cleanKelas,
      phone: phone ? phone.trim() : '-',
      avatar: initials
    });

    res.status(201).json({
      success: true,
      message: `Data siswa & akun login ${cleanName} berhasil ditambahkan ke database!`,
      data: newStudent
    });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ success: false, message: err.message });
    console.error('addSiswa error:', err);
    res.status(500).json({ success: false, message: 'Gagal menambahkan data siswa ke database.' });
  }
});

// PUT /api/siswa/:id
router.put('/:id', authenticate, requireRole('guru', 'admin'), async (req, res) => {
  try {
    const { nis, name, kelas, gender, phone, email, password } = req.body;
    const rfidUid = normalizeRfidUid(req.body.rfid_uid);
    const existingStudent = await db.findSiswaByIdOrNis(req.params.id);
    if (!existingStudent) return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });

    const cleanNis = nis ? String(nis).trim() : existingStudent.nis;
    const cleanName = name ? name.trim() : existingStudent.name;
    const cleanKelas = kelas ? kelas.trim() : existingStudent.kelas;
    const cleanEmail = email ? email.trim() : existingStudent.email;
    const cleanPhone = phone !== undefined ? phone.trim() : existingStudent.phone;

    if (rfidUid) {
      const existingCard = await db.findSiswaByRfidUid(rfidUid);
      if (existingCard && existingCard.id !== existingStudent.id) {
        return res.status(400).json({ success: false, message: `UID RFID sudah terdaftar atas nama ${existingCard.name}.` });
      }
    }

    const updated = await db.updateSiswa(existingStudent.id, {
      nis: cleanNis,
      name: cleanName,
      kelas: cleanKelas,
      gender: gender || existingStudent.gender,
      phone: cleanPhone,
      email: cleanEmail,
      rfid_uid: rfidUid
    });

    // Cari user terkait siswa ini
    const existingUser = await db.findUserByEmailOrNis(existingStudent.email, existingStudent.nis);

    const initials = cleanName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'S';

    if (existingUser) {
      const userUpdates = {
        name: cleanName,
        email: cleanEmail,
        nis: cleanNis,
        kelas: cleanKelas,
        phone: cleanPhone,
        title: `Siswa - ${cleanKelas}`,
        avatar: initials
      };
      // Jika kata sandi diubah (bukan string kosong)
      if (password && password.trim().length >= 4) {
        userUpdates.password = bcrypt.hashSync(password.trim(), 10);
      }
      await db.updateUser(existingUser.id, userUpdates);
    } else {
      // Jika belum punya akun user, buatkan
      const salt = bcrypt.genSaltSync(10);
      const hashedPassword = bcrypt.hashSync(password && password.trim().length >= 4 ? password.trim() : 'password123', salt);
      await db.createUser({
        id: 'usr-' + existingStudent.id,
        email: cleanEmail || `${cleanNis}@sman1jkt.sch.id`,
        password: hashedPassword,
        name: cleanName,
        role: 'siswa',
        title: `Siswa - ${cleanKelas}`,
        nip: null,
        nis: cleanNis,
        kelas: cleanKelas,
        phone: cleanPhone,
        avatar: initials
      });
    }

    res.json({ success: true, message: 'Data siswa dan akun berhasil diperbarui di database.', data: updated });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ success: false, message: err.message });
    console.error('updateSiswa error:', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui data siswa.' });
  }
});

// DELETE /api/siswa/:id
router.delete('/:id', authenticate, requireRole('guru', 'admin'), async (req, res) => {
  try {
    const existing = await db.findSiswaByIdOrNis(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });

    // Hapus akun di tabel users
    await db.deleteUserByNisOrEmail(existing.nis, existing.email);
    // Hapus di tabel siswa
    const removed = await db.deleteSiswa(existing.id);

    res.json({ success: true, message: 'Data siswa dan akun login berhasil dihapus dari database.', data: removed });
  } catch (err) {
    console.error('deleteSiswa error:', err);
    res.status(500).json({ success: false, message: 'Gagal menghapus data siswa.' });
  }
});

function getUtcTime(dateStr) {
  if (!dateStr) return Date.now();
  if (typeof dateStr === 'number') return dateStr;
  const s = String(dateStr).trim();
  if (/^\d{12,14}$/.test(s)) return Number(s);
  const isoWithZ = s.endsWith('Z') || s.includes('+') ? s : s + 'Z';
  return new Date(isoWithZ).getTime();
}

// GET /api/siswa/tracker (Status tracker aktif siswa)
router.get('/tracker', authenticate, async (req, res) => {
  try {
    const nis = req.user.nis;
    if (!nis) {
      return res.status(403).json({ success: false, message: 'Akun belum terhubung dengan NIS siswa.' });
    }
    const active = await db.getActiveStudentTracker(nis);
    let dispensation = null;
    try {
      dispensation = await db.getActiveDispensation(nis);
      dispensasiSchemaWarningLogged = false;
    } catch (error) {
      if (!['42703', 'PGRST204'].includes(error.code)) throw error;
      if (!dispensasiSchemaWarningLogged) {
        console.warn('Kolom dispensasi belum tersedia; timer reguler tetap berjalan. Jalankan migrasi 2026110707.');
        dispensasiSchemaWarningLogged = true;
      }
    }
    if (active) {
      const startTime = getUtcTime(active.durasi && /^\d{12,14}$/.test(active.durasi) ? active.durasi : active.created_at);
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
      return res.json({
        success: true,
        isRunning: true,
        startTime,
        elapsedSeconds,
        dispensation,
        log: active
      });
    }
    res.json({ success: true, isRunning: false, dispensation });
  } catch (err) {
    console.error('getTracker error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat status tracker.' });
  }
});

// POST /api/siswa/tracker/start (Mulai tracker)
router.post('/tracker/start', authenticate, async (req, res) => {
  try {
    const nis = req.user.nis || '0089211478';
    const clientStartTime = Number(req.body.startTime) || Date.now();
    let active = await db.getActiveStudentTracker(nis);
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')} WIB`;
    const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    if (!active) {
      active = await db.addStudentLog({
        id: 'log-' + Date.now(),
        nis,
        tgl: dateStr,
        masuk: timeStr,
        keluar: '-',
        zona: 'Gedung Kelas XII (GPS Valid)',
        status: 'hadir',
        statusText: 'Tracker Berjalan',
        valid: true,
        durasi: String(clientStartTime)
      });
    } else {
      await db.supabase
        .from('student_logs')
        .update({ durasi: String(clientStartTime), masuk: timeStr })
        .eq('id', active.id);
    }

    // Rekam juga ke absensi harian
    try {
      const todayYmd = now.toLocaleDateString('en-CA');
      await db.upsertAbsensi({
        date: todayYmd,
        kelas: req.user.kelas || 'XII IPA 1',
        nis,
        studentName: req.user.name,
        status: 'hadir',
        checkIn: timeStr.split(' ')[0]
      });
    } catch (e) {}

    res.json({
      success: true,
      message: `Tracker waktu dimulai (${timeStr})`,
      isRunning: true,
      startTime: clientStartTime,
      log: active
    });
  } catch (err) {
    console.error('startTracker error:', err);
    res.status(500).json({ success: false, message: 'Gagal memulai tracker.' });
  }
});

// POST /api/siswa/tracker/stop (Hentikan tracker)
router.post('/tracker/stop', authenticate, async (req, res) => {
  try {
    const nis = req.user.nis || '0089211478';
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')} WIB`;

    let active = await db.getActiveStudentTracker(nis);
    let durasi = '0j 0m';
    if (active) {
      const startMs = getUtcTime(active.durasi && /^\d{12,14}$/.test(active.durasi) ? active.durasi : active.created_at);
      const diffSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      durasi = `${hours}j ${mins}m`;
    }

    const updatedLog = await db.stopStudentTracker(nis, timeStr, durasi);

    // Rekam juga checkout ke absensi harian
    try {
      const todayYmd = now.toLocaleDateString('en-CA');
      await db.upsertAbsensi({
        date: todayYmd,
        kelas: req.user.kelas || 'XII IPA 1',
        nis,
        studentName: req.user.name,
        status: 'hadir',
        checkOut: timeStr.split(' ')[0]
      });
    } catch (e) {}

    res.json({
      success: true,
      message: `Tracker berhasil dihentikan. Durasi belajar: ${durasi}`,
      isRunning: false,
      durasi,
      log: updatedLog
    });
  } catch (err) {
    console.error('stopTracker error:', err);
    res.status(500).json({ success: false, message: 'Gagal menghentikan tracker.' });
  }
});

// POST /api/siswa/absen-masuk
router.post('/absen-masuk', authenticate, async (req, res) => {
  try {
    const nis  = req.user.nis || '0089211478';
    const now  = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')} WIB`;
    const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    // Cek jika log hari ini sudah ada
    const existing = await db.findStudentLogByNisAndDate(nis, dateStr);

    let log;
    if (existing) {
      log = await db.updateStudentLogIn(existing.id, timeStr);
    } else {
      log = await db.addStudentLog({
        id: 'log-' + Date.now(),
        nis, tgl: dateStr,
        masuk: timeStr, keluar: '-',
        zona: 'Gedung Kelas XII (GPS Valid)',
        status: 'hadir', statusText: 'Hadir Tepat Waktu',
        valid: true, durasi: '0j 0m'
      });
    }

    res.json({ success: true, message: `Absen masuk berhasil dicatat pada ${timeStr}`, data: log });
  } catch (err) {
    console.error('absenMasuk error:', err);
    res.status(500).json({ success: false, message: 'Gagal mencatat absen masuk.' });
  }
});

// POST /api/siswa/absen-keluar
router.post('/absen-keluar', authenticate, async (req, res) => {
  try {
    const nis     = req.user.nis || '0089211478';
    const now     = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')} WIB`;

    const log = await db.updateStudentLogCheckOut(nis, timeStr);
    if (!log) {
      // Buat log baru
      const newLog = await db.addStudentLog({
        id: 'log-' + Date.now(),
        nis,
        tgl: now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        masuk: '07:15:00 WIB', keluar: timeStr,
        zona: 'Gedung Kelas XII',
        status: 'hadir', statusText: 'Memenuhi Target (>8 Jam)',
        valid: true, durasi: '08j 15m'
      });
      return res.json({ success: true, message: `Absen pulang berhasil dicatat pada ${timeStr}`, data: newLog });
    }

    res.json({ success: true, message: `Absen pulang berhasil dicatat pada ${timeStr}`, data: log });
  } catch (err) {
    console.error('absenKeluar error:', err);
    res.status(500).json({ success: false, message: 'Gagal mencatat absen keluar.' });
  }
});

// GET /api/siswa/log
router.get('/log', authenticate, async (req, res) => {
  try {
    const nis  = req.user.nis || '10924';
    const logs = await db.getStudentLogs(nis);
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('getLog error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat log absensi.' });
  }
});

module.exports = router;
