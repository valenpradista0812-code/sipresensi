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
  const eventId = req.body && req.body.event_id;
  if (eventId !== undefined && eventId !== null
      && (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 100)) {
    return res.status(400).json({ success: false, message: 'ID event RFID tidak valid.' });
  }

  try {
    expireScanIfNeeded();
    if (scanSession && scanSession.status === 'waiting') {
      scanSession.status = 'complete';
      scanSession.uid = uid;
      scanSession.message = 'Kartu berhasil dibaca.';
      return res.json({ success: true, mode: 'registration', uid, message: 'UID diterima untuk pendaftaran.' });
    }

    const nowMs = Date.now();
    const student = await db.findSiswaByRfidUid(uid);
    if (!student) return res.status(404).json({ success: false, mode: 'attendance', message: 'Kartu belum terdaftar.' });
    if (student.status && !['aktif', 'active'].includes(String(student.status).toLowerCase())) {
      return res.status(403).json({ success: false, mode: 'attendance', message: 'Status siswa tidak aktif.' });
    }

    const dispensationContext = await db.getDispensationRfidContext(student.nis);
    let dispensationEvent = null;
    try {
      dispensationEvent = await db.processDispensationRfid(
        student.nis,
        dispensationContext?.kelas || student.kelas,
        student.name,
        eventId ? eventId.trim() : null
      );
    } catch (error) {
      if (!['PGRST202', '42703'].includes(error.code)) throw error;
      console.error('Dispensation RFID workflow is unavailable; apply migrations 2026110707 and 2026110708.', error);
      return res.status(503).json({
        success: false,
        message: 'Workflow dispensasi RFID belum tersedia di database. Admin perlu menjalankan migrasi 2026110707 dan 2026110708.'
      });
    }
    if (!dispensationEvent && dispensationContext) {
      recentScans.set(uid, nowMs);
      const localDate = jakartaDateTime().date;
      const isPending = dispensationContext.status === 'Disetujui - Menunggu Tap';
      const message = isPending && dispensationContext.start_date !== localDate
        ? `Dispensasi disetujui untuk ${dispensationContext.start_date}, bukan hari ini. Tap tidak mengubah timer absensi.`
        : isPending
          ? 'Dispensasi sudah disetujui tetapi belum dapat dimulai. Timer absensi tidak diubah; hubungi guru/admin.'
          : 'Sesi dispensasi masih tercatat aktif tetapi tap tidak dapat diproses. Timer absensi tidak diubah; hubungi guru/admin.';
      return res.status(409).json({
        success: false,
        mode: 'dispensasi',
        status: dispensationContext.status,
        startDate: dispensationContext.start_date,
        message
      });
    }
    if (dispensationEvent) {
      if (dispensationEvent.action === 'debounced') {
        recentScans.set(uid, nowMs);
        return res.status(429).json({
          success: false,
          mode: 'dispensasi',
          action: 'debounced',
          message: 'Tap RFID baru saja diproses. Tunggu sebentar sebelum mencoba lagi.'
        });
      }
      if (dispensationEvent.action === 'duplicate') {
        return res.json({
          success: true,
          mode: 'dispensasi',
          action: 'duplicate',
          duplicate: true,
          message: 'Event RFID ini sudah diproses sebelumnya.'
        });
      }

      if (dispensationEvent.action === 'started') {
        recentScans.set(uid, nowMs);
        for (const [key, timestamp] of recentScans) if (nowMs - timestamp > 60000) recentScans.delete(key);
        const activeTracker = await db.getActiveStudentTracker(student.nis);
        return res.json({
          success: true,
          mode: 'dispensasi',
          ...dispensationEvent,
          isRunning: !!activeTracker,
          startTime: activeTracker ? (activeTracker.durasi && /^\d{12,14}$/.test(String(activeTracker.durasi)) ? Number(activeTracker.durasi) : new Date(activeTracker.created_at).getTime()) : null,
          message: `Dispensasi ${student.name} dimulai. Timer absensi tetap berjalan, countdown dispensasi aktif.`
        });
      }

      if (dispensationEvent.action === 'ended') {
        recentScans.set(uid, nowMs);
        for (const [key, timestamp] of recentScans) if (nowMs - timestamp > 60000) recentScans.delete(key);
        return res.json({
          success: true,
          mode: 'dispensasi',
          ...dispensationEvent,
          isRunning: false,
          startTime: null,
          message: `Dispensasi ${student.name} selesai. Status absensi diperbarui.`
        });
      }

      recentScans.set(uid, nowMs);
      for (const [key, timestamp] of recentScans) if (nowMs - timestamp > 60000) recentScans.delete(key);
      return res.json({
        success: true,
        mode: 'dispensasi',
        ...dispensationEvent,
        message: `Dispensasi ${student.name}: ${dispensationEvent.action}`
      });
    }

    const lastScan = recentScans.get(uid) || 0;
    if (!eventId && nowMs - lastScan < 10000) {
      return res.status(429).json({ success: false, mode: 'attendance', message: 'Kartu baru saja dipindai. Tunggu sebentar.' });
    }

    const { date, time } = jakartaDateTime();
    const now = new Date();
    const startMs = nowMs;
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

       recentScans.set(uid, nowMs);
       for (const [key, timestamp] of recentScans) if (nowMs - timestamp > 60000) recentScans.delete(key);

       return res.json({
         success: true, mode: 'attendance', name: student.name, nis: student.nis,
         kelas: student.kelas, date, time, trackerStarted: true, trackerStopped: false,
         isRunning: true, startTime: startMs,
         message: `Absensi berhasil. Tracker dimulai untuk ${student.name}`
       });
     }

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
         startTime: trackerStartMs, secondsUntilStopAllowed: secondsLeft,
         message: `Tracker ${student.name} masih berjalan. Tap untuk menghentikan setelah 1 menit; tunggu ${secondsLeft} detik lagi.`
       });
     }

     const diffSec = Math.max(0, Math.floor(elapsedMs / 1000));
     const duration = `${Math.floor(diffSec / 3600)}j ${Math.floor((diffSec % 3600) / 60)}m`;
     await db.stopStudentTracker(student.nis, `${time} WIB`, duration);
     await db.clearDispensationState(student.nis);
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

     recentScans.set(uid, nowMs);
     for (const [key, timestamp] of recentScans) if (nowMs - timestamp > 60000) recentScans.delete(key);

     return res.json({
       success: true, mode: 'attendance', name: student.name, nis: student.nis,
       kelas: student.kelas, date, time, trackerStarted: false, trackerStopped: true,
       isRunning: false, startTime: null,
       message: `Tracker ${student.name} berhasil dihentikan.`
     });
  } catch (err) {
    console.error('RFID endpoint error:', err);
    if (err.message && err.message.includes('DISPENSATION_DURATION_EXCEEDS_REMAINING_DAY')) {
      return res.status(409).json({
        success: false,
        mode: 'dispensasi',
        message: 'Durasi dispensasi yang disetujui melewati batas akhir hari. Hubungi guru agar durasinya disesuaikan.'
      });
    }
    if (err.code === 'PGRST202' || err.code === '42703') {
      return res.status(503).json({
        success: false,
        message: 'Fitur dispensasi RFID belum aktif di database. Jalankan migrasi 2026110707 dan 2026110708.'
      });
    }
    return res.status(500).json({ success: false, message: 'Gagal memproses kartu RFID.' });
  }
});

module.exports = router;
