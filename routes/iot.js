const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');

// Satu sesi scan pada satu perangkat/server. Untuk multi-device, simpan sesi di DB/Redis.
let scanSession = null;
const SCAN_WINDOW_MS = 30000;
const MIN_TRACKER_MS = 60 * 1000; // Tracker hanya bisa dihentikan setelah 1 menit dari tap pertama.
const recentScans = new Map();

function normalizeUid(value) {
  if (value === undefined || value === null) return null;
  const uid = String(value).trim().toUpperCase().replace(/[:\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return /^[0-9A-F]{2}(?:-[0-9A-F]{2}){3,9}$/.test(uid) ? uid : null;
}

function jakartaDateTime() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).reduce((obj, p) => (obj[p.type] = p.value, obj), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

function deviceAuthorized(req) {
  const expected = process.env.IOT_DEVICE_TOKEN;
  if (!expected) return { ok: false, status: 503, message: 'IOT_DEVICE_TOKEN belum diatur pada .env server.' };
  const auth = req.get('authorization') || '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.get('x-device-token') || '').trim();
  if (!supplied || supplied.length !== expected.length || supplied !== expected) {
    return { ok: false, status: 401, message: 'Token perangkat tidak valid.' };
  }
  return { ok: true };
}

function expireScanIfNeeded() {
  if (scanSession && scanSession.status === 'waiting' && Date.now() >= scanSession.expiresAt) {
    scanSession.status = 'timeout';
  }
}

// Admin/guru menekan tombol "Baca Kartu" di halaman Data Siswa.
router.post('/scan/start', authenticate, requireRole('guru', 'admin'), (req, res) => {
  scanSession = { status: 'waiting', uid: null, message: 'Tempelkan kartu pada alat RFID.', expiresAt: Date.now() + SCAN_WINDOW_MS };
  res.json({ success: true, message: scanSession.message, expiresIn: SCAN_WINDOW_MS / 1000 });
});

router.get('/scan/status', authenticate, requireRole('guru', 'admin'), (req, res) => {
  expireScanIfNeeded();
  if (!scanSession) return res.json({ success: true, status: 'idle' });
  const { status, uid, message } = scanSession;
  if (status === 'complete') {
    // Hanya satu browser yang perlu mengambil hasil; jangan menghapus sebelum client membacanya.
    return res.json({ success: true, status, uid, message: 'Kartu berhasil dibaca.' });
  }
  res.json({ success: true, status, message: message || (status === 'timeout' ? 'Waktu scan habis. Coba lagi.' : '') });
});

// Dipanggil ESP32 setiap kali kartu disentuhkan. Token perangkat wajib, bukan token login siswa.
router.post('/rfid', async (req, res) => {
  const auth = deviceAuthorized(req);
  if (!auth.ok) return res.status(auth.status).json({ success: false, message: auth.message });

  const uid = normalizeUid(req.body && req.body.uid);
  if (!uid) return res.status(400).json({ success: false, message: 'UID RFID tidak valid.' });

  try {
    expireScanIfNeeded();
    if (scanSession && scanSession.status === 'waiting') {
      scanSession.status = 'complete';
      scanSession.uid = uid;
      scanSession.message = 'Kartu berhasil dibaca.';
      return res.json({ success: true, mode: 'registration', uid, message: 'UID diterima untuk pendaftaran.' });
    }

    // Debounce API: mencegah pembacaan kartu yang sama mencatat absensi berulang dalam 10 detik.
    const nowMs = Date.now();
    const lastScan = recentScans.get(uid) || 0;
    if (nowMs - lastScan < 10000) {
      return res.status(429).json({ success: false, mode: 'attendance', message: 'Kartu baru saja dipindai. Tunggu sebentar.' });
    }

    const student = await db.findSiswaByRfidUid(uid);
    if (!student) return res.status(404).json({ success: false, mode: 'attendance', message: 'Kartu belum terdaftar.' });
    if (student.status && !['aktif', 'active'].includes(String(student.status).toLowerCase())) {
      return res.status(403).json({ success: false, mode: 'attendance', message: 'Status siswa tidak aktif.' });
    }

    const { date, time } = jakartaDateTime();
    const now = new Date();
    const startMs = Date.now();
    const timeStr = `${time} WIB`;
    const dateStr = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric',
      month: 'long', year: 'numeric'
    }).format(now);

    // Jika belum ada tracker aktif, tap pertama memulai tracker.
    let tracker = await db.getActiveStudentTracker(student.nis);
    let trackerStarted = false;
    let trackerStopped = false;

    // Fallback: sebagian data lama bisa memiliki keluar = null, sehingga query tracker aktif
    // yang hanya mencari keluar='-' tidak menemukannya. Periksa juga ID harian lama.
    const dailyLogId = `rfid-log-${student.nis}-${date}`;
    if (!tracker) {
      const existingDailyLog = await db.findStudentLogById(dailyLogId);
      if (existingDailyLog && (!existingDailyLog.keluar || existingDailyLog.keluar === '-')) {
        tracker = existingDailyLog;
      }
    }

    if (!tracker) {
      tracker = await db.addStudentLog({
        // Gunakan ID unik per sesi agar sesi baru tidak bentrok dengan log harian lama.
        id: `rfid-log-${student.nis}-${date}-${startMs}`,
        nis: student.nis,
        tgl: dateStr,
        masuk: `${time} WIB`,
        keluar: '-',
        zona: 'RFID',
        status: 'hadir',
        statusText: 'Tracker Berjalan',
        valid: true,
        durasi: String(startMs)
      });
      trackerStarted = true;
    } else {
      // Tap kedua baru boleh menghentikan tracker setelah 60 detik sejak tap pertama.
      const rawStart = tracker.durasi || tracker.created_at;
      const trackerStartMs = /^\d{12,14}$/.test(String(rawStart || ''))
        ? Number(rawStart)
        : new Date(rawStart).getTime();
      const elapsedMs = Number.isFinite(trackerStartMs) ? nowMs - trackerStartMs : 0;

      if (elapsedMs < MIN_TRACKER_MS) {
        const secondsLeft = Math.max(1, Math.ceil((MIN_TRACKER_MS - elapsedMs) / 1000));
        recentScans.set(uid, nowMs);
        return res.json({
          success: true, mode: 'attendance', name: student.name, nis: student.nis,
          date, time, trackerStarted: false, trackerStopped: false, isRunning: true,
          startTime: tracker.durasi, secondsUntilStopAllowed: secondsLeft,
          message: `Tracker ${student.name} masih berjalan. Tap untuk menghentikan setelah 1 menit; tunggu ${secondsLeft} detik lagi.`
        });
      }

      const diffSec = Math.max(0, Math.floor(elapsedMs / 1000));
      const duration = `${Math.floor(diffSec / 3600)}j ${Math.floor((diffSec % 3600) / 60)}m`;
      await db.stopStudentTracker(student.nis, `${time} WIB`, duration);
      await db.upsertAbsensi({
        id: `rfid-${student.nis}-${date}`,
        date,
        kelas: student.kelas,
        mapel: 'RFID',
        nis: student.nis,
        studentName: student.name,
        status: 'hadir',
        checkOut: time
      });
      trackerStopped = true;
    }

    if (trackerStarted) {
      await db.upsertAbsensi({
        id: `rfid-${student.nis}-${date}`,
        date,
        kelas: student.kelas,
        mapel: 'RFID',
        nis: student.nis,
        studentName: student.name,
        status: 'hadir',
        checkIn: time,
        checkOut: '-'
      });
    }

    recentScans.set(uid, nowMs);
    // Bersihkan map secara ringan agar tidak tumbuh tanpa batas.
    for (const [key, timestamp] of recentScans) if (nowMs - timestamp > 60000) recentScans.delete(key);

    return res.json({
      success: true, mode: 'attendance', name: student.name, nis: student.nis,
      kelas: student.kelas, date, time, trackerStarted, trackerStopped,
      isRunning: !trackerStopped, startTime: trackerStarted ? tracker.durasi : (tracker?.durasi || null),
      message: trackerStarted
        ? `Absensi berhasil. Tracker dimulai untuk ${student.name}`
        : `Tracker ${student.name} berhasil dihentikan.`
    });
  } catch (err) {
    console.error('RFID endpoint error:', err);
    return res.status(500).json({ success: false, message: 'Gagal memproses kartu RFID.' });
  }
});

module.exports = router;
