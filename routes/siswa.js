const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { effectiveRole } = require('../middleware/role');
const { resolveTeacher, getAccessibleClasses } = require('../utils/teacher-access');
const { jakartaNow, readJamKerja, statusMasuk } = require('../utils/jam-kerja');
const { normalizeRfidUid, isRfidUniqueViolation } = require('../utils/rfid-uid');
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

// GET /api/siswa
router.get('/', authenticate, async (req, res) => {
  const role = effectiveRole(req.user);

  if (role === 'siswa') {
    return res.status(403).json({ success: false, message: 'Akses data siswa tidak tersedia untuk siswa.' });
  }

  try {
    let list = await db.getSiswa(req.query);

    if (role === 'guru') {
      const teacher = await resolveTeacher(req.user);
      const { all } = teacher ? await getAccessibleClasses(teacher.id) : { all: [] };
      const requested = typeof req.query.kelas === 'string' && req.query.kelas.trim()
        ? req.query.kelas.trim() : null;
      if (requested && !all.includes(requested)) {
        return res.status(403).json({ success: false, message: 'Kelas tersebut bukan kelas yang dapat Anda akses.' });
      }
      list = all.length === 0 ? [] : list.filter((s) => all.includes(s.kelas));
    }

    res.json({ success: true, count: list.length, data: list });
  } catch (err) {
    console.error('getSiswa error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data siswa.' });
  }
});

// Membuat satu siswa + akun login. Dipakai POST / dan POST /bulk.
async function createStudentAccount({ nis, name, kelas, gender, phone, email, password, rfid_uid }) {
  if (!nis || !name || !kelas) {
    const err = new Error('NIS, Nama, dan Kelas wajib diisi.');
    err.statusCode = 400;
    throw err;
  }

  if (!password || password.trim().length < 4) {
    const err = new Error('Kata sandi akun siswa wajib ditentukan (minimal 4 karakter).');
    err.statusCode = 400;
    throw err;
  }

  const cleanNis = String(nis).trim();
  const cleanName = name.trim();
  const requestedKelas = kelas.trim();
  const classRecord = await db.findKelasByName(requestedKelas);
  if (!classRecord) {
    const err = new Error('Kelas tidak ditemukan.');
    err.statusCode = 400;
    throw err;
  }
  const cleanKelas = classRecord.name;
  const studentEmail = (email && email.trim()) ? email.trim() : `${cleanNis}@sman1jkt.sch.id`;

  const existing = await db.findSiswaByNis(cleanNis);
  if (existing) {
    const err = new Error(`NIS ${cleanNis} sudah terdaftar dalam sistem.`);
    err.statusCode = 400;
    throw err;
  }

  if (rfid_uid) {
    const existingCard = await db.findSiswaByRfidUid(rfid_uid);
    if (existingCard) {
      const err = new Error(`UID RFID sudah terdaftar atas nama ${existingCard.name}.`);
      err.statusCode = 400;
      throw err;
    }
  }

  const existingUser = await db.findUserByEmailOrNis(studentEmail, cleanNis);
  if (existingUser) {
    const err = new Error('Email atau NIS sudah digunakan oleh akun lain.');
    err.statusCode = 400;
    throw err;
  }

  const sid = 'sis-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const newStudent = await db.addSiswa({
    id: sid,
    nis: cleanNis,
    name: cleanName,
    kelas: cleanKelas,
    gender: gender || 'Laki-laki',
    phone: phone ? phone.trim() : '-',
    email: studentEmail,
    rfid_uid: rfid_uid || null
  });

  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync(password.trim(), salt);
  const initials = cleanName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'S';

  try {
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
  } catch (accountErr) {
    try { await db.deleteSiswa(sid); } catch (cleanupErr) { console.error('rollback siswa error:', cleanupErr); }
    throw accountErr;
  }

  return newStudent;
}

// POST /api/siswa
router.post('/', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const rfidUid = normalizeRfidUid(req.body.rfid_uid);
    const newStudent = await createStudentAccount({ ...req.body, rfid_uid: rfidUid });

    res.status(201).json({
      success: true,
      message: `Data siswa & akun login ${newStudent.name} berhasil ditambahkan ke database!`,
      data: newStudent
    });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ success: false, message: err.message });
    if (isRfidUniqueViolation(err)) {
      return res.status(409).json({ success: false, message: 'UID RFID sudah terdaftar pada akun siswa lain.' });
    }
    console.error('addSiswa error:', err);
    res.status(500).json({ success: false, message: 'Gagal menambahkan data siswa ke database.' });
  }
});

