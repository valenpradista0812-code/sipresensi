const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');

const MAX_PROOF_BYTES = 2 * 1024 * 1024;
const MAX_LEAVE_DAYS = 90;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireServiceRoleKey(req, res, next) {
  if (!db.hasServiceRoleKey) {
    return res.status(503).json({
      success: false,
      message: 'Layanan izin belum dikonfigurasi dengan aman. Admin server perlu mengatur SUPABASE_SERVICE_ROLE_KEY.'
    });
  }
  return next();
}

function isValidDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidProof(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string') return false;

  const match = value.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return false;
  return Buffer.from(match[1], 'base64').length <= MAX_PROOF_BYTES;
}

router.get('/', authenticate, requireServiceRoleKey, async (req, res) => {
  try {
    if (req.user.role === 'siswa') {
      if (!req.user.nis) {
        return res.status(403).json({ success: false, message: 'Akun siswa belum terhubung dengan NIS.' });
      }
      const data = await db.getIzinApplications(req.user.nis);
      return res.json({ success: true, data });
    }

    if (!['guru', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke pengajuan izin.' });
    }

    const data = await db.getIzinApplications(undefined, { excludeApproved: true });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('getIzinApplications error:', error);
    if (error.code === '42703' || error.code === 'PGRST204') {
      return res.status(503).json({
        success: false,
        message: 'Kolom dispensasi belum tersedia. Jalankan migrasi 2026110707_dispensasi_fields_and_status.sql di Supabase.'
      });
    }
    return res.status(500).json({ success: false, message: 'Gagal memuat pengajuan izin.' });
  }
});

router.get('/:id', authenticate, requireServiceRoleKey, async (req, res) => {
  try {
    if (!['siswa', 'guru', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke pengajuan izin.' });
    }

    const application = await db.getIzinApplicationById(req.params.id);
    if (!application || (req.user.role === 'siswa' && application.nis !== req.user.nis)) {
      return res.status(404).json({ success: false, message: 'Pengajuan izin tidak ditemukan.' });
    }
    return res.json({ success: true, data: application });
  } catch (error) {
    console.error('getIzinApplicationById error:', error);
    return res.status(500).json({ success: false, message: 'Gagal memuat detail pengajuan izin.' });
  }
});

router.post('/', authenticate, requireRole('siswa'), requireServiceRoleKey, async (req, res) => {
  try {
    const { type, startDate, endDate, reason, proof } = req.body;
    const sameDayDispensation = req.body.sameDay === true;
    const durationMinutes = req.body.durationMinutes;
    if (!req.user.nis || !req.user.kelas) {
      return res.status(403).json({ success: false, message: 'Akun siswa belum memiliki NIS atau kelas.' });
    }
    if (typeof type !== 'string' || !type.trim() || type.trim().length > 60) {
      return res.status(400).json({ success: false, message: 'Jenis izin wajib diisi (maksimal 60 karakter).' });
    }
    if (sameDayDispensation && type.trim().toLowerCase() !== 'dispensasi') {
      return res.status(400).json({ success: false, message: 'Durasi menit hanya tersedia untuk jenis Dispensasi.' });
    }
    if (!isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) {
      return res.status(400).json({ success: false, message: 'Rentang tanggal izin tidak valid.' });
    }
    if (sameDayDispensation && startDate !== endDate) {
      return res.status(400).json({ success: false, message: 'Dispensasi selesai di hari yang sama harus menggunakan satu tanggal.' });
    }
    if (sameDayDispensation && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) {
      return res.status(400).json({ success: false, message: 'Durasi dispensasi harus antara 1 sampai 1440 menit.' });
    }
    const durationDays = (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86400000 + 1;
    if (!sameDayDispensation && durationDays > MAX_LEAVE_DAYS) {
      return res.status(400).json({ success: false, message: `Durasi izin maksimal ${MAX_LEAVE_DAYS} hari per pengajuan.` });
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 300) {
      return res.status(400).json({ success: false, message: 'Keterangan wajib diisi (maksimal 300 karakter).' });
    }
    if (!isValidProof(proof)) {
      return res.status(400).json({ success: false, message: 'Bukti harus berupa gambar JPG, PNG, atau WebP maksimal 2 MB.' });
    }

    const application = await db.createIzinApplication({
      id: `izin-${crypto.randomUUID()}`,
      nis: req.user.nis,
      student_name: req.user.name,
      kelas: req.user.kelas,
      type: type.trim(),
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim(),
      proof_data: proof || null,
      same_day: sameDayDispensation,
      duration_minutes: sameDayDispensation ? durationMinutes : null,
      status: 'Menunggu'
    });

    return res.status(201).json({
      success: true,
      message: 'Pengajuan berhasil dikirim dan menunggu konfirmasi guru.',
      data: application
    });
  } catch (error) {
    console.error('createIzinApplication error:', error);
    if (error.code === '42703' || error.code === 'PGRST204') {
      return res.status(503).json({
        success: false,
        message: 'Kolom dispensasi belum tersedia. Jalankan migrasi 2026110707_dispensasi_fields_and_status.sql di Supabase.'
      });
    }
    return res.status(500).json({ success: false, message: 'Gagal mengirim pengajuan izin.' });
  }
});

router.post('/:id/review', authenticate, requireRole('guru', 'admin'), requireServiceRoleKey, async (req, res) => {
  const { status, reviewNote } = req.body;
  if (!['Disetujui', 'Ditolak'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status konfirmasi tidak valid.' });
  }
  if (reviewNote !== undefined && (typeof reviewNote !== 'string' || reviewNote.trim().length > 300)) {
    return res.status(400).json({ success: false, message: 'Catatan konfirmasi maksimal 300 karakter.' });
  }

  try {
    const data = await db.reviewIzinApplication(
      req.params.id,
      status,
      req.user.name || req.user.id,
      reviewNote ? reviewNote.trim() : null
    );
    return res.json({
      success: true,
      message: status === 'Disetujui'
        ? (data.status === 'Disetujui - Menunggu Tap'
          ? 'Dispensasi disetujui. Siswa perlu melakukan tap RFID untuk memulai.'
          : 'Pengajuan disetujui dan status absensi telah diselaraskan.')
        : 'Pengajuan izin ditolak.',
      data
    });
  } catch (error) {
    if (error.message && error.message.includes('APPLICATION_ALREADY_REVIEWED')) {
      return res.status(409).json({ success: false, message: 'Pengajuan ini sudah pernah dikonfirmasi.' });
    }
    if (error.message && error.message.includes('ATTENDANCE_ALREADY_RECORDED_AS_PRESENT')) {
      return res.status(409).json({
        success: false,
        message: 'Pengajuan tidak dapat disetujui karena siswa sudah tercatat hadir pada salah satu tanggal izin.'
      });
    }
    console.error('reviewIzinApplication error:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint
    });
    if (error.code === '42P10') {
      return res.status(503).json({
        success: false,
        message: 'Struktur database absensi belum lengkap. Admin perlu menjalankan migrasi 2026110703_ensure_attendance_conflict_index.sql.'
      });
    }
    if (error.code === 'PGRST202') {
      return res.status(503).json({
        success: false,
        message: 'Fungsi konfirmasi izin belum terbaca database. Periksa migrasi 2026110702_leave_applications.sql dan 2026110708_rfid_dispensasi_workflow.sql, lalu muat ulang schema Supabase.'
      });
    }
    if (error.code === '42804') {
      return res.status(503).json({
        success: false,
        message: 'Tipe status absensi di database berbeda. Jalankan migrasi 2026110704_fix_attendance_status_type.sql di Supabase.'
      });
    }
    if (error.code === '42703' || error.code === 'PGRST204') {
      return res.status(503).json({
        success: false,
        message: 'Kolom dispensasi belum tersedia. Jalankan migrasi 2026110707_dispensasi_fields_and_status.sql di Supabase.'
      });
    }
    if (error.code === 'PGRST202') {
      return res.status(503).json({
        success: false,
        message: 'Fungsi workflow dispensasi belum tersedia. Jalankan migrasi 2026110708_rfid_dispensasi_workflow.sql di Supabase.'
      });
    }
    return res.status(500).json({ success: false, message: 'Gagal mengonfirmasi pengajuan izin.' });
  }
});

module.exports = router;
