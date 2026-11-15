const MAX_SISWA_PER_JADWAL = 200;

/**
 * Normalisasi pilihan siswa dari body request.
 * `undefined` berarti field tidak dikirim (link lama dipertahankan).
 * Array kosong berarti jadwal berlaku untuk seluruh kelas.
 */
function normalizeSiswaIds(value) {
  if (value === undefined) return { provided: false, ids: [] };
  if (!Array.isArray(value)) {
    return { error: 'Daftar siswa harus berupa array ID siswa.' };
  }
  if (value.length > MAX_SISWA_PER_JADWAL) {
    return { error: `Maksimal ${MAX_SISWA_PER_JADWAL} siswa per jadwal.` };
  }

  const ids = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      return { error: 'Setiap siswa terpilih harus memiliki ID yang valid.' };
    }
    const id = item.trim();
    if (!ids.includes(id)) ids.push(id);
  }
  return { provided: true, ids };
}

/**
 * Pastikan seluruh siswa terpilih ada dan berada di kelas jadwal.
 * students: baris { id, nis, name, kelas } dari tabel siswa.
 */
function validateStudentSelection(students, ids, kelas) {
  if (!Array.isArray(ids) || ids.length === 0) return { valid: true, students: [] };
  const byId = new Map((students || []).map((student) => [student.id, student]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return { error: 'Ada siswa terpilih yang tidak ditemukan di database. Muat ulang daftar siswa.' };
  }

  const selected = ids.map((id) => byId.get(id));
  const wrongClass = selected.filter((student) => String(student.kelas || '').trim() !== String(kelas || '').trim());
  if (wrongClass.length > 0) {
    const names = wrongClass.slice(0, 3).map((student) => `${student.name} (${student.nis})`).join(', ');
    return { error: `Siswa berikut bukan anggota kelas ${kelas}: ${names}.` };
  }
  return { valid: true, students: selected };
}

function groupSiswaIdsByJadwal(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row || !row.jadwal_id || !row.siswa_id) continue;
    if (!map.has(row.jadwal_id)) map.set(row.jadwal_id, []);
    map.get(row.jadwal_id).push(row.siswa_id);
  }
  return map;
}

/**
 * Jadwal tanpa link siswa adalah jadwal lama yang berlaku untuk seluruh kelas.
 * Jadwal dengan link hanya terlihat oleh siswa yang terdaftar di link tersebut.
 */
function isScheduleVisibleToStudent(jadwalId, linksByJadwal, siswaId) {
  const assigned = linksByJadwal.get(jadwalId) || [];
  return assigned.length === 0 || assigned.includes(siswaId);
}

module.exports = {
  MAX_SISWA_PER_JADWAL,
  normalizeSiswaIds,
  validateStudentSelection,
  groupSiswaIdsByJadwal,
  isScheduleVisibleToStudent
};
