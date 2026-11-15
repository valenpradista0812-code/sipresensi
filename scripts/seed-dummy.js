/**
 * SiPresensi - Seed Data Dummy (development/testing)
 * =====================================================
 * Membuat data fiktif untuk menguji fitur jadwal:
 *   - 4 kelas (X-Dev A, X-Dev B, XI-Dev A, XII-Dev A)
 *   - 24 siswa tersebar di 4 kelas, masing-masing dengan akun login
 *   - 6 guru dengan identitas + mata pelajaran dan akun login
 *
 * SIFAT: idempoten. Dapat dijalankan berulang; data existing tidak
 * ditimpa dan tidak dihapus. Hanya membuat yang belum ada, lalu
 * memastikan akun guru/siswa tertaut.
 *
 * PENANDA: seluruh baris dummy memakai email @dev.sipresensi.test
 * dan ID dengan suffix "-dev". Jangan gunakan di produksi.
 *
 * CARA MENJALANKAN:
 *   node scripts/seed-dummy.js --dry-run   (hanya cek, tanpa menulis)
 *   node scripts/seed-dummy.js             (buat data yang belum ada)
 *   npm run seed:dev
 *
 * Untuk produksi, script menolak berjalan kecuali diberi
 * --allow-production. Tetap tinjau dan backup terlebih dahulu.
 * =====================================================
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../data/db');

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const ALLOW_PRODUCTION = ARGS.has('--allow-production');

if (ARGS.has('--help') || ARGS.has('-h')) {
  console.log('Penggunaan: node scripts/seed-dummy.js [--dry-run] [--allow-production]');
  console.log('  --dry-run            Periksa data tanpa menulis ke database.');
  console.log('  --allow-production   Izinkan seed saat NODE_ENV=production (tidak disarankan).');
  process.exit(0);
}

if (process.env.NODE_ENV === 'production' && !ALLOW_PRODUCTION) {
  console.error('Ditolak: NODE_ENV=production. Seed dummy tidak boleh dijalankan di produksi.');
  console.error('Jika benar-benar diperlukan, jalankan dengan --allow-production setelah backup.');
  process.exit(1);
}

const EMAIL_DOMAIN = 'dev.sipresensi.test';
const DEFAULT_PASSWORD = process.env.SEED_DUMMY_PASSWORD || 'password123';

const KELAS_DUMMY = [
  { name: 'X-Dev A', ruangan: 'R-Dev 1' },
  { name: 'X-Dev B', ruangan: 'R-Dev 2' },
  { name: 'XI-Dev A', ruangan: 'R-Dev 3' },
  { name: 'XII-Dev A', ruangan: 'R-Dev 4' }
];

const SISWA_PER_KELAS = 6;
const NAMA_SISWA = [
  'Aisyah Rahma', 'Bagas Prasetyo', 'Citra Lestari', 'Dimas Anggara',
  'Eka Wulandari', 'Fajar Nugroho', 'Gita Permata', 'Hendra Saputra',
  'Intan Maharani', 'Joko Susilo', 'Kirana Ayu', 'Lukman Hakim',
  'Maya Sari', 'Nanda Pratama', 'Oktaviani Putri', 'Putra Wijaya',
  'Rani Kusuma', 'Satria Yudha', 'Tania Melati', 'Umar Faruq',
  'Vina Anggraini', 'Wahyu Setiawan', 'Xena Kirania', 'Yoga Pratama'
];

const GURU_DUMMY = [
  { nip: 'DEV-NIP-001', name: 'Budi Santoso (Dev)', mapel: 'Matematika' },
  { nip: 'DEV-NIP-002', name: 'Sari Wulandari (Dev)', mapel: 'Bahasa Indonesia' },
  { nip: 'DEV-NIP-003', name: 'Agus Wijaya (Dev)', mapel: 'Fisika' },
  { nip: 'DEV-NIP-004', name: 'Ratna Dewi (Dev)', mapel: 'Biologi' },
  { nip: 'DEV-NIP-005', name: 'Hendra Gunawan (Dev)', mapel: 'Sejarah' },
  { nip: 'DEV-NIP-006', name: 'Maya Kartika (Dev)', mapel: 'Bahasa Inggris' }
];

function log(action, detail) {
  const prefix = DRY_RUN ? '[rencana] ' : '';
  console.log(`${prefix}${action}: ${detail}`);
}

function initials(name) {
  return String(name || '').replace(/\(Dev\)/, '').trim().split(/\s+/)
    .map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U';
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function studentEmail(nis) {
  return `siswa-${slug(nis)}@${EMAIL_DOMAIN}`;
}

function teacherEmail(nip) {
  return `guru-${slug(nip)}@${EMAIL_DOMAIN}`;
}

function hashedPassword() {
  return bcrypt.hashSync(DEFAULT_PASSWORD, 10);
}

async function ensureKelas() {
  const existing = await db.getKelas();
  const byName = new Map(existing.map((row) => [row.name, row]));
  let created = 0;
  let present = 0;

  for (const kelas of KELAS_DUMMY) {
    if (byName.has(kelas.name)) {
      present++;
      continue;
    }
    log('+ kelas', `${kelas.name} (${kelas.ruangan})`);
    if (!DRY_RUN) {
      const row = await db.addKelas({
        id: `kls-dev-${slug(kelas.name)}`,
        name: kelas.name,
        totalSiswa: 0,
        waliKelas: 'Belum Ditentukan',
        ruangan: kelas.ruangan
      });
      byName.set(row.name, row);
    }
    created++;
  }
  return { created, present };
}

async function findAccountForTeacher(teacher, email) {
  if (teacher.user_id) {
    const byId = await db.findUserById(teacher.user_id);
    if (byId) return byId;
  }
  return db.findUserByEmail(teacher.email || email || teacher.nip);
}

async function ensureGuru() {
  let teachersCreated = 0;
  let teachersPresent = 0;
  let accountsCreated = 0;
  let linked = 0;
  let warnings = 0;

  for (const guru of GURU_DUMMY) {
    const email = teacherEmail(guru.nip);
    let teacher = await db.findGuruByNip(guru.nip);

    if (teacher) {
      teachersPresent++;
    } else {
      log('+ guru', `${guru.name} [${guru.mapel}] — login ${email}`);
      if (!DRY_RUN) {
        teacher = await db.addGuru({
          id: `guru-dev-${slug(guru.nip)}`,
          nip: guru.nip,
          name: guru.name,
          mapel: guru.mapel,
          phone: '-',
          email
        });
      }
      teachersCreated++;
    }

    if (!teacher && DRY_RUN) {
      const account = await db.findUserByEmail(email);
      if (!account) accountsCreated++;
      continue;
    }

    let account = await findAccountForTeacher(teacher, email);
    if (account && account.role !== 'guru') {
      console.warn(`! Akun ${account.email} sudah ada dengan peran ${account.role}; guru ${guru.name} tidak ditautkan.`);
      warnings++;
      continue;
    }

    if (!account) {
      log('+ akun guru', `${email} (sandi ${DEFAULT_PASSWORD})`);
      if (!DRY_RUN) {
        account = await db.createUser({
          id: `usr-guru-dev-${slug(guru.nip)}`,
          email,
          password: hashedPassword(),
          name: teacher.name,
          role: 'guru',
          title: `Guru ${teacher.mapel} (Dev)`,
          nip: teacher.nip,
          nis: null,
          kelas: null,
          phone: teacher.phone || '-',
          avatar: initials(teacher.name)
        });
      }
      accountsCreated++;
    }

    if (!DRY_RUN && account && teacher.user_id !== account.id) {
      try {
        await db.updateGuru(teacher.id, { user_id: account.id });
        linked++;
      } catch (error) {
        console.warn(`! Gagal menautkan akun guru ${guru.name}: ${error.message || error}`);
        warnings++;
      }
    } else if (DRY_RUN && account && teacher.user_id !== account.id) {
      linked++;
    }
  }

  return { teachersCreated, teachersPresent, accountsCreated, linked, warnings };
}

async function ensureSiswa() {
  let studentsCreated = 0;
  let studentsPresent = 0;
  let accountsCreated = 0;
  let warnings = 0;
  let counter = 0;

  for (const kelas of KELAS_DUMMY) {
    for (let index = 0; index < SISWA_PER_KELAS; index++) {
      const name = NAMA_SISWA[counter % NAMA_SISWA.length] + (counter >= NAMA_SISWA.length ? ' Jr' : '');
      const nis = `DEV${String(1000 + counter)}`;
      const email = studentEmail(nis);
      counter++;

      let student = await db.findSiswaByNis(nis);
      if (student) {
        studentsPresent++;
      } else {
        log('+ siswa', `${name} [${kelas.name}] NIS ${nis}`);
        if (!DRY_RUN) {
          student = await db.addSiswa({
            id: `sis-dev-${slug(nis)}`,
            nis,
            name,
            kelas: kelas.name,
            gender: index % 2 === 0 ? 'Laki-laki' : 'Perempuan',
            phone: '-',
            email,
            rfid_uid: null
          });
        }
        studentsCreated++;
      }

      const accountEmail = student?.email || email;
      const account = await db.findUserByEmailOrNis(accountEmail, nis);
      if (account && account.role !== 'siswa') {
        console.warn(`! Akun ${account.email} sudah ada dengan peran ${account.role}; siswa ${name} tidak ditautkan.`);
        warnings++;
        continue;
      }
      if (!account) {
        log('+ akun siswa', `${accountEmail} (sandi ${DEFAULT_PASSWORD})`);
        if (!DRY_RUN) {
          await db.createUser({
            id: `usr-sis-dev-${slug(nis)}`,
            email: accountEmail,
            password: hashedPassword(),
            name: student.name,
            role: 'siswa',
            title: `Siswa - ${student.kelas}`,
            nip: null,
            nis: student.nis,
            kelas: student.kelas,
            phone: student.phone || '-',
            avatar: initials(student.name)
          });
        }
        accountsCreated++;
      }
    }
  }

  return { studentsCreated, studentsPresent, accountsCreated, warnings };
}

(async () => {
  console.log('=== Seed Data Dummy SiPresensi (development/testing) ===');
  console.log(`Email domain penanda: @${EMAIL_DOMAIN}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (tidak menulis)' : 'TULIS DATABASE'}`);
  console.log('Idempoten: data existing tidak ditimpa/dihapus.\n');

  const kelas = await ensureKelas();
  const guru = await ensureGuru();
  const siswa = await ensureSiswa();

  console.log('\n=== Ringkasan ===');
  console.log(`Kelas  : dibuat ${kelas.created}, sudah ada ${kelas.present} (target ${KELAS_DUMMY.length})`);
  console.log(`Guru   : dibuat ${guru.teachersCreated}, sudah ada ${guru.teachersPresent} (target ${GURU_DUMMY.length})`);
  console.log(`Siswa  : dibuat ${siswa.studentsCreated}, sudah ada ${siswa.studentsPresent} (target ${KELAS_DUMMY.length * SISWA_PER_KELAS})`);
  console.log(`Akun   : dibuat ${guru.accountsCreated + siswa.accountsCreated}, ditautkan ${guru.linked}`);
  if (guru.warnings + siswa.warnings > 0) {
    console.log(`Peringatan: ${guru.warnings + siswa.warnings} (lihat pesan di atas, data tidak ditimpa).`);
  }
  console.log(`Sandi semua akun dummy: ${DEFAULT_PASSWORD}`);
  if (DRY_RUN) console.log('Dry run selesai. Tidak ada perubahan yang ditulis.');
  else console.log('Selesai. Gunakan halaman Manajemen Jadwal untuk memilih guru/kelas/mapel/siswa.');
  process.exit(0);
})().catch((err) => {
  console.error('Seed gagal:', err.message || err);
  process.exit(1);
});
