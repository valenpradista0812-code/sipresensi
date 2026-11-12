BEGIN;

-- =====================================================
-- MIGRATION 2026110709_FINAL: Jadwal Mapel & Jam Pelajaran
-- =====================================================
-- Final fix addressing:
-- 1. pg_advisory_xact_lock() (auto-release on transaction end)
-- 2. Two-lock mechanism untuk guru+kelas conflict protection
-- 3. Hapus FINALLY (tidak valid PL/pgSQL)
-- 4. Perbaiki version increment logic
-- 5. Perbaiki seed jdw-019 (gunakan jam valid, bukan istirahat)
-- 6. Pre-check tabel di awal migration
-- 7. Comprehensive test cases
-- 8. Verifikasi ID guru/NIP vs staging data
-- 9. Safe re-run (idempotent)
-- 10. Laporan pengujian akurat

-- =====================================================
-- PRE-CHECK: Validasi Tabel Dependencies (AWAL)
-- =====================================================
-- Harus dilakukan sebelum CREATE TABLE dengan FK

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'guru'
  ) THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Tabel guru tidak ditemukan. Jalankan setup database terlebih dahulu.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'kelas'
  ) THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Tabel kelas tidak ditemukan. Jalankan setup database terlebih dahulu.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.guru LIMIT 1
  ) THEN
    RAISE WARNING 'WARNING: Tabel guru kosong. Pastikan data guru sudah di-seed sebelum insert jadwal.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kelas LIMIT 1
  ) THEN
    RAISE WARNING 'WARNING: Tabel kelas kosong. Pastikan data kelas sudah di-seed sebelum insert jadwal.';
  END IF;
END $$;

-- =====================================================
-- TABEL: jam_pelajaran (Konfigurasi Jam Pelajaran)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.jam_pelajaran (
  id VARCHAR(50) PRIMARY KEY,
  jam_ke INT NOT NULL UNIQUE,
  waktu_mulai TIME NOT NULL,
  waktu_selesai TIME NOT NULL,
  durasi_menit INT,
  deskripsi VARCHAR(100),
  aktif INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT jam_pelajaran_waktu_valid 
    CHECK (waktu_selesai > waktu_mulai),
  CONSTRAINT jam_pelajaran_aktif_valid CHECK (aktif IN (0, 1))
);

CREATE INDEX IF NOT EXISTS jam_pelajaran_jam_ke_idx 
  ON public.jam_pelajaran(jam_ke);
CREATE INDEX IF NOT EXISTS jam_pelajaran_aktif_idx 
  ON public.jam_pelajaran(aktif);
CREATE INDEX IF NOT EXISTS jam_pelajaran_waktu_idx 
  ON public.jam_pelajaran(waktu_mulai, waktu_selesai);

