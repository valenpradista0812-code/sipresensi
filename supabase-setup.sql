-- =====================================================
-- SiPresensi - Setup Database Supabase (PostgreSQL)
-- Salin dan jalankan script ini di:
-- Supabase Dashboard -> SQL Editor -> New Query -> Run
-- URL: https://supabase.com/dashboard/project/rxcagbqeoevmfcbncmfd/sql/new
-- =====================================================

-- 1. Nonaktifkan Row Level Security (RLS) agar backend server & token publishable dapat beroperasi penuh
ALTER TABLE IF EXISTS users DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS siswa DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS guru DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS kelas DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS absensi DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS student_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pengaturan DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS profil_sekolah DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notifikasi DISABLE ROW LEVEL SECURITY;

-- 2. Pastikan tabel terbuat jika belum ada
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'siswa',
  title VARCHAR(100),
  nip VARCHAR(30),
  nis VARCHAR(20),
  kelas VARCHAR(30),
  phone VARCHAR(25),
  avatar VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS siswa (
  id VARCHAR(50) PRIMARY KEY,
  nis VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  kelas VARCHAR(30) NOT NULL,
  gender VARCHAR(20) DEFAULT 'Laki-laki',
  phone VARCHAR(25) DEFAULT '-',
  email VARCHAR(100),
  status VARCHAR(30) DEFAULT 'Aktif',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guru (
  id VARCHAR(50) PRIMARY KEY,
  nip VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  mapel VARCHAR(80) NOT NULL,
  phone VARCHAR(25) DEFAULT '-',
  email VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kelas (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  total_siswa INT DEFAULT 0,
  wali_kelas VARCHAR(100) DEFAULT 'Belum Ditentukan',
  ruangan VARCHAR(100) DEFAULT '-',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS absensi (
  id VARCHAR(50) PRIMARY KEY,
  date DATE NOT NULL,
  kelas VARCHAR(30) NOT NULL,
  mapel VARCHAR(80),
  nis VARCHAR(20) NOT NULL,
  student_name VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'hadir',
  check_in VARCHAR(20) DEFAULT '-',
  check_out VARCHAR(20) DEFAULT '-',
  note VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_logs (
  id VARCHAR(50) PRIMARY KEY,
  nis VARCHAR(20) NOT NULL,
  tgl VARCHAR(60) NOT NULL,
  masuk VARCHAR(30) DEFAULT '-',
  keluar VARCHAR(30) DEFAULT '-',
  zona VARCHAR(100),
  status VARCHAR(20) DEFAULT 'hadir',
  status_text VARCHAR(100),
  valid INT DEFAULT 1,
  durasi VARCHAR(20) DEFAULT '-',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pengaturan (
  id SERIAL PRIMARY KEY,
  sekolah VARCHAR(100) DEFAULT 'SMA Negeri 1 Jakarta',
  ta VARCHAR(30) DEFAULT '2024/2025 Ganjil',
  jam_masuk VARCHAR(20) DEFAULT '07:00 WIB',
  toleransi VARCHAR(20) DEFAULT '15 Menit',
  email_notif INT DEFAULT 1,
  whatsapp_rekap INT DEFAULT 0,
  bahasa VARCHAR(30) DEFAULT 'Bahasa Indonesia'
);

CREATE TABLE IF NOT EXISTS profil_sekolah (
  id SERIAL PRIMARY KEY,
  nama VARCHAR(100) DEFAULT 'SMA Negeri 1 Jakarta',
  npsn VARCHAR(20) DEFAULT '20101589',
  akreditasi VARCHAR(30) DEFAULT 'A (Unggul)',
  alamat TEXT,
  email VARCHAR(100),
  telepon VARCHAR(30),
  kepsek VARCHAR(100),
  nip_kepsek VARCHAR(30),
  kurikulum VARCHAR(50) DEFAULT 'Kurikulum Merdeka'
);

CREATE TABLE IF NOT EXISTS notifikasi (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  text TEXT,
  time VARCHAR(50),
  unread INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Data Awal (Seed Data)
-- Password semua akun awal: password123

INSERT INTO users (id, email, password, name, role, title, nip, nis, kelas, phone, avatar) VALUES
('usr-1', 'admin.endang@sman1jkt.sch.id', '$2a$10$JzIqH.LyNevYQLAbQREoJO/4jQA0lZfMc12.yz09peAS83UfQRqUK', 'Hj. Endang Triwati, M.Pd.', 'guru',  'Admin Kepegawaian & Guru', '1972041501', NULL,    NULL,        '0812-9876-5432', 'ET'),
('usr-2', 'guru@sman1jkt.sch.id',         '$2a$10$JzIqH.LyNevYQLAbQREoJO/4jQA0lZfMc12.yz09peAS83UfQRqUK', 'Drs. Heri Susanto',         'guru',  'Guru Matematika',         '1975031201', NULL,    NULL,        '0812-7766-5544', 'HS'),
('usr-3', 'siswa@sman1jkt.sch.id',         '$2a$10$JzIqH.LyNevYQLAbQREoJO/4jQA0lZfMc12.yz09peAS83UfQRqUK', 'Rizky Pratama',             'siswa', 'Siswa - XII IPA 1',       NULL,        '10924', 'XII IPA 1', '0821-5566-7788', 'RP'),
('usr-4', 'budi@sman1jkt.sch.id',          '$2a$10$JzIqH.LyNevYQLAbQREoJO/4jQA0lZfMc12.yz09peAS83UfQRqUK', 'Budi Santoso',              'siswa', 'Siswa - XII IPA 1',       NULL,        '10921', 'XII IPA 1', '0812-3456-7890', 'BS')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password = EXCLUDED.password,
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  title = EXCLUDED.title,
  nip = EXCLUDED.nip,
  nis = EXCLUDED.nis,
  kelas = EXCLUDED.kelas,
  phone = EXCLUDED.phone,
  avatar = EXCLUDED.avatar;

INSERT INTO siswa (id, nis, name, kelas, gender, phone, email, status) VALUES
('sis-1',  '10921', 'Budi Santoso',    'XII IPA 1', 'Laki-laki', '0812-3456-7890', 'budi@sman1jkt.sch.id',     'Aktif'),
('sis-2',  '10922', 'Aditya Pratama',  'XII IPA 1', 'Laki-laki', '0812-4455-8899', 'aditya@sman1jkt.sch.id',   'Aktif'),
('sis-3',  '10923', 'Siti Aminah',     'XI IPS 2',  'Perempuan', '0813-8899-0011', 'siti@sman1jkt.sch.id',     'Aktif'),
('sis-4',  '10924', 'Rizky Pratama',   'XII IPA 1', 'Laki-laki', '0821-5566-7788', 'siswa@sman1jkt.sch.id',    'Aktif'),
('sis-5',  '10925', 'Larasati Putri',  'XII IPS 1', 'Perempuan', '0815-1122-3344', 'larasati@sman1jkt.sch.id', 'Aktif'),
('sis-6',  '10926', 'Farhan Saputra',  'X IPA 1',   'Laki-laki', '0857-4433-2211', 'farhan@sman1jkt.sch.id',   'Aktif'),
('sis-7',  '10927', 'Amanda Lestari',  'XI IPA 2',  'Perempuan', '0811-9988-7766', 'amanda@sman1jkt.sch.id',   'Aktif'),
('sis-8',  '10928', 'Dewa Gede',       'XII IPA 1', 'Laki-laki', '0819-2233-4455', 'dewa@sman1jkt.sch.id',     'Aktif'),
('sis-9',  '10929', 'Putri Handayani', 'X IPS 1',   'Perempuan', '0813-5566-1122', 'putri@sman1jkt.sch.id',    'Aktif'),
('sis-10', '10930', 'Muhammad Fauzan', 'XI IPS 1',  'Laki-laki', '0852-9900-1122', 'fauzan@sman1jkt.sch.id',   'Aktif')
ON CONFLICT (id) DO UPDATE SET
  nis = EXCLUDED.nis,
  name = EXCLUDED.name,
  kelas = EXCLUDED.kelas,
  gender = EXCLUDED.gender,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  status = EXCLUDED.status;

INSERT INTO guru (id, nip, name, mapel, phone, email) VALUES
('gur-1', '1975031201', 'Drs. Heri Susanto',     'Matematika',       '0812-7766-5544', 'heri.susanto@sman1jkt.sch.id'),
('gur-2', '1982052402', 'Sri Wahyuni, S.Pd.',     'Bahasa Indonesia', '0813-2211-9988', 'sri.wahyuni@sman1jkt.sch.id'),
('gur-3', '1978100501', 'Bambang Hartono, M.Pd.', 'Fisika (IPA)',     '0811-3344-5566', 'bambang.h@sman1jkt.sch.id'),
('gur-4', '1985121402', 'Dewi Lestari, S.Si.',    'Biologi (IPA)',    '0857-1122-3344', 'dewi.lestari@sman1jkt.sch.id'),
('gur-5', '1980081801', 'Ahmad Dahlan, S.Pd.',    'Sejarah',         '0819-5566-7788', 'ahmad.dahlan@sman1jkt.sch.id'),
('gur-6', '1989040301', 'Rian Hidayat, S.Or.',    'PJOK',            '0852-8899-0011', 'rian.hidayat@sman1jkt.sch.id'),
('gur-7', '1973022802', 'Dra. Maria Ulfah',       'Kimia (IPA)',      '0812-4455-6677', 'maria.ulfah@sman1jkt.sch.id')
ON CONFLICT (id) DO UPDATE SET
  nip = EXCLUDED.nip,
  name = EXCLUDED.name,
  mapel = EXCLUDED.mapel,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email;

INSERT INTO kelas (id, name, total_siswa, wali_kelas, ruangan) VALUES
('kls-1',  'XII IPA 1', 36, 'Drs. Heri Susanto',      'Gedung A, Lantai 3'),
('kls-2',  'XII IPA 2', 35, 'Dewi Lestari, S.Si.',    'Gedung A, Lantai 3'),
('kls-3',  'XII IPS 1', 34, 'Ahmad Dahlan, S.Pd.',    'Gedung B, Lantai 3'),
('kls-4',  'XI IPA 1',  36, 'Bambang Hartono, M.Pd.', 'Gedung A, Lantai 2'),
('kls-5',  'XI IPA 2',  35, 'Dra. Maria Ulfah',       'Gedung A, Lantai 2'),
('kls-6',  'XI IPS 1',  34, 'Rian Hidayat, S.Or.',    'Gedung B, Lantai 2'),
('kls-7',  'XI IPS 2',  35, 'Sri Wahyuni, S.Pd.',     'Gedung B, Lantai 2'),
('kls-8',  'X IPA 1',   36, 'Sri Wahyuni, S.Pd.',     'Gedung A, Lantai 1'),
('kls-9',  'X IPA 2',   35, 'Dewi Lestari, S.Si.',    'Gedung A, Lantai 1'),
('kls-10', 'X IPS 1',   34, 'Ahmad Dahlan, S.Pd.',    'Gedung B, Lantai 1')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  total_siswa = EXCLUDED.total_siswa,
  wali_kelas = EXCLUDED.wali_kelas,
  ruangan = EXCLUDED.ruangan;

INSERT INTO absensi (id, date, kelas, mapel, nis, student_name, status, check_in, check_out, note) VALUES
('abs-1', '2024-10-14', 'XII IPA 1', 'Matematika', '10921', 'Budi Santoso',   'hadir', '07:12:00', '15:30:00', 'Tepat Waktu'),
('abs-2', '2024-10-14', 'XII IPA 1', 'Matematika', '10922', 'Aditya Pratama', 'hadir', '07:14:00', '15:30:00', 'Tepat Waktu'),
('abs-3', '2024-10-14', 'XII IPA 1', 'Matematika', '10923', 'Siti Aminah',    'izin',  '-',        '-',        'Surat Izin Keluarga'),
('abs-4', '2024-10-14', 'XII IPA 1', 'Matematika', '10924', 'Rizky Pratama',  'hadir', '07:15:22', '15:30:14', 'Tepat Waktu'),
('abs-5', '2024-10-14', 'XII IPA 1', 'Matematika', '10925', 'Larasati Putri', 'sakit', '-',        '-',        'Surat Dokter'),
('abs-6', '2024-10-14', 'XII IPA 1', 'Matematika', '10926', 'Farhan Saputra', 'hadir', '07:20:00', '15:30:00', 'Tepat Waktu'),
('abs-7', '2024-10-14', 'XII IPA 1', 'Matematika', '10927', 'Amanda Lestari', 'hadir', '07:10:00', '15:30:00', 'Tepat Waktu'),
('abs-8', '2024-10-14', 'XII IPA 1', 'Matematika', '10928', 'Dewa Gede',      'alfa',  '-',        '-',        'Tanpa Keterangan')
ON CONFLICT (id) DO UPDATE SET
  date = EXCLUDED.date,
  kelas = EXCLUDED.kelas,
  mapel = EXCLUDED.mapel,
  nis = EXCLUDED.nis,
  student_name = EXCLUDED.student_name,
  status = EXCLUDED.status,
  check_in = EXCLUDED.check_in,
  check_out = EXCLUDED.check_out,
  note = EXCLUDED.note;

INSERT INTO student_logs (id, nis, tgl, masuk, keluar, zona, status, status_text, valid, durasi) VALUES
('log-1', '10924', 'Senin, 14 Oktober 2024',  '07:15:22 WIB', '15:30:14 WIB', 'Gedung Kelas XII',    'hadir', 'Memenuhi Target (>8 Jam)', 1, '08j 15m'),
('log-2', '10924', 'Jumat, 11 Oktober 2024',  '07:10:05 WIB', '15:35:41 WIB', 'Gedung Kelas XII',    'hadir', 'Memenuhi Target (>8 Jam)', 1, '08j 25m'),
('log-3', '10924', 'Kamis, 10 Oktober 2024',  '07:22:48 WIB', '15:30:02 WIB', 'Gedung Kelas XII',    'hadir', 'Memenuhi Target (>8 Jam)', 1, '08j 08m'),
('log-4', '10924', 'Rabu, 09 Oktober 2024',   '-',            '-',             'Luar Sekolah (Lomba)','izin',  'Izin Lomba OSN',           1, '-'),
('log-5', '10924', 'Selasa, 08 Oktober 2024', '07:14:30 WIB', '15:40:19 WIB', 'Gedung Kelas XII',    'hadir', 'Memenuhi Target (>8 Jam)', 1, '08j 26m'),
('log-6', '10924', 'Senin, 07 Oktober 2024',  '07:35:12 WIB', '15:30:00 WIB', 'Gedung Kelas XII',    'late',  'Kurang Target (<8 Jam)',    1, '07j 55m')
ON CONFLICT (id) DO UPDATE SET
  nis = EXCLUDED.nis,
  tgl = EXCLUDED.tgl,
  masuk = EXCLUDED.masuk,
  keluar = EXCLUDED.keluar,
  zona = EXCLUDED.zona,
  status = EXCLUDED.status,
  status_text = EXCLUDED.status_text,
  valid = EXCLUDED.valid,
  durasi = EXCLUDED.durasi;

DELETE FROM pengaturan;
INSERT INTO pengaturan (id, sekolah, ta, jam_masuk, toleransi, email_notif, whatsapp_rekap, bahasa) VALUES
(1, 'SMA Negeri 1 Jakarta', '2024/2025 Ganjil', '07:00 WIB', '15 Menit', 1, 0, 'Bahasa Indonesia');

DELETE FROM profil_sekolah;
INSERT INTO profil_sekolah (id, nama, npsn, akreditasi, alamat, email, telepon, kepsek, nip_kepsek, kurikulum) VALUES
(1, 'SMA Negeri 1 Jakarta', '20101589', 'A (Unggul)',
 'Jl. Budi Utomo No.7, Ps. Baru, Sawah Besar, Jakarta Pusat',
 'info@sman1jkt.sch.id', '(021) 3865001',
 'Dr. H. Sudirman, M.Pd.', '196803151992031004', 'Kurikulum Merdeka');

INSERT INTO notifikasi (id, title, text, time, unread) VALUES
('notif-1', 'Laporan Presensi Harian Siap',  'Rekap kehadiran seluruh kelas untuk hari Senin, 14 Oktober telah selesai diproses.', '10 menit yang lalu', 1),
('notif-2', 'Pemberitahuan Toleransi Absen', 'Batas toleransi keterlambatan semester ganjil ditetapkan 15 menit setelah jam masuk.','2 jam yang lalu',    1),
('notif-3', 'Sinkronisasi Data Berhasil',     'Database absensi siswa otomatis telah berhasil disinkronkan dengan Supabase Cloud.', '1 hari yang lalu',   0)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  text = EXCLUDED.text,
  time = EXCLUDED.time,
  unread = EXCLUDED.unread;
