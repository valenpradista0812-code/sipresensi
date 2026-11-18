const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  prepareCreateAccount,
  prepareEditAccount,
  findDuplicateNip,
  findDuplicateNis,
  sanitizeSearchTerm
} = require('../utils/akun-validation');
const { parseWaliAssignment } = require('../utils/akun-wali');
const { normalizeRfidUid, isRfidUniqueViolation } = require('../utils/rfid-uid');

const EDITABLE_FIELDS = ['name', 'email', 'password', 'phone', 'nip', 'mapel', 'nis', 'kelas', 'rfid_uid', 'isWaliKelas', 'waliKelasId'];

function safeAccount(account) {
  if (!account) return {};
  const { password: _password, ...safe } = account;
  return safe;
}

function profileMaps(guruList, siswaList) {
  const guruByUserId = new Map();
  const guruByNip = new Map();
  const siswaByNis = new Map();
  const siswaByEmail = new Map();

  for (const guru of guruList || []) {
    if (guru.user_id) guruByUserId.set(guru.user_id, guru);
    if (guru.nip) guruByNip.set(String(guru.nip), guru);
  }
  for (const siswa of siswaList || []) {
    if (siswa.nis) siswaByNis.set(String(siswa.nis), siswa);
    if (siswa.email) siswaByEmail.set(String(siswa.email).toLowerCase(), siswa);
  }
  return { guruByUserId, guruByNip, siswaByNis, siswaByEmail };
}

function enrichAccount(account, maps) {
  const safe = safeAccount(account);
  if (account.role === 'guru') {
    const profile = maps.guruByUserId.get(account.id) || (account.nip ? maps.guruByNip.get(String(account.nip)) : null);
    safe.profileId = profile?.id || null;
    safe.mapel = profile?.mapel || null;
    safe.rfid_uid = profile?.rfid_uid || null;
    safe.hasGuruProfile = Boolean(profile);
  } else if (account.role === 'siswa') {
    const profile = (account.nis ? maps.siswaByNis.get(String(account.nis)) : null) ||
      (account.email ? maps.siswaByEmail.get(String(account.email).toLowerCase()) : null);
    safe.profileId = profile?.id || null;
    safe.rfid_uid = profile?.rfid_uid || null;
    safe.hasSiswaProfile = Boolean(profile);
  }
  return safe;
}

async function currentProfiles(account) {
  if (account.role === 'guru') {
    const byUser = await db.findGuruByUserId(account.id);
    if (byUser) return { guru: byUser, siswa: null };
    const byNip = account.nip ? await db.findGuruByNip(account.nip) : null;
    return { guru: byNip, siswa: null };
  }
  if (account.role === 'siswa') {
    const byNis = account.nis ? await db.findSiswaByNis(account.nis) : null;
    return { guru: null, siswa: byNis };
  }
  return { guru: null, siswa: null };
}

async function findRfidOwner(uid) {
  const [student, teacher] = await Promise.all([
    db.findSiswaByRfidUid(uid),
    db.findGuruByRfidUid(uid)
  ]);
  return student || teacher || null;
}

// GET /api/akun - daftar seluruh akun, filter role dan pencarian
router.get('/', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const role = ['guru', 'siswa', 'petugas'].includes(req.query.role) ? req.query.role : undefined;
    const q = sanitizeSearchTerm(req.query.q);
    const [list, guruList, siswaList, kelasList] = await Promise.all([
      db.getUsers({ role, q: q || undefined }),
      db.getGuru(),
      db.getSiswa(),
      db.getKelas()
    ]);
    const maps = profileMaps(guruList, siswaList);
    const waliMap = {};
    for (const k of kelasList) {
      if (k.wali_kelas_id && !waliMap[k.wali_kelas_id]) {
        waliMap[k.wali_kelas_id] = { waliKelas: k.name, waliKelasId: k.id };
      }
    }
    const data = list.map((account) => {
      const enriched = enrichAccount(account, maps);
      if (account.role === 'guru' && enriched.profileId) {
        const wali = waliMap[enriched.profileId] || null;
        enriched.waliKelas   = wali ? wali.waliKelas   : null;
        enriched.waliKelasId = wali ? wali.waliKelasId : null;
      }
      return enriched;
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('getAkun error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat daftar akun.' });
  }
});

