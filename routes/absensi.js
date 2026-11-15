const express = require('express');
const router  = express.Router();
const db      = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { effectiveRole } = require('../middleware/role');
const { resolveTeacher, getTaughtClasses, canAccessClass } = require('../utils/teacher-access');
const { jakartaNow } = require('../utils/jam-kerja');

// GET /api/absensi
router.get('/', authenticate, async (req, res) => {
  try {
    const role = effectiveRole(req.user);

    if (role === 'siswa') {
      if (!req.user.nis) {
        return res.status(403).json({ success: false, message: 'Akun siswa belum terhubung dengan NIS.' });
      }
      const records = await db.getAbsensiByNis(req.user.nis);
      return res.json({ success: true, count: records.length, data: records });
    }

    if (role !== 'guru' && role !== 'petugas') {
      return res.status(403).json({ success: false, message: 'Akses riwayat absensi hanya untuk siswa, guru, dan petugas.' });
    }

    const today = jakartaNow().date;
    const kelas = req.query.kelas || null;
    const tanggal = req.query.tanggal || today;
    const mapel = req.query.mapel || null;

    let teacher = null;
    let taught = null;
    if (role === 'guru') {
      teacher = await resolveTeacher(req.user);
      taught = teacher ? await getTaughtClasses(teacher.id) : [];
      if (taught.length === 0) {
        return res.json({ success: true, filter: { kelas, tanggal, mapel }, count: 0, data: [] });
      }
      if (kelas && !taught.includes(kelas) && !(await canAccessClass(req.user, teacher && teacher.id, kelas, { allowWali: true }))) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke kelas tersebut.' });
      }
    }

    const targetKelas = kelas || (role === 'guru' ? taught[0] : null);
    if (!targetKelas) {
      return res.json({ success: true, filter: { kelas: null, tanggal, mapel }, count: 0, data: [] });
    }

    const students = await db.getSiswa({ kelas: targetKelas });
    const existingRecords = await db.getAbsensi({ kelas: targetKelas, tanggal });
    const leaveApplications = await db.getIzinApplicationsForAttendanceDate(tanggal, targetKelas);
    const applicationsByNis = new Map();
    leaveApplications.forEach(application => {
      const key = String(application.nis);
      if (!applicationsByNis.has(key)) applicationsByNis.set(key, []);
      applicationsByNis.get(key).push(application);
    });
    const existingMap = {};
    existingRecords.forEach(a => { existingMap[a.nis] = a; });

    const result = students.map((st, idx) => {
      const existing = existingMap[st.nis];
      const studentApplications = applicationsByNis.get(String(st.nis)) || [];
      const applicationOnly = !existing && studentApplications.length > 0;
      return {
        no:     idx + 1,
        nis:    st.nis,
        name:   st.name,
        kelas:  st.kelas,
        status: existing ? existing.status : applicationOnly ? studentApplications[0].status : 'hadir',
        note:   existing ? (existing.note || '') : '',
        applicationOnly,
        masuk:  existing ? existing.check_in : null,
        keluar: existing ? existing.check_out : null,
        is_overtime: existing ? (existing.is_overtime === true) : false,
        overtime_minutes: existing ? (existing.overtime_minutes || 0) : 0,
        jadwal_pulang: existing ? (existing.jadwal_pulang || null) : null,
        leaveApplications: studentApplications
      };
    });
    const studentNis = new Set(result.map(student => String(student.nis)));
    existingRecords.forEach(record => {
      if (studentNis.has(String(record.nis))) return;
      result.push({
        no: result.length + 1,
        nis: record.nis,
        name: record.student_name || 'Siswa',
        kelas: record.kelas,
        status: record.status,
        note: record.note || '',
        applicationOnly: false,
        masuk: record.check_in,
        keluar: record.check_out,
        is_overtime: record.is_overtime === true,
        overtime_minutes: record.overtime_minutes || 0,
        jadwal_pulang: record.jadwal_pulang || null,
        leaveApplications: applicationsByNis.get(String(record.nis)) || []
      });
    });

    res.json({ success: true, filter: { kelas: targetKelas, tanggal, mapel }, count: result.length, data: result });
  } catch (err) {
    console.error('getAbsensi error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data absensi.' });
  }
});

