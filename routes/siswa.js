const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { jakartaNow, readJamKerja, statusMasuk } = require('../utils/jam-kerja');
let dispensasiSchemaWarningLogged = false;

async function aturanJamKerja() {
  const settings = await db.getPengaturan().catch(() => ({}));
  return { now: jakartaNow(), ...readJamKerja(settings) };
}

async function validasiAbsenMasuk(nis, kelas) {
  const aturan = await aturanJamKerja();
  const todayAbsensi = await db.findAbsensiByNisDate(nis, aturan.now.date, kelas);
  if (todayAbsensi && todayAbsensi.check_out && todayAbsensi.check_out !== '-') {
    return { error: { status: 409, message: 'Absensi pulang hari ini sudah tercatat.' } };
  }
  const active = await db.getActiveStudentTracker(nis);
  if (active || (todayAbsensi && todayAbsensi.check_in && todayAbsensi.check_in !== '-')) {
    return { error: { status: 409, message: 'Siswa sudah absen masuk hari ini.' } };
  }
  if (aturan.now.minutes > aturan.jamPulang) {
    return { error: { status: 425, message: `Sudah melewati jam pulang (${aturan.jamPulangLabel}).` } };
  }
  return { ...aturan, todayAbsensi, attendanceStatus: statusMasuk(aturan.now.minutes, aturan.jamMasuk) };
}

async function validasiAbsenPulang(nis, kelas) {
  const aturan = await aturanJamKerja();
  if (aturan.now.minutes < aturan.jamPulang) {
    return { error: { status: 425, message: `Belum jam pulang (${aturan.jamPulangLabel}).` } };
  }
  const todayAbsensi = await db.findAbsensiByNisDate(nis, aturan.now.date, kelas);
  return { ...aturan, todayAbsensi };
}

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
  if (!['admin', 'guru', 'petugas'].includes(req.user.role)) {
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
router.post('/', authenticate, requireRole('guru', 'admin', 'petugas'), async (req, res) => {
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
router.put('/:id', authenticate, requireRole('guru', 'admin', 'petugas'), async (req, res) => {
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
router.delete('/:id', authenticate, requireRole('guru', 'admin', 'petugas'), async (req, res) => {
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
      const startTimeMs = active.durasi && /^\d{12,14}$/.test(String(active.durasi))
        ? Number(active.durasi)
        : new Date(active.created_at).getTime();
      return res.json({
        success: true,
        isRunning: true,
        startTime: startTimeMs,
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
    const kelas = req.user.kelas || 'XII IPA 1';
    const clientStartTime = Number(req.body.startTime) || Date.now();
    const cek = await validasiAbsenMasuk(nis, kelas);
    if (cek.error) return res.status(cek.error.status).json({ success: false, message: cek.error.message });

    const timeStr = `${cek.now.time} WIB`;
    const dateStr = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(new Date());

    const active = await db.addStudentLog({
      id: 'log-' + Date.now(),
      nis,
      tgl: dateStr,
      masuk: timeStr,
      keluar: '-',
      zona: 'Gedung Kelas XII (GPS Valid)',
      status: cek.attendanceStatus,
      statusText: cek.attendanceStatus === 'terlambat' ? 'Terlambat' : 'Hadir Tepat Waktu',
      valid: true,
      durasi: String(clientStartTime)
    });

    try {
      await db.upsertAbsensi({
        date: cek.now.date,
        kelas,
        nis,
        studentName: req.user.name,
        status: cek.attendanceStatus,
        checkIn: cek.now.time
      });
    } catch (e) {}

    res.json({
      success: true,
      message: `Tracker waktu dimulai (${timeStr})`,
      isRunning: true,
      startTime: clientStartTime,
      status: cek.attendanceStatus,
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
    const kelas = req.user.kelas || 'XII IPA 1';
    const cek = await validasiAbsenPulang(nis, kelas);
    if (cek.error) return res.status(cek.error.status).json({ success: false, message: cek.error.message });
    const timeStr = `${cek.now.time} WIB`;

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

    // Rekam checkout tanpa menimpa status/check-in sebelumnya.
    try {
      await db.upsertAbsensi({
        date: cek.now.date,
        kelas,
        nis,
        studentName: req.user.name,
        checkOut: cek.now.time
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
    const nis = req.user.nis || '0089211478';
    const kelas = req.user.kelas || 'XII IPA 1';
    const cek = await validasiAbsenMasuk(nis, kelas);
    if (cek.error) return res.status(cek.error.status).json({ success: false, message: cek.error.message });

    const timeStr = `${cek.now.time} WIB`;
    const dateStr = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(new Date());

    const log = await db.addStudentLog({
      id: 'log-' + Date.now(),
      nis, tgl: dateStr,
      masuk: timeStr, keluar: '-',
      zona: 'Gedung Kelas XII (GPS Valid)',
      status: cek.attendanceStatus,
      statusText: cek.attendanceStatus === 'terlambat' ? 'Terlambat' : 'Hadir Tepat Waktu',
      valid: true, durasi: '0j 0m'
    });

    await db.upsertAbsensi({
      date: cek.now.date,
      kelas,
      nis,
      studentName: req.user.name,
      status: cek.attendanceStatus,
      checkIn: cek.now.time
    });

    res.json({ success: true, message: `Absen masuk berhasil dicatat pada ${timeStr}`, status: cek.attendanceStatus, data: log });
  } catch (err) {
    console.error('absenMasuk error:', err);
    res.status(500).json({ success: false, message: 'Gagal mencatat absen masuk.' });
  }
});

// POST /api/siswa/absen-keluar
router.post('/absen-keluar', authenticate, async (req, res) => {
  try {
    const nis = req.user.nis || '0089211478';
    const kelas = req.user.kelas || 'XII IPA 1';
    const cek = await validasiAbsenPulang(nis, kelas);
    if (cek.error) return res.status(cek.error.status).json({ success: false, message: cek.error.message });
    const timeStr = `${cek.now.time} WIB`;

    if (!cek.todayAbsensi || !cek.todayAbsensi.check_in || cek.todayAbsensi.check_in === '-') {
      return res.status(409).json({ success: false, message: 'Belum ada absensi masuk hari ini.' });
    }

    const log = await db.stopStudentTracker(nis, timeStr, '-');
    await db.upsertAbsensi({
      date: cek.now.date,
      kelas,
      nis,
      studentName: req.user.name,
      checkOut: cek.now.time
    });

    res.json({
      success: true,
      message: `Absen pulang berhasil dicatat pada ${timeStr}`,
      data: log || cek.todayAbsensi
    });
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