// POST /api/akun - satu form untuk Guru, Siswa, dan Petugas
router.post('/', authenticate, requireRole('petugas'), async (req, res) => {
  let account = null;
  let profile = null;
  try {
    const prepared = prepareCreateAccount(req.body);
    if (prepared.error) return res.status(400).json({ success: false, message: prepared.error });
    const data = prepared.data;
    let rfidUid = null;

    if (data.role === 'siswa') {
      rfidUid = normalizeRfidUid(req.body.rfid_uid);
      const classRecord = await db.findKelasByName(data.kelas);
      if (!classRecord) return res.status(400).json({ success: false, message: 'Kelas tidak ditemukan.' });
      data.kelas = classRecord.name;
    } else if (data.role === 'guru') {
      rfidUid = normalizeRfidUid(req.body.rfid_uid);
    }

    if (rfidUid) {
      const existingCard = await findRfidOwner(rfidUid);
      if (existingCard) {
        return res.status(409).json({ success: false, message: `UID RFID sudah terdaftar atas nama ${existingCard.name}.` });
      }
    }

    if (await db.findUserByEmail(data.email)) {
      return res.status(409).json({ success: false, message: 'Email/username sudah digunakan oleh akun lain.' });
    }

    const [users, guruList, siswaList] = await Promise.all([
      db.getUsers({}),
      db.getGuru(),
      db.getSiswa()
    ]);

    const nipDuplicate = findDuplicateNip({ users, guruProfiles: guruList, nip: data.nip });
    if (nipDuplicate) {
      return res.status(409).json({ success: false, message: 'NIP sudah digunakan oleh akun atau data guru lain.' });
    }
    const nisDuplicate = findDuplicateNis({ users, siswaProfiles: siswaList, nis: data.nis });
    if (nisDuplicate) {
      return res.status(409).json({ success: false, message: 'NIS/NISN sudah digunakan oleh akun atau data siswa lain.' });
    }

    // Validasi penugasan wali sebelum membuat akun/profil.
    const waliResult = parseWaliAssignment(data.role, req.body);
    if (waliResult.error) {
      return res.status(400).json({ success: false, message: waliResult.error });
    }
    let targetKelas = null;
    if (waliResult.assign) {
      targetKelas = await db.findKelasByIdOrName(waliResult.kelasId);
      if (!targetKelas) {
        return res.status(400).json({ success: false, message: 'Kelas wali tidak ditemukan.' });
      }
    }

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const accountId = `usr-${data.role}-${suffix}`;
    const initials = data.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U';

    account = await db.createUser({
      id: accountId,
      email: data.email,
      password: bcrypt.hashSync(data.password, 10),
      name: data.name,
      role: data.role,
      title: data.title,
      nip: data.nip,
      nis: data.nis,
      kelas: data.kelas,
      phone: data.phone,
      avatar: initials
    });

    if (data.role === 'guru') {
      profile = await db.addGuru({
        id: `guru-${suffix}`,
        nip: data.nip,
        name: data.name,
        mapel: data.mapel,
        phone: data.phone || '-',
        email: data.email,
        user_id: account.id,
        rfid_uid: rfidUid
      });
      if (waliResult.assign) {
        await db.assignWaliKelas(targetKelas.id, { id: profile.id, name: profile.name });
      }
    } else if (data.role === 'siswa') {
      profile = await db.addSiswa({
        id: `sis-${suffix}`,
        nis: data.nis,
        name: data.name,
        kelas: data.kelas,
        gender: req.body.gender || 'Laki-laki',
        phone: data.phone || '-',
        email: data.email,
        rfid_uid: rfidUid
      });
    }

    const response = {
      ...safeAccount(account),
      profileId: profile?.id || null,
      hasGuruProfile: data.role === 'guru',
      hasSiswaProfile: data.role === 'siswa'
    };
    if (data.role === 'siswa' || data.role === 'guru') response.rfid_uid = profile?.rfid_uid || null;
    if (data.role === 'guru') response.mapel = data.mapel;

    const profileNote = data.role === 'petugas' ? '' : ' Profil terkait juga dibuat dan terhubung.';
    res.status(201).json({
      success: true,
      message: `Akun ${data.role} berhasil dibuat.${profileNote}`,
      data: response
    });
  } catch (err) {
    // Kompensasi agar tidak meninggalkan akun/profil yatim.
    if (profile) {
      try {
        if (req.body.role === 'guru') await db.deleteGuru(profile.id);
        if (req.body.role === 'siswa') await db.deleteSiswa(profile.id);
      } catch (cleanupError) {
        console.error('rollback profil akun error:', cleanupError);
      }
    }
    if (account?.id) {
      try { await db.deleteUserById(account.id); } catch (cleanupError) { console.error('rollback akun error:', cleanupError); }
    }
    if (err.statusCode === 400) return res.status(400).json({ success: false, message: err.message });
    if (isRfidUniqueViolation(err)) {
      return res.status(409).json({ success: false, message: 'UID RFID sudah terdaftar pada akun lain.' });
    }
    console.error('createAkun error:', err);
    res.status(500).json({ success: false, message: 'Gagal membuat akun.' });
  }
});