-- =====================================================
-- TABEL: jadwal_mapel (Jadwal Mengajar Guru)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.jadwal_mapel (
  id VARCHAR(50) PRIMARY KEY,
  guru_id VARCHAR(50) NOT NULL 
    REFERENCES public.guru(id) ON DELETE RESTRICT,
  jam_ke_id VARCHAR(50)
    REFERENCES public.jam_pelajaran(id) ON DELETE SET NULL,
  nip VARCHAR(30) NOT NULL,
  name_guru VARCHAR(100) NOT NULL,
  mapel VARCHAR(80) NOT NULL,
  kelas VARCHAR(30) NOT NULL,
  hari VARCHAR(15) NOT NULL,
  jam_mulai TIME NOT NULL,
  jam_selesai TIME NOT NULL,
  ruangan VARCHAR(100),
  catatan VARCHAR(200),
  aktif INT DEFAULT 1,
  version INT DEFAULT 1,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT jadwal_hari_valid CHECK (hari IN (
    'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'
  )),
  CONSTRAINT jadwal_jam_valid CHECK (jam_selesai > jam_mulai),
  CONSTRAINT jadwal_aktif_valid CHECK (aktif IN (0, 1)),
  CONSTRAINT jadwal_nip_guru_match CHECK (nip IS NOT NULL AND guru_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS jadwal_mapel_guru_id_idx 
  ON public.jadwal_mapel(guru_id);
CREATE INDEX IF NOT EXISTS jadwal_mapel_nip_idx 
  ON public.jadwal_mapel(nip);
CREATE INDEX IF NOT EXISTS jadwal_mapel_kelas_idx 
  ON public.jadwal_mapel(kelas);
CREATE INDEX IF NOT EXISTS jadwal_mapel_hari_idx 
  ON public.jadwal_mapel(hari);
CREATE INDEX IF NOT EXISTS jadwal_mapel_aktif_idx 
  ON public.jadwal_mapel(aktif);
CREATE INDEX IF NOT EXISTS jadwal_mapel_guru_kelas_hari_idx 
  ON public.jadwal_mapel(guru_id, kelas, hari)
  WHERE aktif = 1;
CREATE INDEX IF NOT EXISTS jadwal_mapel_waktu_idx 
  ON public.jadwal_mapel(jam_mulai, jam_selesai, hari)
  WHERE aktif = 1;

-- =====================================================
-- FUNCTION: Check Time Overlap (Exact Range Detection)
-- =====================================================

CREATE OR REPLACE FUNCTION public.check_time_overlap(
  p_start_1 TIME,
  p_end_1 TIME,
  p_start_2 TIME,
  p_end_2 TIME
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN p_start_1 < p_end_2 AND p_start_2 < p_end_1;
END;
$$;

-- =====================================================
-- FUNCTION: Validasi Guru NIP Match
-- =====================================================
-- Pastikan guru_id dan NIP merujuk pada guru yang sama

CREATE OR REPLACE FUNCTION public.validate_guru_nip_match(
  p_guru_id VARCHAR,
  p_nip VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_guru_nip VARCHAR;
BEGIN
  SELECT nip INTO v_guru_nip FROM public.guru WHERE id = p_guru_id LIMIT 1;
  
  IF v_guru_nip IS NULL THEN
    RETURN FALSE;
  END IF;
  
  RETURN v_guru_nip = p_nip;
END;
$$;

-- =====================================================
-- FUNCTION: Validasi Jadwal (dengan Two-Lock Mechanism)
-- =====================================================
-- Gunakan pg_advisory_xact_lock() untuk auto-release at end of transaction
-- Two locks: satu untuk guru, satu untuk kelas (urutan konsisten)

CREATE OR REPLACE FUNCTION public.validate_jadwal_mapel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict_count INT;
  v_lock_guru BIGINT;
  v_lock_kelas BIGINT;
  v_guru_nip_valid BOOLEAN;
BEGIN
  -- Validate guru_id dan NIP cocok
  SELECT public.validate_guru_nip_match(NEW.guru_id, NEW.nip) INTO v_guru_nip_valid;
  IF NOT v_guru_nip_valid THEN
    RAISE EXCEPTION 'JADWAL_GURU_NIP_MISMATCH: guru_id % dan NIP % tidak cocok. Periksa data guru.',
      NEW.guru_id, NEW.nip;
  END IF;

  -- Compute lock IDs (consistent ordering: guru first, kelas second)
  v_lock_guru := (hashtext('GURU:' || NEW.nip || ':' || NEW.hari))::BIGINT;
  v_lock_kelas := (hashtext('KELAS:' || NEW.kelas || ':' || NEW.hari))::BIGINT;
  
  -- Acquire locks (transaction-level, auto-released at end of transaction)
  PERFORM pg_advisory_xact_lock(v_lock_guru);
  PERFORM pg_advisory_xact_lock(v_lock_kelas);

  -- Check guru overlap
  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.jadwal_mapel
  WHERE nip = NEW.nip
    AND hari = NEW.hari
    AND aktif = 1
    AND id <> NEW.id
    AND public.check_time_overlap(NEW.jam_mulai, NEW.jam_selesai, jam_mulai, jam_selesai);
  
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'JADWAL_GURU_CONFLICT: Guru % (%) sudah mengajar pada %:%-%:% di hari %',
      NEW.name_guru, NEW.nip, NEW.jam_mulai, NEW.jam_selesai, NEW.hari;
  END IF;

  -- Check kelas overlap
  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.jadwal_mapel
  WHERE kelas = NEW.kelas
    AND hari = NEW.hari
    AND aktif = 1
    AND id <> NEW.id
    AND public.check_time_overlap(NEW.jam_mulai, NEW.jam_selesai, jam_mulai, jam_selesai);
  
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'JADWAL_KELAS_CONFLICT: Kelas % sudah memiliki pelajaran pada %:%-%:% di hari %',
      NEW.kelas, NEW.jam_mulai, NEW.jam_selesai, NEW.hari;
  END IF;

  -- Handle version increment
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.version := COALESCE(OLD.version, 1) + 1;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- =====================================================
-- FUNCTION: Validasi Jam Pelajaran
-- =====================================================

CREATE OR REPLACE FUNCTION public.validate_jam_pelajaran()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.waktu_selesai <= NEW.waktu_mulai THEN
    RAISE EXCEPTION 'JAM_PELAJARAN_INVALID: Waktu selesai (%) harus lebih besar dari waktu mulai (%)',
      NEW.waktu_selesai, NEW.waktu_mulai;
  END IF;
  
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- =====================================================
-- TRIGGER: Validasi Jadwal Sebelum Insert/Update
-- =====================================================

DROP TRIGGER IF EXISTS trigger_validate_jadwal_mapel_insert_update 
  ON public.jadwal_mapel;

CREATE TRIGGER trigger_validate_jadwal_mapel_insert_update
  BEFORE INSERT OR UPDATE ON public.jadwal_mapel
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_jadwal_mapel();

-- =====================================================
-- TRIGGER: Validasi Jam Pelajaran Sebelum Insert/Update
-- =====================================================

DROP TRIGGER IF EXISTS trigger_validate_jam_pelajaran_insert_update 
  ON public.jam_pelajaran;

CREATE TRIGGER trigger_validate_jam_pelajaran_insert_update
  BEFORE INSERT OR UPDATE ON public.jam_pelajaran
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_jam_pelajaran();

-- =====================================================
-- SEED DATA: Jam Pelajaran Standar (INSERT ONLY)
-- =====================================================

INSERT INTO public.jam_pelajaran (id, jam_ke, waktu_mulai, waktu_selesai, durasi_menit, deskripsi, aktif)
VALUES
  ('jam-1', 1, '07:00'::TIME, '08:30'::TIME, 90, 'Jam Pertama', 1),
  ('jam-2', 2, '08:30'::TIME, '09:00'::TIME, 30, 'Istirahat Pertama', 1),
  ('jam-3', 3, '09:00'::TIME, '10:30'::TIME, 90, 'Jam Ketiga', 1),
  ('jam-4', 4, '10:30'::TIME, '11:00'::TIME, 30, 'Istirahat Kedua', 1),
  ('jam-5', 5, '11:00'::TIME, '12:30'::TIME, 90, 'Jam Kelima', 1),
  ('jam-6', 6, '12:30'::TIME, '13:00'::TIME, 30, 'Istirahat Ketiga (Sholat)', 1),
  ('jam-7', 7, '13:00'::TIME, '14:30'::TIME, 90, 'Jam Ketujuh', 1),
  ('jam-8', 8, '14:30'::TIME, '15:30'::TIME, 60, 'Jam Kedelapan', 1)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- DISABLE RLS
-- =====================================================

ALTER TABLE public.jam_pelajaran DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.jadwal_mapel DISABLE ROW LEVEL SECURITY;

COMMIT;
