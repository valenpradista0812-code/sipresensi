const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate } = require('../middleware/auth');

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

// GET /api/stats/overview (Guru/Admin Dashboard)
router.get('/overview', authenticate, async (req, res) => {
  try {
    const totalSiswa  = await db.countSiswa();
    const totalGuru   = await db.countGuru();

    const todayStr = new Date().toLocaleDateString('en-CA');
    const todayRecords = await db.getAbsensi({ tanggal: todayStr });

    let hadirCount = 0, izinCount = 0, sakitCount = 0, alfaCount = 0;
    todayRecords.forEach(r => {
      if (r.status === 'hadir')      hadirCount++;
      else if (r.status === 'izin')  izinCount++;
      else if (r.status === 'sakit') sakitCount++;
      else if (r.status === 'alfa')  alfaCount++;
    });

    const totalAbsen      = todayRecords.length;
    const persentaseHadir = totalAbsen > 0
      ? Math.round((hadirCount / totalAbsen) * 100 * 10) / 10
      : 0;

    // Weekly chart from real absensi in database
    const { days, rangeText } = getWeekDays();
    const weekDates = days.map(d => d.date);

    const { data: weekRecords } = await db.supabase
      .from('absensi')
      .select('*')
      .in('date', weekDates);

    const weeklyChart = days.map(d => {
      const records = (weekRecords || []).filter(r => r.date === d.date);
      const h = records.filter(r => r.status === 'hadir').length;
      const z = records.filter(r => r.status === 'izin').length;
      const s = records.filter(r => r.status === 'sakit').length;
      const a = records.filter(r => r.status === 'alfa').length;
      const tot = records.length;
      return {
        day: d.day,
        date: d.date,
        hadir: h,
        izin: z,
        sakit: s,
        alfa: a,
        total: tot
      };
    });

    // Recent absensi from database
    const { data: rawRecent } = await db.supabase
      .from('absensi')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(6);

    const recentAbsensi = (rawRecent || []).map(r => ({
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
        totalSiswa:      totalSiswa,
        siswaAktif:      totalSiswa,
        totalGuru:       totalGuru,
        guruAktif:       totalGuru,
        persentaseHadir: persentaseHadir,
        hadirSiswa:      hadirCount,
        alfaSiswa:       alfaCount,
        izinSiswa:       izinCount,
        sakitSiswa:      sakitCount,
        weeklyChart:     weeklyChart,
        recentAbsensi:   recentAbsensi,
        weekRangeText:   rangeText,
        todayFormatted:  todayFormatted,
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
    const nis      = req.user.nis || '0089211478';
    const userLogs = await db.getStudentLogs(nis);

    const todayLog = userLogs[0] || null;

    const hadirDays = userLogs.filter(l => l.status === 'hadir').length;
    const izinDays  = userLogs.filter(l => l.status === 'izin' || l.status === 'sakit').length;
    const alfaDays  = userLogs.filter(l => l.status === 'alfa').length;
    const totalDays = userLogs.length;
    const pctKehadiran = totalDays > 0 ? Math.round(((hadirDays + izinDays) / totalDays) * 100) : 0;

    res.json({
      success: true,
      data: {
        studentName:         req.user.name,
        kelas:               req.user.kelas || 'XII IPA 1',
        jamMasuk:            todayLog ? (todayLog.masuk || '-') : '-',
        targetPulang:        '15:30 WIB',
        statusMasuk:         todayLog ? (todayLog.status_text || 'Hadir Tepat Waktu') : 'Belum Absen',
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