// PUT /api/akun/:id - edit akun dan sinkronkan profil Guru/Siswa
router.put('/:id', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const account = await db.findUserById(req.params.id);
    if (!account) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
    if (!EDITABLE_FIELDS.some((field) => req.body[field] !== undefined)) {
      return res.status(400).json({ success: false, message: 'Tidak ada perubahan yang dikirim.' });
    }

    const profiles = await currentProfiles(account);
    const prepared = prepareEditAccount({ ...account, mapel: profiles.guru?.mapel }, req.body);
    if (prepared.error) return res.status(400).json({ success: false, message: prepared.error });
    const data = prepared.data;
    if (account.role === 'siswa' && !data.kelas && !account.kelas) data.title = 'Siswa';
    let rfidUid;
    if (account.role === 'siswa' && data.kelas !== undefined) {
      const classRecord = await db.findKelasByName(data.kelas);
      if (!classRecord) return res.status(400).json({ success: false, message: 'Kelas tidak ditemukan.' });
      data.kelas = classRecord.name;
      data.title = `Siswa - ${data.kelas}`;
    }
    if (account.role === 'siswa' && Object.prototype.hasOwnProperty.call(req.body, 'rfid_uid')) {
      rfidUid = normalizeRfidUid(req.body.rfid_uid);
    } else if (account.role === 'guru' && Object.prototype.hasOwnProperty.call(req.body, 'rfid_uid')) {
      rfidUid = normalizeRfidUid(req.body.rfid_uid);
    }
    if (rfidUid) {
      const existingCard = await findRfidOwner(rfidUid);
      const ownProfile = account.role === 'guru' ? profiles.guru : profiles.siswa;
      if (existingCard && existingCard.id !== ownProfile?.id) {
        return res.status(409).json({ success: false, message: `UID RFID sudah terdaftar atas nama ${existingCard.name}.` });
      }
    }

    if (data.email && data.email !== String(account.email || '').toLowerCase()) {
      const duplicate = await db.findUserByEmail(data.email);
      if (duplicate && duplicate.id !== account.id) {
        return res.status(409).json({ success: false, message: 'Email/username sudah digunakan oleh akun lain.' });
      }
    }

    const [users, guruList, siswaList] = await Promise.all([
      db.getUsers({}),
      db.getGuru(),
      db.getSiswa()
    ]);

    if (account.role === 'guru' && data.nip) {
      const duplicate = findDuplicateNip({
        users,
        guruProfiles: guruList,
        nip: data.nip,
        accountId: account.id,
        guruProfileId: profiles.guru?.id
      });
      if (duplicate) return res.status(409).json({ success: false, message: 'NIP sudah digunakan oleh akun atau data guru lain.' });
    }
    if (account.role === 'siswa' && data.nis) {
      const duplicate = findDuplicateNis({
        users,
        siswaProfiles: siswaList,
        nis: data.nis,
        accountId: account.id,
        siswaProfileId: profiles.siswa?.id
      });
      if (duplicate) return res.status(409).json({ success: false, message: 'NIS/NISN sudah digunakan oleh akun atau data siswa lain.' });
    }

    // Profil baru hanya boleh dibuat jika identitas wajibnya lengkap.
    const effectiveNis = data.nis !== undefined ? data.nis : account.nis;
    const effectiveKelas = data.kelas !== undefined ? data.kelas : account.kelas;
    const effectiveNip = data.nip !== undefined ? data.nip : account.nip;
    if (account.role === 'siswa' && !profiles.siswa && (!effectiveNis || !effectiveKelas)) {
      return res.status(400).json({ success: false, message: 'Akun siswa ini belum memiliki profil. Isi NIS/NISN dan kelas untuk membuat profil.' });
    }
    if (account.role === 'guru' && !profiles.guru && (!effectiveNip || !(data.mapel || profiles.guru?.mapel))) {
      return res.status(400).json({ success: false, message: 'Akun guru ini belum memiliki profil. Isi NIP dan mata pelajaran untuk membuat profil.' });
    }

    const userPayload = {};
    if (data.name !== undefined) userPayload.name = data.name;
    if (data.email !== undefined) userPayload.email = data.email;
    if (data.password !== undefined) userPayload.password = bcrypt.hashSync(data.password, 10);
    if (data.phone !== undefined) userPayload.phone = data.phone;
    if (account.role === 'siswa') {
      if (data.nis !== undefined) userPayload.nis = data.nis;
      if (data.kelas !== undefined) userPayload.kelas = data.kelas;
    } else if (account.role === 'guru' && data.nip !== undefined) {
      userPayload.nip = data.nip;
    }
    userPayload.title = data.title;

    const updated = await db.updateUser(account.id, userPayload);
    if (!updated) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });

    try {
      if (account.role === 'guru') {
        const profilePayload = {};
        if (data.nip !== undefined) profilePayload.nip = data.nip;
        if (data.name !== undefined) profilePayload.name = data.name;
        if (data.mapel !== undefined) profilePayload.mapel = data.mapel;
        if (data.email !== undefined) profilePayload.email = data.email;
        if (data.phone !== undefined) profilePayload.phone = data.phone || '-';
        if (rfidUid !== undefined) profilePayload.rfid_uid = rfidUid;

        let profile = profiles.guru;
        if (profile) {
          await db.updateGuru(profile.id, profilePayload);
        } else {
          profile = await db.addGuru({
            id: `guru-${account.id}`.slice(0, 50),
            nip: effectiveNip,
            name: data.name || account.name,
            mapel: data.mapel || 'Belum Ditentukan',
            phone: (data.phone !== undefined ? data.phone : account.phone) || '-',
            email: data.email || account.email,
            user_id: account.id,
            rfid_uid: rfidUid === undefined ? null : rfidUid
          });
        }
        if (profile) {
          await db.updateUser(account.id, { title: `Guru ${data.mapel !== undefined ? data.mapel : profile.mapel}`.trim() });
        }
      } else if (account.role === 'siswa') {
        const profilePayload = {};
        if (data.nis !== undefined) profilePayload.nis = data.nis;
        if (data.name !== undefined) profilePayload.name = data.name;
        if (data.kelas !== undefined) profilePayload.kelas = data.kelas;
        if (data.email !== undefined) profilePayload.email = data.email;
        if (data.phone !== undefined) profilePayload.phone = data.phone || '-';
        if (rfidUid !== undefined) profilePayload.rfid_uid = rfidUid;

        if (profiles.siswa) {
          await db.updateSiswa(profiles.siswa.id, profilePayload);
        } else {
          await db.addSiswa({
            id: `sis-${account.id}`.slice(0, 50),
            nis: effectiveNis,
            name: data.name || account.name,
            kelas: effectiveKelas,
            gender: 'Laki-laki',
            phone: (data.phone !== undefined ? data.phone : account.phone) || '-',
            email: data.email || account.email,
            rfid_uid: rfidUid === undefined ? null : rfidUid
          });
        }
      }
    } catch (profileError) {
      // Kembalikan data akun lama jika sinkronisasi profil gagal.
      try {
        await db.updateUser(account.id, {
          name: account.name,
          email: account.email,
          password: account.password,
          title: account.title,
          nip: account.nip,
          nis: account.nis,
          kelas: account.kelas,
          phone: account.phone
        });
      } catch (rollbackError) {
        console.error('rollback akun setelah gagal sync profil:', rollbackError);
      }
      throw profileError;
    }

    // Penanganan penugasan wali kelas (hanya untuk guru yang memiliki profil).
    if (account.role === 'guru' && profiles.guru) {
      const waliResult = parseWaliAssignment(account.role, req.body);
      if (waliResult.error) {
        return res.status(400).json({ success: false, message: waliResult.error });
      }
      if (waliResult.assign) {
        const targetKelas = await db.findKelasByIdOrName(waliResult.kelasId);
        if (!targetKelas) {
          return res.status(400).json({ success: false, message: 'Kelas wali tidak ditemukan.' });
        }
        await db.assignWaliKelas(targetKelas.id, { id: profiles.guru.id, name: profiles.guru.name });
      } else if (waliResult.clear) {
        await db.clearWaliKelas(profiles.guru.id);
      }
      // waliResult.skip: tidak ada perubahan (kompatibilitas — pertahankan status wali yang ada)
    }

    const fresh = await db.findUserById(account.id);
    const maps = profileMaps(await db.getGuru(), await db.getSiswa());
    res.json({ success: true, message: 'Akun dan profil terkait berhasil diperbarui.', data: enrichAccount(fresh, maps) });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ success: false, message: err.message });
    if (isRfidUniqueViolation(err)) {
      return res.status(409).json({ success: false, message: 'UID RFID sudah terdaftar pada akun lain.' });
    }
    console.error('updateAkun error:', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui akun.' });
  }
});

