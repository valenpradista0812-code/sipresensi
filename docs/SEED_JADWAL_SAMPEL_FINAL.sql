-- =====================================================
-- SEED_JADWAL_SAMPEL_FINAL.sql
-- Jadwal Sampel untuk Development/Staging SAJA
-- =====================================================
-- PENTING:
-- 1. File ini HANYA untuk dev/staging, JANGAN production
-- 2. Jalankan migration 2026110709_jadwal_mapel_schema_final.sql terlebih dahulu
-- 3. Verifikasi guru & kelas ada sebelum insert
-- 4. Semua guru_id, NIP, dan nama guru harus cocok dengan data guru

BEGIN;

-- =====================================================
-- STRICT PRE-CHECK: Verifikasi Data Guru & Kelas
-- =====================================================

DO $$
DECLARE
  v_guru_count INT;
  v_kelas_count INT;
  v_gur1_nip VARCHAR;
  v_gur2_nip VARCHAR;
  v_gur3_nip VARCHAR;
  v_gur4_nip VARCHAR;
  v_gur5_nip VARCHAR;
  v_gur6_nip VARCHAR;
  v_gur7_nip VARCHAR;
BEGIN
  SELECT COUNT(*) INTO v_guru_count FROM public.guru;
  SELECT COUNT(*) INTO v_kelas_count FROM public.kelas;
  
  IF v_guru_count = 0 THEN
    RAISE EXCEPTION 'SEED_BLOCKED: Tidak ada data guru. Jalankan supabase-setup.sql terlebih dahulu.';
  END IF;
  
  IF v_kelas_count = 0 THEN
    RAISE EXCEPTION 'SEED_BLOCKED: Tidak ada data kelas. Jalankan supabase-setup.sql terlebih dahulu.';
  END IF;

  -- Verify guru exist dengan NIP yang sesuai
  SELECT nip INTO v_gur1_nip FROM public.guru WHERE id = 'gur-1';
  IF v_gur1_nip IS NULL THEN
    RAISE EXCEPTION 'SEED_BLOCKED: guru id=gur-1 tidak ditemukan.';
  END IF;
  IF v_gur1_nip <> '1975031201' THEN
    RAISE EXCEPTION 'SEED_BLOCKED: guru gur-1 NIP % tidak cocok (expected 1975031201).', v_gur1_nip;
  END IF;

  SELECT nip INTO v_gur2_nip FROM public.guru WHERE id = 'gur-2';
  IF v_gur2_nip IS NULL OR v_gur2_nip <> '1982052402' THEN
    RAISE EXCEPTION 'SEED_BLOCKED: guru gur-2 tidak valid atau NIP tidak cocok.';
  END IF;

  SELECT nip INTO v_gur3_nip FROM public.guru WHERE id = 'gur-3';
  IF v_gur3_nip IS NULL OR v_gur3_nip <> '1978100501' THEN
    RAISE EXCEPTION 'SEED_BLOCKED: guru gur-3 tidak valid atau NIP tidak cocok.';
  END IF;

  SELECT nip INTO v_gur4_nip FROM public.guru WHERE id = 'gur-4';
  IF v_gur4_nip IS NULL OR v_gur4_nip <> '1985121402' THEN
    RAISE EXCEPTION 'SEED_BLOCKED: guru gur-4 tidak valid atau NIP tidak cocok.';
  END IF;

  SELECT nip INTO v_gur5_nip FROM public.guru WHERE id = 'gur-5';
  IF v_gur5_nip IS NULL OR v_gur5_nip <> '1980081801' THEN
    RAISE EXCEPTION 'SEED_BLOCKED: guru gur-5 tidak valid atau NIP tidak cocok.';
  END IF;

  SELECT nip INTO v_gur6_nip FROM public.guru WHERE id = 'gur-6';
  IF v_gur6_nip IS NULL OR v_gur6_nip <> '1989040301' THEN
    RAISE EXCEPTION 'SEED_BLOCKED: guru gur-6 tidak valid atau NIP tidak cocok.';
  END IF;

  SELECT nip INTO v_gur7_nip FROM public.guru WHERE id = 'gur-7';
  IF v_gur7_nip IS NULL OR v_gur7_nip <> '1973022802' THEN
    RAISE EXCEPTION 'SEED_BLOCKED: guru gur-7 tidak valid atau NIP tidak cocok.';
  END IF;

  -- Verify kelas XII IPA 1 exists
  IF NOT EXISTS (SELECT 1 FROM public.kelas WHERE name = 'XII IPA 1') THEN
    RAISE EXCEPTION 'SEED_BLOCKED: Kelas XII IPA 1 tidak ditemukan.';
  END IF;

  RAISE NOTICE 'Pre-check OK: % guru, % kelas ditemukan. Semua guru NIP cocok.', v_guru_count, v_kelas_count;
END $$;

-- =====================================================
-- DATA SAMPEL: Jadwal Mingguan XII IPA 1 (Senin-Jumat)
-- =====================================================

