const ROLES = ['guru', 'siswa', 'petugas'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeEmail(value) {
  return text(value).toLowerCase();
}

function roleTitle(role, { kelas, mapel } = {}) {
  if (role === 'siswa') return `Siswa - ${text(kelas) || '-'}`;
  if (role === 'guru') return text(mapel) ? `Guru ${text(mapel)}` : 'Guru';
  return 'Petugas';
}

function prepareCreateAccount(body = {}) {
  const role = text(body.role).toLowerCase();
  if (!ROLES.includes(role)) {
    return { error: 'Peran akun harus guru, siswa, atau petugas.' };
  }

  const name = text(body.name);
  const email = normalizeEmail(body.email);
  const password = text(body.password);
  const phone = text(body.phone) || null;

  if (!name) return { error: 'Nama lengkap wajib diisi.' };
  if (name.length > 100) return { error: 'Nama lengkap maksimal 100 karakter.' };
  if (!email) return { error: 'Email wajib diisi.' };
  if (!EMAIL_PATTERN.test(email)) return { error: 'Format email tidak valid.' };
  if (email.length > 100) return { error: 'Email maksimal 100 karakter.' };
  if (password.length < 4) return { error: 'Kata sandi wajib diisi (minimal 4 karakter).' };

  const data = { role, name, email, password, phone, nip: null, nis: null, kelas: null, mapel: null };

  if (role === 'guru') {
    data.nip = text(body.nip);
    data.mapel = text(body.mapel);
    if (!data.nip) return { error: 'NIP wajib diisi untuk akun guru.' };
    if (data.nip.length > 30) return { error: 'NIP maksimal 30 karakter.' };
    if (!data.mapel) return { error: 'Mata pelajaran wajib diisi untuk akun guru.' };
    if (data.mapel.length > 80) return { error: 'Mata pelajaran maksimal 80 karakter.' };
  } else if (role === 'siswa') {
    data.nis = text(body.nis);
    data.kelas = text(body.kelas);
    if (!data.nis) return { error: 'NIS/NISN wajib diisi untuk akun siswa.' };
    if (data.nis.length > 20) return { error: 'NIS/NISN maksimal 20 karakter.' };
    if (!data.kelas) return { error: 'Kelas wajib dipilih untuk akun siswa.' };
    if (data.kelas.length > 30) return { error: 'Kelas maksimal 30 karakter.' };
  }

  data.title = text(body.title) || roleTitle(role, data);
  return { data };
}

function prepareEditAccount(account, body = {}) {
  if (!account) return { error: 'Akun tidak ditemukan.' };
  const role = text(account.role).toLowerCase();
  if (!ROLES.includes(role)) {
    return { error: 'Akun dengan peran ini tidak dapat diubah melalui manajemen akun.' };
  }

  const data = { role };
  if (body.name !== undefined) {
    const name = text(body.name);
    if (!name) return { error: 'Nama lengkap tidak boleh kosong.' };
    if (name.length > 100) return { error: 'Nama lengkap maksimal 100 karakter.' };
    data.name = name;
  }
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (!email) return { error: 'Email tidak boleh kosong.' };
    if (!EMAIL_PATTERN.test(email)) return { error: 'Format email tidak valid.' };
    if (email.length > 100) return { error: 'Email maksimal 100 karakter.' };
    data.email = email;
  }
  if (body.password !== undefined && text(body.password)) {
    const password = text(body.password);
    if (password.length < 4) return { error: 'Kata sandi minimal 4 karakter.' };
    data.password = password;
  }
  if (body.phone !== undefined) data.phone = text(body.phone) || null;

  if (role === 'guru') {
    if (body.nip !== undefined) {
      data.nip = text(body.nip);
      if (!data.nip) return { error: 'NIP tidak boleh kosong.' };
      if (data.nip.length > 30) return { error: 'NIP maksimal 30 karakter.' };
    }
    if (body.mapel !== undefined) {
      data.mapel = text(body.mapel);
      if (!data.mapel) return { error: 'Mata pelajaran tidak boleh kosong.' };
      if (data.mapel.length > 80) return { error: 'Mata pelajaran maksimal 80 karakter.' };
    }
  } else if (role === 'siswa') {
    if (body.nis !== undefined) {
      data.nis = text(body.nis);
      if (!data.nis) return { error: 'NIS/NISN tidak boleh kosong.' };
      if (data.nis.length > 20) return { error: 'NIS/NISN maksimal 20 karakter.' };
    }
    if (body.kelas !== undefined) {
      data.kelas = text(body.kelas);
      if (!data.kelas) return { error: 'Kelas tidak boleh kosong.' };
      if (data.kelas.length > 30) return { error: 'Kelas maksimal 30 karakter.' };
    }
  }

  data.title = roleTitle(role, {
    kelas: data.kelas !== undefined ? data.kelas : account.kelas,
    mapel: data.mapel !== undefined ? data.mapel : account.mapel
  });
  return { data };
}

function findDuplicateNip({ users, guruProfiles, nip, accountId, guruProfileId } = {}) {
  const cleanNip = text(nip);
  if (!cleanNip) return null;

  const duplicateUser = (users || []).find((user) => text(user.nip) === cleanNip && user.id !== accountId);
  if (duplicateUser) return { type: 'user', id: duplicateUser.id, name: duplicateUser.name };

  const duplicateGuru = (guruProfiles || []).find((guru) => {
    if (text(guru.nip) !== cleanNip) return false;
    if (guruProfileId && guru.id === guruProfileId) return false;
    if (guru.user_id && guru.user_id === accountId) return false;
    return true;
  });
  if (duplicateGuru) return { type: 'guru', id: duplicateGuru.id, name: duplicateGuru.name };

  return null;
}

function findDuplicateNis({ users, siswaProfiles, nis, accountId, siswaProfileId } = {}) {
  const cleanNis = text(nis);
  if (!cleanNis) return null;

  const duplicateUser = (users || []).find((user) => text(user.nis) === cleanNis && user.id !== accountId);
  if (duplicateUser) return { type: 'user', id: duplicateUser.id, name: duplicateUser.name };

  const duplicateSiswa = (siswaProfiles || []).find((student) => {
    if (text(student.nis) !== cleanNis) return false;
    if (siswaProfileId && student.id === siswaProfileId) return false;
    return true;
  });
  if (duplicateSiswa) return { type: 'siswa', id: duplicateSiswa.id, name: duplicateSiswa.name };

  return null;
}

function sanitizeSearchTerm(value) {
  return text(value).replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
  ROLES,
  prepareCreateAccount,
  prepareEditAccount,
  findDuplicateNip,
  findDuplicateNis,
  sanitizeSearchTerm,
  roleTitle
};