// POST /api/siswa/bulk - tambah banyak siswa sekaligus (multi-select)
router.post('/bulk', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const students = Array.isArray(req.body.students) ? req.body.students : [];
    if (students.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada siswa yang dikirim.' });
    }
    if (students.length > 100) {
      return res.status(400).json({ success: false, message: 'Maksimal 100 siswa per permintaan.' });
    }

    const results = { created: [], failed: [] };
    for (const item of students) {
      try {
        const rfidUid = item.rfid_uid ? normalizeRfidUid(item.rfid_uid) : null;
        const created = await createStudentAccount({ ...item, rfid_uid: rfidUid });
        results.created.push({ nis: created.nis, name: created.name, kelas: created.kelas });
      } catch (err) {
        results.failed.push({
          nis: item.nis || '-',
          name: item.name || '-',
          reason: err.statusCode === 400 || isRfidUniqueViolation(err)
            ? err.message || 'UID RFID sudah terdaftar pada akun siswa lain.'
            : 'Gagal menyimpan ke database.'
        });
      }
    }

    const message = results.failed.length === 0
      ? `${results.created.length} siswa berhasil ditambahkan.`
      : `${results.created.length} siswa berhasil, ${results.failed.length} gagal.`;

    res.status(201).json({ success: true, message, ...results });
  } catch (err) {
    console.error('addSiswaBulk error:', err);
    res.status(500).json({ success: false, message: 'Gagal menambahkan siswa secara massal.' });
  }
});

// PUT /api/siswa/:id
router.put('/:id', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const { nis, name, kelas, gender, phone, email, password } = req.body;
    const rfidUid = Object.prototype.hasOwnProperty.call(req.body, 'rfid_uid')
      ? normalizeRfidUid(req.body.rfid_uid)
      : undefined;
    const existingStudent = await db.findSiswaByIdOrNis(req.params.id);
    if (!existingStudent) return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });

    const cleanNis = nis ? String(nis).trim() : existingStudent.nis;
    const cleanName = name ? name.trim() : existingStudent.name;
    const requestedKelas = kelas !== undefined ? String(kelas || '').trim() : existingStudent.kelas;
    const classRecord = requestedKelas ? await db.findKelasByName(requestedKelas) : null;
    if (requestedKelas && !classRecord) {
      return res.status(400).json({ success: false, message: 'Kelas tidak ditemukan.' });
    }
    const cleanKelas = classRecord?.name || null;
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
        title: cleanKelas ? `Siswa - ${cleanKelas}` : 'Siswa',
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
        title: cleanKelas ? `Siswa - ${cleanKelas}` : 'Siswa',
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
    if (isRfidUniqueViolation(err)) {
      return res.status(409).json({ success: false, message: 'UID RFID sudah terdaftar pada akun siswa lain.' });
    }
    console.error('updateSiswa error:', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui data siswa.' });
  }
});

// DELETE /api/siswa/:id
router.delete('/:id', authenticate, requireRole('petugas'), async (req, res) => {
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
    const nis = req.user.nis;
    const kelas = req.user.kelas;
    if (!nis || !kelas) {
      return res.status(403).json({ success: false, message: 'Akun siswa belum ditugaskan ke kelas.' });
    }
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
    const nis = req.user.nis;
    const kelas = req.user.kelas;
    if (!nis || !kelas) {
      return res.status(403).json({ success: false, message: 'Akun siswa belum ditugaskan ke kelas.' });
    }
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
    const nis = req.user.nis;
    const kelas = req.user.kelas;
    if (!nis || !kelas) {
      return res.status(403).json({ success: false, message: 'Akun siswa belum ditugaskan ke kelas.' });
    }
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
    const nis = req.user.nis;
    const kelas = req.user.kelas;
    if (!nis || !kelas) {
      return res.status(403).json({ success: false, message: 'Akun siswa belum ditugaskan ke kelas.' });
    }
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
    const nis = req.user.nis;
    if (!nis) {
      return res.status(403).json({ success: false, message: 'Akun belum terhubung dengan NIS siswa.' });
    }
    const logs = await db.getStudentLogs(nis);
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('getLog error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat log absensi.' });
  }
});

module.exports = router;

