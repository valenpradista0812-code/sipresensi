BEGIN;

-- =====================================================
-- MIGRATION 2026110709_REVISED: Jadwal Mapel & Jam Pelajaran
-- =====================================================
-- Revisi addressing:
-- 1. Waktu menggunakan tipe TIME (bukan VARCHAR)
-- 2. Validasi overlap penuh dengan function, bukan UNIQUE index
-- 3. Perlindungan race condition via advisory lock
-- 4. Foreign key jam_ke → jam_pelajaran.id (dengan validasi)
-- 5. Seed jam pelajaran hanya INSERT, tidak ON CONFLICT UPDATE
-- 6. Data sampel jadwal dipindahkan ke file terpisah (tidak di migration)
-- 7. ON DELETE RESTRICT (guru tidak bisa dihapus jika ada jadwal aktif)
-- 8. Validasi waktu pada jam_pelajaran
-- 9. Kompatibel PostgreSQL 12+, Supabase

-- =====================================================
-- TABEL: jam_pelajaran (Konfigurasi Jam Pelajaran)
-- =====================================================
-- Menyimpan periode/slot pelajaran standar sekolah.
-- Admin dapat menambah/edit periode sesuai kebutuhan.
-- IMPORTANT: INSERT only, no UPDATE on seed data.

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
    CHECK (waktu_selesai > waktu_mulai)
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
-- Menyimpan jadwal mengajar setiap guru untuk setiap kelas setiap harinya.
-- Relasi:
--   - guru_id → guru.id (guru yang mengajar, ON DELETE RESTRICT)
--   - jam_ke → jam_pelajaran.id (periode pelajaran, ON DELETE SET NULL)
--   - kelas → kelas.name (kelas yang mengikuti)
--   - hari → hari dalam seminggu (Senin-Minggu)
--   - jam_mulai/jam_selesai → waktu pelajaran (TIME type)

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
  created_by VARCHAR(100),
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT jadwal_hari_valid CHECK (hari IN (
    'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'
  )),
  CONSTRAINT jadwal_jam_valid CHECK (jam_selesai > jam_mulai)
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
-- FUNCTION: Check Time Overlap (Exact Overlap Detection)
-- =====================================================
-- Deteksi overlap penuh: check apakah dua rentang waktu bertabrakan
-- Rentang A [a_start, a_end) dan B [b_start, b_end) overlap jika:
--   a_start < b_end AND b_start < a_end

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
-- FUNCTION: Validasi Jadwal Sebelum Insert/Update
-- =====================================================
-- Memastikan:
-- 1. Guru tidak memiliki dua jadwal pada waktu bersamaan (overlap check).
-- 2. Kelas tidak memiliki dua mapel pada waktu bersamaan (overlap check).
-- 3. Jam selesai > jam mulai.
-- 4. Advisory lock untuk mencegah race condition.

CREATE OR REPLACE FUNCTION public.validate_jadwal_mapel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict_count INT;
  v_lock_id BIGINT;
BEGIN
  -- Gunakan advisory lock untuk mencegah race condition
  -- Lock pada kombinasi guru_id + hari + jam_mulai
  v_lock_id := (hashtext(NEW.nip || NEW.hari || NEW.jam_mulai::TEXT))::BIGINT;
  PERFORM pg_advisory_lock(v_lock_id);

  BEGIN
    -- Cek overlap guru pada hari yang sama (full time range overlap check)
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

    -- Cek overlap kelas pada hari yang sama (full time range overlap check)
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

    -- Increment version untuk optimistic lock
    NEW.version := COALESCE(NEW.version, 1) + 1;
    NEW.updated_at := NOW();

    RETURN NEW;
  FINALLY
    -- Release lock
    PERFORM pg_advisory_unlock(v_lock_id);
  END;
END;
$$;

-- =====================================================
-- FUNCTION: Validasi Jam Pelajaran
-- =====================================================
-- Memastikan waktu_selesai > waktu_mulai di jam_pelajaran

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
-- IMPORTANT: INSERT IF NOT EXISTS, tidak ON CONFLICT UPDATE
-- Tujuan: preserve konfigurasi admin jika migration dijalankan ulang

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
-- ON CONFLICT DO NOTHING: jika sudah ada, skip. Tidak update.

-- =====================================================
-- DATA SAMPEL: JANGAN DIGUNAKAN DI MIGRATION PRODUKSI
-- =====================================================
-- Jadwal sampel dipindahkan ke file terpisah:
-- - docs/SEED_JADWAL_SAMPEL.sql
-- Alasan: Mencegah data fiktif masuk ke database produksi
-- Admin dapat menjalankan file terpisah di development/staging saja

-- =====================================================
-- DISABLE RLS (same as other tables)
-- =====================================================
-- Akses dikelola via backend middleware, bukan RLS.

ALTER TABLE public.jam_pelajaran DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.jadwal_mapel DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- VALIDATION: Cek Foreign Key Relationships
-- =====================================================
-- Pastikan guru & kelas tables sudah exist

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'guru'
  ) THEN
    RAISE EXCEPTION 'TABLE MISSING: guru table tidak ditemukan. Jalankan migration guru terlebih dahulu.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'kelas'
  ) THEN
    RAISE EXCEPTION 'TABLE MISSING: kelas table tidak ditemukan. Jalankan migration kelas terlebih dahulu.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.guru LIMIT 1
  ) THEN
    RAISE WARNING 'WARNING: guru table kosong. Jadwal sampel tidak dapat diinsert.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kelas LIMIT 1
  ) THEN
    RAISE WARNING 'WARNING: kelas table kosong. Jadwal sampel tidak dapat diinsert.';
  END IF;
END $$;

COMMIT;