INSERT INTO public.jadwal_mapel (
  id, guru_id, jam_ke_id, nip, name_guru, mapel, kelas, 
  hari, jam_mulai, jam_selesai, ruangan, catatan, aktif, version, created_by
)
VALUES
  ('jdw-001', 'gur-1', 'jam-1', '1975031201', 'Drs. Heri Susanto', 'Matematika', 'XII IPA 1', 'Senin', '07:00'::TIME, '08:30'::TIME, 'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-002', 'gur-2', 'jam-3', '1982052402', 'Sri Wahyuni, S.Pd.', 'Bahasa Indonesia', 'XII IPA 1', 'Senin', '09:00'::TIME, '10:30'::TIME, 'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-003', 'gur-3', 'jam-5', '1978100501', 'Bambang Hartono, M.Pd.', 'Fisika (IPA)', 'XII IPA 1', 'Senin', '11:00'::TIME, '12:30'::TIME, 'Lab Fisika', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-004', 'gur-4', 'jam-7', '1985121402', 'Dewi Lestari, S.Si.', 'Biologi (IPA)', 'XII IPA 1', 'Senin', '13:00'::TIME, '14:30'::TIME, 'Lab Biologi', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-005', 'gur-2', 'jam-1', '1982052402', 'Sri Wahyuni, S.Pd.', 'Bahasa Indonesia', 'XII IPA 1', 'Selasa', '07:00'::TIME, '08:30'::TIME, 'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-006', 'gur-7', 'jam-3', '1973022802', 'Dra. Maria Ulfah', 'Kimia (IPA)', 'XII IPA 1', 'Selasa', '09:00'::TIME, '10:30'::TIME, 'Lab Kimia', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-007', 'gur-5', 'jam-5', '1980081801', 'Ahmad Dahlan, S.Pd.', 'Sejarah', 'XII IPA 1', 'Selasa', '11:00'::TIME, '12:30'::TIME, 'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-008', 'gur-1', 'jam-7', '1975031201', 'Drs. Heri Susanto', 'Matematika', 'XII IPA 1', 'Selasa', '13:00'::TIME, '14:30'::TIME, 'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-009', 'gur-3', 'jam-1', '1978100501', 'Bambang Hartono, M.Pd.', 'Fisika (IPA)', 'XII IPA 1', 'Rabu', '07:00'::TIME, '08:30'::TIME, 'Lab Fisika', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-010', 'gur-4', 'jam-3', '1985121402', 'Dewi Lestari, S.Si.', 'Biologi (IPA)', 'XII IPA 1', 'Rabu', '09:00'::TIME, '10:30'::TIME, 'Lab Biologi', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-011', 'gur-7', 'jam-5', '1973022802', 'Dra. Maria Ulfah', 'Kimia (IPA)', 'XII IPA 1', 'Rabu', '11:00'::TIME, '12:30'::TIME, 'Lab Kimia', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-012', 'gur-6', 'jam-7', '1989040301', 'Rian Hidayat, S.Or.', 'PJOK', 'XII IPA 1', 'Rabu', '13:00'::TIME, '14:30'::TIME, 'Lapangan', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-013', 'gur-1', 'jam-1', '1975031201', 'Drs. Heri Susanto', 'Matematika', 'XII IPA 1', 'Kamis', '07:00'::TIME, '08:30'::TIME, 'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-014', 'gur-5', 'jam-3', '1980081801', 'Ahmad Dahlan, S.Pd.', 'Sejarah', 'XII IPA 1', 'Kamis', '09:00'::TIME, '10:30'::TIME, 'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-015', 'gur-2', 'jam-5', '1982052402', 'Sri Wahyuni, S.Pd.', 'Bahasa Indonesia', 'XII IPA 1', 'Kamis', '11:00'::TIME, '12:30'::TIME, 'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-016', 'gur-3', 'jam-7', '1978100501', 'Bambang Hartono, M.Pd.', 'Fisika (IPA)', 'XII IPA 1', 'Kamis', '13:00'::TIME, '14:30'::TIME, 'Lab Fisika', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-017', 'gur-4', 'jam-1', '1985121402', 'Dewi Lestari, S.Si.', 'Biologi (IPA)', 'XII IPA 1', 'Jumat', '07:00'::TIME, '08:30'::TIME, 'Lab Biologi', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-018', 'gur-7', 'jam-3', '1973022802', 'Dra. Maria Ulfah', 'Kimia (IPA)', 'XII IPA 1', 'Jumat', '09:00'::TIME, '10:30'::TIME, 'Lab Kimia', 'Pelajaran reguler', 1, 1, 'system'),
  ('jdw-019', 'gur-6', 'jam-8', '1989040301', 'Rian Hidayat, S.Or.', 'PJOK', 'XII IPA 1', 'Jumat', '14:30'::TIME, '15:30'::TIME, 'Lapangan', 'Pelajaran reguler', 1, 1, 'system')
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- POST-INSERT VERIFICATION & ERROR CHECK
-- =====================================================

DO $$
DECLARE
  v_inserted INT;
  v_conflict INT;
BEGIN
  SELECT COUNT(*) INTO v_inserted FROM public.jadwal_mapel WHERE created_by = 'system';
  
  IF v_inserted = 0 THEN
    RAISE EXCEPTION 'SEED_FAILED: Tidak ada jadwal yang diinsert. Periksa constraint dan foreign key.';
  END IF;

  SELECT COUNT(*) INTO v_conflict FROM public.jadwal_mapel j1
    WHERE aktif = 1 AND EXISTS (
      SELECT 1 FROM public.jadwal_mapel j2
      WHERE j1.nip = j2.nip AND j1.hari = j2.hari AND j1.id < j2.id
        AND j1.aktif = 1 AND j2.aktif = 1
        AND j1.jam_mulai < j2.jam_selesai AND j2.jam_mulai < j1.jam_selesai
    );

  IF v_conflict > 0 THEN
    RAISE EXCEPTION 'SEED_FAILED: Ditemukan % jadwal guru yang bentrok. Periksa overlap waktu.', v_conflict;
  END IF;

  RAISE NOTICE 'SEED VERIFICATION OK: % jadwal berhasil diinsert, tidak ada konflik.', v_inserted;
END $$;

COMMIT;
