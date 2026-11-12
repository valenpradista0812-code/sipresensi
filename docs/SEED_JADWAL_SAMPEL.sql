-- =====================================================
-- SEED_JADWAL_SAMPEL.sql
-- Jadwal Sampel untuk Development/Staging SAJA
-- =====================================================
-- File ini TIDAK dijalankan di production migration.
-- Gunakan hanya untuk testing dan development.
-- 
-- Instruksi:
-- 1. Jalankan migration 2026110709_jadwal_mapel_schema_revised.sql terlebih dahulu
-- 2. Verifikasi guru & kelas sudah ada: SELECT COUNT(*) FROM guru; SELECT COUNT(*) FROM kelas;
-- 3. Barulah jalankan file ini di development/staging environment
-- 4. JANGAN jalankan di production tanpa review manual

BEGIN;

-- =====================================================
-- DATA SAMPEL: Jadwal Mingguan XII IPA 1 (Senin-Jumat)
-- =====================================================
-- Sampel ini menggunakan data guru & kelas yang sudah ada di setup database

INSERT INTO public.jadwal_mapel (
  id, guru_id, jam_ke_id, nip, name_guru, mapel, kelas, 
  hari, jam_mulai, jam_selesai, ruangan, catatan, aktif, created_by
)
VALUES
  -- SENIN - XII IPA 1
  ('jdw-001', 'gur-1', 'jam-1', '1975031201', 'Drs. Heri Susanto', 
   'Matematika', 'XII IPA 1', 'Senin', '07:00'::TIME, '08:30'::TIME, 
   'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-002', 'gur-2', 'jam-3', '1982052402', 'Sri Wahyuni, S.Pd.', 
   'Bahasa Indonesia', 'XII IPA 1', 'Senin', '09:00'::TIME, '10:30'::TIME, 
   'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-003', 'gur-3', 'jam-5', '1978100501', 'Bambang Hartono, M.Pd.', 
   'Fisika (IPA)', 'XII IPA 1', 'Senin', '11:00'::TIME, '12:30'::TIME, 
   'Lab Fisika', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-004', 'gur-4', 'jam-7', '1985121402', 'Dewi Lestari, S.Si.', 
   'Biologi (IPA)', 'XII IPA 1', 'Senin', '13:00'::TIME, '14:30'::TIME, 
   'Lab Biologi', 'Pelajaran reguler', 1, 'system'),

  -- SELASA - XII IPA 1
  ('jdw-005', 'gur-2', 'jam-1', '1982052402', 'Sri Wahyuni, S.Pd.', 
   'Bahasa Indonesia', 'XII IPA 1', 'Selasa', '07:00'::TIME, '08:30'::TIME, 
   'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-006', 'gur-7', 'jam-3', '1973022802', 'Dra. Maria Ulfah', 
   'Kimia (IPA)', 'XII IPA 1', 'Selasa', '09:00'::TIME, '10:30'::TIME, 
   'Lab Kimia', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-007', 'gur-5', 'jam-5', '1980081801', 'Ahmad Dahlan, S.Pd.', 
   'Sejarah', 'XII IPA 1', 'Selasa', '11:00'::TIME, '12:30'::TIME, 
   'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-008', 'gur-1', 'jam-7', '1975031201', 'Drs. Heri Susanto', 
   'Matematika', 'XII IPA 1', 'Selasa', '13:00'::TIME, '14:30'::TIME, 
   'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 'system'),

  -- RABU - XII IPA 1
  ('jdw-009', 'gur-3', 'jam-1', '1978100501', 'Bambang Hartono, M.Pd.', 
   'Fisika (IPA)', 'XII IPA 1', 'Rabu', '07:00'::TIME, '08:30'::TIME, 
   'Lab Fisika', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-010', 'gur-4', 'jam-3', '1985121402', 'Dewi Lestari, S.Si.', 
   'Biologi (IPA)', 'XII IPA 1', 'Rabu', '09:00'::TIME, '10:30'::TIME, 
   'Lab Biologi', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-011', 'gur-7', 'jam-5', '1973022802', 'Dra. Maria Ulfah', 
   'Kimia (IPA)', 'XII IPA 1', 'Rabu', '11:00'::TIME, '12:30'::TIME, 
   'Lab Kimia', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-012', 'gur-6', 'jam-7', '1989040301', 'Rian Hidayat, S.Or.', 
   'PJOK', 'XII IPA 1', 'Rabu', '13:00'::TIME, '14:30'::TIME, 
   'Lapangan', 'Pelajaran reguler', 1, 'system'),

  -- KAMIS - XII IPA 1
  ('jdw-013', 'gur-1', 'jam-1', '1975031201', 'Drs. Heri Susanto', 
   'Matematika', 'XII IPA 1', 'Kamis', '07:00'::TIME, '08:30'::TIME, 
   'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-014', 'gur-5', 'jam-3', '1980081801', 'Ahmad Dahlan, S.Pd.', 
   'Sejarah', 'XII IPA 1', 'Kamis', '09:00'::TIME, '10:30'::TIME, 
   'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-015', 'gur-2', 'jam-5', '1982052402', 'Sri Wahyuni, S.Pd.', 
   'Bahasa Indonesia', 'XII IPA 1', 'Kamis', '11:00'::TIME, '12:30'::TIME, 
   'Gedung A, Lantai 3', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-016', 'gur-3', 'jam-7', '1978100501', 'Bambang Hartono, M.Pd.', 
   'Fisika (IPA)', 'XII IPA 1', 'Kamis', '13:00'::TIME, '14:30'::TIME, 
   'Lab Fisika', 'Pelajaran reguler', 1, 'system'),

  -- JUMAT - XII IPA 1
  ('jdw-017', 'gur-4', 'jam-1', '1985121402', 'Dewi Lestari, S.Si.', 
   'Biologi (IPA)', 'XII IPA 1', 'Jumat', '07:00'::TIME, '08:30'::TIME, 
   'Lab Biologi', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-018', 'gur-7', 'jam-3', '1973022802', 'Dra. Maria Ulfah', 
   'Kimia (IPA)', 'XII IPA 1', 'Jumat', '09:00'::TIME, '10:30'::TIME, 
   'Lab Kimia', 'Pelajaran reguler', 1, 'system'),
   
  ('jdw-019', 'gur-6', 'jam-4', '1989040301', 'Rian Hidayat, S.Or.', 
   'PJOK', 'XII IPA 1', 'Jumat', '10:30'::TIME, '12:00'::TIME, 
   'Lapangan', 'Pelajaran reguler', 1, 'system')
ON CONFLICT (id) DO NOTHING;
-- ON CONFLICT DO NOTHING: jika sudah ada, skip

COMMIT;