// DELETE /api/akun/:id - hapus akun beserta profil terkait
router.delete('/:id', authenticate, requireRole('petugas'), async (req, res) => {
  try {
    const account = await db.findUserById(req.params.id);
    if (!account) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
    if (account.id === req.user.id) {
      return res.status(409).json({ success: false, message: 'Anda tidak dapat menghapus akun yang sedang digunakan.' });
    }

    if (account.role === 'guru') {
      const teacher = await db.findGuruByUserId(account.id) ||
        (account.nip ? await db.findGuruByNip(account.nip) : null);
      if (teacher) {
        try {
          await db.deleteGuru(teacher.id);
        } catch (err) {
          if (err && err.code === '23503') {
            return res.status(409).json({ success: false, message: 'Guru masih memiliki jadwal aktif; hapus jadwalnya terlebih dahulu.' });
          }
          throw err;
        }
      }
    } else if (account.role === 'siswa') {
      const student = (account.nis ? await db.findSiswaByNis(account.nis) : null);
      if (student) await db.deleteSiswa(student.id);
    }

    await db.deleteUserById(account.id);
    res.json({ success: true, message: 'Akun dan profil terkait berhasil dihapus.', data: { id: account.id } });
  } catch (err) {
    console.error('deleteAkun error:', err);
    res.status(500).json({ success: false, message: 'Gagal menghapus akun.' });
  }
});

module.exports = router;
