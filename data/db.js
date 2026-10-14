/**
 * SiPresensi - Supabase Database Client
 * Menggantikan MySQL dengan Supabase PostgREST Client
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rxcagbqeoevmfcbncmfd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_tan5CwGU9E-FM8NeCZ3oSw_IafCpIeQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// Test koneksi ke Supabase saat module dimuat
(async () => {
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) {
      console.warn('⚠️  Supabase warning:', error.message);
    } else {
      console.log('✅ Terhubung ke Supabase Database Cloud:', SUPABASE_URL);
    }
  } catch (err) {
    console.error('❌ Gagal menghubungi Supabase:', err.message);
  }
})();

// ─── USER AUTH HELPERS ────────────────────────────────────────────

async function findUserByEmail(identifier) {
  if (!identifier) return null;
  const clean = String(identifier).trim();
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .or(`email.ilike.${clean},nis.eq.${clean},nip.eq.${clean}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('findUserByEmail error:', error.message);
    return null;
  }
  return data || null;
}

async function findUserById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('findUserById error:', error.message);
    return null;
  }
  return data || null;
}

async function findUserByRole(role) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('role', role)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('findUserByRole error:', error.message);
    return null;
  }
  return data || null;
}

async function findUserByEmailOrNis(email, nis) {
  const cleanEmail = email ? String(email).trim() : '';
  const cleanNis   = nis ? String(nis).trim() : '';
  let query = supabase.from('users').select('*');

  if (cleanEmail && cleanNis) {
    query = query.or(`email.ilike.${cleanEmail},nis.eq.${cleanNis}`);
  } else if (cleanEmail) {
    query = query.ilike('email', cleanEmail);
  } else if (cleanNis) {
    query = query.eq('nis', cleanNis);
  } else {
    return null;
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) {
    console.error('findUserByEmailOrNis error:', error.message);
    return null;
  }
  return data || null;
}

async function createUser(user) {
  const { id, email, password, name, role, title, nip, nis, kelas, phone, avatar } = user;
  const payload = {
    id,
    email: email.trim(),
    password,
    name: name.trim(),
    role: role || 'siswa',
    title: title || (role === 'siswa' ? `Siswa - ${kelas || ''}` : 'Guru'),
    nip: nip || null,
    nis: nis || null,
    kelas: kelas || null,
    phone: phone || null,
    avatar: avatar || name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  };

  const { data, error } = await supabase
    .from('users')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .maybeSingle();

  if (error) throw error;
  return data || payload;
}

async function updateUserPassword(id, hashedPassword) {
  const { error } = await supabase
    .from('users')
    .update({ password: hashedPassword })
    .eq('id', id);

  if (error) throw error;
  return true;
}

async function updateUser(id, data) {
  const allowed = ['name', 'email', 'password', 'role', 'title', 'nip', 'nis', 'kelas', 'phone', 'avatar'];
  const payload = {};
  for (const [key, val] of Object.entries(data)) {
    if (allowed.includes(key) && val !== undefined) {
      payload[key] = val;
    }
  }

  if (Object.keys(payload).length === 0) return null;

  const { data: updated, error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw error;
  return updated || findUserById(id);
}

async function deleteUserByNis(nis) {
  const { error } = await supabase.from('users').delete().eq('nis', nis);
  if (error) throw error;
}

async function deleteUserByNip(nip) {
  const { error } = await supabase.from('users').delete().eq('nip', nip);
  if (error) throw error;
}

async function deleteUserByNisOrEmail(nis, email) {
  if (nis && email) {
    const { error } = await supabase.from('users').delete().or(`nis.eq.${nis},email.eq.${email}`);
    if (error) throw error;
  } else if (nis) {
    await deleteUserByNis(nis);
  } else if (email) {
    const { error } = await supabase.from('users').delete().eq('email', email);
    if (error) throw error;
  }
}

// ─── SISWA ────────────────────────────────────────────────────────

async function getSiswa({ kelas, status, q } = {}) {
  let query = supabase.from('siswa').select('*');

  if (kelas && kelas !== 'Semua Kelas' && kelas !== 'all') {
    query = query.ilike('kelas', kelas);
  }
  if (status && status !== 'Semua') {
    query = query.ilike('status', status);
  }
  if (q) {
    query = query.or(`name.ilike.%${q}%,nis.ilike.%${q}%,kelas.ilike.%${q}%`);
  }

  const { data, error } = await query.order('nis', { ascending: true });
  if (error) {
    console.error('getSiswa error:', error.message);
    return [];
  }
  return data || [];
}

async function getSiswaLimit(limit = 8) {
  const { data, error } = await supabase
    .from('siswa')
    .select('*')
    .order('nis', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('getSiswaLimit error:', error.message);
    return [];
  }
  return data || [];
}

async function findSiswaByNis(nis) {
  const { data, error } = await supabase
    .from('siswa')
    .select('*')
    .eq('nis', String(nis).trim())
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function findSiswaByIdOrNis(idOrNis) {
  const clean = String(idOrNis).trim();
  const { data, error } = await supabase
    .from('siswa')
    .select('*')
    .or(`id.eq.${clean},nis.eq.${clean}`)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function addSiswa(data) {
  const payload = {
    id: data.id,
    nis: String(data.nis).trim(),
    name: data.name.trim(),
    kelas: data.kelas.trim(),
    gender: data.gender || 'Laki-laki',
    phone: data.phone ? data.phone.trim() : '-',
    email: data.email || null,
    status: data.status || 'Aktif'
  };

  const { data: created, error } = await supabase
    .from('siswa')
    .insert(payload)
    .select()
    .maybeSingle();

  if (error) throw error;
  return created || payload;
}

async function updateSiswa(id, data) {
  const existing = await findSiswaByIdOrNis(id);
  if (!existing) return null;

  const payload = {
    nis: data.nis !== undefined ? String(data.nis).trim() : existing.nis,
    name: data.name !== undefined ? data.name.trim() : existing.name,
    kelas: data.kelas !== undefined ? data.kelas.trim() : existing.kelas,
    gender: data.gender !== undefined ? data.gender : existing.gender,
    phone: data.phone !== undefined ? data.phone.trim() : existing.phone,
    email: data.email !== undefined ? data.email.trim() : existing.email,
    status: data.status !== undefined ? data.status : existing.status
  };

  const { data: updated, error } = await supabase
    .from('siswa')
    .update(payload)
    .eq('id', existing.id)
    .select()
    .maybeSingle();

  if (error) throw error;
  return updated || { ...existing, ...payload };
}

async function deleteSiswa(id) {
  const existing = await findSiswaByIdOrNis(id);
  if (!existing) return null;

  const { error } = await supabase.from('siswa').delete().eq('id', existing.id);
  if (error) throw error;
  return existing;
}

async function countSiswa() {
  const { count, error } = await supabase.from('siswa').select('*', { count: 'exact', head: true });
  if (error) {
    console.error('countSiswa error:', error.message);
    return 0;
  }
  return count || 0;
}

// ─── GURU ─────────────────────────────────────────────────────────

async function getGuru({ mapel, q } = {}) {
  let query = supabase.from('guru').select('*');

  if (mapel && mapel !== 'Semua Mata Pelajaran') {
    query = query.ilike('mapel', `%${mapel}%`);
  }
  if (q) {
    query = query.or(`name.ilike.%${q}%,nip.ilike.%${q}%,mapel.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data, error } = await query.order('name', { ascending: true });
  if (error) {
    console.error('getGuru error:', error.message);
    return [];
  }
  return data || [];
}

async function findGuruByNip(nip) {
  const { data, error } = await supabase
    .from('guru')
    .select('*')
    .eq('nip', String(nip).trim())
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function findGuruByIdOrNip(idOrNip) {
  const clean = String(idOrNip).trim();
  const { data, error } = await supabase
    .from('guru')
    .select('*')
    .or(`id.eq.${clean},nip.eq.${clean}`)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function addGuru(data) {
  const payload = {
    id: data.id,
    nip: String(data.nip).trim(),
    name: data.name.trim(),
    mapel: data.mapel.trim(),
    phone: data.phone ? data.phone.trim() : '-',
    email: data.email || null
  };

  const { data: created, error } = await supabase
    .from('guru')
    .insert(payload)
    .select()
    .maybeSingle();

  if (error) throw error;
  return created || payload;
}

async function updateGuru(id, data) {
  const existing = await findGuruByIdOrNip(id);
  if (!existing) return null;

  const payload = {
    nip: data.nip !== undefined ? String(data.nip).trim() : existing.nip,
    name: data.name !== undefined ? data.name.trim() : existing.name,
    mapel: data.mapel !== undefined ? data.mapel.trim() : existing.mapel,
    phone: data.phone !== undefined ? data.phone.trim() : existing.phone,
    email: data.email !== undefined ? data.email.trim() : existing.email
  };

  const { data: updated, error } = await supabase
    .from('guru')
    .update(payload)
    .eq('id', existing.id)
    .select()
    .maybeSingle();

  if (error) throw error;
  return updated || { ...existing, ...payload };
}

async function deleteGuru(id) {
  const existing = await findGuruByIdOrNip(id);
  if (!existing) return null;

  const { error } = await supabase.from('guru').delete().eq('id', existing.id);
  if (error) throw error;
  return existing;
}

async function countGuru() {
  const { count, error } = await supabase.from('guru').select('*', { count: 'exact', head: true });
  if (error) {
    console.error('countGuru error:', error.message);
    return 0;
  }
  return count || 0;
}

// ─── KELAS ────────────────────────────────────────────────────────

async function getKelas() {
  const { data, error } = await supabase.from('kelas').select('*').order('name', { ascending: true });
  if (error) {
    console.error('getKelas error:', error.message);
    return [];
  }
  return data || [];
}

async function findKelasByName(name) {
  const { data, error } = await supabase
    .from('kelas')
    .select('*')
    .ilike('name', String(name).trim())
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function findKelasByIdOrName(idOrName) {
  const clean = String(idOrName).trim();
  const { data, error } = await supabase
    .from('kelas')
    .select('*')
    .or(`id.eq.${clean},name.ilike.${clean}`)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function addKelas(data) {
  const payload = {
    id: data.id,
    name: data.name.trim(),
    total_siswa: parseInt(data.totalSiswa, 10) || 0,
    wali_kelas: data.waliKelas || 'Belum Ditentukan',
    ruangan: data.ruangan || '-'
  };

  const { data: created, error } = await supabase
    .from('kelas')
    .insert(payload)
    .select()
    .maybeSingle();

  if (error) throw error;
  return created || payload;
}

async function updateKelas(id, data) {
  const existing = await findKelasByIdOrName(id);
  if (!existing) return null;

  const payload = {};
  if (data.name !== undefined)       payload.name = data.name.trim();
  if (data.totalSiswa !== undefined)  payload.total_siswa = parseInt(data.totalSiswa, 10);
  if (data.waliKelas !== undefined)   payload.wali_kelas = data.waliKelas.trim();
  if (data.ruangan !== undefined)     payload.ruangan = data.ruangan.trim();

  const { data: updated, error } = await supabase
    .from('kelas')
    .update(payload)
    .eq('id', existing.id)
    .select()
    .maybeSingle();

  if (error) throw error;
  return updated || { ...existing, ...payload };
}

async function deleteKelas(id) {
  const existing = await findKelasByIdOrName(id);
  if (!existing) return null;

  const { error } = await supabase.from('kelas').delete().eq('id', existing.id);
  if (error) throw error;
  return existing;
}

// ─── ABSENSI ──────────────────────────────────────────────────────

async function getAbsensi({ kelas, tanggal, q } = {}) {
  let query = supabase.from('absensi').select('*');

  if (kelas)   query = query.ilike('kelas', kelas);
  if (tanggal) query = query.eq('date', tanggal);
  if (q)       query = query.or(`student_name.ilike.%${q}%,nis.ilike.%${q}%`);

  const { data, error } = await query
    .order('date', { ascending: false })
    .order('nis', { ascending: true });

  if (error) {
    console.error('getAbsensi error:', error.message);
    return [];
  }
  return data || [];
}

async function getAbsensiRiwayat({ kelas, tanggal, startDate, endDate } = {}) {
  let query = supabase.from('absensi').select('*');

  if (kelas && kelas !== 'Semua Kelas' && kelas !== 'all') {
    query = query.ilike('kelas', kelas);
  }
  if (tanggal && tanggal.trim() !== '') {
    query = query.eq('date', tanggal.trim());
  }
  if (startDate) query = query.gte('date', startDate);
  if (endDate)   query = query.lte('date', endDate);

  const { data, error } = await query
    .order('date', { ascending: false })
    .order('kelas', { ascending: true });

  if (error) {
    console.error('getAbsensiRiwayat error:', error.message);
    return [];
  }
  return data || [];
}

async function getAbsensiByNisRange(nis, startDate, endDate) {
  let query = supabase.from('absensi').select('status').eq('nis', nis);
  if (startDate) query = query.gte('date', startDate);
  if (endDate)   query = query.lte('date', endDate);

  const { data, error } = await query;
  if (error) {
    console.error('getAbsensiByNisRange error:', error.message);
    return [];
  }
  return data || [];
}

async function upsertAbsensi(data) {
  const { id, date, kelas, mapel, nis, studentName, status, checkIn, checkOut, note } = data;

  const { data: existing } = await supabase
    .from('absensi')
    .select('id')
    .eq('nis', nis)
    .eq('date', date)
    .eq('kelas', kelas)
    .maybeSingle();

  if (existing) {
    const payload = {
      status,
      check_in: checkIn || '-',
      check_out: checkOut || '-',
      note: note || null,
      mapel: mapel || null,
      student_name: studentName || null
    };
    const { data: updated, error } = await supabase
      .from('absensi')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    return updated;
  } else {
    const payload = {
      id: id || ('abs-' + Date.now() + '-' + nis),
      date,
      kelas,
      mapel: mapel || null,
      nis,
      student_name: studentName || null,
      status,
      check_in: checkIn || '-',
      check_out: checkOut || '-',
      note: note || null
    };
    const { data: created, error } = await supabase
      .from('absensi')
      .insert(payload)
      .select()
      .maybeSingle();

    if (error) throw error;
    return created;
  }
}

// ─── STUDENT LOGS ─────────────────────────────────────────────────

async function getStudentLogs(nis) {
  const { data, error } = await supabase
    .from('student_logs')
    .select('*')
    .eq('nis', nis)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getStudentLogs error:', error.message);
    return [];
  }
  return data || [];
}

async function findStudentLogByNisAndDate(nis, dateMatch) {
  const { data, error } = await supabase
    .from('student_logs')
    .select('*')
    .eq('nis', nis)
    .ilike('tgl', `%${dateMatch}%`)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function findStudentLogById(id) {
  const { data, error } = await supabase
    .from('student_logs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function updateStudentLogIn(id, masukTime) {
  const { data, error } = await supabase
    .from('student_logs')
    .update({ masuk: masukTime })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function addStudentLog(data) {
  const payload = {
    id: data.id || ('log-' + Date.now()),
    nis: data.nis,
    tgl: data.tgl,
    masuk: data.masuk || '-',
    keluar: data.keluar || '-',
    zona: data.zona || null,
    status: data.status || 'hadir',
    status_text: data.statusText || null,
    valid: data.valid ? 1 : 0,
    durasi: data.durasi || '-'
  };

  const { data: created, error } = await supabase
    .from('student_logs')
    .insert(payload)
    .select()
    .maybeSingle();

  if (error) throw error;
  return created || payload;
}

async function updateStudentLogCheckOut(nis, keluar) {
  const { data: latest } = await supabase
    .from('student_logs')
    .select('id')
    .eq('nis', nis)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) {
    const { data: updated, error } = await supabase
      .from('student_logs')
      .update({ keluar })
      .eq('id', latest.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    return updated;
  }
  return null;
}

async function getActiveStudentTracker(nis) {
  const { data, error } = await supabase
    .from('student_logs')
    .select('*')
    .eq('nis', nis)
    .eq('keluar', '-')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function stopStudentTracker(nis, keluarTime, durasi) {
  const active = await getActiveStudentTracker(nis);
  if (active) {
    const { data: updated, error } = await supabase
      .from('student_logs')
      .update({
        keluar: keluarTime,
        durasi: durasi || '-',
        status_text: `Selesai (${durasi || keluarTime})`
      })
      .eq('id', active.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    return updated;
  }
  return null;
}

// ─── PENGATURAN ───────────────────────────────────────────────────

async function getPengaturan() {
  const { data, error } = await supabase
    .from('pengaturan')
    .select('*')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      sekolah: 'SMA Negeri 1 Jakarta',
      ta: '2024/2025 Ganjil',
      jamMasuk: '07:00 WIB',
      toleransi: '15 Menit',
      emailNotif: true,
      whatsappRekap: false,
      bahasa: 'Bahasa Indonesia'
    };
  }
  return {
    sekolah: data.sekolah,
    ta: data.ta,
    jamMasuk: data.jam_masuk,
    toleransi: data.toleransi,
    emailNotif: !!data.email_notif,
    whatsappRekap: !!data.whatsapp_rekap,
    bahasa: data.bahasa
  };
}

async function savePengaturan(data) {
  const { data: existing } = await supabase
    .from('pengaturan')
    .select('id')
    .limit(1)
    .maybeSingle();

  const payload = {
    sekolah: data.sekolah || 'SMA Negeri 1 Jakarta',
    ta: data.ta || '2024/2025 Ganjil',
    jam_masuk: data.jamMasuk || '07:00 WIB',
    toleransi: data.toleransi || '15 Menit',
    email_notif: data.emailNotif ? 1 : 0,
    whatsapp_rekap: data.whatsappRekap ? 1 : 0,
    bahasa: data.bahasa || 'Bahasa Indonesia'
  };

  if (existing) {
    await supabase.from('pengaturan').update(payload).eq('id', existing.id);
  } else {
    await supabase.from('pengaturan').insert(payload);
  }
  return getPengaturan();
}

// ─── PROFIL SEKOLAH ───────────────────────────────────────────────

async function getProfilSekolah() {
  const { data, error } = await supabase
    .from('profil_sekolah')
    .select('*')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      nama: 'SMA Negeri 1 Jakarta',
      npsn: '20101589',
      akreditasi: 'A (Unggul)',
      alamat: 'Jl. Budi Utomo No.7, Ps. Baru, Sawah Besar, Jakarta Pusat',
      email: 'info@sman1jkt.sch.id',
      telepon: '(021) 3865001',
      kepsek: 'Dr. H. Sudirman, M.Pd.',
      nipKepsek: '196803151992031004',
      kurikulum: 'Kurikulum Merdeka'
    };
  }
  return {
    nama: data.nama,
    npsn: data.npsn,
    akreditasi: data.akreditasi,
    alamat: data.alamat,
    email: data.email,
    telepon: data.telepon,
    kepsek: data.kepsek,
    nipKepsek: data.nip_kepsek,
    kurikulum: data.kurikulum
  };
}

async function saveProfilSekolah(data) {
  const { data: existing } = await supabase
    .from('profil_sekolah')
    .select('id')
    .limit(1)
    .maybeSingle();

  const payload = {
    nama: data.nama,
    npsn: data.npsn,
    akreditasi: data.akreditasi,
    alamat: data.alamat,
    email: data.email,
    telepon: data.telepon,
    kepsek: data.kepsek,
    nip_kepsek: data.nipKepsek,
    kurikulum: data.kurikulum
  };

  if (existing) {
    await supabase.from('profil_sekolah').update(payload).eq('id', existing.id);
  } else {
    await supabase.from('profil_sekolah').insert(payload);
  }
  return getProfilSekolah();
}

// ─── NOTIFIKASI ───────────────────────────────────────────────────

async function getNotifikasi() {
  const { data, error } = await supabase
    .from('notifikasi')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getNotifikasi error:', error.message);
    return [];
  }
  return data || [];
}

module.exports = {
  supabase,
  // Auth & User Management
  findUserByEmail,
  findUserById,
  findUserByRole,
  findUserByEmailOrNis,
  createUser,
  updateUserPassword,
  updateUser,
  deleteUserByNis,
  deleteUserByNip,
  deleteUserByNisOrEmail,
  // Siswa
  getSiswa,
  getSiswaLimit,
  findSiswaByNis,
  findSiswaByIdOrNis,
  addSiswa,
  updateSiswa,
  deleteSiswa,
  countSiswa,
  // Guru
  getGuru,
  findGuruByNip,
  findGuruByIdOrNip,
  addGuru,
  updateGuru,
  deleteGuru,
  countGuru,
  // Kelas
  getKelas,
  findKelasByName,
  findKelasByIdOrName,
  addKelas,
  updateKelas,
  deleteKelas,
  // Absensi
  getAbsensi,
  getAbsensiRiwayat,
  getAbsensiByNisRange,
  upsertAbsensi,
  // Student Logs
  getStudentLogs,
  findStudentLogByNisAndDate,
  findStudentLogById,
  updateStudentLogIn,
  addStudentLog,
  updateStudentLogCheckOut,
  getActiveStudentTracker,
  stopStudentTracker,
  // Pengaturan
  getPengaturan,
  savePengaturan,
  // Profil Sekolah
  getProfilSekolah,
  saveProfilSekolah,
  // Notifikasi
  getNotifikasi
};
