/**
 * SiPresensi - Supabase Database Verification & Seeder
 * Mengecek koneksi ke Supabase dan mengisi data awal (seed data)
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rxcagbqeoevmfcbncmfd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_tan5CwGU9E-FM8NeCZ3oSw_IafCpIeQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

async function initSupabase() {
  console.log('====================================================');
  console.log('  SiPresensi - Pemeriksaan Database Supabase');
  console.log('  Project URL:', SUPABASE_URL);
  console.log('====================================================\n');

  const tables = [
    'users',
    'siswa',
    'guru',
    'kelas',
    'absensi',
    'student_logs',
    'pengaturan',
    'profil_sekolah',
    'notifikasi'
  ];

  console.log('1. Memeriksa keberadaan tabel di Supabase...');
  let hasError = false;

  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.error(` ❌ Tabel \`${table}\`: Error (${error.message})`);
        hasError = true;
      } else {
        console.log(` ✓ Tabel \`${table}\`: Siap (${count || 0} baris)`);
      }
    } catch (err) {
      console.error(` ❌ Tabel \`${table}\`: ${err.message}`);
      hasError = true;
    }
  }

  // 2. Cek apakah ada data di users
  console.log('\n2. Memeriksa data akun pengguna...');
  const { data: users, error: userErr } = await supabase.from('users').select('id, email, name, role').limit(5);

  if (users && users.length > 0) {
    console.log(` ✓ Ditemukan ${users.length} akun terdaftar di Supabase:`);
    users.forEach(u => console.log(`   - [${u.role.toUpperCase()}] ${u.name} (${u.email})`));
    console.log('\n====================================================');
    console.log('  SUKSES: Database Supabase sudah siap dan aktif!');
    console.log('  Jalankan server dengan: npm start');
    console.log('====================================================\n');
    return;
  }

  // 3. Coba lakukan seed otomatis dari database.json
  console.log('\n3. Database masih kosong, mencoba mengisi data awal (seed data)...');
  const jsonPath = path.join(__dirname, 'data', 'database.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const seedData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

      // Tes tulis pada satu tabel
      const testInsert = await supabase.from('notifikasi').upsert({
        id: 'notif-cek-koneksi',
        title: 'Verifikasi Supabase',
        text: 'Koneksi ke Supabase berhasil.',
        time: 'Baru saja',
        unread: 1
      });

      if (testInsert.error) {
        console.warn('\n[PEMBERITAHUAN ROW LEVEL SECURITY (RLS)]');
        console.warn('Supabase menolak operasi tulis via token publishable karena RLS masih aktif di Supabase.');
        console.warn('Langkah mudah untuk mengaktifkan database:');
        console.warn('1. Buka Supabase SQL Editor:');
        console.warn('   https://supabase.com/dashboard/project/rxcagbqeoevmfcbncmfd/sql/new');
        console.warn('2. Salin isi file `supabase-setup.sql` yang telah disediakan di folder ini.');
        console.warn('3. Tempel di SQL Editor lalu klik tombol "RUN".');
        console.warn('4. Jalankan kembali script ini dengan: npm run db:init\n');
        return;
      }

      // Jika insert diizinkan, lakukan seed pada semua tabel
      if (seedData.users) await supabase.from('users').upsert(seedData.users);
      if (seedData.siswa) await supabase.from('siswa').upsert(seedData.siswa);
      if (seedData.guru)  await supabase.from('guru').upsert(seedData.guru);
      if (seedData.kelas) {
        const kls = seedData.kelas.map(k => ({
          id: k.id,
          name: k.name,
          total_siswa: k.totalSiswa || 36,
          wali_kelas: k.waliKelas || 'Belum Ditentukan',
          ruangan: k.ruangan || '-'
        }));
        await supabase.from('kelas').upsert(kls);
      }
      if (seedData.absensi) {
        const abs = seedData.absensi.map(a => ({
          id: a.id,
          date: a.date,
          kelas: a.kelas,
          mapel: a.mapel || null,
          nis: a.nis,
          student_name: a.studentName || null,
          status: a.status,
          check_in: a.checkIn || '-',
          check_out: a.checkOut || '-',
          note: a.note || null
        }));
        await supabase.from('absensi').upsert(abs);
      }
      if (seedData.studentLogs) {
        const logs = seedData.studentLogs.map(l => ({
          id: l.id,
          nis: l.nis,
          tgl: l.tgl,
          masuk: l.masuk || '-',
          keluar: l.keluar || '-',
          zona: l.zona || null,
          status: l.status || 'hadir',
          status_text: l.statusText || null,
          valid: l.valid ? 1 : 0,
          durasi: l.durasi || '-'
        }));
        await supabase.from('student_logs').upsert(logs);
      }
      if (seedData.pengaturan) {
        await supabase.from('pengaturan').upsert({
          id: 1,
          sekolah: seedData.pengaturan.sekolah,
          ta: seedData.pengaturan.ta,
          jam_masuk: seedData.pengaturan.jamMasuk,
          toleransi: seedData.pengaturan.toleransi,
          email_notif: seedData.pengaturan.emailNotif ? 1 : 0,
          whatsapp_rekap: seedData.pengaturan.whatsappRekap ? 1 : 0,
          bahasa: seedData.pengaturan.bahasa
        });
      }
      if (seedData.profilSekolah) {
        await supabase.from('profil_sekolah').upsert({
          id: 1,
          nama: seedData.profilSekolah.nama,
          npsn: seedData.profilSekolah.npsn,
          akreditasi: seedData.profilSekolah.akreditasi,
          alamat: seedData.profilSekolah.alamat,
          email: seedData.profilSekolah.email,
          telepon: seedData.profilSekolah.telepon,
          kepsek: seedData.profilSekolah.kepsek,
          nip_kepsek: seedData.profilSekolah.nipKepsek,
          kurikulum: seedData.profilSekolah.kurikulum
        });
      }
      if (seedData.notifikasi) await supabase.from('notifikasi').upsert(seedData.notifikasi);

      console.log('✓ Seluruh data awal berhasil diisi ke Supabase!');
      console.log('\n====================================================');
      console.log('  SUKSES: Database Supabase sudah siap digunakan!');
      console.log('====================================================\n');
    } catch (err) {
      console.error('Gagal melakukan seed:', err.message);
    }
  }
}

initSupabase();