// POST /api/absensi/save
router.post('/save', authenticate, requireRole('guru', 'petugas'), async (req, res) => {
  try {
    const { date, kelas, mapel, records } = req.body;

    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ success: false, message: 'Data absensi tidak valid.' });
    }

    const role = effectiveRole(req.user);
    const targetDate  = date  || jakartaNow().date;
    const targetKelas = kelas || null;
    const targetMapel = mapel || 'Umum';

    if (!targetKelas) {
      return res.status(400).json({ success: false, message: 'Kelas wajib dipilih.' });
    }

    if (role === 'guru') {
      const teacher = await resolveTeacher(req.user);
      const allowed = await canAccessClass(req.user, teacher && teacher.id, targetKelas, { allowWali: true });
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses menyimpan absensi kelas ini.' });
      }
    } else if (role !== 'petugas') {
      return res.status(403).json({ success: false, message: 'Akses simpan absensi tidak tersedia.' });
    }

    for (const rec of records) {
      const checkIn  = rec.check_in  !== undefined && rec.check_in  !== '' ? rec.check_in  : (rec.masuk  || '-');
      const checkOut = rec.check_out !== undefined && rec.check_out !== '' ? rec.check_out : (rec.keluar || '-');
      await db.upsertAbsensi({
        id:          'abs-' + Date.now() + '-' + rec.nis,
        date:        targetDate,
        kelas:       targetKelas,
        mapel:       targetMapel,
        nis:         rec.nis,
        studentName: rec.name || 'Siswa',
        status:      rec.status,
        note:        rec.note || '',
        checkIn,
        checkOut
      });
    }

    res.json({ success: true, message: `Data absensi kelas ${targetKelas} tanggal ${targetDate} berhasil disimpan!` });
  } catch (err) {
    console.error('saveAbsensi error:', err);
    res.status(500).json({ success: false, message: 'Gagal menyimpan data absensi.' });
  }
});

// GET /api/absensi/riwayat
router.get('/riwayat', authenticate, async (req, res) => {
  try {
    const role = effectiveRole(req.user);
    if (role === 'siswa') {
      return res.status(403).json({ success: false, message: 'Riwayat absensi kelas hanya untuk guru dan petugas.' });
    }
    if (role !== 'guru' && role !== 'petugas') {
      return res.status(403).json({ success: false, message: 'Akses ditolak.' });
    }

    const { kelas, tanggal, startDate, endDate, q } = req.query;
    const targetKelas = kelas || null;
    let taught = null;

    if (role === 'guru') {
      const teacher = await resolveTeacher(req.user);
      taught = teacher ? await getTaughtClasses(teacher.id) : [];
      if (targetKelas && !taught.includes(targetKelas)) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke kelas tersebut.' });
      }
    }

    let rows;
    if (role === 'guru' && !targetKelas) {
      if (taught.length === 0) return res.json({ success: true, count: 0, data: [] });
      const chunks = await Promise.all(taught.map((k) => db.getAbsensiRiwayat({ kelas: k, tanggal, startDate, endDate })));
      rows = chunks.flat();
    } else {
      rows = await db.getAbsensiRiwayat({ kelas: targetKelas, tanggal, startDate, endDate });
    }

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
          hadir: 0, izin: 0, sakit: 0, alfa: 0, total: 0
        };
      }
      groupedMap[key].total++;
      if      (a.status === 'hadir' || a.status === 'terlambat') groupedMap[key].hadir++;
      else if (a.status === 'izin')  groupedMap[key].izin++;
      else if (a.status === 'sakit') groupedMap[key].sakit++;
      else if (a.status === 'alfa')  groupedMap[key].alfa++;
    });

    let allList = Object.values(groupedMap);
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

