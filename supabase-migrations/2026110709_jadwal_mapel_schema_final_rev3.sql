BEGIN;

-- =====================================================
-- MIGRATION 2026110709_FINAL_REV3: Jadwal Mapel & Jam Pelajaran
-- =====================================================
-- Rev3: Using guru_id as primary identifier, NIP as denormalized snapshot
-- Policy: NIP adalah snapshot historis saat jadwal dibuat, tidak sync jika guru NIP berubah
-- Conflict detection berbasis guru_id dan kelas

-- =====================================================
-- PRE-CHECK: Validasi Tabel Dependencies
-- =====================================================

DO $$
DECLARE
  v_guru_count INT;
  v_kelas_count INT;
  v_guru_nip_null INT;
  v_kelas_name_null INT;
BEGIN
  -- Check guru table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'guru'
  ) THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Tabel guru tidak ditemukan. Jalankan setup database terlebih dahulu.';
  END IF;

  -- Check kelas table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'kelas'
  ) THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Tabel kelas tidak ditemukan. Jalankan setup database terlebih dahulu.';
  END IF;

  -- Check data exists
  SELECT COUNT(*) INTO v_guru_count FROM public.guru;
  SELECT COUNT(*) INTO v_kelas_count FROM public.kelas;
  
  IF v_guru_count = 0 THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Tabel guru kosong. Seed data guru terlebih dahulu.';
  END IF;
  
  IF v_kelas_count = 0 THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Tabel kelas kosong. Seed data kelas terlebih dahulu.';
  END IF;

  -- Check for NULL NIP in guru (should not happen based on schema)
  SELECT COUNT(*) INTO v_guru_nip_null FROM public.guru WHERE nip IS NULL;
  IF v_guru_nip_null > 0 THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Tabel guru memiliki % baris dengan NIP NULL. Perbaiki data terlebih dahulu.', v_guru_nip_null;
  END IF;

  -- Check for NULL name in kelas (should not happen based on schema)
  SELECT COUNT(*) INTO v_kelas_name_null FROM public.kelas WHERE name IS NULL;
  IF v_kelas_name_null > 0 THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Tabel kelas memiliki % baris dengan name NULL. Perbaiki data terlebih dahulu.', v_kelas_name_null;
  END IF;

  RAISE NOTICE 'Pre-check OK: % guru (NIP unique), % kelas (name unique).', v_guru_count, v_kelas_count;
END $$;

-- =====================================================
-- TABEL: jam_pelajaran
-- =====================================================

CREATE TABLE IF NOT EXISTS public.jam_pelajaran (
  id VARCHAR(50) PRIMARY KEY,
  jam_ke INT NOT NULL UNIQUE,
  waktu_mulai TIME NOT NULL,
  waktu_selesai TIME NOT NULL,
  durasi_menit INT,
  deskripsi VARCHAR(100),
  aktif INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT jam_pelajaran_waktu_valid CHECK (waktu_selesai > waktu_mulai),
  CONSTRAINT jam_pelajaran_aktif_valid CHECK (aktif IN (0, 1))
);

CREATE INDEX IF NOT EXISTS jam_pelajaran_jam_ke_idx ON public.jam_pelajaran(jam_ke);
CREATE INDEX IF NOT EXISTS jam_pelajaran_aktif_idx ON public.jam_pelajaran(aktif);
CREATE INDEX IF NOT EXISTS jam_pelajaran_waktu_idx ON public.jam_pelajaran(waktu_mulai, waktu_selesai);

-- =====================================================
-- TABEL: jadwal_mapel
-- =====================================================
-- KEBIJAKAN NIP:
-- - NIP disimpan sebagai snapshot historis saat jadwal dibuat
-- - Jika guru NIP berubah, jadwal lama tetap pakai NIP lama
-- - Deteksi bentrok menggunakan guru_id (bukan NIP) untuk konsistensi
-- - NIP disimpan di kolom terpisah untuk informasi dan validasi awal

CREATE TABLE IF NOT EXISTS public.jadwal_mapel (
  id VARCHAR(50) PRIMARY KEY,
  guru_id VARCHAR(50) NOT NULL REFERENCES public.guru(id) ON DELETE RESTRICT,
  jam_ke_id VARCHAR(50) REFERENCES public.jam_pelajaran(id) ON DELETE SET NULL,
  nip VARCHAR(30) NOT NULL,
  name_guru VARCHAR(100) NOT NULL,
  mapel VARCHAR(80) NOT NULL,
  kelas VARCHAR(30) NOT NULL,
  hari VARCHAR(15) NOT NULL,
  jam_mulai TIME NOT NULL,
  jam_selesai TIME NOT NULL,
  ruangan VARCHAR(100),
  catatan VARCHAR(200),
  aktif INT NOT NULL DEFAULT 1,
  version INT DEFAULT 1,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT jadwal_hari_valid CHECK (hari IN ('Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu')),
  CONSTRAINT jadwal_jam_valid CHECK (jam_selesai > jam_mulai),
  CONSTRAINT jadwal_aktif_valid CHECK (aktif IN (0, 1))
);

CREATE INDEX IF NOT EXISTS jadwal_mapel_guru_id_idx ON public.jadwal_mapel(guru_id);
CREATE INDEX IF NOT EXISTS jadwal_mapel_nip_idx ON public.jadwal_mapel(nip);
CREATE INDEX IF NOT EXISTS jadwal_mapel_kelas_idx ON public.jadwal_mapel(kelas);
CREATE INDEX IF NOT EXISTS jadwal_mapel_hari_idx ON public.jadwal_mapel(hari);
CREATE INDEX IF NOT EXISTS jadwal_mapel_aktif_idx ON public.jadwal_mapel(aktif);
CREATE INDEX IF NOT EXISTS jadwal_mapel_guru_kelas_hari_idx ON public.jadwal_mapel(guru_id, kelas, hari) WHERE aktif = 1;
CREATE INDEX IF NOT EXISTS jadwal_mapel_waktu_idx ON public.jadwal_mapel(jam_mulai, jam_selesai, hari) WHERE aktif = 1;

