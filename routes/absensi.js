const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');

// GET /api/absensi - Daftar siswa di kelas beserta status absensi hari ini
router.get('/', authenticate, async (req, res) => {
  try {
    const kelas   = req.query.kelas   || 'XII IPA 1';
    const tanggal = req.query.tanggal || new Date().toISOString().slice(0, 10);
    const mapel   = req.query.mapel   || 'Matematika';

    // Ambil siswa di kelas ini
    let students = await db.getSiswa({ kelas });
    if (students.length === 0) {
      students = await db.getSiswaLimit(8);
    }

    // Ambil record absensi yang sudah ada untuk kelas & tanggal ini
    const existingRecords = await db.getAbsensi({ kelas, tanggal });
    const existingMap = {};
    existingRecords.forEach(a => { existingMap[a.nis] = a; });

    const result = students.map((st, idx) => {
      const existing = existingMap[st.nis];
      return {
        no:     idx + 1,
        nis:    st.nis,
        name:   st.name,
        kelas:  st.kelas,
        status: existing ? existing.status : 'hadir',
        note:   existing ? (existing.note || '') : ''
      };
    });

    res.json({ success: true, filter: { kelas, tanggal, mapel }, count: result.length, data: result });
  } catch (err) {
    console.error('getAbsensi error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data absensi.' });
  }
});

// POST /api/absensi/save - Simpan absensi sekelompok siswa
router.post('/save', authenticate, requireRole('guru', 'admin'), async (req, res) => {
  try {
    const { date, kelas, mapel, records } = req.body;

    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ success: false, message: 'Data absensi tidak valid.' });
    }

    const targetDate  = date  || new Date().toISOString().slice(0, 10);
    const targetKelas = kelas || 'XII IPA 1';
    const targetMapel = mapel || 'Matematika';

    // Upsert setiap record ke MySQL
    for (const rec of records) {
      await db.upsertAbsensi({
        id:          'abs-' + Date.now() + '-' + rec.nis,
        date:        targetDate,
        kelas:       targetKelas,
        mapel:       targetMapel,
        nis:         rec.nis,
        studentName: rec.name || 'Siswa',
        status:      rec.status,
        note:        rec.note || '',
        checkIn:     rec.status === 'hadir' ? '07:15:00' : '-',
        checkOut:    rec.status === 'hadir' ? '15:30:00' : '-'
      });
    }

    res.json({ success: true, message: `Data absensi kelas ${targetKelas} tanggal ${targetDate} berhasil disimpan!` });
  } catch (err) {
    console.error('saveAbsensi error:', err);
    res.status(500).json({ success: false, message: 'Gagal menyimpan data absensi.' });
  }
});

// GET /api/absensi/riwayat - Riwayat absensi dikelompokkan per kelas & tanggal
router.get('/riwayat', authenticate, async (req, res) => {
  try {
    const { kelas, tanggal, startDate, endDate, q } = req.query;

    // Ambil dari Supabase dan kelompokkan
    const rows = await db.getAbsensiRiwayat({ kelas, tanggal, startDate, endDate });

    // Kelompokkan per date+kelas+mapel
    const groupedMap = {};
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    rows.forEach(a => {
      const key = `${a.date}_${a.kelas}_${a.mapel || 'Umum'}`;
      if (!groupedMap[key]) {
        const parts = (a.date instanceof Date ? a.date.toISOString().slice(0, 10) : String(a.date)).split('-');
        const formattedDate = parts.length === 3
          ? `${parseInt(parts[2], 10)} ${monthNames[parseInt(parts[1], 10)]} ${parts[0]}`
          : String(a.date);
        const rawDate = a.date instanceof Date ? a.date.toISOString().slice(0, 10) : String(a.date);

        groupedMap[key] = {
          date: rawDate, tanggal: formattedDate,
          kelas: a.kelas, mapel: a.mapel || 'Umum',
          guru: 'Guru Pengampu',
          hadir: 0, izin: 0, sakit: 0, alfa: 0, total: 36
        };
      }
      if      (a.status === 'hadir') groupedMap[key].hadir++;
      else if (a.status === 'izin')  groupedMap[key].izin++;
      else if (a.status === 'sakit') groupedMap[key].sakit++;
      else if (a.status === 'alfa')  groupedMap[key].alfa++;
    });

    let allList = Object.values(groupedMap);

    // If database still empty, return empty list
    if (allList.length === 0) {
      allList = [];
    }

    // Filter pencarian
    if (q && q.trim() !== '') {
      const qLow = q.trim().toLowerCase();
      allList = allList.filter(item =>
        item.kelas.toLowerCase().includes(qLow) ||
        item.mapel.toLowerCase().includes(qLow) ||
        item.guru.toLowerCase().includes(qLow)
      );
    }

    res.json({ success: true, count: allList.length, data: allList });
  } catch (err) {
    console.error('riwayat error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat riwayat absensi.' });
  }
});

