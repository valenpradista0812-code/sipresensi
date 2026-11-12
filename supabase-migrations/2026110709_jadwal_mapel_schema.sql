BEGIN;

-- =====================================================
-- MIGRATION 2026110709: Jadwal Mapel & Jam Pelajaran
-- =====================================================
-- Tabel untuk manajemen jadwal pelajaran mingguan dan konfigurasi jam pelajaran.
-- Digunakan untuk:
-- 1. Admin mengatur jadwal mengajar guru per kelas per hari.
-- 2. Guru melihat jadwal mengajarnya.
-- 3. Siswa melihat jadwal kelasnya.
-- 4. Validasi: tidak ada guru/kelas bertabrakan pada waktu bersamaan.

-- =====================================================
-- TABEL: jam_pelajaran (Konfigurasi Jam Pelajaran)
-- =====================================================
-- Menyimpan periode/slot pelajaran standar sekolah.
-- Admin dapat menambah/edit periode sesuai kebutuhan.

CREATE TABLE IF NOT EXISTS public.jam_pelajaran (
  id VARCHAR(50) PRIMARY KEY,
  jam_ke INT NOT NULL UNIQUE,
  waktu_mulai VARCHAR(8) NOT NULL,
  waktu_selesai VARCHAR(8) NOT NULL,
  durasi_menit INT,
  deskripsi VARCHAR(100),
  aktif INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jam_pelajaran_jam_ke_idx ON public.jam_pelajaran(jam_ke);
CREATE INDEX IF NOT EXISTS jam_pelajaran_aktif_idx ON public.jam_pelajaran(aktif);

-- =====================================================
-- TABEL: jadwal_mapel (Jadwal Mengajar Guru)
-- =====================================================
-- Menyimpan jadwal mengajar setiap guru untuk setiap kelas setiap harinya.
-- Relasi:
--   - guru_id → guru.id (guru yang mengajar)
--   - kelas → kelas.name (kelas yang mengikuti)
--   - hari → hari dalam seminggu (Senin-Minggu)
--   - jam_mulai/jam_selesai → waktu pelajaran

CREATE TABLE IF NOT EXISTS public.jadwal_mapel (
  id VARCHAR(50) PRIMARY KEY,
  guru_id VARCHAR(50) NOT NULL REFERENCES public.guru(id) ON DELETE CASCADE,
  nip VARCHAR(30) NOT NULL,
  name_guru VARCHAR(100) NOT NULL,
  mapel VARCHAR(80) NOT NULL,
  kelas VARCHAR(30) NOT NULL,
  hari VARCHAR(15) NOT NULL,
  jam_mulai VARCHAR(8) NOT NULL,
  jam_selesai VARCHAR(8) NOT NULL,
  ruangan VARCHAR(100),
  jam_ke INT,
  catatan VARCHAR(200),
  aktif INT DEFAULT 1,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT jadwal_hari_valid CHECK (hari IN (
    'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'
  )),
  CONSTRAINT jadwal_jam_valid CHECK (jam_selesai > jam_mulai)
);

CREATE INDEX IF NOT EXISTS jadwal_mapel_guru_id_idx ON public.jadwal_mapel(guru_id);
CREATE INDEX IF NOT EXISTS jadwal_mapel_nip_idx ON public.jadwal_mapel(nip);
CREATE INDEX IF NOT EXISTS jadwal_mapel_kelas_idx ON public.jadwal_mapel(kelas);
CREATE INDEX IF NOT EXISTS jadwal_mapel_hari_idx ON public.jadwal_mapel(hari);
CREATE INDEX IF NOT EXISTS jadwal_mapel_aktif_idx ON public.jadwal_mapel(aktif);
CREATE INDEX IF NOT EXISTS jadwal_mapel_guru_kelas_hari_idx 
  ON public.jadwal_mapel(guru_id, kelas, hari);

-- =====================================================
-- VALIDASI: Tidak Ada Jadwal Guru Bertabrakan
-- =====================================================
-- Constraint untuk memastikan satu guru tidak mengajar 2 kelas pada waktu bersamaan.
-- Menggunakan UNIQUE dengan condition untuk jadwal aktif yang sama hari.

CREATE UNIQUE INDEX IF NOT EXISTS jadwal_mapel_guru_no_overlap
  ON public.jadwal_mapel(nip, hari, jam_mulai, jam_selesai)
  WHERE aktif = 1;

-- =====================================================
-- VALIDASI: Tidak Ada Jadwal Kelas Bertabrakan
-- =====================================================
-- Constraint untuk memastikan satu kelas tidak memiliki 2 mapel pada waktu bersamaan.

CREATE UNIQUE INDEX IF NOT EXISTS jadwal_mapel_kelas_no_overlap
  ON public.jadwal_mapel(kelas, hari, jam_mulai, jam_selesai)
  WHERE aktif = 1;

-- =====================================================
-- FUNCTION: Validasi Jadwal Sebelum Insert/Update
-- =====================================================
-- Memastikan:
-- 1. Guru tidak memiliki dua jadwal pada waktu bersamaan.
-- 2. Kelas tidak memiliki dua mapel pada waktu bersamaan.
-- 3. Jam selesai > jam mulai.

CREATE OR REPLACE FUNCTION public.validate_jadwal_mapel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict_count INT;
BEGIN
  -- Cek overlap guru pada hari yang sama
  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.jadwal_mapel
  WHERE nip = NEW.nip
    AND hari = NEW.hari
    AND aktif = 1
    AND id <> NEW.id
    AND (
      (NEW.jam_mulai < jam_selesai AND NEW.jam_selesai > jam_mulai)
    );
  
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'JADWAL_GURU_CONFLICT: Guru % sudah memiliki jadwal pada %:%-%:%',
      NEW.nip, NEW.hari, NEW.jam_mulai, NEW.hari, NEW.jam_selesai;
  END IF;

  -- Cek overlap kelas pada hari yang sama
  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.jadwal_mapel
  WHERE kelas = NEW.kelas
    AND hari = NEW.hari
    AND aktif = 1
    AND id <> NEW.id
    AND (
      (NEW.jam_mulai < jam_selesai AND NEW.jam_selesai > jam_mulai)
    );
  
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'JADWAL_KELAS_CONFLICT: Kelas % sudah memiliki pelajaran pada %:%-%:%',
      NEW.kelas, NEW.hari, NEW.jam_mulai, NEW.hari, NEW.jam_selesai;
  END IF;

  RETURN NEW;
END;
$$;

-- =====================================================
-- TRIGGER: Validasi Sebelum Insert/Update
-- =====================================================

DROP TRIGGER IF EXISTS trigger_validate_jadwal_mapel_insert_update 
  ON public.jadwal_mapel;

CREATE TRIGGER trigger_validate_jadwal_mapel_insert_update
  BEFORE INSERT OR UPDATE ON public.jadwal_mapel
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_jadwal_mapel();

-- =====================================================
-- DATA AWAL: Jam Pelajaran Standar
-- =====================================================
-- Insert jam pelajaran default (7 jam, Senin-Jumat)

INSERT INTO public.jam_pelajaran (id, jam_ke, waktu_mulai, waktu_selesai, durasi_menit, deskripsi, aktif)
VALUES
  ('jam-1', 1, '07:00', '08:30', 90, 'Jam Pertama', 1),
  ('jam-2', 2, '08:30', '09:00', 30, 'Istirahat Pertama', 1),
  ('jam-3', 3, '09:00', '10:30', 90, 'Jam Ketiga', 1),
  ('jam-4', 4, '10:30', '11:00', 30, 'Istirahat Kedua', 1),
  ('jam-5', 5, '11:00', '12:30', 90, 'Jam Kelima', 1),
  ('jam-6', 6, '12:30', '13:00', 30, 'Istirahat Ketiga (Sholat)', 1),
  ('jam-7', 7, '13:00', '14:30', 90, 'Jam Ketujuh', 1),
  ('jam-8', 8, '14:30', '15:30', 60, 'Jam Kedelapan', 1)
ON CONFLICT (id) DO UPDATE SET
  jam_ke = EXCLUDED.jam_ke,
  waktu_mulai = EXCLUDED.waktu_mulai,
  waktu_selesai = EXCLUDED.waktu_selesai,
  durasi_menit = EXCLUDED.durasi_menit,
  deskripsi = EXCLUDED.deskripsi,
  aktif = EXCLUDED.aktif;

-- =====================================================
-- DATA AWAL: Jadwal Sampel (Senin-Jumat untuk XII IPA 1)
-- =====================================================
-- Sampel jadwal mingguan untuk kelas XII IPA 1

INSERT INTO public.jadwal_mapel (id, guru_id, nip, name_guru, mapel, kelas, hari, jam_mulai, jam_selesai, ruangan, jam_ke, aktif, created_by)
VALUES
  -- Senin XII IPA 1
  ('jdw-001', 'gur-1', '1975031201', 'Drs. Heri Susanto', 'Matematika', 'XII IPA 1', 'Senin', '07:00', '08:30', 'Gedung A, Lantai 3', 1, 1, 'admin'),
  ('jdw-002', 'gur-2', '1982052402', 'Sri Wahyuni, S.Pd.', 'Bahasa Indonesia', 'XII IPA 1', 'Senin', '09:00', '10:30', 'Gedung A, Lantai 3', 3, 1, 'admin'),
  ('jdw-003', 'gur-3', '1978100501', 'Bambang Hartono, M.Pd.', 'Fisika (IPA)', 'XII IPA 1', 'Senin', '11:00', '12:30', 'Gedung A, Lantai 3', 5, 1, 'admin'),
  ('jdw-004', 'gur-4', '1985121402', 'Dewi Lestari, S.Si.', 'Biologi (IPA)', 'XII IPA 1', 'Senin', '13:00', '14:30', 'Gedung A, Lantai 3', 7, 1, 'admin'),
  
  -- Selasa XII IPA 1
  ('jdw-005', 'gur-2', '1982052402', 'Sri Wahyuni, S.Pd.', 'Bahasa Indonesia', 'XII IPA 1', 'Selasa', '07:00', '08:30', 'Gedung A, Lantai 3', 1, 1, 'admin'),
  ('jdw-006', 'gur-7', '1973022802', 'Dra. Maria Ulfah', 'Kimia (IPA)', 'XII IPA 1', 'Selasa', '09:00', '10:30', 'Gedung A, Lantai 3', 3, 1, 'admin'),
  ('jdw-007', 'gur-5', '1980081801', 'Ahmad Dahlan, S.Pd.', 'Sejarah', 'XII IPA 1', 'Selasa', '11:00', '12:30', 'Gedung A, Lantai 3', 5, 1, 'admin'),
  ('jdw-008', 'gur-1', '1975031201', 'Drs. Heri Susanto', 'Matematika', 'XII IPA 1', 'Selasa', '13:00', '14:30', 'Gedung A, Lantai 3', 7, 1, 'admin'),
  
  -- Rabu XII IPA 1
  ('jdw-009', 'gur-3', '1978100501', 'Bambang Hartono, M.Pd.', 'Fisika (IPA)', 'XII IPA 1', 'Rabu', '07:00', '08:30', 'Gedung A, Lantai 3', 1, 1, 'admin'),
  ('jdw-010', 'gur-4', '1985121402', 'Dewi Lestari, S.Si.', 'Biologi (IPA)', 'XII IPA 1', 'Rabu', '09:00', '10:30', 'Gedung A, Lantai 3', 3, 1, 'admin'),
  ('jdw-011', 'gur-7', '1973022802', 'Dra. Maria Ulfah', 'Kimia (IPA)', 'XII IPA 1', 'Rabu', '11:00', '12:30', 'Gedung A, Lantai 3', 5, 1, 'admin'),
  ('jdw-012', 'gur-6', '1989040301', 'Rian Hidayat, S.Or.', 'PJOK', 'XII IPA 1', 'Rabu', '13:00', '14:30', 'Lapangan', 7, 1, 'admin'),
  
  -- Kamis XII IPA 1
  ('jdw-013', 'gur-1', '1975031201', 'Drs. Heri Susanto', 'Matematika', 'XII IPA 1', 'Kamis', '07:00', '08:30', 'Gedung A, Lantai 3', 1, 1, 'admin'),
  ('jdw-014', 'gur-5', '1980081801', 'Ahmad Dahlan, S.Pd.', 'Sejarah', 'XII IPA 1', 'Kamis', '09:00', '10:30', 'Gedung A, Lantai 3', 3, 1, 'admin'),
  ('jdw-015', 'gur-2', '1982052402', 'Sri Wahyuni, S.Pd.', 'Bahasa Indonesia', 'XII IPA 1', 'Kamis', '11:00', '12:30', 'Gedung A, Lantai 3', 5, 1, 'admin'),
  ('jdw-016', 'gur-3', '1978100501', 'Bambang Hartono, M.Pd.', 'Fisika (IPA)', 'XII IPA 1', 'Kamis', '13:00', '14:30', 'Gedung A, Lantai 3', 7, 1, 'admin'),
  
  -- Jumat XII IPA 1
  ('jdw-017', 'gur-4', '1985121402', 'Dewi Lestari, S.Si.', 'Biologi (IPA)', 'XII IPA 1', 'Jumat', '07:00', '08:30', 'Gedung A, Lantai 3', 1, 1, 'admin'),
  ('jdw-018', 'gur-7', '1973022802', 'Dra. Maria Ulfah', 'Kimia (IPA)', 'XII IPA 1', 'Jumat', '09:00', '10:30', 'Gedung A, Lantai 3', 3, 1, 'admin'),
  ('jdw-019', 'gur-6', '1989040301', 'Rian Hidayat, S.Or.', 'PJOK', 'XII IPA 1', 'Jumat', '10:30', '12:00', 'Lapangan', 4, 1, 'admin')
ON CONFLICT (id) DO UPDATE SET
  guru_id = EXCLUDED.guru_id,
  nip = EXCLUDED.nip,
  name_guru = EXCLUDED.name_guru,
  mapel = EXCLUDED.mapel,
  kelas = EXCLUDED.kelas,
  hari = EXCLUDED.hari,
  jam_mulai = EXCLUDED.jam_mulai,
  jam_selesai = EXCLUDED.jam_selesai,
  ruangan = EXCLUDED.ruangan,
  jam_ke = EXCLUDED.jam_ke,
  aktif = EXCLUDED.aktif;

-- =====================================================
-- DISABLE RLS (same as other tables)
-- =====================================================
-- Akses dikelola via backend middleware, bukan RLS.

ALTER TABLE public.jam_pelajaran DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.jadwal_mapel DISABLE ROW LEVEL SECURITY;

COMMIT;