-- =====================================================
-- FUNCTION: Validasi Kelas
-- =====================================================

CREATE OR REPLACE FUNCTION public.validate_kelas_exists(p_kelas VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.kelas WHERE name = p_kelas); END;
$$;

-- =====================================================
-- FUNCTION: Validasi Jadwal (Guru ID sebagai primary key untuk deteksi bentrok)
-- =====================================================

CREATE OR REPLACE FUNCTION public.validate_jadwal_mapel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guru_nip VARCHAR;
  v_kelas_exists BOOLEAN;
  v_guru_conflict INT;
  v_kelas_conflict INT;
  v_lock_guru_id BIGINT;
  v_lock_kelas_id BIGINT;
BEGIN
  -- Validate kelas exist
  SELECT public.validate_kelas_exists(NEW.kelas) INTO v_kelas_exists;
  IF NOT v_kelas_exists THEN
    RAISE EXCEPTION 'JADWAL_KELAS_INVALID: Kelas "%" tidak ditemukan di database. Tambahkan kelas terlebih dahulu.', NEW.kelas;
  END IF;

  -- Get guru NIP for snapshot validation (optional, not for conflict detection)
  SELECT nip INTO v_guru_nip FROM public.guru WHERE id = NEW.guru_id;
  IF v_guru_nip IS NULL THEN
    RAISE EXCEPTION 'JADWAL_GURU_NOT_FOUND: Guru ID "%" tidak ditemukan di database.', NEW.guru_id;
  END IF;

  -- Lock on guru_id + hari untuk mencegah race condition
  v_lock_guru_id := (hashtext('GURU:' || NEW.guru_id || ':' || NEW.hari))::BIGINT;
  v_lock_kelas_id := (hashtext('KELAS:' || NEW.kelas || ':' || NEW.hari))::BIGINT;
  
  PERFORM pg_advisory_xact_lock(v_lock_guru_id);
  PERFORM pg_advisory_xact_lock(v_lock_kelas_id);

  -- Check guru conflict menggunakan guru_id (bukan NIP) untuk konsistensi
  -- Ini penting: jika NIP guru berubah, jadwal tetap valid karena pakai guru_id
  SELECT COUNT(*) INTO v_guru_conflict
  FROM public.jadwal_mapel
  WHERE guru_id = NEW.guru_id 
    AND hari = NEW.hari 
    AND aktif = 1 
    AND id <> NEW.id
    AND public.check_time_overlap(NEW.jam_mulai, NEW.jam_selesai, jam_mulai, jam_selesai);
  
  IF v_guru_conflict > 0 THEN
    RAISE EXCEPTION 'JADWAL_GURU_CONFLICT: Guru ID "%" sudah memiliki jadwal pada %:%-%:% di hari %', NEW.guru_id, NEW.jam_mulai, NEW.jam_selesai, NEW.hari;
  END IF;

  -- Check kelas conflict
  SELECT COUNT(*) INTO v_kelas_conflict
  FROM public.jadwal_mapel
  WHERE kelas = NEW.kelas 
    AND hari = NEW.hari 
    AND aktif = 1 
    AND id <> NEW.id
    AND public.check_time_overlap(NEW.jam_mulai, NEW.jam_selesai, jam_mulai, jam_selesai);
  
  IF v_kelas_conflict > 0 THEN
    RAISE EXCEPTION 'JADWAL_KELAS_CONFLICT: Kelas "%" sudah memiliki pelajaran pada %:%-%:% di hari %', NEW.kelas, NEW.jam_mulai, NEW.jam_selesai, NEW.hari;
  END IF;

  -- Version increment
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
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.waktu_selesai <= NEW.waktu_mulai THEN
    RAISE EXCEPTION 'JAM_PELAJARAN_INVALID: Waktu selesai (%) harus lebih besar dari waktu mulai (%)', NEW.waktu_selesai, NEW.waktu_mulai;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- =====================================================
-- FUNCTION: Check Time Overlap
-- =====================================================

CREATE OR REPLACE FUNCTION public.check_time_overlap(
  p_start_1 TIME, p_end_1 TIME, p_start_2 TIME, p_end_2 TIME
) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN p_start_1 < p_end_2 AND p_start_2 < p_end_1; END;
$$;

-- =====================================================
-- TRIGGER: Validasi Jadwal
-- =====================================================

DROP TRIGGER IF EXISTS trigger_validate_jadwal_mapel_insert_update ON public.jadwal_mapel;
CREATE TRIGGER trigger_validate_jadwal_mapel_insert_update
  BEFORE INSERT OR UPDATE ON public.jadwal_mapel
  FOR EACH ROW EXECUTE FUNCTION public.validate_jadwal_mapel();

-- =====================================================
-- TRIGGER: Validasi Jam Pelajaran
-- =====================================================

DROP TRIGGER IF EXISTS trigger_validate_jam_pelajaran_insert_update ON public.jam_pelajaran;
CREATE TRIGGER trigger_validate_jam_pelajaran_insert_update
  BEFORE INSERT OR UPDATE ON public.jam_pelajaran
  FOR EACH ROW EXECUTE FUNCTION public.validate_jam_pelajaran();

-- =====================================================
-- SEED DATA: Jam Pelajaran Standar
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
-- DISABLE RLS (for Express backend)
-- =====================================================

ALTER TABLE public.jam_pelajaran DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.jadwal_mapel DISABLE ROW LEVEL SECURITY;

COMMIT;
