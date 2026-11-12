-- =====================================================
-- AUDIT TAHAP 2A — TAHAP 2A SiPresensi
-- =====================================================
-- Query untuk memverifikasi struktur database yang ada
-- sebelum menjalankan migration 2026110709

-- 1. Verify guru table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'guru'
ORDER BY ordinal_position;

-- 2. Verify kelas table structure  
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'kelas'
ORDER BY ordinal_position;

-- 3. Verify existing jam_pelajaran (if exists)
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_name = 'jam_pelajaran'
) AS jam_pelajaran_exists;

-- 4. Verify existing jadwal_mapel (if exists)
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_name = 'jadwal_mapel'
) AS jadwal_mapel_exists;

-- 5. Verify guru data (NIP must be unique)
SELECT COUNT(*) as total_guru, COUNT(DISTINCT nip) as unique_nip
FROM public.guru;

-- 6. Verify kelas data (name must be unique)
SELECT COUNT(*) as total_kelas, COUNT(DISTINCT name) as unique_kelas
FROM public.kelas;

-- 7. Check for NULL/empty guru_id in existing jadwal_mapel (if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'jadwal_mapel'
  ) THEN
    RAISE NOTICE 'jadwal_mapel exists. Checking for NULL/invalid data...';
    
    SELECT COUNT(*) INTO @null_guru_count FROM public.jadwal_mapel WHERE guru_id IS NULL;
    SELECT COUNT(*) INTO @null_nip_count FROM public.jadwal_mapel WHERE nip IS NULL;
    SELECT COUNT(*) INTO @null_kelas_count FROM public.jadwal_mapel WHERE kelas IS NULL;
    
    RAISE NOTICE 'NULL guru_id: %, NULL nip: %, NULL kelas: %', @null_guru_count, @null_nip_count, @null_kelas_count;
  ELSE
    RAISE NOTICE 'jadwal_mapel does not exist. Safe to create.';
  END IF;
END $$;

-- 8. Check for existing constraints on jam_pelajaran (if exists)
SELECT conname, contype, pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'jam_pelajaran'::regclass
ORDER BY conname;

-- 9. Check for existing constraints on jadwal_mapel (if exists)
SELECT conname, contype, pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'jadwal_mapel'::regclass
ORDER BY conname;

-- 10. Verify seed data consistency (guru NIP match)
-- Ini harus dijalankan SEBELUM seed data insert
SELECT 
  g.id as guru_id,
  g.nip as guru_nip,
  COUNT(j.id) as jadwal_count
FROM public.guru g
LEFT JOIN public.jadwal_mapel j ON g.nip = j.nip
GROUP BY g.id, g.nip
ORDER BY g.id;

-- =====================================================
-- PRE-MIGRATION CHECK LIST
-- =====================================================

-- ✅ guru table exists dengan kolom: id (PK), nip (UNIQUE), name, mapel
-- ✅ kelas table exists dengan kolom: id (PK), name (UNIQUE), total_siswa, wali_kelas, ruangan
-- ✅ No jam_pelajaran or jadwal_mapel table yet (will be created fresh)
-- ✅ Data in guru and kelas tables (verified via query)
-- ✅ No NULL guru_id, nip, or kelas in existing jadwal_mapel (table doesn't exist)

-- Next: Run 2026110709_jadwal_mapel_schema_final_rev2.sql