// GET /api/absensi/rekap-bulanan
router.get('/rekap-bulanan', authenticate, async (req, res) => {
  try {
    const role = effectiveRole(req.user);
    if (role === 'siswa') {
      return res.status(403).json({ success: false, message: 'Rekap bulanan hanya untuk guru dan petugas.' });
    }
    if (role !== 'guru' && role !== 'petugas') {
      return res.status(403).json({ success: false, message: 'Akses ditolak.' });
    }

    const { kelas, bulan, q } = req.query;
    const now = jakartaNow();

    let taught = null;
    if (role === 'guru') {
      const teacher = await resolveTeacher(req.user);
      taught = teacher ? await getTaughtClasses(teacher.id) : [];
      if (kelas && kelas !== 'Semua Kelas' && !taught.includes(kelas) && !(await canAccessClass(req.user, teacher && teacher.id, kelas, { allowWali: true }))) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke kelas tersebut.' });
      }
    }

    let startDate, endDate;
    if (bulan) {
      const monthMap = {
        'Januari': '01', 'Februari': '02', 'Maret': '03', 'April': '04',
        'Mei': '05', 'Juni': '06', 'Juli': '07', 'Agustus': '08',
        'September': '09', 'Oktober': '10', 'November': '11', 'Desember': '12'
      };
      const parts = String(bulan).split(' ');
      if (parts.length === 2 && monthMap[parts[0]]) {
        const mm = monthMap[parts[0]];
        const yyyy = parts[1];
        startDate = `${yyyy}-${mm}-01`;
        const lastDay = new Date(parseInt(yyyy, 10), parseInt(mm, 10), 0).getDate();
        endDate = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
      }
    }
    if (!startDate || !endDate) {
      const [yyyy, mm] = now.date.split('-');
      startDate = `${yyyy}-${mm}-01`;
      const lastDay = new Date(parseInt(yyyy, 10), parseInt(mm, 10), 0).getDate();
      endDate = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
    }

    let students;
    if (role === 'guru') {
      if (taught.length === 0) {
        return res.json({
          success: true,
          filter: { kelas: kelas || 'Semua Kelas', bulan: bulan || null, startDate, endDate },
          summary: {
            kehadiranOverall: null, persentaseSekolah: null, hariEfektif: '0 hari',
            hadir: 0, terlambat: 0, izin: 0, sakit: 0, alfa: 0, dispensasi: 0, totalHadir: 0,
            pctHadir: null, siswaTerajin: '-', siswaSeringAlfa: '-'
          },
          count: 0, data: []
        });
      }
      const all = await db.getSiswa({ q });
      students = all.filter((s) => taught.includes(s.kelas));
    } else {
      students = await db.getSiswa({ kelas: kelas && kelas !== 'Semua Kelas' ? kelas : undefined, q });
    }

    const rekapList = [];
    const allDates = new Set();
    let sumStudentDays = 0;
    let sumNonAlfaDays = 0;

    for (const st of students) {
      const records = await db.getAbsensiByNisRange(st.nis, startDate, endDate);
      const dateMap = new Map();
      for (const r of records) {
        const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date);
        allDates.add(d);
        if (!dateMap.has(d)) dateMap.set(d, []);
        dateMap.get(d).push(r);
      }

      const counts = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, alfa: 0, dispensasi: 0 };
      for (const r of records) {
        if (r.status === 'hadir') counts.hadir += 1;
        else if (r.status === 'terlambat') counts.terlambat += 1;
        else if (r.status === 'izin') counts.izin += 1;
        else if (r.status === 'sakit') counts.sakit += 1;
        else if (r.status === 'alfa') counts.alfa += 1;
        else if (r.status === 'dispensasi') counts.dispensasi += 1;
      }

      const studentDays = dateMap.size;
      let nonAlfaDays = 0;
      let hadirSajaDays = 0;
      const details = [];
      for (const [d, rs] of dateMap.entries()) {
        if (rs.some((r) => r.status !== 'alfa')) nonAlfaDays += 1;
        if (rs.every((r) => r.status === 'hadir' || r.status === 'terlambat')) hadirSajaDays += 1;
        const first = rs[0];
        details.push({ date: d, status: rs.map((r) => r.status).join(','), masuk: first.check_in || '-', keluar: first.check_out || '-' });
      }
      sumStudentDays += studentDays;
      sumNonAlfaDays += nonAlfaDays;

      const persentase = studentDays > 0 ? Math.round((nonAlfaDays / studentDays) * 1000) / 10 : null;
      const persentaseHadirSaja = studentDays > 0 ? Math.round((hadirSajaDays / studentDays) * 1000) / 10 : null;

      if (persentase !== null && (persentase < 0 || persentase > 100)) {
        throw new Error(`persentase out of range untuk ${st.nis}: ${persentase}`);
      }
      if (counts.hadir + counts.terlambat + counts.izin + counts.sakit + counts.alfa + counts.dispensasi !== records.length) {
        throw new Error(`jumlah status tidak sama dengan record untuk ${st.nis}`);
      }

      rekapList.push({
        nis: st.nis, nama: st.name, kelas: st.kelas,
        hadir: counts.hadir, terlambat: counts.terlambat, izin: counts.izin,
        sakit: counts.sakit, alfa: counts.alfa, dispensasi: counts.dispensasi,
        totalHadir: counts.hadir + counts.terlambat,
        studentDays, persentase, persentaseHadirSaja,
        totalRecord: records.length, details
      });
    }

    const sumHadir = rekapList.reduce((s, r) => s + r.hadir, 0);
    const sumTerlambat = rekapList.reduce((s, r) => s + r.terlambat, 0);
    const sumIzin = rekapList.reduce((s, r) => s + r.izin, 0);
    const sumSakit = rekapList.reduce((s, r) => s + r.sakit, 0);
    const sumAlfa = rekapList.reduce((s, r) => s + r.alfa, 0);
    const sumDispensasi = rekapList.reduce((s, r) => s + r.dispensasi, 0);

    const persentaseSekolah = sumStudentDays > 0
      ? Math.round((sumNonAlfaDays / sumStudentDays) * 1000) / 10
      : null;

    const sorted = [...rekapList].filter((r) => r.persentase !== null).sort((a, b) => b.persentase - a.persentase);
    const siswaTerajin = sorted[0] ? `${sorted[0].nama} (${sorted[0].persentase}%)` : '-';
    const alfaSorted = [...rekapList].sort((a, b) => b.alfa - a.alfa);
    const siswaSeringAlfa = alfaSorted[0] && alfaSorted[0].alfa > 0
      ? `${alfaSorted[0].nama} (${alfaSorted[0].alfa} Absen)` : 'Nihil';

    res.json({
      success: true,
      filter: { kelas: kelas || 'Semua Kelas', bulan: bulan || null, startDate, endDate },
      summary: {
        kehadiranOverall: persentaseSekolah, persentaseSekolah,
        hariEfektif: `${allDates.size} hari`,
        hadir: sumHadir, terlambat: sumTerlambat, izin: sumIzin,
        sakit: sumSakit, alfa: sumAlfa, dispensasi: sumDispensasi,
        totalHadir: sumHadir + sumTerlambat, pctHadir: persentaseSekolah,
        siswaTerajin, siswaSeringAlfa
      },
      count: rekapList.length,
      data: rekapList
    });
  } catch (err) {
    console.error('rekap-bulanan error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat rekap bulanan.' });
  }
});

module.exports = router;
