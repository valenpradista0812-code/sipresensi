const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate } = require('../middleware/auth');
const { effectiveRole } = require('../middleware/role');
const { resolveTeacher, getTaughtClasses } = require('../utils/teacher-access');
const { jakartaNow } = require('../utils/jam-kerja');

function getWeekDays() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);

  const days = [];
  const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toLocaleDateString('en-CA');
    days.push({
      day: dayNames[i],
      date: dateStr,
      dayNum: d.getDate(),
      month: monthNames[d.getMonth()]
    });
  }

  const rangeText = `${days[0].dayNum} ${days[0].month} - ${days[4].dayNum} ${days[4].month} ${monday.getFullYear()}`;
  return { days, rangeText };
}

// GET /api/stats/overview (Guru/Admin/Petugas Dashboard)
router.get('/overview', authenticate, async (req, res) => {
  try {
    const role = effectiveRole(req.user);
    if (role === 'siswa') {
      return res.status(403).json({ success: false, message: 'Statistik overview tidak tersedia untuk siswa.' });
    }

    const { days, rangeText } = getWeekDays();

    let classFilter = null;
    if (role === 'guru') {
      const teacher = await resolveTeacher(req.user);
      const taught = teacher ? await getTaughtClasses(teacher.id) : [];
      if (taught.length === 0) {
        return res.json({
          success: true,
          data: {
            totalSiswa: 0, siswaAktif: 0, totalGuru: 0, guruAktif: 0,
            persentaseHadir: 0, hadirSiswa: 0, alfaSiswa: 0, izinSiswa: 0, sakitSiswa: 0,
            weeklyChart: days.map((d) => ({ day: d.day, date: d.date, hadir: 0, izin: 0, sakit: 0, alfa: 0, total: 0 })),
            recentAbsensi: [], weekRangeText: rangeText, todayFormatted: '', user: req.user
          }
        });
      }
      classFilter = taught;
    }

    let totalSiswa = await db.countSiswa();
    if (classFilter) {
      const allStudents = await db.getSiswa({});
      totalSiswa = allStudents.filter((st) => classFilter.includes(st.kelas)).length;
    }
    const totalGuru = await db.countGuru();

    const todayStr = jakartaNow().date;
    let todayRecords = await db.getAbsensi({ tanggal: todayStr });
    if (classFilter) todayRecords = todayRecords.filter((r) => classFilter.includes(r.kelas));

    let hadirCount = 0, izinCount = 0, sakitCount = 0, alfaCount = 0;
    todayRecords.forEach(r => {
      if (r.status === 'hadir' || r.status === 'terlambat') hadirCount++;
      else if (r.status === 'izin')  izinCount++;
      else if (r.status === 'sakit') sakitCount++;
      else if (r.status === 'alfa')  alfaCount++;
    });

    const totalAbsen      = todayRecords.length;
    const persentaseHadir = totalAbsen > 0
      ? Math.round((hadirCount / totalAbsen) * 100 * 10) / 10
      : 0;

    const weekDates = days.map(d => d.date);

    let { data: weekRecords } = await db.supabase
      .from('absensi')
      .select('*')
      .in('date', weekDates);
    if (classFilter) weekRecords = (weekRecords || []).filter((r) => classFilter.includes(r.kelas));

    const weeklyChart = days.map(d => {
      const records = (weekRecords || []).filter(r => r.date === d.date);
      const h = records.filter(r => r.status === 'hadir' || r.status === 'terlambat').length;
      const z = records.filter(r => r.status === 'izin').length;
      const s = records.filter(r => r.status === 'sakit').length;
      const a = records.filter(r => r.status === 'alfa').length;
      const tot = records.length;
      return { day: d.day, date: d.date, hadir: h, izin: z, sakit: s, alfa: a, total: tot };
    });

    const { data: rawRecentAll } = await db.supabase
      .from('absensi')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(classFilter ? 50 : 6);
    const rawRecent = classFilter
      ? (rawRecentAll || []).filter((r) => classFilter.includes(r.kelas)).slice(0, 6)
      : (rawRecentAll || []);

    const recentAbsensi = rawRecent.map(r => ({
      name: r.student_name || 'Siswa',
      kelas: r.kelas || '-',
      time: (r.check_in && r.check_in !== '-') ? `${r.check_in} WIB` : r.date,
      status: r.status || 'hadir',
      statusText: r.status ? (r.status.charAt(0).toUpperCase() + r.status.slice(1)) : 'Hadir'
    }));

    const now = new Date();
    const indonesianDays = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const indonesianMonths = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const todayFormatted = `${indonesianDays[now.getDay()]}, ${now.getDate()} ${indonesianMonths[now.getMonth()]} ${now.getFullYear()}`;

    res.json({
      success: true,
      data: {
        totalSiswa, siswaAktif: totalSiswa, totalGuru, guruAktif: totalGuru,
        persentaseHadir, hadirSiswa: hadirCount, alfaSiswa: alfaCount,
        izinSiswa: izinCount, sakitSiswa: sakitCount,
        weeklyChart, recentAbsensi, weekRangeText: rangeText, todayFormatted,
        user: req.user
      }
    });
  } catch (err) {
    console.error('stats/overview error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat statistik.' });
  }
});

// GET /api/stats/siswa (Student Dashboard)
router.get('/siswa', authenticate, async (req, res) => {
  try {
    const role = effectiveRole(req.user);
    const nis = req.user.nis;
    if (role !== 'siswa' || !nis) {
      return res.status(403).json({ success: false, message: 'Endpoint ini hanya untuk siswa.' });
    }

    const settings = await db.getPengaturan();
    const today = jakartaNow();
    const todayRecord = await db.findAbsensiByNisDate(nis, today.date, req.user.kelas);

    const userLogs = await db.getStudentLogs(nis);
    const hadirDays = userLogs.filter(l => l.status === 'hadir' || l.status === 'terlambat').length;
    const izinDays  = userLogs.filter(l => l.status === 'izin' || l.status === 'sakit').length;
    const alfaDays  = userLogs.filter(l => l.status === 'alfa').length;
    const totalDays = userLogs.length;
    const pctKehadiran = totalDays > 0 ? Math.round(((hadirDays + izinDays) / totalDays) * 100) : 0;

    res.json({
      success: true,
      data: {
        studentName:         req.user.name,
        kelas:               req.user.kelas || null,
        jamMasuk:            settings.jamMasuk || '07:00 WIB',
        targetPulang:        settings.jamPulang || '15:30 WIB',
        batasMasuk:          (settings.jamMasuk || '07:00 WIB').replace(/\s*WIB/i, '').trim(),
        checkIn:             todayRecord && todayRecord.check_in ? todayRecord.check_in : null,
        checkOut:            todayRecord && todayRecord.check_out ? todayRecord.check_out : null,
        statusMasuk:         todayRecord ? (todayRecord.status || 'Hadir') : 'Belum Absen',
        jamBelajarMingguIni: `${hadirDays * 7} Jam`,
        targetBelajar:       '40 Jam',
        kehadiranBulanIni:   `${pctKehadiran}%`,
        hadirCount:          hadirDays,
        izinCount:           izinDays,
        alfaCount:           alfaDays,
        logs:                userLogs
      }
    });
  } catch (err) {
    console.error('stats/siswa error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat statistik siswa.' });
  }
});

module.exports = router;