// GET /api/absensi/rekap-bulanan - Rekap bulanan siswa
router.get('/rekap-bulanan', optionalAuth, async (req, res) => {
  try {
    const { kelas, bulan, q } = req.query;

    // Ambil semua siswa dengan filter kelas & pencarian
    let students = await db.getSiswa({ kelas: kelas && kelas !== 'Semua Kelas' ? kelas : undefined, q });

    // Tentukan rentang tanggal berdasarkan nama bulan (misal: "Oktober 2024")
    let startDate = '2024-10-01', endDate = '2024-10-31', totalHari = 22;
    if (bulan) {
      const monthMap = {
        'Januari': '01', 'Februari': '02', 'Maret': '03', 'April': '04',
        'Mei': '05', 'Juni': '06', 'Juli': '07', 'Agustus': '08',
        'September': '09', 'Oktober': '10', 'November': '11', 'Desember': '12'
      };
      const parts = bulan.split(' '); // ['Oktober', '2024']
      if (parts.length === 2) {
        const mm   = monthMap[parts[0]] || '10';
        const yyyy = parts[1];
        startDate  = `${yyyy}-${mm}-01`;
        const lastDay = new Date(parseInt(yyyy), parseInt(mm), 0).getDate();
        endDate    = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
      }
    }

    // Hitung rekap per siswa
    const rekapList = [];
    for (const st of students) {
      const records = await db.getAbsensiByNisRange(st.nis, startDate, endDate);
      const hadir = records.filter(r => r.status === 'hadir').length;
      const izin  = records.filter(r => r.status === 'izin').length;
      const sakit = records.filter(r => r.status === 'sakit').length;
      const alfa  = records.filter(r => r.status === 'alfa').length;
      const pct   = totalHari > 0 ? Math.round(((hadir + izin) / totalHari) * 1000) / 10 : 100;

      rekapList.push({
        nis: st.nis, nama: st.name, kelas: st.kelas,
        hadir, izin, sakit, alfa,
        persentase: pct + '%'
      });
    }

    // Hitung summary
    const totalSlots   = (rekapList.length * totalHari) || 1;
    const totalHadir   = rekapList.reduce((s, r) => s + r.hadir, 0);
    const totalIzin    = rekapList.reduce((s, r) => s + r.izin,  0);
    const totalSakit   = rekapList.reduce((s, r) => s + r.sakit, 0);
    const totalAlfa    = rekapList.reduce((s, r) => s + r.alfa,  0);
    const pctHadir     = totalSlots > 0 ? Math.round((totalHadir / totalSlots) * 1000) / 10 : 0;
    const pctIzin      = totalSlots > 0 ? Math.round((totalIzin  / totalSlots) * 1000) / 10 : 0;
    const pctSakit     = totalSlots > 0 ? Math.round((totalSakit / totalSlots) * 1000) / 10 : 0;
    const pctAlfa      = totalSlots > 0 ? Math.round((totalAlfa  / totalSlots) * 1000) / 10 : 0;
    const overall      = totalSlots > 0 ? Math.round(((totalHadir + totalIzin) / totalSlots) * 1000) / 10 : 0;

    const sorted       = [...rekapList].sort((a, b) => parseFloat(b.persentase) - parseFloat(a.persentase));
    const siswaTerajin = (sorted[0] && totalHadir > 0) ? `${sorted[0].nama} (${sorted[0].persentase})` : '-';
    const alfaSorted   = [...rekapList].sort((a, b) => b.alfa - a.alfa);
    const siswaSeringAlfa = alfaSorted[0] && alfaSorted[0].alfa > 0
      ? `${alfaSorted[0].nama} (${alfaSorted[0].alfa} Absen)` : 'Nihil';

    res.json({
      success: true,
      filter: { kelas: kelas || 'Semua Kelas', bulan: bulan || 'Oktober 2024' },
      summary: {
        kehadiranOverall: overall + '%',
        pctHadir: pctHadir + '%', pctIzin: pctIzin + '%',
        pctSakit: pctSakit + '%', pctAlfa: pctAlfa + '%',
        totalHari: totalHari + ' Hari',
        siswaTerajin, siswaSeringAlfa
      },
      count: rekapList.length,
      data:  rekapList
    });
  } catch (err) {
    console.error('rekap-bulanan error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat rekap bulanan.' });
  }
});

module.exports = router;
