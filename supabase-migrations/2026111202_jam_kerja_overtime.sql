-- JAM KERJA & OVERTIME
-- Jalankan di Supabase SQL Editor (idempotent, boleh diulang).

-- 1. Jam pulang sekolah (acuan tap untuk pulang + perhitungan overtime).
ALTER TABLE public.pengaturan ADD COLUMN IF NOT EXISTS jam_pulang VARCHAR;

-- 2. Penanda + durasi overtime di log harian siswa (student_logs).
ALTER TABLE public.student_logs
  ADD COLUMN IF NOT EXISTS is_overtime BOOLEAN,
  ADD COLUMN IF NOT EXISTS overtime_minutes INT,
  ADD COLUMN IF NOT EXISTS jadwal_pulang VARCHAR;

-- 3. Penanda + durasi overtime di tabel absensi (dipakai halaman admin & detail siswa).
ALTER TABLE public.absensi
  ADD COLUMN IF NOT EXISTS is_overtime BOOLEAN,
  ADD COLUMN IF NOT EXISTS overtime_minutes INT,
  ADD COLUMN IF NOT EXISTS jadwal_pulang VARCHAR;